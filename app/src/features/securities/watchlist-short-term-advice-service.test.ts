import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShortTermTradingAdvice } from '../../engines/market-analysis/short-term-trading-advice';
import type { StockKLine, StockQuote } from '../../infrastructure/market-data/stock-api';
import {
  analyzeWatchlistShortTermQuotes,
  analyzeWatchlistShortTermStock,
  recalculateWatchlistShortTermStock,
  type WatchlistShortTermAdviceDependencies,
} from './watchlist-short-term-advice-service';

function quote(overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    code: '000001', name: '平安银行', market: 'sz', price: 10, change: 0.1, changePct: 1,
    open: 9.9, high: 10.1, low: 9.8, volume: 100, amount: 1_000,
    preClose: 9.9, turnover: 2, pe: 12, pb: 1, totalShares: 100, floatShares: 80,
    totalCap: 800, floatCap: 640, ...overrides,
  };
}

function klines(): StockKLine[] {
  return Array.from({ length: 60 }, (_, index) => ({
    date: `2026-06-${index + 1}`, open: 9, close: 9.1, high: 9.2, low: 8.9,
    volume: 100, amount: 1_000,
  }));
}

function advice(code = '000001', price = 10): ShortTermTradingAdvice {
  return {
    code, horizon: '3_10_trading_days', action: 'buy_on_dip', label: '逢低买入', score: 75,
    confidence: 80, confidenceLabel: '高', entryRange: { low: price - 0.2, high: price },
    stopLoss: price - 0.8, takeProfit1: price + 1, takeProfit2: price + 1.5,
    maxHoldingTradingDays: 7, riskRewardRatio: 1.6, reasons: ['趋势向上'], risks: [],
    dataCompleteness: { quote: true, kline: true, indicators: true, strategies: true },
    dataAsOf: '2026-08-04T10:00:00.000Z', calculatedAt: '2026-08-04T10:00:01.000Z', cacheStatus: 'fresh',
  };
}

function memoryStorage(initial = ''): Pick<Storage, 'getItem' | 'setItem'> {
  let value = initial;
  return {
    getItem: vi.fn(() => value || null),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
  };
}

function dependencies(): WatchlistShortTermAdviceDependencies {
  return {
    fetchKLine: vi.fn().mockResolvedValue(klines()),
    calcIndicators: vi.fn(),
    scanStrategies: vi.fn().mockReturnValue([]),
    scanPatterns: vi.fn().mockReturnValue([]),
    buildAdvice: vi.fn(input => advice(input.quote.code, input.quote.price)),
    storage: memoryStorage(),
    now: vi.fn(() => 1_000_000),
    recalculationTimes: new Map(),
  };
}

describe('watchlist short-term advice service', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loads sixty rows once and reuses the base snapshot within thirty minutes', async () => {
    const deps = dependencies();
    await analyzeWatchlistShortTermStock(quote(), {}, deps);
    await analyzeWatchlistShortTermStock(quote({ price: 10.2 }), {}, deps);
    expect(deps.fetchKLine).toHaveBeenCalledTimes(1);
    expect(deps.fetchKLine).toHaveBeenCalledWith('000001', 60);
    expect(deps.buildAdvice).toHaveBeenLastCalledWith(expect.objectContaining({
      quote: expect.objectContaining({ price: 10.2 }), cacheStatus: 'cached',
    }));
  });

  it('forces a fresh base snapshot when requested', async () => {
    const deps = dependencies();
    await analyzeWatchlistShortTermStock(quote(), {}, deps);
    await analyzeWatchlistShortTermStock(quote(), { force: true }, deps);
    expect(deps.fetchKLine).toHaveBeenCalledTimes(2);
  });

  it('publishes lightweight recalculation at most once per thirty seconds', async () => {
    let now = 1_000_000;
    const deps = dependencies();
    deps.now = vi.fn(() => now);
    const first = await recalculateWatchlistShortTermStock(quote(), {}, deps);
    now += 29_000;
    const throttled = await recalculateWatchlistShortTermStock(quote({ price: 10.3 }), {}, deps);
    now += 1_000;
    const released = await recalculateWatchlistShortTermStock(quote({ price: 10.4 }), {}, deps);
    expect(first?.entryRange?.high).toBe(10);
    expect(throttled).toBeNull();
    expect(released?.entryRange?.high).toBe(10.4);
    expect(deps.fetchKLine).toHaveBeenCalledTimes(1);
  });

  it('isolates a failed stock and continues the queue', async () => {
    const deps = dependencies();
    deps.fetchKLine = vi.fn(async code => {
      if (code === 'bad') throw new Error('network');
      return klines();
    });
    const onUpdate = vi.fn();
    await analyzeWatchlistShortTermQuotes(
      [quote({ code: 'bad' }), quote({ code: 'good' })],
      { onUpdate, maxConcurrency: 4 },
      deps,
    );
    expect(onUpdate).toHaveBeenCalledWith('bad', { status: 'error', error: 'network' });
    expect(onUpdate).toHaveBeenCalledWith('good', expect.objectContaining({ status: 'success' }));
  });

  it('ignores corrupt cache data and recalculates', async () => {
    const deps = dependencies();
    deps.storage = memoryStorage('{not-json');
    await expect(analyzeWatchlistShortTermStock(quote(), {}, deps)).resolves.toMatchObject({ code: '000001' });
    expect(deps.fetchKLine).toHaveBeenCalledOnce();
  });
});
