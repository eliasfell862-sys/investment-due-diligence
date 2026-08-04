import { describe, expect, it } from 'vitest';
import { qualityTilt, solveRiskParityWeights, type PortfolioWeightInput } from './portfolio-risk-parity';

function inputs(...codes: string[]): PortfolioWeightInput[] {
  return codes.map(code => ({ code, score: 50, confidence: 50, annualizedVolatility: 0.2 }));
}

describe('portfolio risk parity', () => {
  it('equalizes risk for identical independent assets', () => {
    const result = solveRiskParityWeights(inputs('A', 'B'), [[0.04, 0], [0, 0.04]]);
    expect(result.method).toBe('risk_parity');
    expect(result.converged).toBe(true);
    expect(result.weights.A).toBeCloseTo(0.5, 6);
    expect(result.weights.B).toBeCloseTo(0.5, 6);
    expect(result.riskContributions.A).toBeCloseTo(result.riskContributions.B, 6);
  });

  it('assigns less weight to the more volatile independent asset', () => {
    const result = solveRiskParityWeights(inputs('A', 'B'), [[0.04, 0], [0, 0.16]]);
    expect(result.method).toBe('risk_parity');
    expect(result.weights.A).toBeCloseTo(2 / 3, 4);
    expect(result.weights.B).toBeCloseTo(1 / 3, 4);
    expect(result.riskContributions.A).toBeCloseTo(result.riskContributions.B, 4);
  });

  it('uses inverse volatility for a singular covariance matrix', () => {
    const candidates = [
      { code: 'A', score: 50, confidence: 50, annualizedVolatility: 0.2 },
      { code: 'B', score: 50, confidence: 50, annualizedVolatility: 0.4 },
    ];
    const result = solveRiskParityWeights(candidates, [[0.04, 0.04], [0.04, 0.04]]);
    expect(result.method).toBe('inverse_volatility');
    expect(result.converged).toBe(false);
    expect(result.weights.A).toBeCloseTo(2 / 3, 6);
    expect(result.weights.B).toBeCloseTo(1 / 3, 6);
  });

  it('uses inverse volatility for malformed or non-finite covariance input', () => {
    expect(solveRiskParityWeights(inputs('A', 'B'), [[0.04], [0, 0.04]]).method).toBe('inverse_volatility');
    expect(solveRiskParityWeights(inputs('A', 'B'), [[0.04, Number.NaN], [0, 0.04]]).method).toBe('inverse_volatility');
  });

  it('clamps quality tilt between 0.85 and 1.15', () => {
    expect(qualityTilt({ score: 100, confidence: 100 })).toBe(1.15);
    expect(qualityTilt({ score: 0, confidence: 0 })).toBe(0.85);
    expect(qualityTilt({ score: 50, confidence: 50 })).toBe(1);
    expect(qualityTilt({ score: 200, confidence: 200 })).toBe(1.15);
  });

  it('applies bounded quality tilt after base risk parity and normalizes weights', () => {
    const candidates = [
      { code: 'A', score: 100, confidence: 100, annualizedVolatility: 0.2 },
      { code: 'B', score: 0, confidence: 0, annualizedVolatility: 0.2 },
    ];
    const result = solveRiskParityWeights(candidates, [[0.04, 0], [0, 0.04]]);
    expect(result.weights.A).toBeGreaterThan(result.weights.B);
    expect(result.weights.A + result.weights.B).toBeCloseTo(1, 12);
    expect(result.weights.A / result.weights.B).toBeCloseTo(1.15 / 0.85, 6);
  });

  it('returns empty deterministic output for no candidates', () => {
    expect(solveRiskParityWeights([], [])).toEqual({
      weights: {}, riskContributions: {}, method: 'inverse_volatility', converged: false,
    });
  });
});
