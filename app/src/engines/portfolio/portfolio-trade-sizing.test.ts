import { describe, expect, it } from 'vitest';
import { sizePortfolioTrades } from './portfolio-trade-sizing';

describe('portfolio trade sizing', () => {
  it('uses one-hundred-share lots and never exceeds capital', () => {
    const result = sizePortfolioTrades(100000, [
      { code: 'A', name: 'A', price: 12.34, targetWeight: 0.20 },
    ], 0.10, 0.70);
    expect(result.positions[0].shares % 100).toBe(0);
    expect(result.positions[0].targetAmount).toBe(20000);
    expect(result.investedAmount + result.totalCashAmount).toBeCloseTo(100000, 2);
    expect(result.investedAmount).toBeLessThanOrEqual(100000);
  });

  it('separates minimum, constraint, and board-lot cash', () => {
    const result = sizePortfolioTrades(100000, [
      { code: 'A', name: 'A', price: 12.34, targetWeight: 0.20 },
    ], 0.10, 0.70);
    expect(result.minimumCashAmount).toBe(10000);
    expect(result.constraintCashAmount).toBe(70000);
    expect(result.boardLotCashAmount).toBe(256);
    expect(result.totalCashAmount).toBe(80256);
  });

  it('reports actual weights and deviations after rounding down', () => {
    const result = sizePortfolioTrades(100000, [
      { code: 'A', name: 'A', price: 12.34, targetWeight: 0.20 },
      { code: 'B', name: 'B', price: 25, targetWeight: 0.15 },
    ], 0.10, 0.55);
    expect(result.positions[0]).toEqual(expect.objectContaining({
      actualAmount: 19744,
      actualWeight: 0.19744,
      weightDeviation: -0.00256,
    }));
    expect(result.positions[1].shares).toBe(600);
    expect(result.actualStockWeight).toBeCloseTo(result.investedAmount / 100000, 12);
  });

  it('scales inconsistent target weights to the available stock budget', () => {
    const result = sizePortfolioTrades(100000, [
      { code: 'A', name: 'A', price: 10, targetWeight: 0.80 },
      { code: 'B', name: 'B', price: 20, targetWeight: 0.40 },
    ], 0.20, 0.10);
    expect(result.positions.reduce((sum, item) => sum + item.targetWeight, 0)).toBeCloseTo(0.70, 12);
    expect(result.investedAmount + result.totalCashAmount).toBe(100000);
  });

  it('returns all cash for invalid capital without producing invalid numbers', () => {
    const result = sizePortfolioTrades(Number.NaN, [
      { code: 'A', name: 'A', price: 10, targetWeight: 0.20 },
    ], 0.10, 0.70);
    expect(result.positions).toHaveLength(0);
    expect(result.investedAmount).toBe(0);
    expect(result.totalCashAmount).toBe(0);
  });
});
