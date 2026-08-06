import type { AStockDirectoryItem, StockQuote } from '../../../infrastructure/market-data/stock-api';
import type { MultiDayCapitalFlow } from '../../../infrastructure/market-data/pre-move-market-data-api';
import type { PreMoveCandidateSource } from './types';

export interface PreMoveCandidateSeed {
  code: string;
  name: string;
  industry: string | null;
  source: PreMoveCandidateSource;
  industryRank: number | null;
}

export interface IndustryScreenInput {
  industry: string;
  rank: number;
  returnPercentile: number;
  flowPercentile: number;
  breadthPercentile: number;
  relativeStrengthSlopePercentile: number;
}

export interface CandidateUniverseInput {
  watchlistCodes: string[];
  directory: AStockDirectoryItem[];
  quotes: StockQuote[];
  industries: IndustryScreenInput[];
  capitalFlows: MultiDayCapitalFlow[];
  maxRotationCandidates?: number;
}

function composite(row: IndustryScreenInput): number {
  return (row.returnPercentile + row.flowPercentile + row.breadthPercentile + row.relativeStrengthSlopePercentile) / 4;
}

export function selectStrengtheningIndustries(rows: IndustryScreenInput[], limit = 10): string[] {
  return [...rows]
    .filter(row => composite(row) >= 60)
    .sort((a, b) => composite(b) - composite(a) || a.rank - b.rank || a.industry.localeCompare(b.industry))
    .slice(0, Math.max(0, limit))
    .map(row => row.industry);
}

export function buildPreMoveCandidateUniverse(input: CandidateUniverseInput): PreMoveCandidateSeed[] {
  const maxRotation = Math.max(0, input.maxRotationCandidates ?? 200);
  const directoryByCode = new Map(input.directory.map(item => [item.code, item]));
  const quoteByCode = new Map(input.quotes.map(item => [item.code, item]));
  const flowByCode = new Map(input.capitalFlows.map(item => [item.code, item]));
  const selectedIndustries = new Set(selectStrengtheningIndustries(input.industries));
  const rankByIndustry = new Map(input.industries.map(item => [item.industry, item.rank]));
  const watchlist = new Set(input.watchlistCodes);

  const rotation = input.directory
    .filter(item => item.classificationStatus === 'official' && selectedIndustries.has(item.industry))
    .filter(item => {
      const quote = quoteByCode.get(item.code);
      return quote && quote.price > 0 && quote.amount > 0 && !/ST|退/i.test(item.name);
    })
    .map(item => {
      const quote = quoteByCode.get(item.code)!;
      const flow = flowByCode.get(item.code);
      const score = (flow?.mainNet10d ?? flow?.mainNet5d ?? 0)
        + quote.amount * 0.01 + (flow?.changePct5d ?? 0) * 100
        - Math.max(0, quote.changePct - 7) * 1000;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score || a.item.code.localeCompare(b.item.code))
    .slice(0, maxRotation)
    .map(({ item }) => item);
  const rotationCodes = new Set(rotation.map(item => item.code));

  const result: PreMoveCandidateSeed[] = rotation.map(item => ({
    code: item.code, name: item.name, industry: item.industry,
    source: watchlist.has(item.code) ? 'watchlist_and_rotation' : 'rotation',
    industryRank: rankByIndustry.get(item.industry) ?? null,
  }));

  for (const code of [...watchlist].sort()) {
    if (rotationCodes.has(code)) continue;
    const item = directoryByCode.get(code);
    const quote = quoteByCode.get(code);
    result.push({ code, name: item?.name ?? quote?.name ?? code,
      industry: item?.industry && item.industry !== '未分类' ? item.industry : null,
      source: 'watchlist', industryRank: item?.industry ? rankByIndustry.get(item.industry) ?? null : null });
  }
  return result;
}