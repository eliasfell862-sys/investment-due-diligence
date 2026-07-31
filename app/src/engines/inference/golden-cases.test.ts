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
  it('produces identical session ID for identical input', () => {
    const r1 = runInference(inputFrom(SAAS_GOLDEN_CASES[0].facts));
    const r2 = runInference(inputFrom(SAAS_GOLDEN_CASES[0].facts));
    expect(r1.judgment.sessionId).toBe(r2.judgment.sessionId);
    expect(r1.judgment.traceId).toBe(r2.judgment.traceId);
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
});
