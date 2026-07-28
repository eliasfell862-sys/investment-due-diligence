import { describe, expect, it } from 'vitest';

import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
import { riskAssessmentInput, riskItemInput, fatalFlawCheckInput } from './risk-test-fixtures';
import { validateRiskInput } from './validate-risk-input';
import { calculateRiskScores } from './calculate-risk-scores';
import type { RiskCategory } from './risk-types';
import { compareUnicodeCodePoints } from './compare-risk-strings';

describe('calculateRiskScores', () => {
  it('calculates exact item residual risk', () => {
    const input = validateRiskInput(riskAssessmentInput({
      riskItems: [
        riskItemInput({
          riskId: 'r1',
          probability: '0.5',
          impact: '0.8',
          mitigationEffectiveness: '0.25',
        }),
      ],
    }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const result = calculateRiskScores(input.input);
    const item = result.items[0]!;
    const expectedResidual = canonicalDecimal(
      new AnalysisDecimal('0.5').times('0.8').times(new AnalysisDecimal(1).minus('0.25')),
    );
    expect(item.residualRisk).toBe(expectedResidual);
    expect(item.light).toBe('green');
  });

  it('handles no mitigation (effectiveness 0)', () => {
    const input = validateRiskInput(riskAssessmentInput({
      riskItems: [
        riskItemInput({
          riskId: 'r1',
          probability: '0.3',
          impact: '0.5',
          mitigationEffectiveness: '0',
          mitigationDescription: undefined as any,
        }),
      ],
    }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const result = calculateRiskScores(input.input);
    const item = result.items[0]!;
    expect(item.residualRisk).toBe(
      canonicalDecimal(new AnalysisDecimal('0.3').times('0.5')),
    );
  });

  it('handles full mitigation (effectiveness 1)', () => {
    const input = validateRiskInput(riskAssessmentInput({
      riskItems: [
        riskItemInput({
          riskId: 'r1',
          probability: '0.9',
          impact: '0.9',
          mitigationEffectiveness: '1',
        }),
      ],
    }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;
    expect(calculateRiskScores(input.input).items[0]!.residualRisk).toBe('0');
  });

  it('uses category maximum for classification risk', () => {
    const input = validateRiskInput(riskAssessmentInput({
      riskItems: [
        riskItemInput({ riskId: 'low', category: 'market', probability: '0.1', impact: '0.5', mitigationEffectiveness: '0' }),
        riskItemInput({ riskId: 'high', category: 'market', probability: '0.8', impact: '0.9', mitigationEffectiveness: '0' }),
      ],
    }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const result = calculateRiskScores(input.input);
    const marketRow = result.categoryMatrix.find((row) => row.category === 'market')!;
    const expectedMax = canonicalDecimal(new AnalysisDecimal('0.8').times('0.9'));
    expect(marketRow.residualRisk).toBe(expectedMax);
    expect(marketRow.topRiskId).toBe('high');
  });

  it('ties break by Unicode code-point smallest riskId', () => {
    const shared = riskItemInput({ riskId: 'ä-risk', category: 'technology', probability: '0.5', impact: '0.5', mitigationEffectiveness: '0', signals: [] });
    const input = validateRiskInput(riskAssessmentInput({
      riskItems: [
        { ...shared, riskId: 'z-risk' },
        { ...shared, riskId: 'ä-risk' },
      ],
    }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const techRow = calculateRiskScores(input.input).categoryMatrix.find((row) => row.category === 'technology')!;
    expect(techRow.topRiskId).toBe('z-risk');
  });

  it('marks unassessed categories with null risk and light', () => {
    const input = validateRiskInput(riskAssessmentInput({
      riskItems: [
        riskItemInput({ category: 'market' }),
      ],
    }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const result = calculateRiskScores(input.input);
    const unassessed = result.categoryMatrix.find((row) => row.category === 'technology')!;
    expect(unassessed.status).toBe('unassessed');
    expect(unassessed.residualRisk).toBeNull();
    expect(unassessed.light).toBeNull();
    expect(unassessed.riskItemCount).toBe(0);
  });

  it('returns null overall risk when all categories are unassessed', () => {
    const input = validateRiskInput(riskAssessmentInput({ riskItems: [] }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const result = calculateRiskScores(input.input);
    expect(result.overall.residualRisk).toBeNull();
    expect(result.overall.light).toBeNull();
    expect(result.overall.riskPenalty).toBeNull();
    expect(result.overall.assessedCategoryCount).toBe(0);
    expect(result.overall.categoryCoverageRatio).toBe('0');
  });

  it('calculates default equal-weight overall risk', () => {
    const input = validateRiskInput(riskAssessmentInput({
      riskItems: [
        riskItemInput({ riskId: 'a', category: 'market', probability: '0.5', impact: '0.6', mitigationEffectiveness: '0' }),
        riskItemInput({ riskId: 'b', category: 'technology', probability: '0.3', impact: '0.4', mitigationEffectiveness: '0', signals: [] }),
      ],
    }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const result = calculateRiskScores(input.input);
    // market residual = 0.5 * 0.6 = 0.3; technology = 0.3 * 0.4 = 0.12
    // overall = (0.3 + 0.12) / 2 = 0.21
    expect(result.overall.residualRisk).toBe('0.21');
    expect(result.overall.assessedCategoryCount).toBe(2);
    expect(result.overall.categoryCoverageRatio).toBe(canonicalDecimal(new AnalysisDecimal(2).div(9)));
    expect(result.overall.light).toBe('green');
  });

  it('renormalizes custom weights over assessed categories', () => {
    const weights: Record<RiskCategory, string> = {
      market: '0.5', technology: '0.3', customer: '0.1',
      financial: '0.1', financing: '0', legal_compliance: '0',
      governance: '0', data_authenticity: '0', exit: '0',
    };
    const input = validateRiskInput(riskAssessmentInput({
      categoryWeights: weights,
      riskItems: [
        riskItemInput({ riskId: 'a', category: 'market', probability: '0.5', impact: '0.8', mitigationEffectiveness: '0' }),
        riskItemInput({ riskId: 'b', category: 'technology', probability: '0.2', impact: '0.5', mitigationEffectiveness: '0', signals: [] }),
      ],
    }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const result = calculateRiskScores(input.input);
    // market residual = 0.4; technology residual = 0.1
    // weights: market 0.5, tech 0.3 → assessed weight = 0.8
    // renormalized: market = 0.5/0.8 = 0.625, tech = 0.3/0.8 = 0.375
    // overall = 0.4*0.625 + 0.1*0.375 = 0.25 + 0.0375 = 0.2875
    expect(result.overall.residualRisk).toBe('0.2875');
    expect(result.overall.weightCoverageRatio).toBe('0.8');
  });

  it('applies default traffic light thresholds', () => {
    const input = validateRiskInput(riskAssessmentInput({
      riskItems: [
        riskItemInput({ riskId: 'low', category: 'market', probability: '0.3', impact: '0.3', mitigationEffectiveness: '0' }),
      ],
    }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const result = calculateRiskScores(input.input);
    // 0.3 * 0.3 = 0.09 < 0.33 → green
    expect(result.items[0]!.light).toBe('green');
    expect(result.categoryMatrix.find((r) => r.category === 'market')!.light).toBe('green');
  });

  it('applies custom traffic light thresholds', () => {
    const input = validateRiskInput(riskAssessmentInput({
      trafficLightThresholds: { greenUpper: '0.1', redLower: '0.3', changeReason: 'Stricter fund policy' },
      riskItems: [
        riskItemInput({ riskId: 'mid', category: 'market', probability: '0.4', impact: '0.5', mitigationEffectiveness: '0' }),
      ],
    }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const result = calculateRiskScores(input.input);
    // 0.4 * 0.5 = 0.2, thresholds: green < 0.1, red >= 0.3 → yellow
    expect(result.items[0]!.light).toBe('yellow');
  });

  it('calculates risk penalty as overallRisk * 20', () => {
    const input = validateRiskInput(riskAssessmentInput({
      riskItems: [
        riskItemInput({ riskId: 'a', category: 'market', probability: '0.5', impact: '0.8', mitigationEffectiveness: '0' }),
      ],
    }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const result = calculateRiskScores(input.input);
    // one assessed category, overall = 0.4
    expect(result.overall.riskPenalty).toBe('8');
  });

  it('outputs exactly nine category matrix rows in fixed order', () => {
    const input = validateRiskInput(riskAssessmentInput({ riskItems: [] }));
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const result = calculateRiskScores(input.input);
    expect(result.categoryMatrix).toHaveLength(9);
    const expectedOrder: RiskCategory[] = [
      'market', 'technology', 'customer', 'financial', 'financing',
      'legal_compliance', 'governance', 'data_authenticity', 'exit',
    ];
    expect(result.categoryMatrix.map((r) => r.category)).toEqual(expectedOrder);
  });

  it('produces deterministic output for repeated calls', () => {
    const input = validateRiskInput(riskAssessmentInput());
    expect(input.status).toBe('valid');
    if (input.status !== 'valid') return;

    const first = calculateRiskScores(input.input);
    const second = calculateRiskScores(input.input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
