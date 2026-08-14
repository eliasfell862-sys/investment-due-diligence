import type { DailyStrategyReview, StrategyValidationRun } from './types';

export type CalibrationStatus =
  | 'insufficient'
  | 'preliminary'
  | 'established'
  | 'blocked';

export interface StrategyCalibrationSummary {
  status: CalibrationStatus;
  evidenceRunCount: number;
  stressRunCount: number;
  totalClosedTrades: number;
  weightedWinRatePct: number | null;
  weightedNetReturnPct: number | null;
  feeDragPct: number | null;
  maxDrawdownPct: number | null;
  modelConfidencePct: number | null;
  confidenceGapPct: number | null;
  leakageFailed: boolean;
  overfittingFailed: boolean;
  remainingTradesToPreliminary: number;
  latestDataDate: string | null;
}

const EVIDENCE_TYPES = new Set<StrategyValidationRun['validationType']>([
  'walk_forward',
  'out_of_sample',
  'forward',
]);

const rounded = (value: number) => Math.round(value * 100) / 100;

const validClosedTrades = (run: StrategyValidationRun) => {
  const value = run.candidateMetrics.closedTrades;
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const weightedMetric = (
  runs: StrategyValidationRun[],
  read: (run: StrategyValidationRun) => number,
) => {
  let weightedTotal = 0;
  let totalWeight = 0;

  runs.forEach(run => {
    const weight = validClosedTrades(run);
    const value = read(run);
    if (weight <= 0 || !Number.isFinite(value)) return;
    weightedTotal += value * weight;
    totalWeight += weight;
  });

  return totalWeight > 0 ? rounded(weightedTotal / totalWeight) : null;
};

const hasFailedCheck = (runs: StrategyValidationRun[], key: 'leakageChecks' | 'overfittingChecks') =>
  runs.some(run => Object.values(run[key]).some(value => value === false));

const latestReviewConfidence = (reviews: DailyStrategyReview[]) => {
  const values = [...reviews]
    .sort((left, right) => right.tradingDate.localeCompare(left.tradingDate))
    .map(review => review.confidence)
    .filter(value => Number.isFinite(value) && value >= 0 && value <= 1)
    .slice(0, 20);

  return values.length > 0
    ? rounded(values.reduce((sum, value) => sum + value, 0) / values.length * 100)
    : null;
};

export function buildStrategyCalibrationSummary(
  validationRuns: StrategyValidationRun[],
  reviews: DailyStrategyReview[],
): StrategyCalibrationSummary {
  const evidenceRuns = validationRuns.filter(run => EVIDENCE_TYPES.has(run.validationType));
  const stressRunCount = validationRuns.filter(run => run.validationType === 'stress').length;
  const totalClosedTrades = evidenceRuns.reduce(
    (sum, run) => sum + validClosedTrades(run),
    0,
  );
  const weightedWinRatePct = weightedMetric(evidenceRuns, run => run.candidateMetrics.winRate);
  const weightedNetReturnPct = weightedMetric(
    evidenceRuns,
    run => run.candidateMetrics.netReturnPct,
  );
  const feeDragPct = weightedMetric(
    evidenceRuns,
    run => run.candidateMetrics.grossReturnPct - run.candidateMetrics.netReturnPct,
  );
  const drawdowns = evidenceRuns
    .map(run => run.candidateMetrics.maxDrawdownPct)
    .filter(value => Number.isFinite(value));
  const maxDrawdownPct = drawdowns.length > 0 ? rounded(Math.max(...drawdowns)) : null;
  const modelConfidencePct = latestReviewConfidence(reviews);
  const confidenceGapPct = modelConfidencePct !== null && weightedWinRatePct !== null
    ? rounded(modelConfidencePct - weightedWinRatePct)
    : null;
  const leakageFailed = hasFailedCheck(validationRuns, 'leakageChecks');
  const overfittingFailed = hasFailedCheck(validationRuns, 'overfittingChecks');

  let status: CalibrationStatus;
  if (leakageFailed) status = 'blocked';
  else if (totalClosedTrades < 30) status = 'insufficient';
  else if (totalClosedTrades < 100 || overfittingFailed) status = 'preliminary';
  else status = 'established';

  const latestDataDate = evidenceRuns
    .map(run => run.period.end)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    status,
    evidenceRunCount: evidenceRuns.length,
    stressRunCount,
    totalClosedTrades,
    weightedWinRatePct,
    weightedNetReturnPct,
    feeDragPct,
    maxDrawdownPct,
    modelConfidencePct,
    confidenceGapPct,
    leakageFailed,
    overfittingFailed,
    remainingTradesToPreliminary: Math.max(0, 30 - totalClosedTrades),
    latestDataDate,
  };
}

