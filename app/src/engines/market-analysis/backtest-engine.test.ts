import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockKLine } from '../../infrastructure/market-data/stock-api';

vi.mock('./backtest-strategy', async importOriginal => {
  const original = await importOriginal<typeof import('./backtest-strategy')>();
  return {
    ...original,
    evaluateBacktestBar: vi.fn(original.evaluateBacktestBar),
  };
});

import { runBacktest } from './backtest-engine';
import { evaluateBacktestBar } from './backtest-strategy';

type IndicatorLine = StockKLine & {
  macd: { dif: number; dea: number; bar: number };
  kdj: { k: number; d: number; j: number };
  rsi: { rsi6: number; rsi12: number; rsi24: number };
  boll: { upper: number; mid: number; lower: number };
  ma: { ma5: number; ma10: number; ma20: number; ma60: number };
};

function backtestSeries(): IndicatorLine[] {
  const lines = Array.from({ length: 70 }, (_, index) => ({
    date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    open: 10,
    close: 10,
    high: 10.2,
    low: 9.8,
    volume: 1_000,
    amount: 10_000,
    macd: { dif: 0, dea: 0, bar: 0 },
    kdj: { k: 50, d: 50, j: 50 },
    rsi: { rsi6: 50, rsi12: 50, rsi24: 50 },
    boll: { upper: 12, mid: 10, lower: 8 },
    ma: { ma5: 10, ma10: 10, ma20: 10, ma60: 10 },
  }));

  lines[20].macd = { dif: 0, dea: 1, bar: -1 };
  lines[21].macd = { dif: 2, dea: 1, bar: 1 };
  lines[21].close = 10;
  lines[22].macd = { dif: 0, dea: 1, bar: -1 };
  lines[22].close = 11;
  return lines;
}

describe('runBacktest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the shared strategy decision while preserving trade output', () => {
    const result = runBacktest(backtestSeries());

    expect(evaluateBacktestBar).toHaveBeenCalled();
    expect(result.totalTrades).toBe(1);
    expect(result.trades[0]).toMatchObject({
      entryDate: '2026-01-22',
      exitDate: '2026-01-23',
      entryPrice: 10,
      exitPrice: 11,
      returnPct: 10,
      exitReason: 'signal',
      holdingDays: 1,
    });
  });
});
