/**
 * Golden Case Tests — validates inference correctness.
 * Same input → same output (deterministic ID).
 * Key signals appear regardless of assessment grouping.
 */

import { describe, it, expect } from 'vitest';
import { runInference } from './inference-orchestrator';
import { SAAS_GOLDEN_CASES } from './industry-packs/saas-growth-pack';
import { CONSUMER_GOLDEN_CASES } from './industry-packs/consumer-retail-pack';
import { INDUSTRIAL_GOLDEN_CASES } from './industry-packs/industrial-manufacturing-pack';
import type { InferenceSessionInput } from '../../domain/inference/types';

function inputFrom(facts: readonly any[]): InferenceSessionInput {
  return { version: '1', projectId: 'golden_test', institutionPolicyVersion: '1.0.0', asOfDate: '2026-01-01', confirmedFacts: facts as any, candidateFacts: [], requestedStrategy: 'growth_equity' };
}

function allText(result: ReturnType<typeof runInference>): string {
  return JSON.stringify([
    ...result.judgment.operatingAssessment,
    ...result.judgment.financialAssessment,
    ...result.judgment.competitiveAssessment,
    ...result.judgment.moatAssessment,
    ...result.judgment.exitAssessment,
    ...result.judgment.teamAssessment,
    ...result.judgment.investmentThesis,
    ...result.judgment.strongestCounterThesis,
  ]);
}

// ── Deterministic ──
describe('Deterministic output', () => {
  it('produces byte-equivalent output for identical input', () => {
    const r1 = runInference(inputFrom(SAAS_GOLDEN_CASES[0].facts));
    const r2 = runInference(inputFrom(SAAS_GOLDEN_CASES[0].facts));
    expect(r1).toStrictEqual(r2);
  });

  it('changes the session version when a fact value changes', () => {
    const baseFacts = SAAS_GOLDEN_CASES[0].facts;
    const changedFacts = baseFacts.map(f => f.metricId === 'arr'
      ? { ...f, value: String(Number(f.value) + 1) }
      : f);

    const r1 = runInference(inputFrom(baseFacts));
    const r2 = runInference(inputFrom(changedFacts));

    expect(r1.judgment.sessionId).not.toBe(r2.judgment.sessionId);
  });

  it('does not publish snapshot references unless a deterministic engine ran', () => {
    const result = runInference(inputFrom([]));

    expect(result.judgment.riskSnapshotRef).toBeNull();
    expect(result.judgment.forecastSnapshotRef).toBeNull();
    expect(result.judgment.valuationSnapshotRef).toBeNull();
    expect(result.judgment.equitySnapshotRef).toBeNull();
  });

  it('runs the forecast engine when the minimum financial facts are available', () => {
    const result = runInference(inputFrom(SAAS_GOLDEN_CASES[0].facts));
    expect(result.judgment.forecastSnapshotRef).toMatch(/^forecast_snapshot_/);
    expect(result.judgment.financialAssessment.some(node => node.metricId === 'forecast_base_revenue')).toBe(true);
  });

  it('calculates listed-company market cap from price and fully diluted shares', () => {
    const facts = [
      ...SAAS_GOLDEN_CASES[0].facts,
      { factId: 'price', metricId: 'share_price', value: '12.5', unit: 'CNY/share', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'shares', metricId: 'fully_diluted_shares', value: '1000', unit: 'shares', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
    ];
    const result = runInference(inputFrom(facts));
    const marketCap = result.judgment.financialAssessment.find(node => node.metricId === 'market_cap');
    expect(marketCap).toMatchObject({ value: '12500', lowerBound: '12500', upperBound: '12500' });
    expect(marketCap?.ruleIds).toContain('listed-market-cap@1');
  });

  it('calculates post-money market cap when financing terms are available', () => {
    const facts = [
      ...SAAS_GOLDEN_CASES[0].facts,
      { factId: 'round', metricId: 'investment_amount', value: '100000', unit: 'CNY', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
    ];
    const result = runInference(inputFrom(facts));
    const marketCap = result.judgment.financialAssessment.find(node => node.metricId === 'market_cap');
    expect(marketCap?.value).toBe('1100000');
    expect(marketCap?.ruleIds).toContain('post-money-market-cap@1');
  });

  it('feeds the base forecast into DCF valuation', () => {
    const result = runInference(inputFrom(SAAS_GOLDEN_CASES[0].facts));
    expect(result.judgment.valuationSnapshotRef).toMatch(/^valuation_snapshot_/);
    expect(result.judgment.exitAssessment.some(node => node.metricId === 'dcf_valuation_range')).toBe(true);
    expect(result.judgment.financialAssessment.find(node => node.metricId === 'market_cap')?.ruleIds).toContain('model-implied-market-cap@1');
  });

  it('blocks formal submission when any fatal flaw remains unassessed', () => {
    const fatalIds = [
      'material_data_or_business_fraud', 'core_ownership_or_license_unclear',
      'irremediable_major_illegality', 'business_model_unverifiable',
      'pre_close_cash_break', 'founder_integrity_failure',
    ];
    const fatalFacts = fatalIds.map((id, index) => ({
      factId: `unassessed-${index}`, metricId: `fatal_flaw_${id}`,
      value: index === 0 ? 'unassessed' : 'clear', unit: null, period: null,
      evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01',
    }));
    const result = runInference(inputFrom([...SAAS_GOLDEN_CASES[0].facts, ...fatalFacts]));
    expect(result.judgment.riskSnapshotRef).toMatch(/^risk_snapshot_/);
    expect(result.judgment.formalSubmissionBlocked).toBe(true);
    expect(result.judgment.blockingReasons.join(' ')).toContain('未评估');
  });

  it('runs risk, equity returns, and decision when their required facts are complete', () => {
    const fatalIds = [
      'material_data_or_business_fraud', 'core_ownership_or_license_unclear',
      'irremediable_major_illegality', 'business_model_unverifiable',
      'pre_close_cash_break', 'founder_integrity_failure',
    ];
    const extraFacts = [
      ...fatalIds.map((id, index) => ({
        factId: `fatal-${index}`, metricId: `fatal_flaw_${id}`, value: 'clear', unit: null,
        period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01',
      })),
      { factId: 'cap', metricId: 'cap_table_json', value: JSON.stringify([
        { name: 'Founder', shares: '800', class_: 'Common' },
        { name: 'Seed', shares: '200', class_: 'Preferred' },
      ]), unit: null, period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'invest', metricId: 'investment_amount', value: '100000', unit: 'CNY', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'exit', metricId: 'exit_valuation', value: '1800000', unit: 'CNY', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'hold', metricId: 'holding_years', value: '5', unit: 'years', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'esop', metricId: 'esop_pct', value: '10', unit: '%', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'conc', metricId: 'customer_concentration', value: '70', unit: '%', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
    ];
    const result = runInference(inputFrom([...SAAS_GOLDEN_CASES[0].facts, ...extraFacts]));

    expect(result.judgment.riskSnapshotRef).toMatch(/^risk_snapshot_/);
    expect(result.judgment.equitySnapshotRef).toMatch(/^equity_snapshot_/);
    expect(result.judgment.financialAssessment.some(node => node.metricId === 'expected_moic')).toBe(true);
    expect(result.judgment.investmentThesis.some(node => node.metricId === 'investment_decision')).toBe(true);
    expect(result.judgment.transactionRecommendations.some(node => node.metricId.startsWith('risk_clause_'))).toBe(true);
  });
});

// ── SaaS ──
describe('SaaS Golden Cases', () => {
  it('strong+expensive: high quality, premium valuation', () => {
    const r = runInference(inputFrom(SAAS_GOLDEN_CASES[0].facts));
    expect(r.judgment.archetype.primaryPackId).toBe('saas_growth');
    const t = allText(r);
    expect(t).toMatch(/NRR|125|卓越/);
    expect(t).toMatch(/60/);
    expect(r.judgment.investmentThesis.length).toBeGreaterThan(0);
  });

  it('churn crisis: SaaS pack runs and identifies issues', () => {
    const r = runInference(inputFrom(SAAS_GOLDEN_CASES[1].facts));
    expect(r.judgment.archetype.primaryPackId).toBe('saas_growth');
    // Verify SaaS-specific nodes were generated (beyond universal nodes)
    const saasNodeCount = [...r.judgment.operatingAssessment, ...r.judgment.financialAssessment, ...r.judgment.competitiveAssessment]
      .filter(n => n.metricId.includes('nrr') || n.metricId.includes('ltv') || n.metricId.includes('cac')).length;
    expect(saasNodeCount).toBeGreaterThan(0);
  });

  it('cash crunch: 3.6 months runway with high burn', () => {
    const r = runInference(inputFrom(SAAS_GOLDEN_CASES[2].facts));
    const t = allText(r);
    expect(t).toMatch(/危机|紧张|融资/);
  });
});

// ── Consumer ──
describe('Consumer Golden Cases', () => {
  it('strong brand: same-store growth + repurchase', () => {
    const r = runInference(inputFrom(CONSUMER_GOLDEN_CASES[0].facts));
    expect(r.judgment.archetype.primaryPackId).toBe('consumer_retail');
    const t = allText(r);
    expect(t).toMatch(/同店|15/);
    expect(t).toMatch(/复购|65|品牌/);
  });

  it('channel dependent: platform fee + single channel', () => {
    const r = runInference(inputFrom(CONSUMER_GOLDEN_CASES[1].facts));
    const t = allText(r);
    expect(t).toMatch(/依赖|30|渠道/);
  });

  it('overexpansion: consumer pack identifies store-level issues', () => {
    const r = runInference(inputFrom(CONSUMER_GOLDEN_CASES[2].facts));
    const consumerNodeCount = [...r.judgment.operatingAssessment, ...r.judgment.financialAssessment, ...r.judgment.competitiveAssessment]
      .filter(n => n.metricId.includes('store') || n.metricId.includes('expansion')).length;
    expect(consumerNodeCount).toBeGreaterThan(0);
  });
});

// ── Industrial ──
describe('Industrial Golden Cases', () => {
  it('strong backlog: industrial pack identifies order coverage', () => {
    const r = runInference(inputFrom(INDUSTRIAL_GOLDEN_CASES[0].facts));
    expect(r.judgment.archetype.primaryPackId).toBe('industrial_manufacturing');
    const indNodeCount = [...r.judgment.operatingAssessment, ...r.judgment.financialAssessment]
      .filter(n => n.metricId.includes('order') || n.metricId.includes('yield') || n.metricId.includes('capacity')).length;
    expect(indNodeCount).toBeGreaterThan(0);
  });

  it('capacity crunch: industrial pack flags utilization and debt', () => {
    const r = runInference(inputFrom(INDUSTRIAL_GOLDEN_CASES[1].facts));
    const indNodeCount = [...r.judgment.operatingAssessment, ...r.judgment.financialAssessment]
      .filter(n => n.metricId.includes('utilization') || n.metricId.includes('debt') || n.metricId.includes('capacity')).length;
    expect(indNodeCount).toBeGreaterThan(0);
  });

  it('customer loss: 70% concentration + 75% yield', () => {
    const r = runInference(inputFrom(INDUSTRIAL_GOLDEN_CASES[2].facts));
    const t = allText(r);
    expect(t).toMatch(/极度集中|70/);
    expect(t).toMatch(/偏低/);
  });
});

// ── Edge ──
describe('Edge cases', () => {
  it('empty facts → blocked', () => {
    const r = runInference(inputFrom([]));
    expect(r.judgment.overallConfidence).toBe('blocked');
    expect(r.judgment.formalSubmissionBlocked).toBe(true);
  });

  it('unknown company → generic pack, not SaaS', () => {
    const r = runInference(inputFrom([
      { factId: 'f1', metricId: 'company_name', value: 'Unknown Co', unit: null, period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
    ]));
    expect(r.judgment.archetype.primaryPackId).toBe('general_enterprise');
    expect(r.judgment.archetype.fallbackUsed).toBe(true);
  });

  it('different policies → different compliance', async () => {
    const { DEFAULT_GROWTH_EQUITY_POLICY, CONSERVATIVE_POLICY, AGGRESSIVE_POLICY } = await import('../../domain/inference/institution-policy');
    const facts = [
      { factId: 'f1', metricId: 'company_name', value: 'TestCo', unit: null, period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
      { factId: 'f2', metricId: 'revenue', value: '5000', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
      { factId: 'f3', metricId: 'cash_balance', value: '3000', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
      { factId: 'f4', metricId: 'burn_rate', value: '250', unit: '万元/月', period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
      { factId: 'f5', metricId: 'gross_margin', value: '55', unit: '%', period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
      { factId: 'f6', metricId: 'valuation', value: '30000', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
    ];

    const dr = runInference(inputFrom(facts), DEFAULT_GROWTH_EQUITY_POLICY);
    const cr = runInference(inputFrom(facts), CONSERVATIVE_POLICY);
    const ar = runInference(inputFrom(facts), AGGRESSIVE_POLICY);

    expect(dr.policyResult).not.toBeNull();
    expect(cr.policyResult).not.toBeNull();
    expect(ar.policyResult).not.toBeNull();

    // Cash = 3000, burn = 250 → runway = 12 months
    // Default min=12, Conservative min=18, Aggressive min=6
    // Conservative should fail (12 < 18)
    expect(cr.policyResult!.riskViolations.length).toBeGreaterThan(0);

    const allDifferent =
      dr.policyResult!.policyCompliant !== cr.policyResult!.policyCompliant ||
      cr.policyResult!.policyCompliant !== ar.policyResult!.policyCompliant;
    expect(allDifferent).toBe(true);
  });

  it('reports each policy threshold independently', async () => {
    const { DEFAULT_GROWTH_EQUITY_POLICY } = await import('../../domain/inference/institution-policy');
    const facts = [
      { factId: 'f1', metricId: 'company_name', value: 'TestCo', unit: null, period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
      { factId: 'f2', metricId: 'revenue', value: '5000', unit: null, period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
      { factId: 'f3', metricId: 'cash_balance', value: '3000', unit: null, period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
      { factId: 'f4', metricId: 'burn_rate', value: '250', unit: null, period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
      { factId: 'f5', metricId: 'gross_margin', value: '55', unit: '%', period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
      { factId: 'f6', metricId: 'valuation', value: '30000', unit: null, period: null, evidenceIds: [], confirmedBy: 'user', confirmedAt: '2026-01-01' },
    ];
    const result = runInference(inputFrom(facts), DEFAULT_GROWTH_EQUITY_POLICY);
    const runway = result.policyResult!.thresholdComparison[0] as any;

    expect(runway).toMatchObject({
      metDefault: true,
      metConservative: false,
      metAggressive: true,
    });
  });

  it('blocks formal submission when policy evidence requirements are unmet', async () => {
    const { DEFAULT_GROWTH_EQUITY_POLICY } = await import('../../domain/inference/institution-policy');
    const result = runInference(inputFrom(SAAS_GOLDEN_CASES[0].facts), DEFAULT_GROWTH_EQUITY_POLICY);

    expect(result.policyResult!.canSubmitToCommittee).toBe(false);
    expect(result.judgment.formalSubmissionBlocked).toBe(true);
  });
});
