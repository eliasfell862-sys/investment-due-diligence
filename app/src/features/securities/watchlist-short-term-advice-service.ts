import {
  buildShortTermTradingAdvice,
  type ShortTermAdviceBaseInput,
  type ShortTermIndicatorKLine,
  type ShortTermTradingAdvice,
} from '../../engines/market-analysis/short-term-trading-advice';
import { scanPatterns, type PatternResult } from '../../engines/market-analysis/kline-patterns';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import { scanStrategies, type StrategySignal } from '../../engines/market-analysis/trading-strategies';
import {
  fetchEastmoneyKLine,
  type StockKLine,
  type StockQuote,
} from '../../infrastructure/market-data/stock-api';

export const WATCHLIST_SHORT_TERM_CACHE_KEY = 'sec_watchlist_short_term_advice_cache_v1';
export const WATCHLIST_SHORT_TERM_CACHE_TTL_MS = 30 * 60 * 1000;
export const WATCHLIST_SHORT_TERM_RECALCULATE_MS = 30 * 1000;
export const WATCHLIST_SHORT_TERM_MAX_CONCURRENCY = 4;

export type WatchlistShortTermTaskState =
  | { status: 'waiting' }
  | { status: 'loading' }
  | { status: 'success'; advice: ShortTermTradingAdvice }
  | { status: 'error'; error: string; previousAdvice?: ShortTermTradingAdvice };

interface ShortTermBaseSnapshot {
  expiresAt: number;
  klines: ShortTermIndicatorKLine[];
  strategies: StrategySignal[];
  patterns: PatternResult[];
  dataAsOf: string;
}

type ShortTermBaseCache = Record<string, ShortTermBaseSnapshot>;

export interface WatchlistShortTermAdviceDependencies {
  fetchKLine: (code: string, count: number) => Promise<StockKLine[]>;
  calcIndicators: (klines: StockKLine[]) => void;
  scanStrategies: (klines: StockKLine[]) => StrategySignal[];
  scanPatterns: (klines: StockKLine[]) => PatternResult[];
  buildAdvice: (input: ShortTermAdviceBaseInput) => ShortTermTradingAdvice;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now: () => number;
  recalculationTimes: Map<string, number>;
}

export interface AnalyzeWatchlistShortTermOptions {
  force?: boolean;
  maxConcurrency?: number;
  shouldPublish?: () => boolean;
  onUpdate: (code: string, state: WatchlistShortTermTaskState) => void;
}

const sharedRecalculationTimes = new Map<string, number>();

const defaultDependencies = (): WatchlistShortTermAdviceDependencies => ({
  fetchKLine: fetchEastmoneyKLine,
  calcIndicators: calcAllIndicators,
  scanStrategies,
  scanPatterns,
  buildAdvice: buildShortTermTradingAdvice,
  storage: globalThis.localStorage,
  now: Date.now,
  recalculationTimes: sharedRecalculationTimes,
});

function dependenciesWith(
  overrides: Partial<WatchlistShortTermAdviceDependencies> = {},
): WatchlistShortTermAdviceDependencies {
  return { ...defaultDependencies(), ...overrides };
}

function readCache(storage: Pick<Storage, 'getItem'>): ShortTermBaseCache {
  try {
    const raw = storage.getItem(WATCHLIST_SHORT_TERM_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as ShortTermBaseCache
      : {};
  } catch {
    return {};
  }
}

function writeCache(storage: Pick<Storage, 'setItem'>, cache: ShortTermBaseCache): void {
  try {
    storage.setItem(WATCHLIST_SHORT_TERM_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache is optional; analysis must remain available when storage is full or disabled.
  }
}

async function createBaseSnapshot(
  code: string,
  dependencies: WatchlistShortTermAdviceDependencies,
): Promise<ShortTermBaseSnapshot> {
  const rows = await dependencies.fetchKLine(code, 60);
  const cloned = rows.map(row => ({ ...row })) as ShortTermIndicatorKLine[];
  dependencies.calcIndicators(cloned);
  const strategies = dependencies.scanStrategies(cloned);
  const patterns = dependencies.scanPatterns(cloned);
  return {
    expiresAt: dependencies.now() + WATCHLIST_SHORT_TERM_CACHE_TTL_MS,
    klines: cloned,
    strategies,
    patterns,
    dataAsOf: cloned.at(-1)?.date || new Date(dependencies.now()).toISOString(),
  };
}

async function loadBaseSnapshot(
  code: string,
  force: boolean,
  dependencies: WatchlistShortTermAdviceDependencies,
): Promise<{ snapshot: ShortTermBaseSnapshot; cacheStatus: 'fresh' | 'cached' }> {
  const cache = readCache(dependencies.storage);
  const cached = cache[code];
  if (!force && cached && cached.expiresAt > dependencies.now() && Array.isArray(cached.klines)) {
    return { snapshot: cached, cacheStatus: 'cached' };
  }

  const snapshot = await createBaseSnapshot(code, dependencies);
  cache[code] = snapshot;
  writeCache(dependencies.storage, cache);
  return { snapshot, cacheStatus: 'fresh' };
}

function buildFromSnapshot(
  quote: StockQuote,
  snapshot: ShortTermBaseSnapshot,
  cacheStatus: 'fresh' | 'cached',
  dependencies: WatchlistShortTermAdviceDependencies,
): ShortTermTradingAdvice {
  return dependencies.buildAdvice({
    quote,
    klines: snapshot.klines,
    strategies: snapshot.strategies,
    patterns: snapshot.patterns,
    dataAsOf: snapshot.dataAsOf,
    calculatedAt: new Date(dependencies.now()).toISOString(),
    cacheStatus,
  });
}

export async function analyzeWatchlistShortTermStock(
  quote: StockQuote,
  options: { force?: boolean } = {},
  dependencyOverrides: Partial<WatchlistShortTermAdviceDependencies> = {},
): Promise<ShortTermTradingAdvice> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const { snapshot, cacheStatus } = await loadBaseSnapshot(quote.code, Boolean(options.force), dependencies);
  return buildFromSnapshot(quote, snapshot, cacheStatus, dependencies);
}

export async function recalculateWatchlistShortTermStock(
  quote: StockQuote,
  options: { force?: boolean } = {},
  dependencyOverrides: Partial<WatchlistShortTermAdviceDependencies> = {},
): Promise<ShortTermTradingAdvice | null> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const now = dependencies.now();
  const previous = dependencies.recalculationTimes.get(quote.code);
  if (!options.force && previous !== undefined && now - previous < WATCHLIST_SHORT_TERM_RECALCULATE_MS) {
    return null;
  }
  const result = await analyzeWatchlistShortTermStock(quote, { force: options.force }, dependencies);
  dependencies.recalculationTimes.set(quote.code, now);
  return result;
}

export async function analyzeWatchlistShortTermQuotes(
  quotes: StockQuote[],
  options: AnalyzeWatchlistShortTermOptions,
  dependencyOverrides: Partial<WatchlistShortTermAdviceDependencies> = {},
): Promise<void> {
  if (quotes.length === 0) return;
  const dependencies = dependenciesWith(dependencyOverrides);
  const shouldPublish = options.shouldPublish ?? (() => true);
  const concurrency = Math.min(
    WATCHLIST_SHORT_TERM_MAX_CONCURRENCY,
    Math.max(1, Math.floor(options.maxConcurrency ?? WATCHLIST_SHORT_TERM_MAX_CONCURRENCY)),
  );
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < quotes.length) {
      const current = quotes[cursor++];
      if (shouldPublish()) options.onUpdate(current.code, { status: 'loading' });
      try {
        const advice = await analyzeWatchlistShortTermStock(
          current,
          { force: options.force },
          dependencies,
        );
        dependencies.recalculationTimes.set(current.code, dependencies.now());
        if (shouldPublish()) options.onUpdate(current.code, { status: 'success', advice });
      } catch (error) {
        if (shouldPublish()) {
          options.onUpdate(current.code, {
            status: 'error',
            error: error instanceof Error ? error.message : '短线建议分析失败',
          });
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, quotes.length) }, () => worker()));
}

export function clearWatchlistShortTermAdviceCache(
  codes?: string[],
  storage: Pick<Storage, 'getItem' | 'setItem'> = globalThis.localStorage,
): void {
  if (!codes) {
    writeCache(storage, {});
    sharedRecalculationTimes.clear();
    return;
  }
  const cache = readCache(storage);
  for (const code of codes) {
    delete cache[code];
    sharedRecalculationTimes.delete(code);
  }
  writeCache(storage, cache);
}
