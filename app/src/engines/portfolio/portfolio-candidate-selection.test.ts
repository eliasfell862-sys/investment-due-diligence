import { describe, expect, it } from 'vitest';
import type { PortfolioCandidateAnalysis } from '../../features/securities/portfolio-candidate-analysis';
import {
  selectPortfolioCandidates,
  type PortfolioRiskLevel,
} from './portfolio-candidate-selection';

function returns(direction = 1) {
  return Array.from({ length: 80 }, (_, index) => ({
    date: `2026-${String(index + 1).padStart(3, '0')}`,
    value: direction * ((index % 7) - 3) / 100,
  }));
}

function candidate(overrides: Partial<PortfolioCandidateAnalysis> & {
  code?: string;
  maximumDrawdown?: number;
  annualizedVolatility?: number;
} = {}): PortfolioCandidateAnalysis {
  const code = overrides.code ?? '000001';
  const riskReturns = overrides.returns ?? returns();
  return {
    code,
    name: `股票${code}`,
    quote: {
      code, name: `股票${code}`, market: 'sz', price: 10, change: 0, changePct: 0,
      open: 10, high: 10.2, low: 9.8, volume: 100000, amount: 2_000_000,
      preClose: 10, turnover: 2, pe: 15, pb: 1.5, totalShares: 100,
      floatShares: 80, totalCap: 500, floatCap: 400,
    },
    industry: `行业${code}`,
    classificationStatus: 'official',
    sources: [],
    labels: [],
    score: 80,
    confidence: 85,
    mediumTermAdvice: {
      code, horizon: '1_3_months', action: 'accumulate', label: '分批买入', score: 80,
      confidence: 85, confidenceLabel: '高', reasons: [], risks: [],
      dataCompleteness: { quote: true, kline: true, fundamental: true },
      calculatedAt: '2026-08-04T08:00:00.000Z',
    },
    fundamental: { totalScore: 80, rating: '优秀', breakdown: [], metrics: [] },
    strategies: [],
    patterns: [],
    risk: {
      returns: riskReturns,
      annualizedVolatility: overrides.annualizedVolatility ?? 0.25,
      maximumDrawdown: overrides.maximumDrawdown ?? 0.2,
    },
    returns: riskReturns,
    dataCompleteness: { quote: true, kline: true, fundamental: true, industry: true },
    dataAsOf: '2026-08-04',
    ...overrides,
  };
}

describe('portfolio candidate selection', () => {
  it.each([
    ['conservative', 70],
    ['balanced', 65],
    ['aggressive', 60],
  ] as const)('uses the %s score threshold', (riskLevel, threshold) => {
    const result = selectPortfolioCandidates([candidate({ score: threshold - 1 })], riskLevel);
    expect(result.selected).toHaveLength(0);
    expect(result.excluded[0].reasonCode).toBe('score_threshold');
  });

  it('applies hard-risk gates before score and explains the first failure', () => {
    const result = selectPortfolioCandidates([
      candidate({ score: 99, maximumDrawdown: 0.4 }),
      candidate({ code: '000002', score: 99, quote: { ...candidate().quote, code: '000002', price: 0 } }),
    ], 'conservative');
    expect(result.excluded).toContainEqual(expect.objectContaining({ code: '000001', reasonCode: 'drawdown_limit' }));
    expect(result.excluded).toContainEqual(expect.objectContaining({ code: '000002', reasonCode: 'invalid_price' }));
  });

  it('does not fill ten slots when only six candidates qualify', () => {
    const qualified = Array.from({ length: 6 }, (_, index) => candidate({ code: String(index + 1).padStart(6, '0') }));
    const below = Array.from({ length: 8 }, (_, index) => candidate({ code: String(index + 20).padStart(6, '0'), score: 64 }));
    const result = selectPortfolioCandidates([...qualified, ...below], 'balanced');
    expect(result.selected).toHaveLength(6);
    expect(result.excluded.filter(item => item.reasonCode === 'score_threshold')).toHaveLength(8);
  });

  it('keeps only the best ten using score, confidence, volatility, then code', () => {
    const items = Array.from({ length: 12 }, (_, index) => candidate({
      code: String(index + 1).padStart(6, '0'),
      score: 70 + index,
    }));
    const result = selectPortfolioCandidates(items, 'balanced');
    expect(result.selected).toHaveLength(10);
    expect(result.selected.map(item => item.code)).not.toContain('000001');
    expect(result.excluded.filter(item => item.reasonCode === 'selection_limit')).toHaveLength(2);
  });

  it('removes the weaker same-industry stock at correlation 0.80', () => {
    const strong = candidate({ code: '000001', score: 85, industry: '银行', returns: returns() });
    const weak = candidate({ code: '000002', score: 75, industry: '银行', returns: returns() });
    const result = selectPortfolioCandidates([weak, strong], 'balanced');
    expect(result.selected.map(item => item.code)).toEqual(['000001']);
    expect(result.excluded).toContainEqual(expect.objectContaining({ code: '000002', reasonCode: 'high_correlation' }));
    expect(result.highCorrelationPairs[0]).toEqual(expect.objectContaining({ correlation: 1, commonDays: 80 }));
  });

  it('retains correlated stocks from different official industries for the later pair cap', () => {
    const bank = candidate({ code: '000001', industry: '银行' });
    const technology = candidate({ code: '000002', industry: '软件' });
    const result = selectPortfolioCandidates([bank, technology], 'balanced');
    expect(result.selected).toHaveLength(2);
    expect(result.highCorrelationPairs).toHaveLength(1);
    expect(result.highCorrelationPairs[0]).toEqual(expect.objectContaining({ leftCode: '000001', rightCode: '000002' }));
  });

  it.each([
    ['conservative', 0.35, 0.25],
    ['balanced', 0.5, 0.35],
    ['aggressive', 0.7, 0.5],
  ] as Array<[PortfolioRiskLevel, number, number]>)('uses %s volatility and drawdown limits', (riskLevel, volatility, drawdown) => {
    const result = selectPortfolioCandidates([
      candidate({ code: '000001', annualizedVolatility: volatility + 0.01 }),
      candidate({ code: '000002', maximumDrawdown: drawdown + 0.01 }),
    ], riskLevel);
    expect(result.excluded.map(item => item.reasonCode)).toEqual(['volatility_limit', 'drawdown_limit']);
  });
});
