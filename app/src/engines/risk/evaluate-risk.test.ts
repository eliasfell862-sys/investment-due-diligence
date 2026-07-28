import { describe, expect, it } from 'vitest';
import { evaluateRisk } from './evaluate-risk';
import { riskAssessmentInput, riskItemInput } from './risk-test-fixtures';

describe('evaluateRisk', () => {
  it('returns a complete risk assessment for valid input', () => {
    const input = riskAssessmentInput();
    const result = evaluateRisk(input);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const assessment = result.value;
    expect(assessment.version).toBe('1');
    expect(assessment.categoryMatrix).toHaveLength(9);
    expect(assessment.riskItems.length).toBeGreaterThan(0);
    expect(assessment.overall.residualRisk).not.toBeNull();
    expect(assessment.fatalFlaws.checks).toHaveLength(6);
    expect(assessment.permanentLoss.requiresInvestorConfirmation).toBe(true);
    expect(assessment.temporaryDrawdown.requiresInvestorConfirmation).toBe(true);
    expect(assessment.clauseRecommendations).toBeDefined();
    expect(assessment.verificationChecklist).toBeDefined();
    expect(assessment.thresholds.source).toBe('default');
  });

  it('returns blocked for invalid input', () => {
    const result = evaluateRisk({ version: '99', riskItems: [], fatalFlaws: [] });
    expect(result.status).toBe('blocked');
  });

  it('throws invalid_dto for hostile input', () => {
    const cyclic: Record<string, unknown> = { version: '1' };
    cyclic.self = cyclic;
    expect(() => evaluateRisk(cyclic)).toThrow();
  });

  it('returns null risk for empty risk items', () => {
    const input = riskAssessmentInput({ riskItems: [] });
    const result = evaluateRisk(input);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.value.overall.residualRisk).toBeNull();
    expect(result.value.overall.light).toBeNull();
  });

  it('returns custom thresholds in assessment', () => {
    const input = riskAssessmentInput({
      trafficLightThresholds: { greenUpper: '0.25', redLower: '0.5', changeReason: 'Fund policy' },
    });
    const result = evaluateRisk(input);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.value.thresholds.source).toBe('custom');
    expect(result.value.thresholds.greenUpper).toBe('0.25');
    expect(result.value.thresholds.changeReason).toBe('Fund policy');
  });

  it('includes trace with risk engine metadata', () => {
    const input = riskAssessmentInput();
    const result = evaluateRisk(input);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const trace = result.trace;
    expect(trace.engine).toBe('risk');
    expect(trace.riskRef).toBe('risk-assessment@1');
    expect(trace.inputs).toBeDefined();
    expect(trace.steps).toBeDefined();
  });

  it('outputs clause recommendation counts per category', () => {
    const input = riskAssessmentInput({
      riskItems: [
        riskItemInput({ riskId: 'r1', category: 'market', probability: '0.9', impact: '0.9', mitigationEffectiveness: '0' }),
      ],
    });
    const result = evaluateRisk(input);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const marketRow = result.value.categoryMatrix.find((r) => r.category === 'market')!;
    expect(marketRow.clauseRecommendationCount).toBeGreaterThan(0);
  });

  it('produces deterministic output for repeated calls', () => {
    const input = riskAssessmentInput();
    const first = JSON.stringify(evaluateRisk(input));
    const second = JSON.stringify(evaluateRisk(input));
    expect(first).toBe(second);
  });

  it('does not mutate the input', () => {
    const input = riskAssessmentInput();
    const snap = JSON.stringify(input);
    evaluateRisk(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});
