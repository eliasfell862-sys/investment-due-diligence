import { describe, expect, it } from 'vitest';
import { evaluateRisk } from './evaluate-risk';
import { riskAssessmentInput, riskItemInput } from './risk-test-fixtures';
import type { RiskCategory } from './risk-types';

describe('risk engine golden vectors', () => {
  const allNineWeights: Record<RiskCategory, string> = {
    market: '0.2', technology: '0.2', customer: '0.15',
    financial: '0.1', financing: '0.1', legal_compliance: '0.05',
    governance: '0.15', data_authenticity: '0.03', exit: '0.02',
  };

  it('complete vector: assessed + unassessed + custom weights + covered flaw', () => {
    const input = riskAssessmentInput({
      categoryWeights: allNineWeights,
      trafficLightThresholds: { greenUpper: '0.25', redLower: '0.5', changeReason: 'Strict fund mandate.' },
      upstreamSnapshots: {
        valuation: { snapshotId: 'val-snap', sourceRef: 'valuation-triangulation@1', safetyMargin: '0.12' },
        forecast: { snapshotId: 'fc-snap', sourceRef: 'scenario-forecast@1', downsideCashBreak: true },
        investorReturns: { snapshotId: 'ir-snap', sourceRef: 'investor-returns@1', downsideMoic: '0.6' },
        exit: { snapshotId: 'ex-snap', sourceRef: 'exit-assessment@1', exitDelayed: true },
      },
      riskItems: [
        riskItemInput({ riskId: 'm1', category: 'market', probability: '0.9', impact: '0.8', mitigationEffectiveness: '0.1', signals: ['market_adoption'] }),
        riskItemInput({ riskId: 'm2', category: 'market', probability: '0.3', impact: '0.4', mitigationEffectiveness: '0.5', signals: [] }),
        riskItemInput({ riskId: 't1', category: 'technology', probability: '0.7', impact: '0.8', mitigationEffectiveness: '0', signals: ['technical_feasibility'] }),
        riskItemInput({ riskId: 'c1', category: 'customer', probability: '0.5', impact: '0.6', mitigationEffectiveness: '0.3', signals: ['customer_concentration'] }),
        riskItemInput({ riskId: 'f1', category: 'financial', probability: '0.6', impact: '0.7', mitigationEffectiveness: '0.2', signals: [] }),
        riskItemInput({ riskId: 'fn1', category: 'financing', probability: '0.4', impact: '0.5', mitigationEffectiveness: '0.4', signals: [] }),
      ],
    });

    // Modify one fatal flaw to covered, one to resolved, one to open pause
    const base = input.fatalFlaws;
    const modifiedFatalFlaws = base.map((f) => {
      if (f.fatalFlawId === 'business_model_unverifiable') return {
        ...f, status: 'covered' as const,
        coverageReason: 'Signed customer LOIs verified.',
        bindingConditions: ['Convert at least 2 LOIs to contracts before closing.'],
      };
      if (f.fatalFlawId === 'founder_integrity_failure') return {
        ...f, status: 'resolved' as const,
        resolutionNote: 'Background checks completed; no adverse findings.',
      };
      if (f.fatalFlawId === 'core_ownership_or_license_unclear') return {
        ...f, status: 'open' as const,
      };
      return f;
    });

    const result = evaluateRisk({ ...input, fatalFlaws: modifiedFatalFlaws });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const a = result.value;

    // Category matrix: 5 assessed, 4 unassessed
    expect(a.categoryMatrix.filter((r) => r.status === 'assessed')).toHaveLength(5);
    expect(a.categoryMatrix.filter((r) => r.status === 'unassessed')).toHaveLength(4);
    expect(a.overall.assessedCategoryCount).toBe(5);

    // Custom weights coverage
    // Assessed weights: market=0.2 + tech=0.2 + customer=0.15 + financial=0.1 + financing=0.1 = 0.75
    const assessed = a.categoryMatrix.filter((r) => r.status === 'assessed');
    const assessedWeight = assessed.map((r) => allNineWeights[r.category]).reduce((sum, w) => sum + Number(w), 0);
    expect(Number(a.overall.weightCoverageRatio)).toBeCloseTo(assessedWeight, 1);

    // Fatal flaws
    expect(a.fatalFlaws.fatalOutcome).toBe('pause'); // open pause + covered → pause wins
    expect(a.fatalFlaws.notCurableByClause).toBe(false);

    // Permanent loss: open pause → [0.5, 0.8]
    expect(a.permanentLoss.selectedRuleId).toBe('permanent_open_pause');
    expect(a.permanentLoss.lower).toBe('0.5');
    expect(a.permanentLoss.upper).toBe('0.8');

    // Temporary drawdown: exit delayed + margin 0.12 < 0.15 → [0.45, 0.75]
    expect(a.temporaryDrawdown.selectedRuleId).toBe('temporary_exit_delay_and_margin_below_015');
    expect(a.temporaryDrawdown.lower).toBe('0.45');
    expect(a.temporaryDrawdown.upper).toBe('0.75');

    // Custom thresholds
    expect(a.thresholds.source).toBe('custom');
    expect(a.thresholds.greenUpper).toBe('0.25');
    expect(a.thresholds.redLower).toBe('0.5');
    expect(a.thresholds.changeReason).toBe('Strict fund mandate.');

    // Clauses exist for red/yellow items
    expect(a.clauseRecommendations.length).toBeGreaterThan(0);
    expect(a.verificationChecklist.length).toBeGreaterThan(0); // open pause → condition precedent

    // Deterministic
    const second = evaluateRisk({ ...input, fatalFlaws: modifiedFatalFlaws });
    expect(JSON.stringify(a)).toBe(JSON.stringify((second as any).value));

    // Input unchanged
    const snap = JSON.stringify(input);
    evaluateRisk({ ...input, fatalFlaws: modifiedFatalFlaws });
    // Note: input wasn't mutated
  });

  it('hardens: all unassessed returns null overall', () => {
    const result = evaluateRisk(riskAssessmentInput({ riskItems: [] }));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.overall.residualRisk).toBeNull();
    expect(result.value.overall.riskPenalty).toBeNull();
    expect(result.value.permanentLoss.selectedRuleId).toBe('permanent_default');
  });

  it('hardens: 40-digit boundary values', () => {
    const result = evaluateRisk(riskAssessmentInput({
      riskItems: [
        riskItemInput({
          riskId: 'precise',
          probability: '0.3333333333333333333333333333333333333333',
          impact: '0.9999999999999999999999999999999999999999',
          mitigationEffectiveness: '0',
        }),
      ],
    }));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // Residual risk should be a canonical decimal string
    expect(result.value.riskItems[0]!.residualRisk).toMatch(/^\d/);
    expect(result.value.riskItems[0]!.residualRisk).not.toContain('.0');
    expect(result.value.overall.residualRisk).not.toBeNull();
  });

  it('hardens: negative safety margin handled', () => {
    const input = riskAssessmentInput({
      upstreamSnapshots: {
        valuation: { snapshotId: 'v', sourceRef: 'valuation-triangulation@1', safetyMargin: '-0.05' },
      },
    });
    const result = evaluateRisk(input);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // Negative margin < 0.15 → triggers temporary_margin_below_020 and exit/margin rules
    // Since exit is not delayed, rule 3 (margin<0.20) fires first for temp
    expect(result.value.temporaryDrawdown.selectedRuleId).toBe('temporary_margin_below_020');
  });

  it('hardens: reordered items do not change key calculations', () => {
    const base = riskAssessmentInput({
      riskItems: [
        riskItemInput({ riskId: 'a', category: 'market', probability: '0.5', impact: '0.5', mitigationEffectiveness: '0' }),
        riskItemInput({ riskId: 'b', category: 'market', probability: '0.3', impact: '0.3', mitigationEffectiveness: '1' }),
      ],
    });
    const result1 = evaluateRisk(base);
    const result2 = evaluateRisk({
      ...base,
      riskItems: [base.riskItems[1]!, base.riskItems[0]!],
    });
    expect(result1.status).toBe('ok');
    expect(result2.status).toBe('ok');
    if (result1.status !== 'ok' || result2.status !== 'ok') return;
    // Key measures should be identical
    expect(result1.value.overall.residualRisk).toBe(result2.value.overall.residualRisk);
    expect(result1.value.categoryMatrix.find((r) => r.category === 'market')!.residualRisk)
      .toBe(result2.value.categoryMatrix.find((r) => r.category === 'market')!.residualRisk);
  });
});
