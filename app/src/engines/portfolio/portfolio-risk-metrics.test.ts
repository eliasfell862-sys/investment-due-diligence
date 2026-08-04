import { describe, expect, it } from 'vitest';
import {
  calculateStockRiskMetrics,
  correlateAlignedReturns,
  covarianceMatrix,
  simpleDailyReturns,
  type DatedReturn,
} from './portfolio-risk-metrics';

function returnSeries(count: number, direction = 1, start = 0): DatedReturn[] {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-${String(start + index + 1).padStart(3, '0')}`,
    value: direction * ((index % 7) - 3) / 100,
  }));
}

describe('portfolio risk metrics', () => {
  it('uses simple daily returns', () => {
    const result = simpleDailyReturns([
      { date: '2026-01-01', close: 100 },
      { date: '2026-01-02', close: 110 },
      { date: '2026-01-03', close: 99 },
    ]);
    expect(result[0].value).toBeCloseTo(0.1, 12);
    expect(result[1].value).toBeCloseTo(-0.1, 12);
  });

  it('annualizes sample volatility with sqrt 252 and calculates running-peak drawdown', () => {
    const result = calculateStockRiskMetrics([
      { date: '2026-01-01', close: 100 },
      { date: '2026-01-02', close: 110 },
      { date: '2026-01-03', close: 99 },
    ]);
    expect(result.annualizedVolatility).toBeCloseTo(Math.sqrt(0.02) * Math.sqrt(252), 10);
    expect(result.maximumDrawdown).toBeCloseTo(0.1, 10);
  });

  it('returns null correlation below sixty common valid dates', () => {
    const result = correlateAlignedReturns(returnSeries(59), returnSeries(59));
    expect(result).toEqual({ commonDays: 59, correlation: null });
  });

  it('aligns by exact date and calculates Pearson correlation', () => {
    const left = returnSeries(65);
    const right = left.slice(5).map(row => ({ date: row.date, value: -row.value }));
    const result = correlateAlignedReturns(left, right);
    expect(result.commonDays).toBe(60);
    expect(result.correlation).toBeCloseTo(-1, 12);
  });

  it('builds a symmetric covariance matrix from dates common to every series', () => {
    const result = covarianceMatrix({
      B: returnSeries(80, -1),
      A: returnSeries(80, 1),
    });
    expect(result.codes).toEqual(['A', 'B']);
    expect(result.commonDays).toBe(80);
    expect(result.matrix).toHaveLength(2);
    expect(result.matrix[0][1]).toBeCloseTo(result.matrix[1][0], 12);
    expect(result.matrix[0][0]).toBeGreaterThan(0);
    expect(result.matrix[0][1]).toBeLessThan(0);
  });

  it('filters invalid closes and non-finite returns', () => {
    const returns = simpleDailyReturns([
      { date: '1', close: 0 },
      { date: '2', close: 100 },
      { date: '3', close: Number.NaN },
      { date: '4', close: 110 },
    ]);
    expect(returns).toHaveLength(1);
    expect(returns[0].date).toBe('4');
    expect(returns[0].value).toBeCloseTo(0.1, 12);
    expect(correlateAlignedReturns(
      [...returnSeries(60), { date: 'bad', value: Number.NaN }],
      [...returnSeries(60), { date: 'bad', value: 1 }],
    ).commonDays).toBe(60);
  });
});
