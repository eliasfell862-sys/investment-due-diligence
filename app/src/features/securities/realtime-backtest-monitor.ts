import { evaluateBacktestBar, type BacktestBarDecision } from '../../engines/market-analysis/backtest-strategy';
import { runBacktest, type BacktestResult } from '../../engines/market-analysis/backtest-engine';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import {
  fetchEastmoneyKLine,
  type StockKLine,
  type StockQuote,
} from '../../infrastructure/market-data/stock-api';
import type { BacktestDecisionEvent, BacktestSignalMetrics } from './backtest-signal-inbox-store';

const HISTORY_LIMIT = 250;
const LOAD_CONCURRENCY = 4;

export interface MonitorPosition {
  code: string;
  shares: number;
  availableShares: number;
  averageCost: number;
  openedAt: string;
}

export interface MonitorSnapshotInput {
  quotes: Record<string, StockQuote>;
  buyCodes: string[];
  positions: MonitorPosition[];
  tradingDate: string;
  signalAt: string;
}

export interface MonitorSnapshotResult {
  events: BacktestDecisionEvent[];
  partialFailureCount: number;
}

export interface RealtimeBacktestMonitorDependencies {
  fetchKLine: (code: string, limit: number) => Promise<StockKLine[]>;
  calculateIndicators: (klines: StockKLine[]) => void;
  runBacktest: (klines: StockKLine[]) => BacktestResult;
  evaluateBar: typeof evaluateBacktestBar;
}

export interface RealtimeBacktestMonitor {
  syncUniverse(codes: string[]): Promise<void>;
  processSnapshot(input: MonitorSnapshotInput): Promise<MonitorSnapshotResult>;
  reload(codes?: string[]): Promise<void>;
  dispose(): void;
}

interface CachedHistory {
  klines: StockKLine[];
  metrics: BacktestSignalMetrics;
}

function defaultDependencies(): RealtimeBacktestMonitorDependencies {
  return {
    fetchKLine: fetchEastmoneyKLine,
    calculateIndicators: calcAllIndicators,
    runBacktest,
    evaluateBar: evaluateBacktestBar,
  };
}

function cloneKlines(klines: StockKLine[]): StockKLine[] {
  return klines.map(kline => ({ ...kline }));
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function mergeRealtimeQuoteIntoDailyBar(
  history: StockKLine[],
  quote: StockQuote,
  tradingDate: string,
): StockKLine[] | null {
  if (!Number.isFinite(quote.price) || quote.price <= 0 || !tradingDate) return null;
  const result = cloneKlines(history);
  const previous = result.at(-1);
  const open = positiveOr(quote.open, positiveOr(quote.preClose, quote.price));
  const high = positiveOr(quote.high, quote.price);
  const low = positiveOr(quote.low, quote.price);
  const bar: StockKLine = {
    date: tradingDate,
    open,
    close: quote.price,
    high,
    low,
    volume: Math.max(0, quote.volume || 0),
    amount: Math.max(0, quote.amount || 0),
  };

  if (previous?.date === tradingDate) {
    result[result.length - 1] = {
      date: tradingDate,
      open: positiveOr(previous.open, open),
      close: quote.price,
      high: Math.max(previous.high, high, quote.price),
      low: Math.min(previous.low, low, quote.price),
      volume: bar.volume,
      amount: bar.amount,
    };
  } else {
    result.push(bar);
  }
  return result;
}

function toMetrics(result: BacktestResult): BacktestSignalMetrics {
  return {
    totalTrades: result.totalTrades,
    winRate: result.winRate,
    sharpeRatio: result.sharpeRatio,
    maxDrawdown: result.maxDrawdown,
    annualReturn: result.annualReturn,
    profitFactor: result.profitFactor,
  };
}

function positionEntryIndex(klines: StockKLine[], openedAt: string): number {
  const openedDate = openedAt.slice(0, 10);
  const index = klines.findIndex(kline => kline.date >= openedDate);
  return index >= 0 ? index : 20;
}

function quoteFingerprint(
  quote: StockQuote,
  isBuyCandidate: boolean,
  position: MonitorPosition | undefined,
): string {
  return [
    quote.price, quote.open, quote.high, quote.low, quote.volume, quote.amount,
    isBuyCandidate ? 1 : 0,
    position?.shares ?? 0,
    position?.availableShares ?? 0,
    position?.averageCost ?? 0,
    position?.openedAt ?? '',
  ].join('|');
}

async function runWithConcurrency(items: string[], worker: (code: string) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(LOAD_CONCURRENCY, items.length) }, async () => {
    while (nextIndex < items.length) {
      const code = items[nextIndex++];
      await worker(code);
    }
  });
  await Promise.all(workers);
}

export function createRealtimeBacktestMonitor(
  dependencyOverrides: Partial<RealtimeBacktestMonitorDependencies> = {},
): RealtimeBacktestMonitor {
  const dependencies = { ...defaultDependencies(), ...dependencyOverrides };
  const cache = new Map<string, CachedHistory>();
  const failures = new Map<string, string>();
  const fingerprints = new Map<string, string>();
  let activeCodes: string[] = [];
  let disposed = false;
  let generation = 0;

  async function loadCodes(codes: string[], force: boolean): Promise<void> {
    const currentGeneration = generation;
    const targets = codes.filter(code => force || !cache.has(code));
    await runWithConcurrency(targets, async code => {
      if (disposed) return;
      try {
        const fetched = await dependencies.fetchKLine(code, HISTORY_LIMIT);
        if (disposed || currentGeneration !== generation) return;
        if (fetched.length < 60) throw new Error('历史K线不足60条');
        const prepared = cloneKlines(fetched);
        dependencies.calculateIndicators(prepared);
        const result = dependencies.runBacktest(prepared);
        cache.set(code, { klines: prepared, metrics: toMetrics(result) });
        failures.delete(code);
        fingerprints.delete(code);
      } catch (error) {
        if (disposed || currentGeneration !== generation) return;
        failures.set(code, error instanceof Error ? error.message : String(error));
        cache.delete(code);
      }
    });
  }

  async function syncUniverse(codes: string[]): Promise<void> {
    if (disposed) return;
    activeCodes = [...new Set(codes.map(code => code.trim()).filter(Boolean))].sort();
    const activeSet = new Set(activeCodes);
    for (const code of cache.keys()) if (!activeSet.has(code)) cache.delete(code);
    for (const code of failures.keys()) if (!activeSet.has(code)) failures.delete(code);
    for (const code of fingerprints.keys()) if (!activeSet.has(code)) fingerprints.delete(code);
    await loadCodes(activeCodes, false);
  }

  async function processSnapshot(input: MonitorSnapshotInput): Promise<MonitorSnapshotResult> {
    if (disposed) return { events: [], partialFailureCount: 0 };
    const buyCodes = new Set(input.buyCodes);
    const positions = new Map(input.positions.map(position => [position.code, position]));
    const events: BacktestDecisionEvent[] = [];

    for (const code of activeCodes) {
      const cached = cache.get(code);
      const quote = input.quotes[code];
      if (!cached || !quote || quote.price <= 0) continue;
      const position = positions.get(code);
      const fingerprint = quoteFingerprint(quote, buyCodes.has(code), position);
      if (fingerprints.get(code) === fingerprint) continue;
      fingerprints.set(code, fingerprint);

      const liveKlines = mergeRealtimeQuoteIntoDailyBar(cached.klines, quote, input.tradingDate);
      if (!liveKlines || liveKlines.length < 2) continue;
      try {
        dependencies.calculateIndicators(liveKlines);
        const last = liveKlines.at(-1) as StockKLine & { atr?: number };
        const buyDecision: BacktestBarDecision = dependencies.evaluateBar(
          liveKlines,
          liveKlines.length - 1,
          { inPosition: false },
        );
        const sellDecision: BacktestBarDecision = position
          ? dependencies.evaluateBar(
              liveKlines,
              liveKlines.length - 1,
              {
                inPosition: true,
                entryPrice: position.averageCost,
                entryIndex: positionEntryIndex(liveKlines, position.openedAt),
              },
            )
          : { action: 'hold', reasons: [] };
        const atr = positiveOr(last.atr ?? 0, quote.price * 0.03);
        events.push({
          code,
          name: quote.name,
          price: quote.price,
          buyDecision,
          sellDecision,
          isBuyCandidate: buyCodes.has(code),
          isHeld: Boolean(position),
          positionShares: position?.shares ?? 0,
          availableShares: position?.availableShares ?? 0,
          signalAt: input.signalAt,
          metrics: { ...cached.metrics },
          entryPrice: buyDecision.action === 'buy' ? quote.price : position?.averageCost ?? 0,
          stopLoss: buyDecision.action === 'buy'
            ? Math.round((quote.price - atr * 2) * 100) / 100
            : 0,
        });
      } catch (error) {
        failures.set(code, error instanceof Error ? error.message : String(error));
      }
    }

    return { events, partialFailureCount: failures.size };
  }

  async function reload(codes: string[] = activeCodes): Promise<void> {
    if (disposed) return;
    await loadCodes(codes, true);
  }

  function dispose() {
    disposed = true;
    generation += 1;
    activeCodes = [];
    cache.clear();
    failures.clear();
    fingerprints.clear();
  }

  return { syncUniverse, processSnapshot, reload, dispose };
}
