import { describe, expect, it } from 'vitest';
import { DEFAULT_TRADING_FEE_PROFILE } from '../t-trading/trading-fee-engine';
import type { CalibrationHistoryRow } from '../../../infrastructure/market-data/watchlist-calibration-history';
import type { CalibrationSignal } from './types';
import { replayCalibrationSignal } from './trade-replay';

function row(
  date: string,
  values: Partial<CalibrationHistoryRow> = {},
): CalibrationHistoryRow {
  return {
    date, open: 10, close: 10, high: 10.5, low: 9.5, volume: 1000, amount: 10_000,
    amplitude: 10, changePct: 0, change: 0, turnover: 3,
    ...values,
  };
}

function signal(values: Partial<CalibrationSignal> = {}): CalibrationSignal {
  return {
    code: '600000', signalDate: '2026-08-01', action: 'strong_buy',
    entryRange: { low: 10, high: 11 }, stopLoss: 9, takeProfit1: 12,
    takeProfit2: 13, maxHoldingTradingDays: 3,
    ...values,
  };
}

function replay(futureRows: CalibrationHistoryRow[], value: Partial<CalibrationSignal> = {}) {
  return replayCalibrationSignal({
    signal: signal(value), futureRows, feeProfile: DEFAULT_TRADING_FEE_PROFILE,
  });
}

describe('short-term calibration trade replay', () => {
  it('fills at the opening price when the open is inside the entry range', () => {
    const result = replay([
      row('2026-08-02', { open: 10.5 }),
      row('2026-08-03', { open: 12, high: 12.2, low: 11.8, close: 12 }),
    ]);
    expect(result).toMatchObject({ kind: 'trade', entryDate: '2026-08-02', entryPrice: 10.5, exitPrice: 12 });
  });

  it.each([
    ['from above', { open: 11.5, high: 11.8, low: 10.8 }, 11],
    ['from below', { open: 9.5, high: 10.2, low: 9.4 }, 10],
  ])('fills at the range boundary when price enters %s', (_name, values, expected) => {
    const result = replay([
      row('2026-08-02', values),
      row('2026-08-03', { open: 12, high: 12.2, low: 11.8, close: 12 }),
    ]);
    expect(result).toMatchObject({ kind: 'trade', entryPrice: expected });
  });

  it('expires unfilled after three trading days outside the range', () => {
    const result = replay([
      row('2026-08-02', { open: 12, high: 12.5, low: 11.5 }),
      row('2026-08-03', { open: 12, high: 12.5, low: 11.5 }),
      row('2026-08-04', { open: 12, high: 12.5, low: 11.5 }),
      row('2026-08-05', { open: 10.5 }),
    ]);
    expect(result).toEqual({ kind: 'unfilled', code: '600000', signalDate: '2026-08-01', action: 'strong_buy' });
  });

  it('does not fill suspended or one-price limit bars', () => {
    const result = replay([
      row('2026-08-02', { open: 10.5, volume: 0 }),
      row('2026-08-03', { open: 10.5, high: 10.5, low: 10.5, close: 10.5, changePct: 10 }),
      row('2026-08-04', { open: 12, high: 12, low: 11.5 }),
    ]);
    expect(result.kind).toBe('unfilled');
  });

  it('enforces T+1 and chooses stop loss when stop and target touch together', () => {
    const result = replay([
      row('2026-08-02', { open: 10.5, high: 12.5, low: 8.5 }),
      row('2026-08-03', { open: 10.5, high: 12.5, low: 8.5 }),
    ]);
    expect(result).toMatchObject({
      kind: 'trade', exitDate: '2026-08-03', exitPrice: 9, exitReason: 'stop_loss',
    });
  });

  it('deducts actual profile fees before deciding whether the trade won', () => {
    const result = replay([
      row('2026-08-02', { open: 10 }),
      row('2026-08-03', { open: 10.2, high: 10.4, low: 9.8, close: 10.2 }),
    ], { maxHoldingTradingDays: 1, takeProfit1: 20, takeProfit2: 21 });
    expect(result).toMatchObject({
      kind: 'trade', exitReason: 'max_holding', grossPnl: 20, netPnl: 9.47, won: true,
    });
  });

  it('records the second target path without changing first-target proceeds', () => {
    const result = replay([
      row('2026-08-02', { open: 10 }),
      row('2026-08-03', { open: 11, high: 12.2, low: 10.8, close: 12 }),
      row('2026-08-04', { open: 12.5, high: 13.2, low: 12.4, close: 13 }),
    ]);
    expect(result).toMatchObject({
      kind: 'trade', exitPrice: 12, exitReason: 'take_profit_1', secondTakeProfitReached: true,
    });
  });

  it('returns incomplete when available history cannot reach an exit', () => {
    const result = replay([
      row('2026-08-02', { open: 10 }),
      row('2026-08-03', { open: 10.5, high: 11, low: 9.5, close: 10.5 }),
    ], { maxHoldingTradingDays: 3, takeProfit1: 20, takeProfit2: 21, stopLoss: 1 });
    expect(result).toEqual({ kind: 'incomplete', reason: 'insufficient_exit_history' });
  });
});
