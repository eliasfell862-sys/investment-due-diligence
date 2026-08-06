import { describe, expect, it } from 'vitest';
import type { StockKLine } from '../../../infrastructure/market-data/stock-api';
import { evaluatePredictionOutcome } from './prediction-outcome';

function bars(closes: number[], lows: number[] = closes.map(value => value - 0.5)): StockKLine[] {
  return closes.map((close, index) => ({
    date: `2026-07-${String(index + 2).padStart(2, '0')}`,
    open: close, close, high: close + 0.5, low: lows[index] ?? close - 0.5,
    volume: 1000, amount: 100000000,
  }));
}

function fixture(stockCloses: number[], benchmarkCloses: number[], lows?: number[]) {
  return {
    signalDate: '2026-07-01', signalClose: 100, benchmarkSignalClose: 100,
    stockBars: bars(stockCloses, lows), benchmarkBars: bars(benchmarkCloses),
  };
}

describe('evaluatePredictionOutcome', () => {
  it('marks success when one trading day from three through fifteen meets every target', () => {
    const stock = [101, 102, 106, ...Array(12).fill(106)];
    const benchmark = [100, 100.5, 102, ...Array(12).fill(102)];
    const result = evaluatePredictionOutcome(fixture(stock, benchmark));
    expect(result).toMatchObject({ evaluated: true, success: true, firstSuccessTradingDay: 3 });
    expect(result.observations).toHaveLength(3);
  });

  it('fails when the price target follows a drawdown beyond four percent', () => {
    const stock = [99, 98, 106, ...Array(12).fill(106)];
    const benchmark = [100, 100, 101, ...Array(12).fill(101)];
    const lows = [98, 95, 105, ...Array(12).fill(105)];
    expect(evaluatePredictionOutcome(fixture(stock, benchmark, lows)).success).toBe(false);
  });

  it('does not finalize before fifteen common forward trading bars exist', () => {
    const result = evaluatePredictionOutcome(fixture(Array(10).fill(101), Array(10).fill(100)));
    expect(result).toMatchObject({ evaluated: false, success: null });
  });

  it('aligns stock and benchmark observations by trading date', () => {
    const stock = bars(Array(15).fill(106));
    stock[1].date = '2026-07-20';
    const result = evaluatePredictionOutcome({
      signalDate: '2026-07-01', signalClose: 100, benchmarkSignalClose: 100,
      stockBars: stock, benchmarkBars: bars(Array(15).fill(102)),
    });
    expect(result.evaluated).toBe(false);
  });
});