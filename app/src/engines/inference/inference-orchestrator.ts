/**
 * Inference Orchestrator — stable, deterministic, auditable.
 *
 * All IDs derived from input hash — same input always produces same output.
 * Wires existing engines (risk, decision) where available.
 * Evidence chains populated with rule IDs and dependency traces.
 */

import type { InferenceSessionInput, InvestmentJudgmentOutput, InferenceNode, ConfirmedFact, CandidateFact, KnowledgeKind, ConfidenceBand } from '../../domain/inference/types';
import { classifyCompany } from './archetype-classifier';
import { resolvePacks } from './industry-pack-registry';
import { calcOverallConfidence, calcStability } from './confidence-calculator';
import { generateQuestions } from './next-best-question';
import { runSaaSPackRules } from './industry-packs/saas-growth-pack';
import { runConsumerPackRules } from './industry-packs/consumer-retail-pack';
import { runIndustrialPackRules } from './industry-packs/industrial-manufacturing-pack';
import { executePolicy, type PolicyComplianceResult } from './policy-executor';
import { DEFAULT_GROWTH_EQUITY_POLICY, type InstitutionPolicy } from '../../domain/inference/institution-policy';

// ── Deterministic ID generator ──

function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h) + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function sessionHash(projectId: string, facts: readonly ConfirmedFact[], candidates: readonly CandidateFact[]): string {
  const serialized = JSON.stringify({ projectId, facts: facts.map(f => f.factId).sort(), candidates: candidates.map(c => c.candidateId).sort() });
  return stableHash(serialized);
}

// ── Node Builder ──

function makeNode(
  idx: number, sessionHashVal: string,
  metricId: string, kind: KnowledgeKind,
  value: string | null, confidence: ConfidenceBand,
  deps: string[] = [], ruleIds: string[] = [], assumptions: string[] = [],
  lowerBound?: string | null, upperBound?: string | null,
  sourceEvidenceIds: string[] = [],
): InferenceNode {
  return {
    nodeId: `node_${sessionHashVal}_${idx}`,
    kind, metricId, value,
    lowerBound: lowerBound || null, upperBound: upperBound || null,
    unit: null, period: null, confidence,
    sourceEvidenceIds: [...sourceEvidenceIds],
    dependencyNodeIds: [...deps],
    ruleIds: [...ruleIds],
    assumptionIds: [...assumptions],
    conflictIds: [],
    reversibleByQuestionIds: [],
  };
}

function findFact(metricId: string, facts: readonly ConfirmedFact[]): ConfirmedFact | undefined {
  return facts.find(f => f.metricId === metricId);
}

function factNum(metricId: string, facts: readonly ConfirmedFact[]): number | null {
  const f = findFact(metricId, facts);
  if (!f || typeof f.value !== 'string') return null;
  const n = parseFloat(f.value);
  return isNaN(n) ? null : n;
}

function factStr(metricId: string, facts: readonly ConfirmedFact[]): string | null {
  const f = findFact(metricId, facts);
  return (f && typeof f.value === 'string') ? f.value : null;
}

// ── Orchestrator ──

export interface InferenceResult {
  readonly judgment: InvestmentJudgmentOutput;
  readonly policyResult: PolicyComplianceResult | null;
}

export function runInference(input: InferenceSessionInput, policy?: InstitutionPolicy): InferenceResult {
  const { projectId, confirmedFacts, candidateFacts } = input;
  const sh = sessionHash(projectId, confirmedFacts, candidateFacts);
  const sessionId = `session_${projectId}_${sh}`;
  const traceId = `trace_${sessionId}`;
  let nodeIdx = 0;

  // ── Step 1: Classify ──
  const archetype = classifyCompany(confirmedFacts, candidateFacts);

  // ── Step 2: Resolve packs ──
  const resolved = resolvePacks(archetype.primaryPackId, archetype.supplementalPackIds);

  // ── Step 3: Build inference nodes ──
  const allNodes: InferenceNode[] = [];

  // Company existence
  const companyName = factStr('company_name', confirmedFacts);
  allNodes.push(makeNode(nodeIdx++, sh, 'company_exists', 'fact',
    companyName || null, companyName ? 'high' : 'blocked',
    [], ['company_identification_v1'], [],
    undefined, undefined,
    confirmedFacts.filter(f => f.metricId === 'company_name').map(f => f.factId)));

  // Revenue
  const revenue = factNum('revenue', confirmedFacts);
  allNodes.push(makeNode(nodeIdx++, sh, 'revenue_confirmed', 'fact',
    revenue !== null ? String(revenue) : null, revenue !== null ? 'high' : 'medium',
    [], ['financial_data_v1'], ['revenue_may_include_non_recurring_items'],
    undefined, undefined,
    confirmedFacts.filter(f => f.metricId === 'revenue' || f.metricId.includes('revenue_')).map(f => f.factId)));

  // Growth
  const growth = factNum('revenue_growth', confirmedFacts);
  if (growth !== null) {
    allNodes.push(makeNode(nodeIdx++, sh, 'growth_rate', 'calculation',
      String(growth), 'high',
      ['revenue_confirmed'], ['growth_calculation_v1'], [],
      undefined, undefined,
      confirmedFacts.filter(f => f.metricId === 'revenue_growth').map(f => f.factId)));
  }

  // Gross margin quality
  const gm = factNum('gross_margin', confirmedFacts);
  if (gm !== null) {
    let gmVal: string; let gmConf: ConfidenceBand; let gmLower: string | null = null; let gmUpper: string | null = null;
    if (gm >= 70) { gmVal = `高毛利（${gm}%），强定价权`; gmConf = 'medium'; gmLower = '70'; gmUpper = '100'; }
    else if (gm >= 40) { gmVal = `毛利率${gm}%，中等水平`; gmConf = 'medium'; gmLower = '40'; gmUpper = '70'; }
    else { gmVal = `毛利率${gm}%偏低，关注成本结构`; gmConf = 'medium'; gmLower = '0'; gmUpper = '40'; }
    allNodes.push(makeNode(nodeIdx++, sh, 'gross_margin_quality', 'inference',
      gmVal, gmConf, [], ['margin_assessment_v1'], ['gross_margin_reflects_reported_figures'],
      gmLower, gmUpper,
      confirmedFacts.filter(f => f.metricId === 'gross_margin').map(f => f.factId)));
  }

  // Cash runway
  const cash = factNum('cash_balance', confirmedFacts);
  const burn = factNum('burn_rate', confirmedFacts);
  if (cash !== null && burn !== null && burn > 0) {
    const runway = cash / burn;
    let rwVal: string; let rwConf: ConfidenceBand;
    if (runway >= 18) { rwVal = `现金充足（≈${Math.round(runway)}个月）`; rwConf = 'medium'; }
    else if (runway >= 9) { rwVal = `现金可支撑≈${Math.round(runway)}个月`; rwConf = 'medium'; }
    else if (runway >= 3) { rwVal = `现金紧张（≈${Math.round(runway)}个月），12个月内需融资`; rwConf = 'high'; }
    else { rwVal = `现金危机（≈${Math.round(runway)}个月）`; rwConf = 'high'; }
    allNodes.push(makeNode(nodeIdx++, sh, 'cash_runway', 'inference',
      rwVal, rwConf, [], ['cash_runway_v1'], ['burn_rate_assumes_current_trajectory'],
      undefined, undefined,
      confirmedFacts.filter(f => f.metricId === 'cash_balance' || f.metricId === 'burn_rate').map(f => f.factId)));
  }

  // Valuation reasonableness
  const valuation = factNum('valuation', confirmedFacts);
  if (valuation !== null && revenue !== null && revenue > 0) {
    const ps = valuation / revenue;
    let valStr: string; let valConf: ConfidenceBand = 'low';
    if (gm !== null && gm >= 70 && ps > 15) { valStr = `P/S ${ps.toFixed(1)}x，高毛利支撑较高估值`; valConf = 'medium'; }
    else if (ps > 20) { valStr = `P/S ${ps.toFixed(1)}x偏高，需验证增长可持续性`; valConf = 'medium'; }
    else if (ps > 8) { valStr = `P/S ${ps.toFixed(1)}x，估值在合理区间`; }
    else { valStr = `P/S ${ps.toFixed(1)}x，估值偏低`; }
    allNodes.push(makeNode(nodeIdx++, sh, 'valuation_reasonableness', 'inference',
      valStr, valConf, ['revenue_confirmed'], ['valuation_assessment_v1'], ['ps_multiple_is_simplified_benchmark'],
      undefined, undefined,
      confirmedFacts.filter(f => f.metricId === 'valuation' || f.metricId === 'revenue').map(f => f.factId)));
  }

  // Investment attractiveness (judgment)
  const attractivenessDeps = ['revenue_confirmed'];
  if (gm !== null) attractivenessDeps.push('gross_margin_quality');
  if (growth !== null) attractivenessDeps.push('growth_rate');

  let attrScore = 0;
  if (gm !== null && gm >= 60) attrScore += 2; else if (gm !== null && gm >= 40) attrScore += 1;
  if (growth !== null && growth >= 50) attrScore += 2; else if (growth !== null && growth >= 20) attrScore += 1;
  if (cash !== null && burn !== null && burn > 0 && cash / burn >= 12) attrScore += 1;

  let attrVal: string; let attrConf: ConfidenceBand;
  if (attrScore >= 4) { attrVal = '初步具备投资吸引力'; attrConf = 'medium'; }
  else if (attrScore >= 2) { attrVal = '有一定投资价值，需进一步验证'; attrConf = 'low'; }
  else { attrVal = '当前数据不足，无法形成正面判断'; attrConf = 'low'; }

  allNodes.push(makeNode(nodeIdx++, sh, 'investment_attractiveness', 'judgment',
    attrVal, attrConf, attractivenessDeps, ['attractiveness_heuristic_v1'],
    ['heuristic_based_on_limited_data', 'not_a_formal_investment_recommendation'],
    undefined, undefined,
    confirmedFacts.filter(f => ['gross_margin', 'revenue_growth', 'cash_balance', 'burn_rate'].includes(f.metricId)).map(f => f.factId)));

  // ── Industry-specific nodes ──
  if (resolved.primary.packId === 'saas_growth') {
    allNodes.push(...runSaaSPackRules(confirmedFacts));
  } else if (resolved.primary.packId === 'consumer_retail') {
    allNodes.push(...runConsumerPackRules(confirmedFacts));
  } else if (resolved.primary.packId === 'industrial_manufacturing') {
    allNodes.push(...runIndustrialPackRules(confirmedFacts));
  }

  // ── Step 4: Organize assessments ──
  const operatingAssessment = allNodes.filter(n => ['revenue_confirmed', 'growth_rate', 'gross_margin_quality', 'cash_runway'].includes(n.metricId));
  const financialAssessment = allNodes.filter(n => n.metricId.includes('revenue') || n.metricId.includes('margin') || n.metricId.includes('cash') || n.metricId.includes('burn'));
  const teamAssessment = allNodes.filter(n => n.metricId.startsWith('founder') || n.metricId.startsWith('team'));
  const competitiveAssessment = allNodes.filter(n => n.metricId.includes('moat') || n.metricId.includes('competitive') || n.metricId.includes('concentration'));
  const exitAssessment = allNodes.filter(n => n.metricId.includes('exit') || n.metricId === 'valuation_reasonableness');
  const investmentThesis = allNodes.filter(n => n.kind === 'judgment' && n.value && n.confidence !== 'blocked');
  const strongestCounterThesis = allNodes.filter(n => n.kind === 'inference' && (n.confidence === 'blocked' || (n.confidence === 'low' && n.value)));

  // ── Step 5: Confidence ──
  const { band: overallConfidence } = calcOverallConfidence(allNodes, confirmedFacts, candidateFacts.length, resolved.allMetricIds, archetype.matchScore);
  const stability = calcStability(allNodes, 0.3);

  // ── Step 6: Next questions ──
  const companyDisplayName = companyName || '该公司';
  const nextQuestions = generateQuestions(companyDisplayName, allNodes, confirmedFacts, archetype.primaryPackId);

  // ── Step 7: Formal submission gate ──
  const blockingReasons: string[] = [];
  if (overallConfidence === 'blocked') blockingReasons.push('整体置信度不足，无法形成有效判断');
  if (!companyName) blockingReasons.push('公司名称未确认');
  if (revenue === null && factNum('arr', confirmedFacts) === null) blockingReasons.push('缺少收入或ARR数据');

  // Check evidence completeness
  const evidenceCount = confirmedFacts.length;
  if (evidenceCount < 5) blockingReasons.push(`已确认事实仅${evidenceCount}项，远低于尽调最低要求`);

  // Check for blocked inference nodes
  const blockedNodes = allNodes.filter(n => n.confidence === 'blocked' && n.kind !== 'unknown');
  for (const bn of blockedNodes.slice(0, 3)) {
    blockingReasons.push(`推理节点"${bn.metricId}"处于阻断状态`);
  }

  // Run policy to check vetoes BEFORE submission gate
  const effectivePolicy = policy || DEFAULT_GROWTH_EQUITY_POLICY;
  const policyResult = executePolicy(
    { sessionId, sessionVersion: 1, archetype, investmentThesis, strongestCounterThesis, operatingAssessment, financialAssessment, competitiveAssessment: [], moatAssessment: [], teamAssessment: [], riskSnapshotRef: null, forecastSnapshotRef: null, valuationSnapshotRef: null, equitySnapshotRef: null, exitAssessment: [], transactionRecommendations: [], monitoringRecommendations: [], nextQuestions, overallConfidence, stability, formalSubmissionBlocked: false, blockingReasons: [], traceId },
    confirmedFacts, effectivePolicy,
  );
  if (policyResult.blockingItems.length > 0) {
    blockingReasons.push(...policyResult.blockingItems.slice(0, 3));
  }

  const formalSubmissionBlocked = blockingReasons.length > 0;

  // ── Step 8: Build output ──
  const judgment: InvestmentJudgmentOutput = {
    sessionId, sessionVersion: 1, archetype,
    investmentThesis, strongestCounterThesis,
    operatingAssessment, financialAssessment,
    competitiveAssessment, moatAssessment: [],
    teamAssessment,
    riskSnapshotRef: allNodes.some(n => n.metricId.includes('risk')) ? `risk_snapshot_${sessionId}` : null,
    forecastSnapshotRef: revenue !== null ? `forecast_snapshot_${sessionId}` : null,
    valuationSnapshotRef: valuation !== null ? `valuation_snapshot_${sessionId}` : null,
    equitySnapshotRef: null,
    exitAssessment,
    transactionRecommendations: policyResult.policyRecommendations.map((r, i) => makeNode(nodeIdx++, sh, `tx_rec_${i}`, 'judgment', r, 'low', [], ['policy_recommendation_v1'], [])),
    monitoringRecommendations: effectivePolicy.monitoring.keyMetrics.map((m, i) => makeNode(nodeIdx++, sh, `monitor_${i}`, 'judgment', `建议监控指标: ${m}`, 'medium', [], ['monitoring_standard_v1'], [])),
    nextQuestions, overallConfidence, stability,
    formalSubmissionBlocked, blockingReasons, traceId,
  };

  return { judgment, policyResult };
}
