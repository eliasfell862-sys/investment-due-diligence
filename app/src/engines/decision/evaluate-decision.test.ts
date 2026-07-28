import { describe, expect, it } from 'vitest';
import { evaluateDecision } from './evaluate-decision';
import type { DecisionInput } from './decision-types';

describe('evaluateDecision', () => {
  const baseInput = (): DecisionInput => ({
    version: '1',
    strategy: 'growth',
    qualityScores: {
      teamAndGovernance: '80',
      marketAndIndustry: '75',
      productAndTechnology: '70',
      commercializationAndGrowth: '65',
      financialAndCashFlow: '60',
      valuationAndReturn: '55',
    },
    overallResidualRisk: '0.2',
    riskPenalty: '4',
    fatalOutcome: 'none',
    notCurableByClause: false,
    returnMetrics: {
      targetIrr: '0.25',
      targetMoic: '3',
      baseCaseIrr: '0.3',
      baseCaseMoic: '3.5',
      permanentLossProbabilityLower: '0.05',
      permanentLossProbabilityUpper: '0.2',
    },
    maxAcceptableValuation: '50000000',
    keyAssumptions: ['Revenue grows 30% YoY for 3 years.'],
    bearCaseArguments: ['Competitor entering market in Year 2 could compress margins.'],
  });

  it('returns conditional invest for a typical growth-stage deal', () => {
    const input: DecisionInput = {
      ...baseInput(),
      qualityScores: { teamAndGovernance: '85', marketAndIndustry: '80', productAndTechnology: '78',
        commercializationAndGrowth: '75', financialAndCashFlow: '72', valuationAndReturn: '70' },
      riskPenalty: '2',
    };
    const result = evaluateDecision(input);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.tier).toBe('conditional_invest');
    expect(result.value.compositeScore).not.toBeNull();
    expect(result.value.riskAdjustedScore).not.toBeNull();
  });

  it('returns do_not_invest when fatal outcome is reject', () => {
    const result = evaluateDecision({
      ...baseInput(),
      fatalOutcome: 'reject',
      notCurableByClause: true,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.tier).toBe('do_not_invest');
  });

  it('caps at conditional_invest when fatal outcome is conditional_cap', () => {
    const result = evaluateDecision({
      ...baseInput(),
      fatalOutcome: 'conditional_cap',
      qualityScores: {
        teamAndGovernance: '90', marketAndIndustry: '85', productAndTechnology: '85',
        commercializationAndGrowth: '80', financialAndCashFlow: '80', valuationAndReturn: '80',
      },
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.tier).toBe('conditional_invest');
  });

  it('returns defer when fatal outcome is pause', () => {
    const result = evaluateDecision({
      ...baseInput(),
      fatalOutcome: 'pause',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.tier).toBe('defer');
  });

  it('uses early VC stage weights', () => {
    const result = evaluateDecision({
      ...baseInput(),
      strategy: 'vc_early',
      riskPenalty: '2',
      qualityScores: {
        teamAndGovernance: '92', marketAndIndustry: '88', productAndTechnology: '85',
        commercializationAndGrowth: '72', financialAndCashFlow: '65', valuationAndReturn: '80',
      },
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // VC weights heavier on team/market/product; high scores in those areas → strong
    expect(['strong_recommend', 'conditional_invest']).toContain(result.value.tier);
  });

  it('returns continue_observing for borderline scores', () => {
    const result = evaluateDecision({
      ...baseInput(),
      qualityScores: {
        teamAndGovernance: '75', marketAndIndustry: '72', productAndTechnology: '70',
        commercializationAndGrowth: '68', financialAndCashFlow: '65', valuationAndReturn: '62',
      },
      overallResidualRisk: '0.5',
      riskPenalty: '8',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.tier).toBe('continue_observing');
  });

  it('returns defer when quality is too low and no fatal flaw', () => {
    const result = evaluateDecision({
      ...baseInput(),
      qualityScores: {
        teamAndGovernance: '30', marketAndIndustry: '30', productAndTechnology: '30',
        commercializationAndGrowth: '30', financialAndCashFlow: '30', valuationAndReturn: '30',
      },
      overallResidualRisk: '0.9',
      riskPenalty: '18',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.tier).toBe('defer');
  });

  it('applies custom stage weights', () => {
    const result = evaluateDecision({
      ...baseInput(),
      qualityScores: { teamAndGovernance: '85', marketAndIndustry: '80', productAndTechnology: '78',
        commercializationAndGrowth: '75', financialAndCashFlow: '72', valuationAndReturn: '70' },
      riskPenalty: '2',
      stageWeights: {
        teamAndGovernance: '0.1', marketAndIndustry: '0.1', productAndTechnology: '0.1',
        commercializationAndGrowth: '0.2', financialAndCashFlow: '0.3', valuationAndReturn: '0.2',
      },
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(['conditional_invest', 'continue_observing']).toContain(result.value.tier);
  });

  it('applies custom threshold overrides', () => {
    const result = evaluateDecision({
      ...baseInput(),
      customThresholdOverrides: {
        strongRecommendMin: '0.75',
        conditionalInvestMin: '0.55',
        continueObservingMin: '0.35',
        changeReason: 'Stricter fund mandate.',
      },
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // With higher thresholds, the same score may downgrade
    expect(['conditional_invest', 'continue_observing']).toContain(result.value.tier);
  });

  it('outputs all required decision fields', () => {
    const result = evaluateDecision(baseInput());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const d = result.value;
    expect(d.tier).toBeDefined();
    expect(d.investRationale.length).toBeGreaterThan(0);
    expect(d.bearCase.length).toBeGreaterThan(0);
    expect(d.keyAssumptions.length).toBeGreaterThan(0);
    expect(d.prerequisites.length).toBeGreaterThan(0);
    expect(d.verificationActions.length).toBeGreaterThan(0);
    expect(d.reversalConditions.length).toBeGreaterThan(0);
    expect(d.permanentLossRange.lower).toBe('0.05');
    expect(d.permanentLossRange.upper).toBe('0.2');
  });

  it('returns null scores when overall risk is null', () => {
    const result = evaluateDecision({
      ...baseInput(),
      overallResidualRisk: null,
      riskPenalty: null,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // Cannot compute risk-adjusted score without risk data
    expect(result.value.riskAdjustedScore).toBeNull();
  });

  it('throws invalid_dto for hostile input', () => {
    const cyclic: Record<string, unknown> = { version: '1' };
    cyclic.self = cyclic;
    expect(() => evaluateDecision(cyclic)).toThrow();
  });

  it('returns blocked for invalid version', () => {
    const result = evaluateDecision({ ...baseInput(), version: '99' as any });
    expect(result.status).toBe('blocked');
  });

  it('returns blocked for invalid strategy', () => {
    const result = evaluateDecision({ ...baseInput(), strategy: 'seed' as any });
    expect(result.status).toBe('blocked');
  });

  it('returns blocked for invalid quality scores', () => {
    const result = evaluateDecision({
      ...baseInput(),
      qualityScores: { ...baseInput().qualityScores, teamAndGovernance: '150' },
    });
    expect(result.status).toBe('blocked');
  });

  it('returns blocked for stage weights that do not sum to 1', () => {
    const result = evaluateDecision({
      ...baseInput(),
      stageWeights: {
        teamAndGovernance: '0.5', marketAndIndustry: '0.5', productAndTechnology: '0.1',
        commercializationAndGrowth: '0.1', financialAndCashFlow: '0.1', valuationAndReturn: '0',
      },
    });
    expect(result.status).toBe('blocked');
  });
});
