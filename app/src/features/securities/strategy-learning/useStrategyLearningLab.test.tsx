import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  catchUp: vi.fn(async () => ({ status: 'existing' })),
  listDailyReviews: vi.fn(async () => [{
    id: 'review-1', tradingDate: '2026-08-06', strategyId: 'realtime-technical',
    strategyVersion: '1', snapshotId: 'snapshot-1', status: 'completed',
    portfolioMetrics: { returnPct: 1, maxDrawdownPct: 0, openPositions: 1, transactionCost: 0 },
    positiveFindings: [], negativeFindings: [], dataQuality: { completeness: 1, blockingIssues: [] },
    confidence: 0.8, createdAt: '2026-08-06T07:10:00.000Z', completedAt: '2026-08-06T07:15:00.000Z',
  }]),
  listDecisionReviews: vi.fn(async () => [{
    id: 'decision-1', dailyReviewId: 'review-1', code: '000001', decisionType: 'buy',
    decisionAt: '2026-08-06T02:00:00.000Z', evidence: [], positiveFindings: [],
    negativeFindings: [], attribution: {}, counterfactuals: [], improvementSuggestions: [],
    confidence: 0.8, patternKeys: [], followUpHorizons: {},
  }]),
}));

vi.mock('./daily-review-orchestrator', () => ({ runDailyReviewCatchUp: mocks.catchUp }));
vi.mock('./strategy-learning-db', () => ({ strategyLearningDb: {} }));
vi.mock('./strategy-learning-repository', () => ({
  StrategyLearningRepository: class {
    listDailyReviews = mocks.listDailyReviews;
    listDecisionReviews = mocks.listDecisionReviews;
    listPatterns = vi.fn(async () => []);
    listCandidates = vi.fn(async () => []);
    listApprovals = vi.fn(async () => []);
    exportBundle = vi.fn(async () => ({}));
  },
}));

import { useStrategyLearningLab } from './useStrategyLearningLab';

describe('useStrategyLearningLab', () => {
  it('runs the missed-review catch-up before loading the latest review decisions', async () => {
    const { result } = renderHook(() => useStrategyLearningLab());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.catchUp).toHaveBeenCalled();
    expect(mocks.listDecisionReviews).toHaveBeenCalledWith('review-1');
    expect(result.current.latestDecisions).toHaveLength(1);
  });
});
