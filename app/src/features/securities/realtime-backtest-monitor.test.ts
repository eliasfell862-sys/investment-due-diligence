import { describe, expect, it, vi } from 'vitest';
import type { StockKLine, StockQuote } from '../../infrastructure/market-data/stock-api';
import { createRealtimeBacktestMonitor, mergeRealtimeQuoteIntoDailyBar } from './realtime-backtest-monitor';
import { DEFAULT_TECHNICAL_STRATEGY_CONFIG } from './strategy-learning/technical-strategy-config';

function quote(code = '000001', price = 10.8): StockQuote {
  return {
    code, name: code === '000001' ? '平安银行' : '贵州茅台', market: code.startsWith('6') ? 'sh' : 'sz',
    price, change: 0.8, changePct: 8, open: 10, high: 11, low: 9.9,
    volume: 2_000, amount: 21_000, preClose: 10, turnover: 1,
    pe: 10, pb: 1, totalShares: 1, floatShares: 1, totalCap: 1, floatCap: 1,
  };
}

function history(code = '000001'): StockKLine[] {
  return Array.from({ length: 70 }, (_, index) => ({
    date: `2026-${String(Math.floor(index / 28) + 5).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    open: 10,
    close: code === '000001' ? 10 : 100,
    high: code === '000001' ? 10.2 : 101,
    low: code === '000001' ? 9.8 : 99,
    volume: 1_000,
    amount: 10_000,
  }));
}

const metrics = {
  symbol: '', period: '', totalTrades: 12, winRate: 58, totalReturn: 20,
  annualReturn: 18, maxDrawdown: 12, sharpeRatio: 1.1, avgHoldingDays: 8,
  profitFactor: 1.4, benchmarkReturn: 10, excessReturn: 10, trades: [], equityCurve: [],
};

describe('mergeRealtimeQuoteIntoDailyBar', () => {
  it('updates the current trading day without mutating history', () => {
    const source = [...history().slice(0, -1), {
      date: '2026-08-04', open: 10, close: 10.2, high: 10.5, low: 10, volume: 1_000, amount: 10_000,
    }];
    const result = mergeRealtimeQuoteIntoDailyBar(source, quote(), '2026-08-04');

    expect(result?.at(-1)).toEqual({
      date: '2026-08-04', open: 10, close: 10.8, high: 11, low: 9.9,
      volume: 2_000, amount: 21_000,
    });
    expect(source.at(-1)?.close).toBe(10.2);
  });

  it('appends a new daily bar and rejects invalid prices', () => {
    expect(mergeRealtimeQuoteIntoDailyBar(history(), quote(), '2026-08-04')?.at(-1)).toEqual({
      date: '2026-08-04', open: 10, close: 10.8, high: 11, low: 9.9,
      volume: 2_000, amount: 21_000,
    });
    expect(mergeRealtimeQuoteIntoDailyBar(history(), quote('000001', 0), '2026-08-04')).toBeNull();
  });
});

describe('createRealtimeBacktestMonitor', () => {
  it('isolates a failed history load and still emits a signal for a healthy stock', async () => {
    const fetchKLine = vi.fn(async (code: string) => {
      if (code === '600519') throw new Error('network');
      return history(code);
    });
    const calculateIndicators = vi.fn((lines: StockKLine[]) => {
      const previous = lines.at(-2) as StockKLine & Record<string, any>;
      const current = lines.at(-1) as StockKLine & Record<string, any>;
      previous.macd = { dif: 0, dea: 1, bar: -1 };
      current.macd = { dif: 2, dea: 1, bar: 1 };
    });
    const runBacktest = vi.fn(() => metrics);
    const monitor = createRealtimeBacktestMonitor({ fetchKLine, calculateIndicators, runBacktest });

    await monitor.syncUniverse(['000001', '600519']);
    const result = await monitor.processSnapshot({
      quotes: { '000001': quote(), '600519': quote('600519', 1_500) },
      buyCodes: ['000001', '600519'], virtualPositions: [], actualPositions: [],
      tradingDate: '2026-08-04', signalAt: '2026-08-04T01:30:00.000Z',
    });

    expect(result.partialFailureCount).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      code: '000001',
      buyDecision: { action: 'buy', reasons: ['MACD金叉'] },
      virtualSellDecision: { action: 'hold' }, actualSellDecision: { action: 'hold' },
      virtualPositionShares: 0, virtualAvailableShares: 0,
      actualPositionShares: 0, actualAvailableShares: 0,
    });
  });

  it('loads and backtests history once, then skips an unchanged quote', async () => {
    const fetchKLine = vi.fn(async () => history());
    const calculateIndicators = vi.fn((lines: StockKLine[]) => {
      const previous = lines.at(-2) as StockKLine & Record<string, any>;
      const current = lines.at(-1) as StockKLine & Record<string, any>;
      previous.macd = { dif: 0, dea: 1, bar: -1 };
      current.macd = { dif: 2, dea: 1, bar: 1 };
    });
    const runBacktest = vi.fn(() => metrics);
    const monitor = createRealtimeBacktestMonitor({ fetchKLine, calculateIndicators, runBacktest });
    await monitor.syncUniverse(['000001']);

    const input = {
      quotes: { '000001': quote() }, buyCodes: ['000001'], virtualPositions: [], actualPositions: [],
      tradingDate: '2026-08-04', signalAt: '2026-08-04T01:30:00.000Z',
    };
    expect((await monitor.processSnapshot(input)).events).toHaveLength(1);
    expect((await monitor.processSnapshot({ ...input, signalAt: '2026-08-04T01:30:03.000Z' })).events).toHaveLength(0);
    expect(fetchKLine).toHaveBeenCalledTimes(1);
    expect(runBacktest).toHaveBeenCalledTimes(1);
  });

  it('evaluates held stocks through both flat and held paths', async () => {
    const evaluateBar = vi.fn((
      _lines: StockKLine[],
      _index: number,
      position: { inPosition: boolean },
    ) => position.inPosition
      ? { action: 'hold' as const, reasons: [] }
      : { action: 'buy' as const, reasons: ['RSI超卖'] });
    const monitor = createRealtimeBacktestMonitor({
      fetchKLine: vi.fn(async () => history()),
      calculateIndicators: vi.fn(),
      runBacktest: vi.fn(() => metrics),
      evaluateBar,
    });
    await monitor.syncUniverse(['000001']);

    const result = await monitor.processSnapshot({
      quotes: { '000001': quote('000001', 9) }, buyCodes: [],
      virtualPositions: [],
      actualPositions: [{ code: '000001', shares: 500, availableShares: 300, averageCost: 10, openedAt: '2026-07-01T01:30:00.000Z' }],
      tradingDate: '2026-08-04', signalAt: '2026-08-04T01:30:00.000Z',
    });

    expect(evaluateBar).toHaveBeenCalledTimes(2);
    expect(evaluateBar).toHaveBeenCalledWith(expect.any(Array), expect.any(Number), { inPosition: false });
    expect(evaluateBar).toHaveBeenCalledWith(expect.any(Array), expect.any(Number), expect.objectContaining({
      inPosition: true, entryPrice: 10,
    }));
    expect(result.events[0]).toMatchObject({
      code: '000001', actualPositionShares: 500, actualAvailableShares: 300,
      virtualPositionShares: 0, virtualAvailableShares: 0,
      buyDecision: { action: 'buy' }, actualSellDecision: { action: 'hold' },
    });
  });

  it('evaluates virtual and actual positions with their own cost bases', async () => {
    const evaluateBar = vi.fn((
      _lines: StockKLine[],
      _index: number,
      position: { inPosition: boolean; entryPrice?: number },
    ) => position.inPosition
      ? { action: 'sell' as const, reasons: ['测试卖出'], exitReason: 'signal' as const }
      : { action: 'hold' as const, reasons: [] });
    const monitor = createRealtimeBacktestMonitor({
      fetchKLine: vi.fn(async () => history()),
      calculateIndicators: vi.fn(),
      runBacktest: vi.fn(() => metrics),
      evaluateBar,
    });
    await monitor.syncUniverse(['000001']);

    const result = await monitor.processSnapshot({
      quotes: { '000001': quote('000001', 12) },
      buyCodes: [],
      virtualPositions: [{
        code: '000001', shares: 100, availableShares: 100,
        averageCost: 10, openedAt: '2026-07-01T01:30:00.000Z',
      }],
      actualPositions: [{
        code: '000001', shares: 300, availableShares: 200,
        averageCost: 14, openedAt: '2026-07-15T01:30:00.000Z',
      }],
      tradingDate: '2026-08-04',
      signalAt: '2026-08-04T01:30:00.000Z',
    });

    expect(evaluateBar).toHaveBeenCalledWith(expect.any(Array), expect.any(Number),
      expect.objectContaining({ inPosition: true, entryPrice: 10 }));
    expect(evaluateBar).toHaveBeenCalledWith(expect.any(Array), expect.any(Number),
      expect.objectContaining({ inPosition: true, entryPrice: 14 }));
    expect(result.events[0]).toMatchObject({
      virtualSellDecision: { action: 'sell' },
      actualSellDecision: { action: 'sell' },
      virtualPositionShares: 100,
      actualPositionShares: 300,
    });
  });

  it('keeps evaluating a virtual holding with no watchlist or actual position', async () => {
    const evaluateBar = vi.fn((
      _lines: StockKLine[],
      _index: number,
      position: { inPosition: boolean },
    ) => position.inPosition
      ? { action: 'sell' as const, reasons: ['MACD死叉'], exitReason: 'signal' as const }
      : { action: 'hold' as const, reasons: [] });
    const monitor = createRealtimeBacktestMonitor({
      fetchKLine: vi.fn(async () => history()),
      calculateIndicators: vi.fn(),
      runBacktest: vi.fn(() => metrics),
      evaluateBar,
    });
    await monitor.syncUniverse(['000001']);

    const result = await monitor.processSnapshot({
      quotes: { '000001': quote() },
      buyCodes: [],
      virtualPositions: [{
        code: '000001', shares: 100, availableShares: 100,
        averageCost: 10, openedAt: '2026-07-01T01:30:00.000Z',
      }],
      actualPositions: [],
      tradingDate: '2026-08-04',
      signalAt: '2026-08-04T01:30:00.000Z',
    });

    expect(result.events[0].virtualSellDecision.action).toBe('sell');
    expect(result.events[0].actualSellDecision.action).toBe('hold');
  });

  it('passes simultaneous held sell and flat buy decisions to the inbox state machine', async () => {
    const evaluateBar = vi.fn((
      _lines: StockKLine[],
      _index: number,
      position: { inPosition: boolean },
    ) => position.inPosition
      ? { action: 'sell' as const, reasons: ['止损'], exitReason: 'stop_loss' as const }
      : { action: 'buy' as const, reasons: ['RSI超卖'] });
    const monitor = createRealtimeBacktestMonitor({
      fetchKLine: vi.fn(async () => history()),
      calculateIndicators: vi.fn(),
      runBacktest: vi.fn(() => metrics),
      evaluateBar,
    });
    await monitor.syncUniverse(['000001']);

    const result = await monitor.processSnapshot({
      quotes: { '000001': quote('000001', 9) }, buyCodes: ['000001'],
      virtualPositions: [],
      actualPositions: [{ code: '000001', shares: 300, availableShares: 200, averageCost: 10, openedAt: '2026-07-01T01:30:00.000Z' }],
      tradingDate: '2026-08-04', signalAt: '2026-08-04T01:30:00.000Z',
    });

    expect(result.events[0]).toMatchObject({
      actualPositionShares: 300,
      buyDecision: { action: 'buy' },
      actualSellDecision: { action: 'sell', exitReason: 'stop_loss' },
    });
  });

  it('reloads requested histories and ignores work after disposal', async () => {
    const fetchKLine = vi.fn(async () => history());
    const monitor = createRealtimeBacktestMonitor({
      fetchKLine, calculateIndicators: vi.fn(), runBacktest: vi.fn(() => metrics),
    });
    await monitor.syncUniverse(['000001']);
    await monitor.reload(['000001']);
    expect(fetchKLine).toHaveBeenCalledTimes(2);

    monitor.dispose();
    await monitor.syncUniverse(['600519']);
    expect(fetchKLine).toHaveBeenCalledTimes(2);
    expect((await monitor.processSnapshot({
      quotes: { '000001': quote() }, buyCodes: ['000001'], virtualPositions: [], actualPositions: [],
      tradingDate: '2026-08-04', signalAt: '2026-08-04T01:30:00.000Z',
    })).events).toEqual([]);
  });
  it('emits signals with the active approved strategy version', async () => {
    const evaluateBar = vi.fn((_lines: StockKLine[], _index: number, _position: { inPosition: boolean }, _config?: unknown) => ({ action: 'buy' as const, reasons: ['RSI超卖'] }));
    const monitor = createRealtimeBacktestMonitor({
      fetchKLine: vi.fn(async () => history()), calculateIndicators: vi.fn(),
      runBacktest: vi.fn(() => metrics), evaluateBar,
    }, { ...DEFAULT_TECHNICAL_STRATEGY_CONFIG, version: '2', rsiBuyThreshold: 28 });
    await monitor.syncUniverse(['000001']);
    const result = await monitor.processSnapshot({
      quotes: { '000001': quote() }, buyCodes: ['000001'], virtualPositions: [], actualPositions: [],
      tradingDate: '2026-08-04', signalAt: '2026-08-04T01:30:00.000Z',
    });

    expect(result.events[0]).toMatchObject({ strategyId: 'realtime-technical', strategyVersion: '2' });
    expect(evaluateBar.mock.calls[0][3]).toMatchObject({ version: '2', rsiBuyThreshold: 28 });
  });
});
