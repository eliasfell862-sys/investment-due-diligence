import { deepFreeze } from '../../domain/deep-freeze';
import type { RiskCalculationTrace, TraceStep } from '../../domain/analysis/calculation-trace';
import { okResult, blockedResult } from '../../domain/analysis/engine-result';
import type { EngineIssue } from '../../domain/analysis/engine-result';
import { calculateRiskScores } from './calculate-risk-scores';
import { compareUnicodeCodePoints } from './compare-risk-strings';
import { estimateLossRanges } from './estimate-loss-ranges';
import { evaluateFatalFlaws } from './evaluate-fatal-flaws';
import { recommendRiskClauses } from './recommend-risk-clauses';
import type {
  RiskAssessment,
  RiskAssessmentInput,
  RiskEngineResult,
} from './risk-types';
import { validateRiskInput } from './validate-risk-input';

function assembleTrace(
  _input: RiskAssessmentInput,
  _scoreWarnings: readonly EngineIssue[],
  scoreSteps: TraceStep[],
  fatalSteps: TraceStep[],
  lossSteps: TraceStep[],
  clauseSteps: TraceStep[],
): RiskCalculationTrace {
  const steps: TraceStep[] = [
    {
      id: 'risk:input-validation',
      operator: 'validate',
      operands: [],
      result: 'passed',
      outcome: 'passed',
    },
    ...scoreSteps,
    ...fatalSteps,
    ...lossSteps,
    ...clauseSteps,
    {
      id: 'risk:assembly',
      operator: 'assemble',
      operands: [],
      result: 'complete',
      outcome: 'passed',
    },
  ];

  return {
    engine: 'risk',
    riskRef: 'risk-assessment@1',
    inputs: [],
    steps,
  };
}

export function evaluateRisk(
  input: unknown,
): RiskEngineResult<RiskAssessment> {
  const validation = validateRiskInput(input);

  if (validation.status === 'blocked') {
    return blockedResult<RiskAssessment>(
      validation.reason,
      validation.issues,
      {
        engine: 'risk',
        riskRef: 'risk-assessment@1',
        inputs: validation.traceInputs,
        steps: [{
          id: 'risk:input-validation',
          operator: 'validate',
          operands: [],
          outcome: 'blocked',
        }],
      },
    );
  }

  const validated = validation.input;

  // 1. Calculate risk scores
  const scores = calculateRiskScores(validated);

  // 2. Evaluate fatal flaws
  const fatalFlaws = evaluateFatalFlaws(validated.fatalFlaws);

  // 3. Estimate loss ranges
  const lossRanges = estimateLossRanges({
    fatalOutcome: fatalFlaws.fatalOutcome,
    notCurableByClause: fatalFlaws.notCurableByClause,
    overallResidualRisk: scores.overall.residualRisk,
    safetyMargin: validated.upstreamSnapshots?.valuation?.safetyMargin ?? '0',
    downsideCashBreak: validated.upstreamSnapshots?.forecast?.downsideCashBreak ?? false,
    downsideMoic: validated.upstreamSnapshots?.investorReturns?.downsideMoic ?? '0',
    exitDelayed: validated.upstreamSnapshots?.exit?.exitDelayed ?? false,
  });

  // 4. Recommend clauses
  const clauses = recommendRiskClauses({
    riskItems: scores.items,
    fatalFlaws: fatalFlaws.checks,
  });

  // 5. Populate clause counts per category
  const clauseCountByCategory = new Map<string, number>();
  for (const rec of clauses.recommendations) {
    for (const riskId of rec.sourceRiskIds) {
      const item = scores.items.find((i) => i.riskId === riskId);
      if (item !== undefined) {
        const count = clauseCountByCategory.get(item.category) ?? 0;
        clauseCountByCategory.set(item.category, count + 1);
      }
    }
  }

  const categoryMatrix = scores.categoryMatrix.map((row) => ({
    ...row,
    clauseRecommendationCount: clauseCountByCategory.get(row.category) ?? 0,
  }));

  // 6. Assemble full assessment
  const assessment: RiskAssessment = {
    version: '1',
    asOfDate: validated.asOfDate,
    thresholds: scores.thresholds,
    riskItems: scores.items,
    categoryMatrix,
    overall: scores.overall,
    fatalFlaws,
    permanentLoss: lossRanges.permanentLoss,
    temporaryDrawdown: lossRanges.temporaryDrawdown,
    clauseRecommendations: clauses.recommendations,
    verificationChecklist: clauses.verificationChecklist,
    dataGaps: scores.dataGaps,
  };

  // 7. Assemble trace
  const scoreSteps: TraceStep[] = scores.items.map((item) => ({
    id: `risk:score:${item.riskId}`,
    operator: 'residual-risk',
    operands: [item.probability, item.impact, item.mitigationEffectiveness],
    result: item.residualRisk,
    outcome: 'passed',
  }));

  const fatalSteps: TraceStep[] = fatalFlaws.checks.map((check) => ({
    id: `risk:fatal:${check.fatalFlawId}`,
    operator: 'fatal-flaw',
    operands: [check.status],
    result: check.status,
    outcome: check.status === 'open' ? 'blocked' : 'passed',
  }));

  const lossSteps: TraceStep[] = [
    {
      id: `risk:permanent-loss:${lossRanges.permanentLoss.selectedRuleId}`,
      operator: 'permanent-loss',
      operands: lossRanges.permanentLoss.triggeredRuleIds,
      result: `[${lossRanges.permanentLoss.lower}, ${lossRanges.permanentLoss.upper}]`,
      outcome: 'passed',
    },
    {
      id: `risk:drawdown:${lossRanges.temporaryDrawdown.selectedRuleId}`,
      operator: 'temporary-drawdown',
      operands: lossRanges.temporaryDrawdown.triggeredRuleIds,
      result: `[${lossRanges.temporaryDrawdown.lower}, ${lossRanges.temporaryDrawdown.upper}]`,
      outcome: 'passed',
    },
  ];

  const clauseSteps: TraceStep[] = clauses.recommendations.map((rec) => ({
    id: `risk:clause:${rec.clauseType}`,
    operator: 'clause-recommendation',
    operands: rec.sourceRiskIds,
    result: rec.negotiationPriority,
    outcome: 'passed',
  }));

  const trace = assembleTrace(
    validated,
    validation.warnings,
    scoreSteps,
    fatalSteps,
    lossSteps,
    clauseSteps,
  );

  const warnings = [...validation.warnings].sort((left, right) =>
    compareUnicodeCodePoints(left.path, right.path),
  );

  return okResult<RiskAssessment>(
    deepFreeze(assessment) as RiskAssessment,
    deepFreeze(warnings) as readonly EngineIssue[],
    trace,
  );
}
