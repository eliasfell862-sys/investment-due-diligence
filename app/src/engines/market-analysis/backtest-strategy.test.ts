import { describe, expect, it } from 'vitest';
import type { StockKLine } from '../../infrastructure/market-data/stock-api';
import { DEFAULT_TECHNICAL_STRATEGY_CONFIG } from '../../features/securities/strategy-learning/technical-strategy-config';
import { evaluateBacktestBar, evaluateConfiguredBacktestBar } from './backtest-strategy';

type IndicatorLine = StockKLine & {
  macd: { dif: number; dea: number; bar: number };
  kdj: { k: number; d: number; j: number };
  rsi: { rsi6: number; rsi12: number; rsi24: number };
  boll: { upper: number; mid: number; lower: number };
  ma: { ma5: number; ma10: number; ma20: number; ma60: number };
};

function indicatorSeries(length = 70): IndicatorLine[] {
  return Array.from({ length }, (_, index) => ({
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
}

describe('evaluateBacktestBar', () => {
  it('uses versioned defaults for an RSI entry', () => {
    const lines = indicatorSeries();
    lines[60].rsi.rsi6 = 25;

    expect(evaluateConfiguredBacktestBar(
      lines,
      60,
      { inPosition: false },
      DEFAULT_TECHNICAL_STRATEGY_CONFIG,
    )).toMatchObject({ action: 'buy', reasons: ['RSI超卖'] });
  });

  it('holds when no entry condition is present', () => {
    expect(evaluateBacktestBar(indicatorSeries(), 69, { inPosition: false })).toEqual({
      action: 'hold',
      reasons: [],
    });
  });

  it('buys on the same five entry conditions used by the backtest', () => {
    const cases: Array<{ reason: string; prepare(lines: IndicatorLine[]): void }> = [
      {
        reason: 'MACD金叉',
        prepare: lines => {
          lines[68].macd = { dif: 0, dea: 1, bar: -1 };
          lines[69].macd = { dif: 2, dea: 1, bar: 1 };
        },
      },
      { reason: 'KDJ超卖', prepare: lines => { lines[69].kdj.j = 19; } },
      { reason: 'RSI超卖', prepare: lines => { lines[69].rsi.rsi6 = 29; } },
      { reason: '触及布林下轨', prepare: lines => { lines[69].close = 8; } },
      {
        reason: '突破MA20',
        prepare: lines => {
          lines[68].close = 9.9;
          lines[68].ma.ma20 = 10;
          lines[69].close = 10.1;
          lines[69].ma.ma20 = 10;
        },
      },
    ];

    for (const testCase of cases) {
      const lines = indicatorSeries();
      testCase.prepare(lines);
      expect(evaluateBacktestBar(lines, 69, { inPosition: false })).toEqual({
        action: 'buy',
        reasons: [testCase.reason],
      });
    }
  });

  it('prioritizes stop loss over other exit reasons', () => {
    const lines = indicatorSeries();
    lines[69].close = 9;
    lines[68].macd = { dif: 2, dea: 1, bar: 1 };
    lines[69].macd = { dif: 0, dea: 1, bar: -1 };

    expect(evaluateBacktestBar(lines, 69, {
      inPosition: true,
      entryPrice: 10,
      entryIndex: 60,
    })).toEqual({
      action: 'sell',
      reasons: ['止损'],
      exitReason: 'stop_loss',
    });
  });

  it('sells on timeout, MACD dead cross, and KDJ overbought', () => {
    const timedOut = indicatorSeries();
    expect(evaluateBacktestBar(timedOut, 69, {
      inPosition: true,
      entryPrice: 10,
      entryIndex: 9,
    })).toEqual({ action: 'sell', reasons: ['最长持仓期'], exitReason: 'timeout' });

    const deadCross = indicatorSeries();
    deadCross[68].macd = { dif: 2, dea: 1, bar: 1 };
    deadCross[69].macd = { dif: 0, dea: 1, bar: -1 };
    expect(evaluateBacktestBar(deadCross, 69, {
      inPosition: true,
      entryPrice: 10,
      entryIndex: 60,
    })).toEqual({ action: 'sell', reasons: ['MACD死叉'], exitReason: 'signal' });

    const overbought = indicatorSeries();
    overbought[69].kdj.j = 86;
    expect(evaluateBacktestBar(overbought, 69, {
      inPosition: true,
      entryPrice: 10,
      entryIndex: 60,
    })).toEqual({ action: 'sell', reasons: ['KDJ超买'], exitReason: 'signal' });
  });
});
