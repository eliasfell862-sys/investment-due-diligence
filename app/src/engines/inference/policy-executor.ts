/**
 * Institution Policy Executor
 *
 * Applies institution policy to inference results, producing
 * policy-compliant judgments with clear threshold comparisons.
 * Missing critical data is flagged, not silently ignored.
 */

import type { InstitutionPolicy } from '../../domain/inference/institution-policy';
import type { InvestmentJudgmentOutput, ConfirmedFact } from '../../domain/inference/types';
import { DEFAULT_GROWTH_EQUITY_POLICY, CONSERVATIVE_POLICY, AGGRESSIVE_POLICY } from '../../domain/inference/institution-policy';

export interface PolicyComplianceResult {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyName: string;
  readonly policyCompliant: boolean;
  readonly canSubmitToCommittee: boolean;
  readonly blockingItems: readonly string[];
  readonly riskViolations: readonly string[];
  readonly evidenceGaps: readonly string[];
  readonly policyRecommendations: readonly string[];
  readonly thresholdComparison: readonly ThresholdCheck[];
}

export interface ThresholdCheck {
  readonly label: string;
  readonly currentValue: string;
  readonly defaultThreshold: string;
  readonly conservativeThreshold: string;
  readonly aggressiveThreshold: string;
  /** Which policy thresholds are met?
   *  'all' = meets all three | 'meets_default' = meets default+conservative |
   *  'meets_conservative_only' = only meets conservative (lowest bar) | 'none' = meets none */
  readonly met: 'all' | 'meets_default' | 'meets_conservative_only' | 'none';
}

function findFactNum(metricId: string, facts: readonly ConfirmedFact[]): number | null {
  const f = facts.find(x => x.metricId === metricId);
  if (!f || typeof f.value !== 'string') return null;
  const n = parseFloat(f.value);
  return isNaN(n) ? null : n;
}

export function executePolicy(
  _judgment: InvestmentJudgmentOutput,
  facts: readonly ConfirmedFact[],
  policy: InstitutionPolicy,
): PolicyComplianceResult {
  const blockingItems: string[] = [];
  const riskViolations: string[] = [];
  const evidenceGaps: string[] = [];
  const recommendations: string[] = [];
  const thresholdComparison: ThresholdCheck[] = [];

  // ── Data gaps (policy-aware) ──
  const revenue = findFactNum('revenue', facts);
  const grossMargin = findFactNum('gross_margin', facts);
  const cash = findFactNum('cash_balance', facts);
  const burn = findFactNum('burn_rate', facts);
  const valuation = findFactNum('valuation', facts);
  const irr = findFactNum('target_irr', facts) || findFactNum('irr', facts);
  const moic = findFactNum('moic', facts);
  const nrr = findFactNum('nrr', facts);
  const arr = findFactNum('arr', facts);
  const customerConc = findFactNum('customer_concentration', facts);
  // Flag missing critical data
  if (revenue === null && cash === null && arr === null) {
    evidenceGaps.push('缺少核心财务数据（收入/ARR/现金），无法评估投资');
    blockingItems.push('核心财务数据缺失 — 请先录入财务信息');
  }
  if (valuation === null) {
    evidenceGaps.push('缺少估值数据，无法判断价格合理性');
  }

  // ── Threshold helpers ──
  // For "higher is better" metrics: hardest = highest threshold (usually aggressive or conservative)
  // For "lower is better" metrics: hardest = lowest threshold
  function metHigherIsBetter(value: number, thresholds: number[]): ThresholdCheck['met'] {
    // thresholds: [conservative, default, aggressive] — find hardest (max) and easiest (min)
    const hardest = Math.max(...thresholds);
    const easiest = Math.min(...thresholds);
    const middle = thresholds.sort((a, b) => a - b)[1]; // median
    if (value >= hardest) return 'all';
    if (value >= middle) return 'meets_default';
    if (value >= easiest) return 'meets_conservative_only';
    return 'none';
  }
  function metLowerIsBetter(value: number, thresholds: number[]): ThresholdCheck['met'] {
    // thresholds: [conservative, default, aggressive] — find hardest (min) and easiest (max)
    const hardest = Math.min(...thresholds);
    const easiest = Math.max(...thresholds);
    const middle = thresholds.sort((a, b) => a - b)[1];
    if (value <= hardest) return 'all';
    if (value <= middle) return 'meets_default';
    if (value <= easiest) return 'meets_conservative_only';
    return 'none';
  }

  // Cash runway (higher better)
  const cashRunwayMonths = cash !== null && burn !== null && burn > 0 ? cash / burn : null;
  const runwayThresholds = [
    CONSERVATIVE_POLICY.riskTolerance.minCashRunwayMonths,
    DEFAULT_GROWTH_EQUITY_POLICY.riskTolerance.minCashRunwayMonths,
    AGGRESSIVE_POLICY.riskTolerance.minCashRunwayMonths,
  ];
  thresholdComparison.push({
    label: '现金跑道（月）', currentValue: cashRunwayMonths !== null ? cashRunwayMonths.toFixed(0) : '未提供',
    defaultThreshold: `≥${DEFAULT_GROWTH_EQUITY_POLICY.riskTolerance.minCashRunwayMonths}月`,
    conservativeThreshold: `≥${CONSERVATIVE_POLICY.riskTolerance.minCashRunwayMonths}月`,
    aggressiveThreshold: `≥${AGGRESSIVE_POLICY.riskTolerance.minCashRunwayMonths}月`,
    met: cashRunwayMonths === null ? 'none' : metHigherIsBetter(cashRunwayMonths, runwayThresholds),
  });
  if (cashRunwayMonths !== null && cashRunwayMonths < policy.riskTolerance.minCashRunwayMonths) {
    const msg = `现金跑道${cashRunwayMonths.toFixed(0)}个月 < ${policy.policyId === 'conservative' ? '保守要求' : policy.policyId === 'aggressive' ? '激进最低' : '默认要求'}${policy.riskTolerance.minCashRunwayMonths}个月`;
    riskViolations.push(msg);
    if (cashRunwayMonths < policy.vetoItems.cashRunwayThreshold) blockingItems.push(msg + '（否决项）');
  }

  // IRR (higher better)
  const irrThresholds = [
    parseFloat(CONSERVATIVE_POLICY.returnRequirements.targetIrr) * 100,
    parseFloat(DEFAULT_GROWTH_EQUITY_POLICY.returnRequirements.targetIrr) * 100,
    parseFloat(AGGRESSIVE_POLICY.returnRequirements.targetIrr) * 100,
  ];
  thresholdComparison.push({
    label: '目标IRR', currentValue: irr !== null ? `${irr}%` : '未提供',
    defaultThreshold: `≥${irrThresholds[1].toFixed(0)}%`,
    conservativeThreshold: `≥${irrThresholds[0].toFixed(0)}%`,
    aggressiveThreshold: `≥${irrThresholds[2].toFixed(0)}%`,
    met: irr === null ? 'none' : metHigherIsBetter(irr, irrThresholds),
  });
  if (irr !== null && irr < parseFloat(policy.returnRequirements.targetIrr) * 100) {
    recommendations.push(`目标IRR ${irr}%未达到${policy.policyId === 'conservative' ? '保守' : policy.policyId === 'aggressive' ? '激进' : '默认'}要求${(parseFloat(policy.returnRequirements.targetIrr)*100).toFixed(0)}%`);
  }

  // MOIC (higher better)
  if (moic !== null) {
    const moicThresholds = [
      parseFloat(CONSERVATIVE_POLICY.returnRequirements.targetMoic),
      parseFloat(DEFAULT_GROWTH_EQUITY_POLICY.returnRequirements.targetMoic),
      parseFloat(AGGRESSIVE_POLICY.returnRequirements.targetMoic),
    ];
    thresholdComparison.push({
      label: 'MOIC', currentValue: `${moic}x`,
      defaultThreshold: `≥${DEFAULT_GROWTH_EQUITY_POLICY.returnRequirements.targetMoic}x`,
      conservativeThreshold: `≥${CONSERVATIVE_POLICY.returnRequirements.targetMoic}x`,
      aggressiveThreshold: `≥${AGGRESSIVE_POLICY.returnRequirements.targetMoic}x`,
      met: metHigherIsBetter(moic, moicThresholds),
    });
  }

  // Evidence count (higher better)
  const evThresholds = [
    CONSERVATIVE_POLICY.evidenceStandards.minimumEvidenceCount,
    DEFAULT_GROWTH_EQUITY_POLICY.evidenceStandards.minimumEvidenceCount,
    AGGRESSIVE_POLICY.evidenceStandards.minimumEvidenceCount,
  ];
  thresholdComparison.push({
    label: '已确认事实数', currentValue: `${facts.length}项`,
    defaultThreshold: `≥${DEFAULT_GROWTH_EQUITY_POLICY.evidenceStandards.minimumEvidenceCount}项`,
    conservativeThreshold: `≥${CONSERVATIVE_POLICY.evidenceStandards.minimumEvidenceCount}项`,
    aggressiveThreshold: `≥${AGGRESSIVE_POLICY.evidenceStandards.minimumEvidenceCount}项`,
    met: metHigherIsBetter(facts.length, evThresholds),
  });

  // NRR (SaaS specific, higher better)
  if (nrr !== null) {
    const nrrThresholds = [
      parseFloat(CONSERVATIVE_POLICY.vetoItems.nrrThreshold),
      parseFloat(DEFAULT_GROWTH_EQUITY_POLICY.vetoItems.nrrThreshold),
      parseFloat(AGGRESSIVE_POLICY.vetoItems.nrrThreshold),
    ];
    thresholdComparison.push({
      label: 'NRR（净收入留存率）', currentValue: `${nrr}%`,
      defaultThreshold: `≥${DEFAULT_GROWTH_EQUITY_POLICY.vetoItems.nrrThreshold}%（红线）`,
      conservativeThreshold: `≥${CONSERVATIVE_POLICY.vetoItems.nrrThreshold}%（红线）`,
      aggressiveThreshold: `≥${AGGRESSIVE_POLICY.vetoItems.nrrThreshold}%（红线）`,
      met: metHigherIsBetter(nrr, nrrThresholds),
    });
    if (nrr < parseFloat(policy.vetoItems.nrrThreshold)) {
      blockingItems.push(`NRR ${nrr}% < 红线${policy.vetoItems.nrrThreshold}%（否决项）`);
    }
    if (nrr < 100) {
      recommendations.push(`NRR ${nrr}%低于100%，客户在流失，不论政策均需关注`);
    }
  }

  // Customer concentration (lower better) — if available
  if (customerConc !== null) {
    const concThresholds = [
      parseFloat(CONSERVATIVE_POLICY.vetoItems.customerConcentrationThreshold),
      parseFloat(DEFAULT_GROWTH_EQUITY_POLICY.vetoItems.customerConcentrationThreshold),
      parseFloat(AGGRESSIVE_POLICY.vetoItems.customerConcentrationThreshold),
    ];
    thresholdComparison.push({
      label: '客户集中度', currentValue: `${customerConc}%`,
      defaultThreshold: `≤${DEFAULT_GROWTH_EQUITY_POLICY.vetoItems.customerConcentrationThreshold}%`,
      conservativeThreshold: `≤${CONSERVATIVE_POLICY.vetoItems.customerConcentrationThreshold}%`,
      aggressiveThreshold: `≤${AGGRESSIVE_POLICY.vetoItems.customerConcentrationThreshold}%`,
      met: metLowerIsBetter(customerConc, concThresholds),
    });
    if (customerConc > parseFloat(policy.vetoItems.customerConcentrationThreshold)) {
      blockingItems.push(`客户集中度${customerConc}% > 上限${policy.vetoItems.customerConcentrationThreshold}%（否决项）`);
    }
  }

  if (facts.length < policy.evidenceStandards.minimumEvidenceCount) {
    evidenceGaps.push(`${policy.policyId === 'conservative' ? '保守型要求' : policy.policyId === 'aggressive' ? '激进型仅需' : '需要'}${policy.evidenceStandards.minimumEvidenceCount}项事实，当前${facts.length}项`);
  }

  // ── Veto checks ──
  if (policy.vetoItems.businessFraud) recommendations.push('投资前需确认无业务/财务造假');
  if (policy.vetoItems.unclearOwnership) recommendations.push('需确认核心权属清晰（知识产权/股权/牌照）');
  if (policy.vetoItems.founderIntegrity) recommendations.push('需完成创始人背景调查');

  // ── Evidence ──
  if (policy.evidenceStandards.requireAuditedFinancials) {
    evidenceGaps.push('需提供审计财务数据');
  }
  if (policy.evidenceStandards.requireBackgroundCheck) {
    evidenceGaps.push('需完成背景调查');
  }
  if (policy.evidenceStandards.requireCustomerReferences && policy.policyId === 'conservative') {
    evidenceGaps.push('保守型要求：需客户推荐信/访谈');
  }

  // ── Policy-specific recommendations ──
  if (policy.policyId === 'conservative') {
    if (cashRunwayMonths !== null && cashRunwayMonths < 24) {
      recommendations.push('保守型建议：现金跑道应≥24个月以应对不确定性');
    }
  } else if (policy.policyId === 'aggressive') {
    if (revenue !== null && grossMargin !== null && grossMargin > 50) {
      recommendations.push('激进型视角：高毛利+确定收入，可适度容忍短期亏损');
    }
  }

  const riskWithinTolerance = riskViolations.length === 0;
  const policyCompliant = blockingItems.length === 0 && riskWithinTolerance;
  const canSubmitToCommittee = policyCompliant && evidenceGaps.length === 0;

  return {
    policyId: policy.policyId, policyVersion: policy.version, policyName: policy.name,
    policyCompliant, canSubmitToCommittee, blockingItems, riskViolations,
    evidenceGaps, policyRecommendations: recommendations,
    thresholdComparison,
  };
}

