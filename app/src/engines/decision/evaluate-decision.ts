import { AnalysisDecimal, canonicalDecimal, parseDecimalString, parseUnitIntervalString } from '../../domain/analysis/decimal';
import { deepFreeze } from '../../domain/deep-freeze';
import { DomainContractError } from '../../domain/analysis/value';
import { okResult, blockedResult } from '../../domain/analysis/engine-result';
import type { EngineIssue } from '../../domain/analysis/engine-result';
import type { TraceStep } from '../../domain/analysis/calculation-trace';
import { compareUnicodeCodePoints } from '../risk/compare-risk-strings';
import type {
  DecisionInput,
  DecisionOutput,
  DecisionTier,
  DecisionEngineResult,
  StageWeights,
} from './decision-types';

const DEFAULT_WEIGHTS: Record<string, StageWeights> = {
  vc_early: {
    teamAndGovernance: '0.25', marketAndIndustry: '0.2', productAndTechnology: '0.2',
    commercializationAndGrowth: '0.15', financialAndCashFlow: '0.1', valuationAndReturn: '0.1',
  },
  growth: {
    teamAndGovernance: '0.15', marketAndIndustry: '0.15', productAndTechnology: '0.15',
    commercializationAndGrowth: '0.2', financialAndCashFlow: '0.2', valuationAndReturn: '0.15',
  },
  pe_buyout: {
    teamAndGovernance: '0.1', marketAndIndustry: '0.1', productAndTechnology: '0.1',
    commercializationAndGrowth: '0.15', financialAndCashFlow: '0.25', valuationAndReturn: '0.3',
  },
};

const DEFAULT_THRESHOLDS = {
  strongRecommendMin: '0.8',
  conditionalInvestMin: '0.7',
  continueObservingMin: '0.6',
};

const DIMENSIONS = [
  'teamAndGovernance', 'marketAndIndustry', 'productAndTechnology',
  'commercializationAndGrowth', 'financialAndCashFlow', 'valuationAndReturn',
] as const;

function invalidDto(): never { throw new DomainContractError('invalid_dto'); }
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : invalidDto();
}
function str(value: unknown): string { return typeof value === 'string' ? value : invalidDto(); }
function arr(value: unknown): unknown[] { return Array.isArray(value) ? value : invalidDto(); }
function issue(code: EngineIssue['code'], path: string): EngineIssue {
  return { code, path, message: `${path}: ${code}`, details: {} };
}

function computeWeightedScore(scores: DecisionInput['qualityScores'], weights: StageWeights): AnalysisDecimal {
  let total = new AnalysisDecimal(0);
  for (const dim of DIMENSIONS) total = total.plus(new AnalysisDecimal(scores[dim]).times(weights[dim]));
  return total;
}

function determineTier(
  riskAdjustedScore: string | null,
  fatalOutcome: DecisionInput['fatalOutcome'],
  thresholds: typeof DEFAULT_THRESHOLDS,
  returnMetrics: DecisionInput['returnMetrics'],
): DecisionTier {
  if (fatalOutcome === 'reject') return 'do_not_invest';
  if (fatalOutcome === 'pause') return 'defer';
  if (riskAdjustedScore === null) {
    return fatalOutcome === 'conditional_cap' ? 'conditional_invest' : 'continue_observing';
  }

  const score = new AnalysisDecimal(riskAdjustedScore);
  const baseMoic = returnMetrics.baseCaseMoic !== null ? new AnalysisDecimal(returnMetrics.baseCaseMoic) : null;
  const targetMoic = new AnalysisDecimal(returnMetrics.targetMoic);
  const baseIrr = returnMetrics.baseCaseIrr !== null ? new AnalysisDecimal(returnMetrics.baseCaseIrr) : null;
  const targetIrr = new AnalysisDecimal(returnMetrics.targetIrr);
  const returnMet = (baseMoic !== null && baseMoic.greaterThanOrEqualTo(targetMoic)) ||
    (baseIrr !== null && baseIrr.greaterThanOrEqualTo(targetIrr));

  const sm = new AnalysisDecimal(thresholds.strongRecommendMin);
  const cm = new AnalysisDecimal(thresholds.conditionalInvestMin);
  const om = new AnalysisDecimal(thresholds.continueObservingMin);

  if (fatalOutcome === 'conditional_cap') {
    if (score.lessThan(om)) return 'defer';
    if (score.lessThan(cm)) return 'continue_observing';
    return 'conditional_invest';
  }

  if (score.lessThan(om)) return 'defer';
  if (score.lessThan(cm)) return 'continue_observing';
  if (score.lessThan(sm)) return 'conditional_invest';
  if (!returnMet) return 'conditional_invest';
  return 'strong_recommend';
}

export function evaluateDecision(input: unknown): DecisionEngineResult<DecisionOutput> {
  // Snapshot
  let snapped: unknown;
  try {
    snapped = JSON.parse(JSON.stringify(input));
  } catch {
    throw new DomainContractError('invalid_dto');
  }

  const issues: EngineIssue[] = [];
  const inp = record(snapped);
  const allowed = ['version', 'strategy', 'qualityScores', 'stageWeights', 'overallResidualRisk', 'riskPenalty', 'fatalOutcome', 'notCurableByClause', 'returnMetrics', 'maxAcceptableValuation', 'keyAssumptions', 'bearCaseArguments', 'customThresholdOverrides'];
  for (const key of Object.keys(inp)) { if (!allowed.includes(key)) return invalidDto(); }

  // Required fields
  for (const key of ['version', 'strategy', 'qualityScores', 'fatalOutcome', 'notCurableByClause', 'returnMetrics']) {
    if (!Object.hasOwn(inp, key)) { issues.push(issue('missing_input', `decision.${key}`)); }
  }
  if (issues.length > 0) {
    return blockedResult('invalid-input', deepFreeze(issues) as readonly EngineIssue[], { engine: 'decision', decisionRef: 'investment-decision@1', inputs: [], steps: [] });
  }

  const version = str(inp.version);
  if (version !== '1') issues.push(issue('unsupported_engine_version', 'decision.version'));

  const strategy = str(inp.strategy);
  if (!['vc_early', 'growth', 'pe_buyout'].includes(strategy)) issues.push(issue('invalid_risk_item', 'decision.strategy'));

  const qs = record(inp.qualityScores);
  const scores: Record<string, string> = {};
  for (const dim of DIMENSIONS) {
    try {
      const raw = str(qs[dim]);
      const val = parseDecimalString(raw);
      if (val.isNegative() || val.greaterThan(100)) issues.push(issue('value_out_of_range', `decision.qualityScores.${dim}`));
      scores[dim] = canonicalDecimal(val);
    } catch { issues.push(issue('invalid_decimal', `decision.qualityScores.${dim}`)); }
  }

  let stageWeights: StageWeights | undefined;
  if (Object.hasOwn(inp, 'stageWeights') && inp.stageWeights !== null) {
    const sw = record(inp.stageWeights);
    stageWeights = {} as StageWeights;
    let total = new AnalysisDecimal(0);
    for (const dim of DIMENSIONS) {
      try {
        const val = parseUnitIntervalString(str(sw[dim]));
        (stageWeights as Record<string, string>)[dim] = canonicalDecimal(val);
        total = total.plus(val);
      } catch { issues.push(issue('invalid_risk_weight', `decision.stageWeights.${dim}`)); }
    }
    if (issues.length === 0 && canonicalDecimal(total) !== '1') issues.push(issue('invalid_risk_weight', 'decision.stageWeights'));
  }

  const fatalOutcome = str(inp.fatalOutcome);
  if (!['none', 'conditional_cap', 'pause', 'reject'].includes(fatalOutcome)) issues.push(issue('invalid_fatal_flaw', 'decision.fatalOutcome'));

  const rm = record(inp.returnMetrics);
  const targetIrr = str(rm.targetIrr); const targetMoic = str(rm.targetMoic);
  let baseCaseIrr: string | null = null; let baseCaseMoic: string | null = null;
  try { parseUnitIntervalString(targetIrr); } catch { issues.push(issue('invalid_decimal', 'decision.returnMetrics.targetIrr')); }
  try { parseDecimalString(targetMoic); } catch { issues.push(issue('invalid_decimal', 'decision.returnMetrics.targetMoic')); }
  if (Object.hasOwn(rm, 'baseCaseIrr') && rm.baseCaseIrr !== null) {
    try { baseCaseIrr = canonicalDecimal(parseUnitIntervalString(str(rm.baseCaseIrr))); } catch { issues.push(issue('invalid_decimal', 'decision.returnMetrics.baseCaseIrr')); }
  }
  if (Object.hasOwn(rm, 'baseCaseMoic') && rm.baseCaseMoic !== null) {
    try { baseCaseMoic = canonicalDecimal(parseDecimalString(str(rm.baseCaseMoic))); } catch { issues.push(issue('invalid_decimal', 'decision.returnMetrics.baseCaseMoic')); }
  }
  const permLower = str(rm.permanentLossProbabilityLower);
  const permUpper = str(rm.permanentLossProbabilityUpper);

  let thresholds = { ...DEFAULT_THRESHOLDS };
  if (Object.hasOwn(inp, 'customThresholdOverrides') && inp.customThresholdOverrides !== null && inp.customThresholdOverrides !== undefined) {
    const ct = record(inp.customThresholdOverrides);
    try {
      thresholds.strongRecommendMin = canonicalDecimal(parseUnitIntervalString(str(ct.strongRecommendMin)));
      thresholds.conditionalInvestMin = canonicalDecimal(parseUnitIntervalString(str(ct.conditionalInvestMin)));
      thresholds.continueObservingMin = canonicalDecimal(parseUnitIntervalString(str(ct.continueObservingMin)));
      if (str(ct.changeReason).length === 0) issues.push(issue('invalid_risk_threshold', 'decision.customThresholdOverrides.changeReason'));
      const s = new AnalysisDecimal(thresholds.strongRecommendMin);
      const c = new AnalysisDecimal(thresholds.conditionalInvestMin);
      const o = new AnalysisDecimal(thresholds.continueObservingMin);
      if (s.lessThanOrEqualTo(c) || c.lessThanOrEqualTo(o)) issues.push(issue('invalid_risk_threshold', 'decision.customThresholdOverrides'));
    } catch { issues.push(issue('invalid_risk_threshold', 'decision.customThresholdOverrides')); }
  }

  let overallResidualRisk: string | null = null;
  if (Object.hasOwn(inp, 'overallResidualRisk') && inp.overallResidualRisk !== null) {
    try { overallResidualRisk = canonicalDecimal(parseDecimalString(str(inp.overallResidualRisk))); } catch { issues.push(issue('invalid_decimal', 'decision.overallResidualRisk')); }
  }
  let riskPenalty: string | null = null;
  if (Object.hasOwn(inp, 'riskPenalty') && inp.riskPenalty !== null) {
    try { riskPenalty = canonicalDecimal(parseDecimalString(str(inp.riskPenalty))); } catch { issues.push(issue('invalid_decimal', 'decision.riskPenalty')); }
  }

  const maxAccVal = (Object.hasOwn(inp, 'maxAcceptableValuation') && inp.maxAcceptableValuation !== null) ? str(inp.maxAcceptableValuation) : null;
  const keyAssumptions: string[] = Object.hasOwn(inp, 'keyAssumptions') ? arr(inp.keyAssumptions).map((a: unknown) => str(a)) : [];
  const bearCase: string[] = Object.hasOwn(inp, 'bearCaseArguments') ? arr(inp.bearCaseArguments).map((a: unknown) => str(a)) : [];

  if (issues.length > 0) {
    issues.sort((a, b) => compareUnicodeCodePoints(a.path, b.path));
    return blockedResult('invalid-input', deepFreeze(issues) as readonly EngineIssue[], { engine: 'decision', decisionRef: 'investment-decision@1', inputs: [], steps: [] });
  }

  // Calculate
  const weights = stageWeights ?? DEFAULT_WEIGHTS[strategy]!;
  const compositeScore = computeWeightedScore(scores as unknown as DecisionInput['qualityScores'], weights);
  const compositeScoreStr = canonicalDecimal(compositeScore.div(100));

  let riskAdjustedScore: string | null = null;
  if (overallResidualRisk !== null && riskPenalty !== null) {
    riskAdjustedScore = canonicalDecimal(compositeScore.minus(riskPenalty).div(100));
  }

  const tier = determineTier(riskAdjustedScore, fatalOutcome as DecisionInput['fatalOutcome'], thresholds, {
    targetIrr, targetMoic, baseCaseIrr, baseCaseMoic,
    permanentLossProbabilityLower: permLower, permanentLossProbabilityUpper: permUpper,
  });

  // Build rationale
  const parts: string[] = [];
  if (fatalOutcome === 'reject') { parts.push('Fatal flaw present — investment rejected.'); }
  else if (fatalOutcome === 'pause') { parts.push('Fatal flaw requires resolution before proceeding.'); }
  else if (fatalOutcome === 'conditional_cap') { parts.push('Fatal flaw covered; decision capped at conditional.'); }
  if (compositeScoreStr !== null) parts.push(`Composite score: ${compositeScoreStr}.`);
  if (riskAdjustedScore !== null) parts.push(`Risk-adjusted: ${riskAdjustedScore}.`);
  switch (tier) {
    case 'strong_recommend': parts.push('Quality and returns exceed thresholds.'); break;
    case 'conditional_invest': parts.push('Conditions required to proceed.'); break;
    case 'continue_observing': parts.push('Key metrics not yet validated.'); break;
    case 'defer': parts.push('Risk or quality insufficient.'); break;
    case 'do_not_invest': parts.push('Does not meet investment criteria.'); break;
  }

  const output: DecisionOutput = {
    tier,
    compositeScore: compositeScoreStr,
    riskAdjustedScore,
    investRationale: parts.join(' '),
    bearCase: bearCase.join(' ') || 'No bear case arguments provided.',
    maxAcceptableValuation: maxAccVal,
    targetIrr,
    targetMoic,
    permanentLossRange: { lower: permLower, upper: permUpper },
    keyAssumptions,
    prerequisites: tier === 'strong_recommend' ? ['Complete legal due diligence.', 'Finalize investment agreement.'] :
      tier === 'conditional_invest' ? ['Resolve outstanding due diligence findings.', 'Negotiate protective clauses.'] :
      tier === 'continue_observing' ? ['Obtain additional data on product-market fit.'] :
      tier === 'defer' ? ['Resolve fatal flaw before reconsidering.'] :
      ['No investment action recommended.'],
    suggestedClauses: [],
    verificationActions: tier === 'strong_recommend' ? ['Verify QoQ revenue growth for 2 consecutive quarters.'] :
      tier === 'conditional_invest' ? ['Verify 3 months of actual financials against projections.'] :
      tier === 'continue_observing' ? ['Track monthly active users and revenue for 6 months.'] :
      tier === 'defer' ? ['Monitor resolution of fatal flaw conditions.'] :
      ['Archive project with reasons documented.'],
    reversalConditions: tier === 'strong_recommend' ? ['Key customer churn exceeds 20% before closing.'] :
      tier === 'conditional_invest' ? ['Due diligence identifies previously undisclosed material liability.'] :
      tier === 'continue_observing' ? ['Company fails to close next funding round within 12 months.'] :
      tier === 'defer' ? ['All open fatal flaws are resolved or covered.'] :
      ['New material evidence emerges that invalidates the fatal flaw.'],
  };

  const traceSteps: TraceStep[] = [
    { id: 'decision:composite', operator: 'weighted-score', operands: [...DIMENSIONS], result: compositeScoreStr, outcome: 'passed' },
    { id: 'decision:risk-adjusted', operator: 'risk-adjust', operands: [compositeScoreStr, riskPenalty ?? '0'], result: riskAdjustedScore ?? 'null', outcome: 'passed' },
    { id: 'decision:tier', operator: 'determine-tier', operands: [riskAdjustedScore ?? 'null', fatalOutcome], result: tier, outcome: 'passed' },
  ];

  return okResult<DecisionOutput>(
    deepFreeze(output) as DecisionOutput, [],
    { engine: 'decision', decisionRef: 'investment-decision@1', inputs: [], steps: traceSteps },
  );
}
