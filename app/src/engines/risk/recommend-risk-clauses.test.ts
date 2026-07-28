import { describe, expect, it } from 'vitest';
import { recommendRiskClauses } from './recommend-risk-clauses';
import type { RiskItemAssessment, FatalFlawCheckAssessment } from './risk-types';

describe('recommendRiskClauses', () => {
  const redItem = (): RiskItemAssessment => ({
    riskId: 'r1',
    category: 'market',
    title: 'High market risk',
    probability: '0.9',
    impact: '0.9',
    mitigationEffectiveness: '0',
    mitigationDescription: null,
    signals: [],
    evidenceRefs: [],
    residualRisk: '0.81',
    light: 'red',
  });

  const yellowItem = (): RiskItemAssessment => ({
    riskId: 'r2',
    category: 'technology',
    title: 'Medium tech risk',
    probability: '0.5',
    impact: '0.6',
    mitigationEffectiveness: '0',
    mitigationDescription: null,
    signals: [],
    evidenceRefs: [],
    residualRisk: '0.3',
    light: 'yellow',
  });

  const greenItem = (): RiskItemAssessment => ({
    riskId: 'g1',
    category: 'financial',
    title: 'Low financial risk',
    probability: '0.1',
    impact: '0.3',
    mitigationEffectiveness: '0',
    mitigationDescription: null,
    signals: [],
    evidenceRefs: [],
    residualRisk: '0.03',
    light: 'green',
  });

  const clearFatalFlaws = (): FatalFlawCheckAssessment[] => [
    { fatalFlawId: 'material_data_or_business_fraud', severity: 'reject', status: 'clear', evidenceRefs: [], coverageReason: null, bindingConditions: [], resolutionNote: null },
    { fatalFlawId: 'core_ownership_or_license_unclear', severity: 'pause', status: 'clear', evidenceRefs: [], coverageReason: null, bindingConditions: [], resolutionNote: null },
    { fatalFlawId: 'irremediable_major_illegality', severity: 'reject', status: 'clear', evidenceRefs: [], coverageReason: null, bindingConditions: [], resolutionNote: null },
    { fatalFlawId: 'business_model_unverifiable', severity: 'pause', status: 'clear', evidenceRefs: [], coverageReason: null, bindingConditions: [], resolutionNote: null },
    { fatalFlawId: 'pre_close_cash_break', severity: 'pause', status: 'clear', evidenceRefs: [], coverageReason: null, bindingConditions: [], resolutionNote: null },
    { fatalFlawId: 'founder_integrity_failure', severity: 'reject', status: 'clear', evidenceRefs: [], coverageReason: null, bindingConditions: [], resolutionNote: null },
  ];

  it('generates must_have clauses for red items', () => {
    const result = recommendRiskClauses({ riskItems: [redItem()], fatalFlaws: clearFatalFlaws() });
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0]!.negotiationPriority).toBe('must_have');
  });

  it('generates high clauses for yellow items', () => {
    const result = recommendRiskClauses({ riskItems: [yellowItem()], fatalFlaws: clearFatalFlaws() });
    expect(result.recommendations.every((r) => r.negotiationPriority === 'high')).toBe(true);
  });

  it('generates no clauses for green items', () => {
    const result = recommendRiskClauses({ riskItems: [greenItem()], fatalFlaws: clearFatalFlaws() });
    expect(result.recommendations).toHaveLength(0);
  });

  it('deduplicates clauses across multiple sources', () => {
    const result = recommendRiskClauses({
      riskItems: [redItem(), { ...redItem(), riskId: 'r3' }],
      fatalFlaws: clearFatalFlaws(),
    });
    // Both red items in same category should produce clauses, but each clauseType should appear once with both riskIds
    const duplicateCt = result.recommendations.find((r) => r.sourceRiskIds.length > 1);
    expect(duplicateCt).toBeDefined();
  });

  it('escalates to must_have when any source is red', () => {
    const result = recommendRiskClauses({
      riskItems: [yellowItem(), redItem()],
      fatalFlaws: clearFatalFlaws(),
    });
    // Clauses triggered by both categories — items from market (red) and technology (yellow)
    // Some clauses may overlap across categories, triggering escalation
    const hasMustHave = result.recommendations.some((r) => r.negotiationPriority === 'must_have');
    expect(hasMustHave).toBe(true);
  });

  it('generates condition precedent for open pause flaws', () => {
    const flaws = clearFatalFlaws().map((f) =>
      f.fatalFlawId === 'core_ownership_or_license_unclear'
        ? { ...f, status: 'open' as const }
        : f,
    );
    const result = recommendRiskClauses({ riskItems: [], fatalFlaws: flaws });
    expect(result.recommendations.some((r) => r.clauseType === 'fatal_flaw_condition_precedent')).toBe(true);
    expect(result.verificationChecklist.length).toBeGreaterThan(0);
  });

  it('generates binding conditions for covered flaws', () => {
    const flaws = clearFatalFlaws().map((f) =>
      f.fatalFlawId === 'business_model_unverifiable'
        ? { ...f, status: 'covered' as const, bindingConditions: ['Complete customer audit.'] }
        : f,
    );
    const result = recommendRiskClauses({ riskItems: [], fatalFlaws: flaws });
    expect(result.recommendations.some((r) => r.clauseType === 'covered_flaw_binding_condition')).toBe(true);
  });

  it('every clause has legal review required and disclaimer', () => {
    const result = recommendRiskClauses({ riskItems: [redItem()], fatalFlaws: clearFatalFlaws() });
    for (const clause of result.recommendations) {
      expect(clause.legalReviewRequired).toBe(true);
      expect(clause.disclaimer.length).toBeGreaterThan(0);
    }
  });

  it('sorts must_have before high', () => {
    const result = recommendRiskClauses({
      riskItems: [redItem(), yellowItem()],
      fatalFlaws: clearFatalFlaws(),
    });
    // All must_have clauses should come before any high clauses
    let sawHigh = false;
    for (const clause of result.recommendations) {
      if (clause.negotiationPriority === 'high') sawHigh = true;
      if (sawHigh) {
        expect(clause.negotiationPriority).toBe('high');
      } else {
        expect(clause.negotiationPriority).toBe('must_have');
      }
    }
  });
});
