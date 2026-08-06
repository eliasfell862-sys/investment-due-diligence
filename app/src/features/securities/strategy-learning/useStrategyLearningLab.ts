import { useCallback, useEffect, useState } from 'react';
import { strategyLearningDb } from './strategy-learning-db';
import { StrategyLearningRepository } from './strategy-learning-repository';
import type { DailyStrategyReview, LearningPattern, StrategyApproval, StrategyCandidate } from './types';

const repository = new StrategyLearningRepository(strategyLearningDb);

export function useStrategyLearningLab() {
  const [reviews, setReviews] = useState<DailyStrategyReview[]>([]);
  const [patterns, setPatterns] = useState<LearningPattern[]>([]);
  const [candidates, setCandidates] = useState<StrategyCandidate[]>([]);
  const [approvals, setApprovals] = useState<StrategyApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const values = await Promise.all([
        repository.listDailyReviews(), repository.listPatterns(),
        repository.listCandidates(), repository.listApprovals(),
      ]);
      setReviews(values[0].reverse());
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

  const exportData = useCallback(async () => repository.exportBundle(), []);
  return { reviews, patterns, candidates, approvals, loading, error, refresh, exportData };
}
