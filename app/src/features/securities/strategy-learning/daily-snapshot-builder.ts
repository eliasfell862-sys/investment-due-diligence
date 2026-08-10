import type { StockKLine } from '../../../infrastructure/market-data/stock-api';
import { calcAllIndicators } from '../../../engines/market-analysis/technical-indicators';
import type { TechnicalStrategyConfig } from './technical-strategy-config';
import type { ReviewDataQuality, StrategyLearningSnapshot } from './types';

interface PositionLike { code: string }
export interface DailySnapshotInput<TVirtualLedger extends object = Record<string, unknown>> {
  tradingDate: string;
  strategyConfig: TechnicalStrategyConfig;
  watchlistCodes: string[];
  actualPositions: PositionLike[];
  virtualLedger: TVirtualLedger & { positions: PositionLike[] };
  marketRegime: string;
  dataSources: string[];
  loadBars: (code: string, limit: number) => Promise<StockKLine[]>;
  actualLedger?: unknown;
  capturedAt?: string;
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
};

const sha256 = async (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

async function mapWithConcurrency<T, R>(values: T[], limit: number, task: (value: T) => Promise<R>) {
  const result = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await task(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return result;
}

export async function buildDailyReviewSnapshot<TVirtualLedger extends object>(
  input: DailySnapshotInput<TVirtualLedger>,
): Promise<StrategyLearningSnapshot> {
  const codes = [...new Set([
    ...input.watchlistCodes,
    ...input.actualPositions.map(position => position.code),
    ...input.virtualLedger.positions.map(position => position.code),
  ].map(code => code.trim()).filter(Boolean))].sort();

  const blockingIssues: string[] = [];
  const entries = await mapWithConcurrency(codes, 8, async code => {
    const bars = structuredClone(await input.loadBars(code, 250))
      .filter(bar => bar.date <= input.tradingDate)
      .sort((left, right) => left.date.localeCompare(right.date));
    calcAllIndicators(bars);
    if (bars.length < 60) blockingIssues.push(`${code}可用K线少于60个交易日`);
    return [code, { code, bars }] as const;
  });

  blockingIssues.sort();
  const stocks = Object.fromEntries(entries);
  const dataQuality: ReviewDataQuality = {
    completeness: codes.length === 0 ? 1 : (codes.length - blockingIssues.length) / codes.length,
    blockingIssues,
  };
  const frozen = {
    tradingDate: input.tradingDate,
    strategyId: input.strategyConfig.strategyId,
    strategyVersion: input.strategyConfig.version,
    strategyConfig: structuredClone(input.strategyConfig),
    stocks,
    watchlistCodes: structuredClone(codes),
    actualPositions: structuredClone(input.actualPositions),
    virtualLedger: structuredClone(input.virtualLedger),
    actualLedger: structuredClone(input.actualLedger),
    marketRegime: input.marketRegime,
    dataSources: [...input.dataSources].sort(),
    dataQuality,
  };
  const inputHash = await sha256(frozen);
  return {
    id: `snapshot-${input.tradingDate}-${input.strategyConfig.strategyId}-${input.strategyConfig.version}-${inputHash.slice(0, 12)}`,
    ...frozen,
    capturedAt: input.capturedAt ?? `${input.tradingDate}T07:10:00.000Z`,
    inputHash,
    payload: structuredClone(frozen) as unknown as Record<string, unknown>,
  };
}
