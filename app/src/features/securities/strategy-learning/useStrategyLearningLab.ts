import { useCallback, useEffect, useState } from 'react';
import { runDailyReviewCatchUp } from './daily-review-orchestrator';
import { strategyLearningDb } from './strategy-learning-db';
import { StrategyLearningRepository } from './strategy-learning-repository';
import { DAILY_STRATEGY_REVIEW_UPDATED_EVENT } from './useDailyStrategyReviewScheduler';
import type {
  DailyStrategyReview,
  LearningPattern,
  StrategyApproval,
  StrategyCandidate,
  TradeDecisionReview,
} from './types';

const repository = new StrategyLearningRepository(strategyLearningDb);

export function useStrategyLearningLab() {
  const [reviews, setReviews] = useState<DailyStrategyReview[]>([]);
  const [latestDecisions, setLatestDecisions] = useState<TradeDecisionReview[]>([]);
  const [patterns, setPatterns] = useState<LearningPattern[]>([]);
  const [candidates, setCandidates] = useState<StrategyCandidate[]>([]);
  const [approvals, setApprovals] = useState<StrategyApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await runDailyReviewCatchUp();
      const values = await Promise.all([
        repository.listDailyReviews(), repository.listPatterns(),
        repository.listCandidates(), repository.listApprovals(),
      ]);
      const orderedReviews = values[0].reverse();
      const decisions = orderedReviews[0]
        ? await repository.listDecisionReviews(orderedReviews[0].id)
        : [];
      setReviews(orderedReviews);
      setLatestDecisions(decisions);
      setPatterns(values[1]);
      setCandidates(values[2]);
      setApprovals(values[3].reverse());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '策略学习数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const listener = () => { void refresh(); };
    window.addEventListener(DAILY_STRATEGY_REVIEW_UPDATED_EVENT, listener);
    return () => window.removeEventListener(DAILY_STRATEGY_REVIEW_UPDATED_EVENT, listener);
  }, [refresh]);

  const exportData = useCallback(async () => repository.exportBundle(), []);
  return { reviews, latestDecisions, patterns, candidates, approvals, loading, error, refresh, exportData };
}
