import {
  buildMediumTermBuyAdvice,
  type MediumTermBuyAdvice,
  type MediumTermBuyAdviceInput,
} from '../../../engines/market-analysis/medium-term-buy-advice';
import {
  buildShortTermTradingAdvice,
  type ShortTermAdviceBaseInput,
  type ShortTermTradingAdvice,
} from '../../../engines/market-analysis/short-term-trading-advice';
import { scoreFundamentals, type FundamentalScore } from '../../../engines/market-analysis/fundamental-scorer';
import { scanPatterns, type PatternResult } from '../../../engines/market-analysis/kline-patterns';
import { calcAllIndicators } from '../../../engines/market-analysis/technical-indicators';
import { scanStrategies, type StrategySignal } from '../../../engines/market-analysis/trading-strategies';
import {
  fetchEastmoneyBasic,
  fetchEastmoneyKLine,
  type DailyBasicData,
  type StockKLine,
  type StockQuote,
} from '../../../infrastructure/market-data/stock-api';
import { computeRealtimePriceTargets, type RealtimePriceTargets } from '../realtime-price-targets';
import type { LiveTradingCandidate, LiveTradingFormalTargets } from './live-trading-types';

export const LIVE_TRADING_CANDIDATE_CACHE_TTL_MS = 5 * 60 * 1_000;
export const LIVE_TRADING_CANDIDATE_MAX_CONCURRENCY = 2;

export interface LiveTradingCandidateScannerInput {
  accountId: string;
  codes: string[];
  quotes: Readonly<Record<string, StockQuote>>;
  force?: boolean;
}

export interface LiveTradingCandidateScannerDependencies {
  fetchKLine: (code: string, count: number) => Promise<StockKLine[]>;
  fetchBasic: (code: string) => Promise<DailyBasicData | null>;
  calcIndicators: (rows: StockKLine[]) => void;
  scanStrategies: (rows: StockKLine[]) => StrategySignal[];
  scanPatterns: (rows: StockKLine[]) => PatternResult[];
  scoreFundamentals: (quote: StockQuote, rows: StockKLine[], basic: DailyBasicData | null) => FundamentalScore;
  buildMediumAdvice: (input: MediumTermBuyAdviceInput) => MediumTermBuyAdvice;
  buildShortAdvice: (input: ShortTermAdviceBaseInput) => ShortTermTradingAdvice;
  computeTargets: (rows: StockKLine[], quote: StockQuote) => RealtimePriceTargets | null;
  now: () => number;
}

interface AnalysisBase {
  rows: StockKLine[];
  basic: DailyBasicData | null;
  strategies: StrategySignal[];
  patterns: PatternResult[];
  expiresAt: number;
  fetchFailed: boolean;
}

const analysisCache = new Map<string, AnalysisBase>();

const defaults: LiveTradingCandidateScannerDependencies = {
  fetchKLine: fetchEastmoneyKLine,
  fetchBasic: fetchEastmoneyBasic,
  calcIndicators: calcAllIndicators,
  scanStrategies,
  scanPatterns,
  scoreFundamentals,
  buildMediumAdvice: buildMediumTermBuyAdvice,
  buildShortAdvice: buildShortTermTradingAdvice,
  computeTargets: computeRealtimePriceTargets,
  now: Date.now,
};

export function clearLiveTradingCandidateCache(accountId?: string): void {
  if (!accountId) {
    analysisCache.clear();
    return;
  }
  const prefix = `${accountId}:`;
  for (const key of analysisCache.keys()) {
    if (key.startsWith(prefix)) analysisCache.delete(key);
  }
}

async function loadAnalysisBase(
  accountId: string,
  code: string,
  force: boolean,
  dependencies: LiveTradingCandidateScannerDependencies,
): Promise<{ base: AnalysisBase; cacheStatus: 'fresh' | 'cached' }> {
  const cacheKey = `${accountId}:${code}`;
  const cached = analysisCache.get(cacheKey);
  if (!force && cached && cached.expiresAt > dependencies.now()) {
    return { base: cached, cacheStatus: 'cached' };
  }

  const [rowsResult, basic] = await Promise.all([
    dependencies.fetchKLine(code, 120).then(rows => ({ rows, failed: false })).catch(() => ({ rows: [], failed: true })),
    dependencies.fetchBasic(code).catch(() => null),
  ]);
  const rows = rowsResult.rows.map(row => ({ ...row }));
  if (rows.length > 0) dependencies.calcIndicators(rows);
  const base: AnalysisBase = {
    rows,
    basic,
    strategies: rows.length > 0 ? dependencies.scanStrategies(rows) : [],
    patterns: rows.length > 0 ? dependencies.scanPatterns(rows) : [],
    expiresAt: dependencies.now() + LIVE_TRADING_CANDIDATE_CACHE_TTL_MS,
    fetchFailed: rowsResult.failed,
  };
  analysisCache.set(cacheKey, base);
  return { base, cacheStatus: 'fresh' };
}

const numericTarget = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

function normalizeTargets(targets: RealtimePriceTargets | null): LiveTradingFormalTargets {
  return {
    buyPrice: targets ? numericTarget(targets.buyPrice) : 0,
    sellPrice: targets ? numericTarget(targets.sellPrice) : 0,
    stopLoss: targets ? numericTarget(targets.stopLoss) : 0,
    supportLevel: targets ? numericTarget(targets.supportLevel) : 0,
    resistanceLevel: targets ? numericTarget(targets.resistanceLevel) : 0,
    atr: targets ? numericTarget(targets.atr) : 0,
  };
}

async function scanOne(
  accountId: string,
  code: string,
  quote: StockQuote,
  force: boolean,
  dependencies: LiveTradingCandidateScannerDependencies,
): Promise<LiveTradingCandidate> {
  const { base, cacheStatus } = await loadAnalysisBase(accountId, code, force, dependencies);
  let fundamental: FundamentalScore | null = null;
  if (base.basic && base.rows.length > 0) {
    try {
      fundamental = dependencies.scoreFundamentals(quote, base.rows, base.basic);
    } catch {
      fundamental = null;
    }
  }
  const calculatedAt = new Date(dependencies.now()).toISOString();
  const dataAsOf = base.rows.at(-1)?.date ?? calculatedAt;
  const mediumAdvice = dependencies.buildMediumAdvice({
    quote,
    klines: base.rows,
    fundamental,
    hasFinancialData: fundamental !== null,
    strategies: base.strategies,
    patterns: base.patterns,
    calculatedAt,
  });
  const shortAdvice = dependencies.buildShortAdvice({
    quote,
    klines: base.rows,
    strategies: base.strategies,
    patterns: base.patterns,
    dataAsOf,
    calculatedAt,
    cacheStatus,
  });
  const rawTargets = dependencies.computeTargets(base.rows, quote);
  const formalTargets = normalizeTargets(rawTargets);
  const failureReasons: string[] = [];
  if (base.fetchFailed) failureReasons.push('kline_fetch_failed');
  if (base.rows.length < 60) failureReasons.push('kline_insufficient');
  if (mediumAdvice.action === 'insufficient_data') failureReasons.push('medium_advice_insufficient');
  if (shortAdvice.action === 'insufficient_data') failureReasons.push('short_advice_insufficient');
  if (!rawTargets || Object.values(formalTargets).some(value => value <= 0)) failureReasons.push('formal_targets_missing');

  return {
    code,
    name: quote.name || code,
    price: quote.price,
    shortAdvice,
    mediumAdvice,
    formalTargets,
    combinedScore: mediumAdvice.score * 0.6 + shortAdvice.score * 0.4,
    dataFresh: failureReasons.length === 0,
    dataAsOf,
    failureReasons,
  };
}

export async function scanLiveTradingCandidates(
  input: LiveTradingCandidateScannerInput,
  dependencyOverrides: Partial<LiveTradingCandidateScannerDependencies> = {},
): Promise<LiveTradingCandidate[]> {
  const dependencies = { ...defaults, ...dependencyOverrides };
  const jobs = input.codes
    .map(code => ({ code, quote: input.quotes[code] }))
    .filter((job): job is { code: string; quote: StockQuote } => Boolean(job.quote));
  const results = new Array<LiveTradingCandidate>(jobs.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const index = cursor++;
      const job = jobs[index];
      results[index] = await scanOne(
        input.accountId,
        job.code,
        job.quote,
        Boolean(input.force),
        dependencies,
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(LIVE_TRADING_CANDIDATE_MAX_CONCURRENCY, jobs.length) }, () => worker()),
  );
  return results;
}
