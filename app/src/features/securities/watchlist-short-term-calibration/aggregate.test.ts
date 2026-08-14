import { describe, expect, it } from 'vitest';
import type {
  CalibrationBuyAction,
  CalibrationTrade,
  CalibrationUnfilledSignal,
} from './types';
import {
  aggregateCalibrationResult,
  selectCalibrationMetricsForAction,
} from './aggregate';

const fee = {
  commission: 0, stampDuty: 0, transferFee: 0, modeledSlippage: 0,
  total: 0, source: 'profile_calculated' as const,
};

function trade(
  index: number,
  values: Partial<CalibrationTrade> = {},
): CalibrationTrade {
  return {
    kind: 'trade', code: String(index).padStart(6, '0'), action: 'strong_buy',
    signalDate: `2026-01-${String(index % 28 + 1).padStart(2, '0')}`,
    entryDate: '2026-02-01', entryPrice: 10,
    exitDate: `2026-03-${String(index % 28 + 1).padStart(2, '0')}`,
    exitPrice: 11, shares: 100, exitReason: 'take_profit_1',
    secondTakeProfitReached: false, buyFees: fee, sellFees: fee,
    grossPnl: 100, netPnl: 100, netReturnPct: 10, won: true,
    ...values,
  };
}

function unfilled(index: number, action: CalibrationBuyAction = 'strong_buy'): CalibrationUnfilledSignal {
  return { kind: 'unfilled', code: String(index).padStart(6, '0'), signalDate: '2026-02-01', action };
}

function fixture(options: {
  completed?: number;
  proxyStocks?: number;
  totalStocks?: number;
  validStocks?: number;
  leakageBlocked?: boolean;
} = {}) {
  const completed = options.completed ?? 20;
  const totalStocks = options.totalStocks ?? 10;
  const validStocks = options.validStocks ?? totalStocks;
  const proxyStocks = options.proxyStocks ?? 0;
  return aggregateCalibrationResult({
    trades: Array.from({ length: completed }, (_, index) => trade(index)),
    unfilled: [], totalStocks,
    validStocks: Array.from({ length: validStocks }, (_, index) => ({
      code: String(index).padStart(6, '0'),
      turnoverMode: index < proxyStocks ? 'proxy' as const : 'direct' as const,
    })),
    skippedStocks: [], dataAsOf: '2026-08-14',
    leakageBlocked: options.leakageBlocked ?? false,
    createdAt: '2026-08-14T12:00:00.000Z',
  });
}

describe('watchlist short-term calibration aggregation', () => {
  it('applies the 20 and 100 completed-trade trust thresholds', () => {
    expect(fixture({ completed: 19 }).trust).toBe('insufficient');
    expect(fixture({ completed: 20 }).trust).toBe('preliminary');
    expect(fixture({ completed: 100 }).trust).toBe('established');
  });

  it('caps proxy evidence at preliminary even with 100 trades', () => {
    const result = fixture({ completed: 100, proxyStocks: 1 });
    expect(result.trust).toBe('preliminary');
    expect(result.proxyStockCount).toBe(1);
    expect(result.directStockCount).toBe(9);
  });

  it('marks coverage below 70 percent as insufficient', () => {
    const result = fixture({ completed: 100, totalStocks: 100, validStocks: 69 });
    expect(result.coverageRate).toBe(69);
    expect(result.trust).toBe('insufficient');
  });

  it('blocks evidence when future-data leakage is detected', () => {
    expect(fixture({ completed: 100, leakageBlocked: true }).trust).toBe('blocked');
  });

  it('keeps fill rate separate from fee-adjusted win rate and calculates risk metrics', () => {
    const result = aggregateCalibrationResult({
      trades: [
        trade(1, { netPnl: 100, netReturnPct: 10, won: true, exitReason: 'take_profit_1' }),
        trade(2, { netPnl: -200, netReturnPct: -20, won: false, exitReason: 'stop_loss' }),
      ],
      unfilled: [unfilled(3)], totalStocks: 1,
      validStocks: [{ code: '600000', turnoverMode: 'direct' }], skippedStocks: [],
      dataAsOf: '2026-08-14', leakageBlocked: false, createdAt: '2026-08-14T12:00:00.000Z',
    });
    expect(result.overall).toMatchObject({
      signalCount: 3, completedTrades: 2, fillRate: 66.67, winRate: 50,
      averageNetReturnPct: -5, maxDrawdownPct: 20, profitFactor: 0.5,
      firstTakeProfitRate: 50, stopLossRate: 50, unfilledRate: 33.33,
    });
    expect(result.warnings).toContain('盈亏结构不佳');
  });

  it('uses an action group only after it reaches 20 completed trades', () => {
    const trades = [
      ...Array.from({ length: 19 }, (_, index) => trade(index, { action: 'strong_buy' })),
      ...Array.from({ length: 20 }, (_, index) => trade(index + 20, { action: 'buy_on_dip' })),
    ];
    const result = aggregateCalibrationResult({
      trades, unfilled: [], totalStocks: 1,
      validStocks: [{ code: '600000', turnoverMode: 'direct' }], skippedStocks: [],
      dataAsOf: '2026-08-14', leakageBlocked: false, createdAt: '2026-08-14T12:00:00.000Z',
    });
    expect(selectCalibrationMetricsForAction(result, 'strong_buy').scope).toBe('overall_fallback');
    expect(selectCalibrationMetricsForAction(result, 'buy_on_dip').scope).toBe('action_group');
    expect(selectCalibrationMetricsForAction(result, 'hold_watch').scope).toBe('not_applicable');
  });
});
