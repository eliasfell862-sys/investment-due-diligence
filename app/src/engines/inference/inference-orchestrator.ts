/**
 * Inference Orchestrator
 *
 * Ties together: archetype classification → pack resolution → inference graph →
 * confidence calculation → next-best questions → judgment synthesis.
 *
 * This is the main entry point for the investment inference engine.
 */

import type {
  InferenceSessionInput, InvestmentJudgmentOutput, InferenceNode,
  ConfirmedFact, CandidateFact, KnowledgeKind, ConfidenceBand,
} from '../../domain/inference/types';
import { classifyCompany } from './archetype-classifier';
import { resolvePacks } from './industry-pack-registry';
import { calcOverallConfidence, calcStability } from './confidence-calculator';
import { generateQuestions } from './next-best-question';

// ── Inference Node Builder ──

let nodeCounter = 0;
function nextNodeId(): string { nodeCounter++; return `node_${Date.now()}_${nodeCounter}`; }

interface NodeTemplate {
  metricId: string;
  kind: KnowledgeKind;
  label: string;
  derive: (facts: readonly ConfirmedFact[], candidates: readonly CandidateFact[]) => {
    value: string | boolean | null;
    lowerBound?: string | null;
    upperBound?: string | null;
    confidence: ConfidenceBand;
  };
  deps: string[];
}

function makeNode(
  template: NodeTemplate,
  facts: readonly ConfirmedFact[],
  candidates: readonly CandidateFact[],
): InferenceNode {
  const derived = template.derive(facts, candidates);
  return {
    nodeId: nextNodeId(),
    kind: template.kind,
    metricId: template.metricId,
    value: derived.value,
    lowerBound: derived.lowerBound || null,
    upperBound: derived.upperBound || null,
    unit: null,
    period: null,
    confidence: derived.confidence,
    sourceEvidenceIds: facts.filter(f => f.metricId === template.metricId).map(f => f.factId),
    dependencyNodeIds: template.deps,
    ruleIds: [],
    assumptionIds: [],
    conflictIds: [],
    reversibleByQuestionIds: [],
  };
}

function findFact(metricId: string, facts: readonly ConfirmedFact[]): ConfirmedFact | undefined {
  return facts.find(f => f.metricId === metricId);
}

function factValue(metricId: string, facts: readonly ConfirmedFact[]): number | null {
  const f = findFact(metricId, facts);
  if (!f || typeof f.value !== 'string') return null;
  const n = parseFloat(f.value);
  return isNaN(n) ? null : n;
}

// ── Node Templates (universal, not industry-specific) ──

const UNIVERSAL_NODES: NodeTemplate[] = [
  {
    metricId: 'company_exists', kind: 'fact', label: '公司已识别',
    derive: (facts) => {
      const f = findFact('company_name', facts);
      return { value: !!f, confidence: f ? 'high' : 'blocked' };
    },
    deps: [],
  },
  {
    metricId: 'revenue_confirmed', kind: 'fact', label: '收入已确认',
    derive: (facts) => {
      const v = factValue('revenue', facts);
      return { value: v !== null ? String(v) : null, confidence: v !== null ? 'high' : 'medium' };
    },
    deps: [],
  },
  {
    metricId: 'growth_rate', kind: 'calculation', label: '收入增速',
    derive: (facts) => {
      const rev = factValue('revenue', facts);
      const growth = factValue('revenue_growth', facts);
      if (growth !== null) return { value: String(growth), confidence: 'high' };
      if (rev !== null && rev > 0) return { value: '已确认收入，增速待补充', confidence: 'low' };
      return { value: null, confidence: 'blocked' };
    },
    deps: ['revenue_confirmed'],
  },
  {
    metricId: 'gross_margin_quality', kind: 'inference', label: '毛利率质量',
    derive: (facts) => {
      const gm = factValue('gross_margin', facts);
      if (gm === null) return { value: null, confidence: 'low' };
      if (gm >= 70) return { value: '高毛利（≥70%），具备强定价权', lowerBound: '70', upperBound: '100', confidence: 'medium' };
      if (gm >= 40) return { value: '中高毛利（40-70%），有一定竞争壁垒', lowerBound: '40', upperBound: '70', confidence: 'medium' };
      return { value: '较低毛利（<40%），需关注成本结构和竞争', lowerBound: '0', upperBound: '40', confidence: 'medium' };
    },
    deps: [],
  },
  {
    metricId: 'cash_runway_assessment', kind: 'inference', label: '现金跑道评估',
    derive: (facts) => {
      const cash = factValue('cash_balance', facts);
      const burn = factValue('burn_rate', facts);
      if (cash === null || burn === null || burn <= 0) return { value: null, confidence: 'low' };
      const months = cash / burn;
      if (months >= 18) return { value: `现金充足（≈${Math.round(months)}个月）`, confidence: 'medium' };
      if (months >= 9) return { value: `现金可支撑≈${Math.round(months)}个月`, confidence: 'medium' };
      if (months >= 3) return { value: `现金紧张（≈${Math.round(months)}个月），12个月内需要融资`, confidence: 'high', lowerBound: '3', upperBound: '9' };
      return { value: `现金危机（≈${Math.round(months)}个月），急需融资`, confidence: 'high', lowerBound: '0', upperBound: '3' };
    },
    deps: [],
  },
  {
    metricId: 'valuation_reasonableness', kind: 'inference', label: '估值合理性',
    derive: (facts) => {
      const rev = factValue('revenue', facts);
      const val = factValue('valuation', facts);
      const gm = factValue('gross_margin', facts);
      if (rev === null || val === null || rev <= 0) return { value: null, confidence: 'low' };
      const multiple = val / rev;
      const gmAdj = gm !== null && gm > 0 ? gm : 50;
      if (multiple > 30 && gmAdj < 60) return { value: `估值偏高（${multiple.toFixed(1)}x P/S，毛利率${gmAdj}%）`, confidence: 'medium' };
      if (multiple > 15) return { value: `估值适中偏高（${multiple.toFixed(1)}x P/S）`, confidence: 'low' };
      return { value: `估值在合理区间（${multiple.toFixed(1)}x P/S）`, confidence: 'low' };
    },
    deps: ['revenue_confirmed'],
  },
  {
    metricId: 'investment_attractiveness', kind: 'judgment', label: '投资吸引力初判',
    derive: (facts) => {
      const rev = factValue('revenue', facts);
      const gm = factValue('gross_margin', facts);
      const growth = factValue('revenue_growth', facts);
      if (rev === null) return { value: null, confidence: 'blocked' };
      let score = 0;
      if (gm !== null && gm >= 60) score += 2;
      else if (gm !== null && gm >= 40) score += 1;
      if (growth !== null && growth >= 50) score += 2;
      else if (growth !== null && growth >= 20) score += 1;
      if (score >= 4) return { value: '初步具备投资吸引力', confidence: 'medium' };
      if (score >= 2) return { value: '有一定投资价值，需进一步验证', confidence: 'low' };
      return { value: '当前数据不足以形成正面判断', confidence: 'low' };
    },
    deps: ['growth_rate', 'gross_margin_quality', 'valuation_reasonableness'],
  },
];

// ── Orchestrator ──

export function runInference(input: InferenceSessionInput): InvestmentJudgmentOutput {
  const { projectId, confirmedFacts, candidateFacts } = input;
  const sessionId = `session_${projectId}_${Date.now()}`;
  const traceId = `trace_${sessionId}`;

  // Step 1: Classify
  const archetype = classifyCompany(confirmedFacts, candidateFacts);

  // Step 2: Resolve packs
  const resolved = resolvePacks(archetype.primaryPackId, archetype.supplementalPackIds);

  // Step 3: Build inference nodes
  const allNodes: InferenceNode[] = [];
  for (const template of UNIVERSAL_NODES) {
    allNodes.push(makeNode(template, confirmedFacts, candidateFacts));
  }

  // Organize nodes by assessment area
  const operatingAssessment = allNodes.filter(n =>
    ['revenue_confirmed', 'growth_rate', 'gross_margin_quality', 'cash_runway_assessment'].includes(n.metricId));

  const financialAssessment = allNodes.filter(n =>
    n.metricId.includes('revenue') || n.metricId.includes('cash') || n.metricId.includes('margin'));

  const valuationAssessment = allNodes.filter(n =>
    n.metricId.includes('valuation'));

  const investmentThesis = allNodes.filter(n =>
    n.kind === 'judgment' && n.value && n.confidence !== 'blocked');

  const strongestCounterThesis = allNodes.filter(n =>
    n.kind === 'inference' && (n.confidence === 'blocked' || n.confidence === 'low'));

  // Step 4: Confidence
  const { band: overallConfidence } = calcOverallConfidence(
    allNodes, confirmedFacts, candidateFacts.length,
    resolved.allMetricIds, archetype.matchScore,
  );

  // Step 5: Stability
  const stability = calcStability(allNodes, 0.3);

  // Step 6: Next questions
  const companyName = findFact('company_name', confirmedFacts)?.value as string || '该公司';
  const nextQuestions = generateQuestions(companyName, allNodes, confirmedFacts, archetype.primaryPackId);

  // Step 7: Blocking check
  const blockingReasons: string[] = [];
  if (overallConfidence === 'blocked') blockingReasons.push('整体置信度不足');
  if (!findFact('company_name', confirmedFacts)) blockingReasons.push('公司名称未确认');
  if (!findFact('revenue', confirmedFacts) && !findFact('arr', confirmedFacts)) blockingReasons.push('缺少收入或ARR数据');
  const formalSubmissionBlocked = blockingReasons.length > 0;

  return {
    sessionId,
    sessionVersion: 1,
    archetype,
    investmentThesis,
    strongestCounterThesis,
    operatingAssessment,
    financialAssessment,
    competitiveAssessment: [],
    moatAssessment: [],
    teamAssessment: [],
    riskSnapshotRef: null,
    forecastSnapshotRef: null,
    valuationSnapshotRef: null,
    equitySnapshotRef: null,
    exitAssessment: valuationAssessment,
    transactionRecommendations: [],
    monitoringRecommendations: [],
    nextQuestions,
    overallConfidence,
    stability,
    formalSubmissionBlocked,
    blockingReasons,
    traceId,
  };
}
