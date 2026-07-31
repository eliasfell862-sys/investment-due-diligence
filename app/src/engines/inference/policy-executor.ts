/**
 * Institution Policy Executor
 *
 * Applies an institution's investment policy to inference results,
 * producing policy-compliant judgments, veto flags, and monitoring
 * recommendations. Same project + different policy = different output.
 */

import type { InstitutionPolicy } from '../../domain/inference/institution-policy';
import type { InferenceNode, InvestmentJudgmentOutput, ConfirmedFact } from '../../domain/inference/types';

// ── Types ──

export interface PolicyComplianceResult {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyName: string;

  // Mandate checks
  readonly stageAllowed: boolean;
  readonly industryAllowed: boolean;
  readonly regionAllowed: boolean;
  readonly investmentWithinRange: boolean;

  // Return checks
  readonly irrMeetsTarget: boolean;
  readonly moicMeetsTarget: boolean;

  // Risk checks
  readonly riskWithinTolerance: boolean;
  readonly riskViolations: readonly string[];

  // Veto checks
  readonly vetoTriggered: boolean;
  readonly vetoReasons: readonly string[];

  // Evidence checks
  readonly evidenceSufficient: boolean;
  readonly evidenceGaps: readonly string[];

  // Overall
  readonly policyCompliant: boolean;
  readonly canSubmitToCommittee: boolean;
  readonly blockingItems: readonly string[];

  // Recommendations
  readonly policyRecommendations: readonly string[];
}

// ── Extract values from inference nodes ──

function findNumericNode(metricId: string, nodes: readonly InferenceNode[]): number | null {
  const n = nodes.find(x => x.metricId === metricId && x.value !== null);
  if (!n || typeof n.value !== 'string') return null;
  const v = parseFloat(n.value);
  return isNaN(v) ? null : v;
}

function findFactNum(metricId: string, facts: readonly ConfirmedFact[]): number | null {
  const f = facts.find(x => x.metricId === metricId);
  if (!f || typeof f.value !== 'string') return null;
  const v = parseFloat(f.value);
  return isNaN(v) ? null : v;
}

// ── Executor ──

export function executePolicy(
  judgment: InvestmentJudgmentOutput,
  facts: readonly ConfirmedFact[],
  policy: InstitutionPolicy,
): PolicyComplianceResult {
  const blockingItems: string[] = [];
  const riskViolations: string[] = [];
  const evidenceGaps: string[] = [];
  const recommendations: string[] = [];
  const vetoReasons: string[] = [];

  // ── Mandate Checks ──
  const stageAllowed = true; // The archetype already matched

  const industry = facts.find(f => f.metricId === 'industry');
  const industryValue = industry && typeof industry.value === 'string' ? industry.value : '';
  const industryAllowed = policy.mandate.industries.length === 0 ||
    policy.mandate.industries.some(ind => industryValue.includes(ind) || ind === '*');

  const regionAllowed = true; // Default for now

  const valuation = findFactNum('valuation', facts);
  const investmentWithinRange = valuation !== null &&
    valuation >= parseFloat(policy.mandate.minInvestment) &&
    valuation <= parseFloat(policy.mandate.maxInvestment);

  if (!industryAllowed) blockingItems.push(`行业不在机构投资范围内`);
  if (!investmentWithinRange) blockingItems.push(`投资金额超出机构范围`);

  // ── Return Checks ──
  const irr = findFactNum('target_irr', facts) || findFactNum('irr', facts);
  const moic = findFactNum('moic', facts);
  const irrMeetsTarget = irr !== null && irr >= parseFloat(policy.returnRequirements.targetIrr) * 100;
  const moicMeetsTarget = moic !== null && moic >= parseFloat(policy.returnRequirements.targetMoic);

  if (!irrMeetsTarget && irr !== null) recommendations.push(`IRR不达标（${irr}% < 目标${parseFloat(policy.returnRequirements.targetIrr)*100}%），考虑估值谈判`);
  if (!moicMeetsTarget && moic !== null) recommendations.push(`MOIC不达标，考虑调整进入估值`);

  // ── Risk Checks ──
  const nrr = findFactNum('nrr', facts);
  const customerConc = findFactNum('customer_concentration', facts);
  const cashRunwayText = findNumericNode('cash_runway', judgment.operatingAssessment);
  const cash = findFactNum('cash_balance', facts);
  const burn = findFactNum('burn_rate', facts);
  const cashRunwayMonths = cash !== null && burn !== null && burn > 0 ? cash / burn : null;

  // Cash runway
  if (cashRunwayMonths !== null && cashRunwayMonths < policy.riskTolerance.minCashRunwayMonths) {
    const msg = `现金跑道${cashRunwayMonths.toFixed(0)}个月 < 机构要求${policy.riskTolerance.minCashRunwayMonths}个月`;
    riskViolations.push(msg);
    if (policy.vetoItems.cashRunwayBelowThreshold && cashRunwayMonths < policy.vetoItems.cashRunwayThreshold) {
      vetoReasons.push(msg);
    }
  }

  // NRR
  if (nrr !== null && policy.vetoItems.nrrBelowThreshold && nrr < parseFloat(policy.vetoItems.nrrThreshold)) {
    vetoReasons.push(`NRR ${nrr}% < 机构红线${policy.vetoItems.nrrThreshold}%`);
  }

  // Customer concentration
  if (customerConc !== null && policy.vetoItems.customerConcentrationAboveThreshold &&
    customerConc > parseFloat(policy.vetoItems.customerConcentrationThreshold)) {
    vetoReasons.push(`客户集中度${customerConc}% > 机构上限${policy.vetoItems.customerConcentrationThreshold}%`);
  }

  const riskWithinTolerance = riskViolations.length === 0;

  // ── Veto ──
  if (policy.vetoItems.businessFraud) recommendations.push('需确认无业务/财务造假');
  if (policy.vetoItems.unclearOwnership) recommendations.push('需确认核心权属清晰');
  if (policy.vetoItems.founderIntegrity) recommendations.push('需完成创始人背景调查');

  const vetoTriggered = vetoReasons.length > 0;

  // ── Evidence ──
  if (policy.evidenceStandards.requireAuditedFinancials) {
    const hasAudit = facts.some(f => f.metricId.includes('audit') || f.metricId.includes('audited'));
    if (!hasAudit) evidenceGaps.push('缺少审计财务数据');
  }
  if (policy.evidenceStandards.requireBackgroundCheck) {
    evidenceGaps.push('需完成背景调查');
  }
  if (facts.length < policy.evidenceStandards.minimumEvidenceCount) {
    evidenceGaps.push(`已确认事实${facts.length}项 < 机构要求${policy.evidenceStandards.minimumEvidenceCount}项`);
  }

  const evidenceSufficient = evidenceGaps.length === 0;

  // ── Overall ──
  const policyCompliant = !vetoTriggered && riskWithinTolerance && industryAllowed;
  const canSubmitToCommittee = policyCompliant && evidenceSufficient &&
    parseFloat(judgment.overallConfidence === 'blocked' ? '0' :
      judgment.overallConfidence === 'high' ? '0.85' :
      judgment.overallConfidence === 'medium' ? '0.6' : '0.3') >= parseFloat(policy.evidenceStandards.confidenceThresholdForSubmission);

  if (!canSubmitToCommittee) {
    if (vetoTriggered) blockingItems.push(...vetoReasons);
    if (!evidenceSufficient) blockingItems.push(...evidenceGaps);
    if (!policyCompliant) blockingItems.push('不满足机构投资政策基本要求');
  }

  return {
    policyId: policy.policyId, policyVersion: policy.version, policyName: policy.name,
    stageAllowed, industryAllowed, regionAllowed, investmentWithinRange,
    irrMeetsTarget, moicMeetsTarget,
    riskWithinTolerance, riskViolations,
    vetoTriggered, vetoReasons,
    evidenceSufficient, evidenceGaps,
    policyCompliant, canSubmitToCommittee, blockingItems,
    policyRecommendations: recommendations,
  };
}
