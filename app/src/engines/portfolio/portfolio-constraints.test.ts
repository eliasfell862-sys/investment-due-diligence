import { describe, expect, it } from 'vitest';
import type { PairCorrelation } from './portfolio-risk-metrics';
import {
  constrainPortfolioWeights,
  type ConstrainedCandidate,
} from './portfolio-constraints';

function candidate(
  code: string,
  industry: string | null,
  labels: string[] = [],
  score = 80,
): ConstrainedCandidate {
  return { code, industry, labels, score, confidence: 80 };
}

function pair(leftCode: string, rightCode: string, correlation = 0.85): PairCorrelation {
  return { leftCode, rightCode, correlation, commonDays: 80 };
}

describe('portfolio constraints', () => {
  it('keeps stock weights between five and twenty percent with balanced cash at least ten percent', () => {
    const result = constrainPortfolioWeights([
      candidate('A', '银行'), candidate('B', '软件'), candidate('C', '医药'),
    ], { A: 0.70, B: 0.20, C: 0.10 }, 'balanced', []);
    expect(Math.max(...Object.values(result.weights))).toBeLessThanOrEqual(0.20 + 1e-12);
    expect(Math.min(...Object.values(result.weights))).toBeGreaterThanOrEqual(0.05 - 1e-12);
    expect(result.minimumCash).toBe(0.10);
    expect(result.stockWeight + result.minimumCash + result.constraintCash).toBeCloseTo(1, 12);
  });

  it('caps each official industry at thirty-five percent', () => {
    const result = constrainPortfolioWeights([
      candidate('A', '银行'), candidate('B', '银行'), candidate('C', '软件'), candidate('D', '医药'),
    ], { A: 0.3, B: 0.3, C: 0.2, D: 0.2 }, 'aggressive', []);
    expect(result.exposures.industries['银行']).toBeLessThanOrEqual(0.35 + 1e-12);
  });

  it('counts multi-label positions against every label', () => {
    const result = constrainPortfolioWeights([
      candidate('A', '软件', ['成长', '科技']),
      candidate('B', '电子', ['成长']),
      candidate('C', '通信', ['科技']),
      candidate('D', '医药', ['防御']),
    ], { A: 0.3, B: 0.3, C: 0.2, D: 0.2 }, 'aggressive', []);
    expect(result.exposures.labels['成长']).toBeLessThanOrEqual(0.35 + 1e-12);
    expect(result.exposures.labels['科技']).toBeLessThanOrEqual(0.35 + 1e-12);
  });

  it('caps a retained high-correlation pair at twenty-five percent', () => {
    const result = constrainPortfolioWeights([
      candidate('A', '银行'), candidate('B', '软件'), candidate('C', '医药'),
    ], { A: 0.20, B: 0.20, C: 0.20 }, 'aggressive', [pair('A', 'B')]);
    expect((result.weights.A ?? 0) + (result.weights.B ?? 0)).toBeLessThanOrEqual(0.25 + 1e-12);
  });

  it('removes a position below five percent and transfers excess to constraint cash', () => {
    const result = constrainPortfolioWeights([
      candidate('A', '银行', [], 90), candidate('B', '软件', [], 70),
    ], { A: 0.96, B: 0.04 }, 'aggressive', []);
    expect(result.weights.B).toBeUndefined();
    expect(result.removed).toContainEqual(expect.objectContaining({ code: 'B' }));
    expect(result.constraintCash).toBeGreaterThan(0);
  });

  it('removes the lowest-ranked sub-five-percent position first and resolves again', () => {
    const result = constrainPortfolioWeights([
      candidate('A', '银行', [], 90),
      candidate('B', '软件', [], 80),
      candidate('C', '医药', [], 70),
    ], { A: 0.90, B: 0.055, C: 0.045 }, 'balanced', []);
    expect(result.weights.C).toBeUndefined();
    expect(result.removed[0].code).toBe('C');
    expect(Object.values(result.weights).every(weight => weight >= 0.05 - 1e-12)).toBe(true);
  });

  it.each([
    ['conservative', 0.20, 0.80],
    ['balanced', 0.10, 0.90],
    ['aggressive', 0.00, 1.00],
  ] as const)('uses %s minimum cash and stock cap', (riskLevel, cashFloor, stockCap) => {
    const items = Array.from({ length: 8 }, (_, index) => candidate(String(index), `行业${index}`));
    const weights = Object.fromEntries(items.map(item => [item.code, 0.125]));
    const result = constrainPortfolioWeights(items, weights, riskLevel, []);
    expect(result.minimumCash).toBe(cashFloor);
    expect(result.stockWeight).toBeLessThanOrEqual(stockCap + 1e-12);
  });
});
