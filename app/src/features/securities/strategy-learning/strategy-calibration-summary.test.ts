import { describe, expect, it } from 'vitest';
import type {
  DailyStrategyReview,
  StrategyMetrics,
  StrategyValidationRun,
  ValidationType,
} from './types';
import { buildStrategyCalibrationSummary } from './strategy-calibration-summary';

const metrics = (overrides: Partial<StrategyMetrics> = {}): StrategyMetrics => ({
  netReturnPct: 8,
  grossReturnPct: 10,
  annualReturnPct: 12,
  maxDrawdownPct: 6,
  winRate: 55,
  payoffRatio: 1.4,
  profitFactor: 1.3,
  sharpe: 1.1,
  closedTrades: 40,
  ...overrides,
});

const validationRun = (overrides: {
  id?: string;
  validationType?: ValidationType;
  closedTrades?: number;
  winRate?: number;
  netReturnPct?: number;
  grossReturnPct?: number;
  maxDrawdownPct?: number;
  periodEnd?: string;
  leakagePassed?: boolean;
  overfittingPassed?: boolean;
} = {}): StrategyValidationRun => ({
  id: overrides.id ?? crypto.randomUUID(),
  candidateId: 'candidate-1',
  validationType: overrides.validationType ?? 'out_of_sample',
  universeSnapshotId: 'universe-1',
  period: { start: '2026-01-01', end: overrides.periodEnd ?? '2026-06-30' },
  costModel: { commissionRate: 0.0003 },
  baselineMetrics: metrics(),
  candidateMetrics: metrics({
    closedTrades: overrides.closedTrades ?? 40,
    winRate: overrides.winRate ?? 55,
    netReturnPct: overrides.netReturnPct ?? 8,
    grossReturnPct: overrides.grossReturnPct ?? 10,
    maxDrawdownPct: overrides.maxDrawdownPct ?? 6,
  }),
  marketRegimeMetrics: {},
  leakageChecks: { passed: overrides.leakagePassed ?? true },
  overfittingChecks: { passed: overrides.overfittingPassed ?? true },
  passed: true,
  failureReasons: [],
  createdAt: '2026-07-01T08:00:00.000Z',
});

const dailyReview = (
  confidence: number,
  tradingDate = '2026-08-01',
): DailyStrategyReview => ({
  id: `review-${tradingDate}`,
  tradingDate,
  strategyId: 'realtime-technical',
  strategyVersion: '1',
  snapshotId: `snapshot-${tradingDate}`,
  status: 'completed',
  portfolioMetrics: {
    returnPct: 1,
    maxDrawdownPct: 0.5,
    openPositions: 2,
    transactionCost: 6,
  },
  positiveFindings: [],
  negativeFindings: [],
  dataQuality: { completeness: 1, blockingIssues: [] },
  confidence,
  createdAt: `${tradingDate}T07:10:00.000Z`,
  completedAt: `${tradingDate}T07:15:00.000Z`,
});

describe('buildStrategyCalibrationSummary', () => {
  it('returns explicit insufficient evidence when no validation exists', () => {
    expect(buildStrategyCalibrationSummary([], [])).toEqual({
      status: 'insufficient',
      evidenceRunCount: 0,
      stressRunCount: 0,
      totalClosedTrades: 0,
      weightedWinRatePct: null,
      weightedNetReturnPct: null,
      feeDragPct: null,
      maxDrawdownPct: null,
      modelConfidencePct: null,
      confidenceGapPct: null,
      leakageFailed: false,
      overfittingFailed: false,
      remainingTradesToPreliminary: 30,
      latestDataDate: null,
    });
  });

  it('weights sample-out-of-sample metrics by closed trades', () => {
    const summary = buildStrategyCalibrationSummary([
      validationRun({
        id: 'oos',
        validationType: 'out_of_sample',
        closedTrades: 40,
        winRate: 55,
        netReturnPct: 8,
        grossReturnPct: 10,
        maxDrawdownPct: 6,
        periodEnd: '2026-06-30',
      }),
      validationRun({
        id: 'forward',
        validationType: 'forward',
        closedTrades: 60,
        winRate: 65,
        netReturnPct: 12,
        grossReturnPct: 15,
        maxDrawdownPct: 9,
        periodEnd: '2026-07-31',
      }),
    ], [dailyReview(0.7)]);

    expect(summary).toMatchObject({
      status: 'established',
      evidenceRunCount: 2,
      totalClosedTrades: 100,
      weightedWinRatePct: 61,
      weightedNetReturnPct: 10.4,
      feeDragPct: 2.6,
      maxDrawdownPct: 9,
      modelConfidencePct: 70,
      confidenceGapPct: 9,
      remainingTradesToPreliminary: 0,
      latestDataDate: '2026-07-31',
    });
  });

  it('keeps stress tests out of performance evidence', () => {
    const summary = buildStrategyCalibrationSummary([
      validationRun({ validationType: 'stress', closedTrades: 300, winRate: 90 }),
    ], []);

    expect(summary).toMatchObject({
      status: 'insufficient',
      evidenceRunCount: 0,
      stressRunCount: 1,
      totalClosedTrades: 0,
      weightedWinRatePct: null,
    });
  });

  it('uses the sample thresholds and downgrades overfitting failures', () => {
    expect(buildStrategyCalibrationSummary([
      validationRun({ closedTrades: 29 }),
    ], []).status).toBe('insufficient');

    expect(buildStrategyCalibrationSummary([
      validationRun({ closedTrades: 30 }),
    ], []).status).toBe('preliminary');

    expect(buildStrategyCalibrationSummary([
      validationRun({ closedTrades: 100, overfittingPassed: false }),
    ], []).status).toBe('preliminary');
  });

  it('blocks calibration when any leakage check fails', () => {
    const summary = buildStrategyCalibrationSummary([
      validationRun({ closedTrades: 120, leakagePassed: false }),
    ], []);

    expect(summary).toMatchObject({
      status: 'blocked',
      leakageFailed: true,
    });
  });

  it('ignores non-finite metrics and averages only the latest 20 review confidences', () => {
    const reviews = Array.from({ length: 21 }, (_, index) =>
      dailyReview(index === 0 ? 0 : 0.8, `2026-07-${String(index + 1).padStart(2, '0')}`));
    const summary = buildStrategyCalibrationSummary([
      validationRun({
        closedTrades: 40,
        winRate: Number.NaN,
        netReturnPct: Number.POSITIVE_INFINITY,
      }),
    ], reviews);

    expect(summary.weightedWinRatePct).toBeNull();
    expect(summary.weightedNetReturnPct).toBeNull();
    expect(summary.modelConfidencePct).toBe(80);
    expect(summary.confidenceGapPct).toBeNull();
  });
});

