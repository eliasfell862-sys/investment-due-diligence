import { buildMediumTermBuyAdvice, type MediumTermBuyAdvice, type MediumTermBuyAdviceInput } from '../../engines/market-analysis/medium-term-buy-advice';
import { scoreFundamentals, type FundamentalScore } from '../../engines/market-analysis/fundamental-scorer';
import { scanPatterns, type PatternResult } from '../../engines/market-analysis/kline-patterns';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import { scanStrategies, type StrategySignal } from '../../engines/market-analysis/trading-strategies';
import {
  fetchEastmoneyBasic,
  fetchEastmoneyKLine,
  type DailyBasicData,
  type StockKLine,
  type StockQuote,
} from '../../infrastructure/market-data/stock-api';

export const WATCHLIST_ADVICE_CACHE_KEY = 'sec_watchlist_buy_advice_cache_v2';
export const WATCHLIST_ADVICE_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
export const WATCHLIST_ADVICE_MAX_CONCURRENCY = 4;

export type WatchlistAdviceTaskState =
  | { status: 'waiting' }
  | { status: 'loading' }
  | { status: 'success'; advice: MediumTermBuyAdvice }
  | { status: 'error'; error: string };

export interface WatchlistAdviceDependencies {
  fetchKLine: (code: string, count: number) => Promise<StockKLine[]>;
  fetchBasic: (code: string) => Promise<DailyBasicData | null>;
  calcIndicators: (klines: StockKLine[]) => void;
  scanStrategies: (klines: StockKLine[]) => StrategySignal[];
  scanPatterns: (klines: StockKLine[]) => PatternResult[];
  scoreFundamentals: (quote: StockQuote, klines: StockKLine[], financial?: DailyBasicData | null) => FundamentalScore;
  buildAdvice: (input: MediumTermBuyAdviceInput) => MediumTermBuyAdvice;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now: () => number;
}

export interface AnalyzeWatchlistOptions {
  force?: boolean;
  maxConcurrency?: number;
  shouldPublish?: () => boolean;
  onUpdate: (code: string, state: WatchlistAdviceTaskState) => void;
}

interface AdviceCacheEntry {
  expiresAt: number;
  advice: MediumTermBuyAdvice;
}
type AdviceCache = Record<string, AdviceCacheEntry>;

const defaultDependencies = (): WatchlistAdviceDependencies => ({
  fetchKLine: fetchEastmoneyKLine,
  fetchBasic: fetchEastmoneyBasic,
  calcIndicators: calcAllIndicators,
  scanStrategies,
  scanPatterns,
  scoreFundamentals,
  buildAdvice: buildMediumTermBuyAdvice,
  storage: globalThis.localStorage,
  now: Date.now,
});

function dependenciesWith(overrides: Partial<WatchlistAdviceDependencies> = {}): WatchlistAdviceDependencies {
  return { ...defaultDependencies(), ...overrides };
}

function readCache(storage: Pick<Storage, 'getItem'>): AdviceCache {
  try {
    const raw = storage.getItem(WATCHLIST_ADVICE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AdviceCache : {};
  } catch {
    return {};
  }
}

function writeCache(storage: Pick<Storage, 'setItem'>, cache: AdviceCache): void {
  try {
    storage.setItem(WATCHLIST_ADVICE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage is an optimization; quota or privacy errors must not break analysis.
  }
}

export async function analyzeWatchlistStock(
  quote: StockQuote,
  options: { force?: boolean } = {},
  dependencyOverrides: Partial<WatchlistAdviceDependencies> = {},
): Promise<MediumTermBuyAdvice> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const cache = readCache(dependencies.storage);
  const cached = cache[quote.code];
  if (!options.force && cached && cached.expiresAt > dependencies.now()) return cached.advice;

  const [klines, financial] = await Promise.all([
    dependencies.fetchKLine(quote.code, 120),
    dependencies.fetchBasic(quote.code).catch(() => null),
  ]);
  const cloned = klines.map(row => ({ ...row }));
  dependencies.calcIndicators(cloned);
  const strategies = dependencies.scanStrategies(cloned);
  const patterns = dependencies.scanPatterns(cloned);
  const fundamental = dependencies.scoreFundamentals(quote, cloned, financial);
  const advice = dependencies.buildAdvice({
    quote,
    klines: cloned,
    fundamental,
    hasFinancialData: financial !== null,
    strategies,
    patterns,
    calculatedAt: new Date(dependencies.now()).toISOString(),
  });

  cache[quote.code] = { expiresAt: dependencies.now() + WATCHLIST_ADVICE_CACHE_TTL_MS, advice };
  writeCache(dependencies.storage, cache);
  return advice;
}

export async function analyzeWatchlistQuotes(
  quotes: StockQuote[],
  options: AnalyzeWatchlistOptions,
  dependencyOverrides: Partial<WatchlistAdviceDependencies> = {},
): Promise<void> {
  if (quotes.length === 0) return;
  const dependencies = dependenciesWith(dependencyOverrides);
  const shouldPublish = options.shouldPublish ?? (() => true);
  const requestedConcurrency = options.maxConcurrency ?? WATCHLIST_ADVICE_MAX_CONCURRENCY;
  const concurrency = Math.min(8, Math.max(1, Math.floor(requestedConcurrency)));
  const workerCount = Math.min(concurrency, quotes.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < quotes.length) {
      const current = quotes[cursor++];
      if (shouldPublish()) options.onUpdate(current.code, { status: 'loading' });
      try {
        const advice = await analyzeWatchlistStock(current, { force: options.force }, dependencies);
        if (shouldPublish()) options.onUpdate(current.code, { status: 'success', advice });
      } catch (error) {
        if (shouldPublish()) {
          options.onUpdate(current.code, {
            status: 'error',
            error: error instanceof Error ? error.message : '建议分析失败',
          });
        }
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export function clearWatchlistAdviceCache(
  codes?: string[],
  storage: Pick<Storage, 'getItem' | 'setItem'> = globalThis.localStorage,
): void {
  if (!codes) {
    writeCache(storage, {});
    return;
  }
  const cache = readCache(storage);
  for (const code of codes) delete cache[code];
  writeCache(storage, cache);
}
