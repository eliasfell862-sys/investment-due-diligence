/**
 * Inference Orchestrator — stable, deterministic, auditable.
 *
 * All IDs derived from input hash — same input always produces same output.
 * Wires existing engines (risk, decision) where available.
 * Evidence chains populated with rule IDs and dependency traces.
 */

import type { InferenceSessionInput, InvestmentJudgmentOutput, InferenceNode, ConfirmedFact, KnowledgeKind, ConfidenceBand } from '../../domain/inference/types';
import { classifyCompany } from './archetype-classifier';
import { resolvePacks } from './industry-pack-registry';
import { calcOverallConfidence, calcStability } from './confidence-calculator';
import { generateQuestions } from './next-best-question';
import { runSaaSPackRules } from './industry-packs/saas-growth-pack';
import { runConsumerPackRules } from './industry-packs/consumer-retail-pack';
import { runIndustrialPackRules } from './industry-packs/industrial-manufacturing-pack';
import { executePolicy, type PolicyComplianceResult } from './policy-executor';
import { DEFAULT_GROWTH_EQUITY_POLICY, type InstitutionPolicy } from '../../domain/inference/institution-policy';
import { deepFreeze } from '../../domain/deep-freeze';
import { runAutomaticAnalysisPipeline } from './automatic-analysis-pipeline';

// ── Deterministic ID generator ──

function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h) + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function sessionHash(input: InferenceSessionInput): string {
  const serialized = JSON.stringify({
    version: input.version,
    projectId: input.projectId,
    institutionPolicyVersion: input.institutionPolicyVersion,
    asOfDate: input.asOfDate,
    requestedStrategy: input.requestedStrategy,
    facts: [...input.confirmedFacts].sort((a, b) => a.factId.localeCompare(b.factId)),
    candidates: [...input.candidateFacts].sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
  });
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
  const sh = sessionHash(input);
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

  // Run deterministic downstream engines only when their minimum facts are available.
  const automaticAnalysis = runAutomaticAnalysisPipeline(confirmedFacts, input.asOfDate, sh);
  if (automaticAnalysis.forecast) {
    allNodes.push(makeNode(
      nodeIdx++, sh, 'forecast_base_revenue', 'calculation',
      `基准情景第3年收入 ${automaticAnalysis.forecast.baseRevenue}`,
      'medium', ['revenue_confirmed', 'growth_rate'], ['three-scenario@1'],
      ['growth_and_cost_profile_inferred_from_confirmed_facts'],
      automaticAnalysis.forecast.downsideRevenue, automaticAnalysis.forecast.upsideRevenue,
    ));
    allNodes.push(makeNode(
      nodeIdx++, sh, 'forecast_base_fcff', 'calculation',
      automaticAnalysis.forecast.baseFcff, 'medium', ['forecast_base_revenue'],
      ['three-scenario@1'], ['operating_cost_mix_uses_industry_defaults'],
    ));
  }
  if (automaticAnalysis.valuation) {
    allNodes.push(makeNode(
      nodeIdx++, sh, 'dcf_valuation_range', 'calculation',
      automaticAnalysis.valuation.midpoint, 'medium', ['forecast_base_fcff'],
      ['dcf@1'], ['wacc_and_terminal_assumptions_use_confirmed_facts_or_policy_defaults'],
      automaticAnalysis.valuation.low, automaticAnalysis.valuation.high,
    ));
  }
  if (automaticAnalysis.marketCap) {
    const marketCap = automaticAnalysis.marketCap;
    allNodes.push(makeNode(
      nodeIdx++, sh, 'market_cap', 'calculation', marketCap.midpoint,
      marketCap.basis === 'model_implied' ? 'medium' : 'high',
      marketCap.basis === 'listed' ? ['share_price', 'fully_diluted_shares']
        : marketCap.basis === 'post_money' ? ['valuation', 'investment_amount'] : ['dcf_valuation_range'],
      [marketCap.ruleRef],
      marketCap.basis === 'model_implied' ? ['private_company_market_cap_is_model_implied_equity_value'] : [],
      marketCap.low, marketCap.high,
    ));
  }
  if (automaticAnalysis.equity) {
    allNodes.push(makeNode(
      nodeIdx++, sh, 'expected_moic', 'calculation', automaticAnalysis.equity.expectedMoic,
      'medium', ['dcf_valuation_range'], ['cap-table@1', 'investor-returns@1'],
      ['one_x_non_participating_liquidation_preference_unless_confirmed_otherwise'],
    ));
    allNodes.push(makeNode(
      nodeIdx++, sh, 'permanent_loss_probability', 'calculation',
      automaticAnalysis.equity.permanentLossProbability, 'medium', ['expected_moic'],
      ['investor-returns@1'], [],
    ));
  }
  if (automaticAnalysis.risk) {
    allNodes.push(makeNode(
      nodeIdx++, sh, 'overall_residual_risk', 'calculation', automaticAnalysis.risk.residualRisk,
      'medium', ['forecast_base_fcff', 'expected_moic'], ['risk-assessment@1'], [],
    ));
    allNodes.push(makeNode(
      nodeIdx++, sh, 'permanent_loss_range', 'inference',
      `[${automaticAnalysis.risk.permanentLossLower}, ${automaticAnalysis.risk.permanentLossUpper}]`,
      'medium', ['overall_residual_risk'], ['risk-assessment@1'], [],
      automaticAnalysis.risk.permanentLossLower, automaticAnalysis.risk.permanentLossUpper,
    ));
    automaticAnalysis.risk.clauseTypes.forEach((clauseType, index) => {
      allNodes.push(makeNode(nodeIdx++, sh, `risk_clause_${index}`, 'judgment', clauseType,
        'medium', ['overall_residual_risk'], ['risk-assessment@1'], []));
    });
  }
  if (automaticAnalysis.decision) {
    allNodes.push(makeNode(
      nodeIdx++, sh, 'investment_decision', 'judgment',
      `${automaticAnalysis.decision.tier}: ${automaticAnalysis.decision.rationale}`,
      'medium', ['overall_residual_risk', 'expected_moic', 'dcf_valuation_range'],
      ['investment-decision@1'], ['decision_is_reversible_when_key_facts_change'],
    ));
  }

  // Normalize pack-local IDs and evidence links at the orchestration boundary.
  const stableNodes = allNodes.map((node, index) => ({
    ...node,
    nodeId: `node_${sh}_${index}`,
  }));
  const nodeIdByMetric = new Map<string, string>();
  for (const node of stableNodes) {
    if (!nodeIdByMetric.has(node.metricId)) nodeIdByMetric.set(node.metricId, node.nodeId);
  }
  const normalizedNodes = stableNodes.map((node, index) => {
    const original = allNodes[index];
    const dependencyMetrics = original.dependencyNodeIds;
    const explicitFactIds = new Set(original.sourceEvidenceIds);
    const evidenceIds = confirmedFacts
      .filter(f => explicitFactIds.has(f.factId) || dependencyMetrics.includes(f.metricId))
      .flatMap(f => f.evidenceIds);
    return {
      ...node,
      sourceEvidenceIds: [...new Set(evidenceIds)].sort(),
      dependencyNodeIds: dependencyMetrics
        .map(metricId => nodeIdByMetric.get(metricId))
        .filter((id): id is string => id !== undefined),
      ruleIds: node.ruleIds.length > 0
        ? node.ruleIds
        : [`${resolved.primary.packId}:${node.metricId}:v1`],
    };
  });
  allNodes.splice(0, allNodes.length, ...normalizedNodes);

  // ── Step 4: Organize assessments ──
  // Classify every node into the best-fitting assessment category
  function classifyNode(n: InferenceNode): string {
    const id = n.metricId;
    if (['revenue_confirmed', 'growth_rate', 'gross_margin_quality', 'cash_runway'].includes(id)) return 'operating';
    if (['market_cap', 'expected_moic', 'permanent_loss_probability', 'overall_residual_risk'].includes(id)) return 'financial';
    if (id.startsWith('founder') || id.startsWith('team')) return 'team';
    if (id.includes('moat') || id.includes('pricing_power') || id.includes('switching_cost')) return 'moat';
    if (id.includes('competitive') || id.includes('concentration')) return 'competitive';
    if (id.includes('exit') || id.includes('ipo') || id.includes('ma_') || id === 'valuation_reasonableness' || id.startsWith('dcf_')) return 'exit';
    // Industry pack nodes — categorize by domain
    if (id.includes('nrr') || id.includes('recurrence') || id.includes('growth')) return 'operating';
    if (id.includes('ltv') || id.includes('cac') || id.includes('margin') || id.includes('revenue') || id.includes('cash') || id.includes('burn') || id.includes('rule_of_40') || id.includes('unit_')) return 'financial';
    if (id.includes('yield') || id.includes('capacity') || id.includes('order') || id.includes('utilization')) return 'operating';
    if (id.includes('store') || id.includes('expansion') || id.includes('repurchase') || id.includes('inventory') || id.includes('return_rate') || id.includes('platform') || id.includes('channel')) return 'operating';
    if (id.includes('debt') || id.includes('cost') || id.includes('material') || id.includes('receivables') || id.includes('capex') || id.includes('depreciation')) return 'financial';
    if (id.includes('certification') || id.includes('valuation_context') || id.includes('valuation_ps') || id.includes('valuation_vs') || id.includes('valuation_multiples')) return 'exit';
    return 'operating'; // default
  }

  const operatingAssessment: InferenceNode[] = [];
  const financialAssessment: InferenceNode[] = [];
  const competitiveAssessment: InferenceNode[] = [];
  const moatAssessment: InferenceNode[] = [];
  const teamAssessment: InferenceNode[] = [];
  const exitAssessment: InferenceNode[] = [];

  for (const n of allNodes) {
    const cat = classifyNode(n);
    if (cat === 'operating') operatingAssessment.push(n);
    else if (cat === 'financial') financialAssessment.push(n);
    else if (cat === 'competitive') competitiveAssessment.push(n);
    else if (cat === 'moat') moatAssessment.push(n);
    else if (cat === 'team') teamAssessment.push(n);
    else if (cat === 'exit') exitAssessment.push(n);
    else operatingAssessment.push(n);
  }

  const investmentThesis = allNodes.filter(n => n.kind === 'judgment' && n.value && n.confidence !== 'blocked');
  const strongestCounterThesis = allNodes.filter(n => n.kind === 'inference' && (n.confidence === 'blocked' || (n.confidence === 'low' && n.value)));

  // ── Step 5: Confidence ──
  const { band: overallConfidence } = calcOverallConfidence(allNodes, confirmedFacts, candidateFacts.length, resolved.allMetricIds, archetype.matchScore);
  const stability = calcStability(allNodes, 0.3);

  // ── Step 6: Next questions ──
  const companyDisplayName = companyName || '该公司';
  const nextQuestions = generateQuestions(companyDisplayName, allNodes, confirmedFacts, archetype.primaryPackId)
    .map((question, index) => ({ ...question, questionId: `q_${sh}_${index}` }));

  // ── Step 7: Formal submission gate ──
  const blockingReasons: string[] = [];
  if (automaticAnalysis.risk?.unassessedFatalFlawCount) {
    blockingReasons.push(`六项致命缺陷中仍有${automaticAnalysis.risk.unassessedFatalFlawCount}项未评估`);
  } else if (automaticAnalysis.risk?.fatalOutcome === 'pause') {
    blockingReasons.push('存在尚未解决的致命缺陷，投资流程暂停');
  } else if (automaticAnalysis.risk?.fatalOutcome === 'reject') {
    blockingReasons.push('存在不可通过条款补救的致命缺陷，建议否决');
  }
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
  if (!policyResult.canSubmitToCommittee) {
    blockingReasons.push(...policyResult.riskViolations.slice(0, 2));
    blockingReasons.push(...policyResult.evidenceGaps.slice(0, 2));
  }


  const formalSubmissionBlocked = blockingReasons.length > 0;

  // ── Step 8: Build output ──
  const judgment: InvestmentJudgmentOutput = {
    sessionId, sessionVersion: 1, archetype,
    investmentThesis, strongestCounterThesis,
    operatingAssessment, financialAssessment,
    competitiveAssessment, moatAssessment,
    teamAssessment,
    riskSnapshotRef: automaticAnalysis.riskSnapshotRef,
    forecastSnapshotRef: automaticAnalysis.forecastSnapshotRef,
    valuationSnapshotRef: automaticAnalysis.valuationSnapshotRef,
    equitySnapshotRef: automaticAnalysis.equitySnapshotRef,
    exitAssessment,
    transactionRecommendations: [
      ...allNodes.filter(node => node.metricId.startsWith('risk_clause_')),
      ...policyResult.policyRecommendations.map((r, i) => makeNode(nodeIdx++, sh, `tx_rec_${i}`, 'judgment', r, 'low', [], ['policy_recommendation_v1'], [])),
    ],
    monitoringRecommendations: effectivePolicy.monitoring.keyMetrics.map((m, i) => makeNode(nodeIdx++, sh, `monitor_${i}`, 'judgment', `建议监控指标: ${m}`, 'medium', [], ['monitoring_standard_v1'], [])),
    nextQuestions, overallConfidence, stability,
    formalSubmissionBlocked, blockingReasons, traceId,
  };

  return deepFreeze({ judgment, policyResult });
}
