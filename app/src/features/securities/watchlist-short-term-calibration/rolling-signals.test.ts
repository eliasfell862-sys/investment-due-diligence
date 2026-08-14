import { describe, expect, it, vi } from 'vitest';
import type { ShortTermAdviceBaseInput, ShortTermTradingAdvice } from '../../../engines/market-analysis/short-term-trading-advice';
import type { CalibrationHistoryRow } from '../../../infrastructure/market-data/watchlist-calibration-history';
import { generateRollingCalibrationSignals } from './rolling-signals';

function rows(count = 65): CalibrationHistoryRow[] {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`,
    open: 10 + index * 0.01, close: 10.05 + index * 0.01,
    high: 10.2 + index * 0.01, low: 9.9 + index * 0.01,
    volume: 1000 + index, amount: 10_000 + index,
    amplitude: 3, changePct: 0.5, change: 0.05, turnover: 2 + index * 0.01,
  }));
}

function advice(input: ShortTermAdviceBaseInput, action: ShortTermTradingAdvice['action']): ShortTermTradingAdvice {
  return {
    code: input.quote.code, horizon: '3_10_trading_days', action,
    label: action === 'strong_buy' ? '积极买入' : action === 'buy_on_dip' ? '逢低买入' : '持有观察',
    score: 80, confidence: 90, confidenceLabel: '高',
    entryRange: { low: 10, high: 11 }, stopLoss: 9, takeProfit1: 12,
    takeProfit2: 13, maxHoldingTradingDays: 5, riskRewardRatio: 2,
    reasons: [], risks: [], evidence: [],
    dataCompleteness: { quote: true, kline: true, indicators: true, strategies: true },
    dataAsOf: input.dataAsOf, calculatedAt: input.calculatedAt!, cacheStatus: 'fresh',
  };
}

describe('rolling short-term calibration signals', () => {
  it('never passes rows after the signal date to calculation dependencies', () => {
    const history = rows();
    const seenLastDates: string[] = [];
    const seenQuotes: ShortTermAdviceBaseInput['quote'][] = [];

    generateRollingCalibrationSignals('600000', history, {
      calcIndicators: visible => { seenLastDates.push(visible.at(-1)!.date); },
      scanStrategies: () => [],
      scanPatterns: () => [],
      buildAdvice: input => { seenQuotes.push(input.quote); return advice(input, 'hold_watch'); },
    });

    expect(seenLastDates).toEqual(history.slice(60).map(item => item.date));
    expect(seenQuotes[0]).toMatchObject({
      code: '600000', price: history[60].close, preClose: history[59].close,
      open: history[60].open, high: history[60].high, low: history[60].low,
      volume: history[60].volume, amount: history[60].amount, turnover: history[60].turnover,
    });
  });

  it('keeps only complete buy plans and freezes their signal-day values', () => {
    const history = rows(64);
    const actions: ShortTermTradingAdvice['action'][] = [
      'strong_buy', 'hold_watch', 'buy_on_dip', 'avoid',
    ];
    let cursor = 0;

    const signals = generateRollingCalibrationSignals('000001', history, {
      calcIndicators: () => undefined,
      scanStrategies: () => [],
      scanPatterns: () => [],
      buildAdvice: input => advice(input, actions[cursor++]),
    });

    expect(signals).toEqual([
      {
        code: '000001', signalDate: history[60].date, action: 'strong_buy',
        entryRange: { low: 10, high: 11 }, stopLoss: 9,
        takeProfit1: 12, takeProfit2: 13, maxHoldingTradingDays: 5,
      },
      {
        code: '000001', signalDate: history[62].date, action: 'buy_on_dip',
        entryRange: { low: 10, high: 11 }, stopLoss: 9,
        takeProfit1: 12, takeProfit2: 13, maxHoldingTradingDays: 5,
      },
    ]);
  });

  it('calculates on cloned rows and does not mutate the supplied history', () => {
    const history = rows(61);
    const snapshot = structuredClone(history);
    generateRollingCalibrationSignals('600000', history, {
      calcIndicators: visible => { (visible[0] as { close: number }).close = 999; },
      scanStrategies: vi.fn(() => []),
      scanPatterns: vi.fn(() => []),
      buildAdvice: input => advice(input, 'hold_watch'),
    });
    expect(history).toEqual(snapshot);
  });
});
