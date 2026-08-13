import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import {
  useRealtimeBacktestMonitor,
  type UseRealtimeBacktestMonitorResult,
} from './useRealtimeBacktestMonitor';
import { useDailyStrategyReviewScheduler } from './strategy-learning/useDailyStrategyReviewScheduler';
import {
  runDailyReviewCatchUp,
  runDailyReviewCatchUpFromCloudState,
  runDailyReviewCatchUpFromSnapshot,
} from './strategy-learning/daily-review-orchestrator';
import { useOptionalAuth } from '../auth/AuthProvider';
import { createCloudSecuritiesRepository } from './cloud/cloud-securities-repository';
import { useOptionalSecuritiesState } from './state/securities-state-context';

const RealtimeBacktestMonitorContext = createContext<UseRealtimeBacktestMonitorResult | null>(null);

export interface RealtimeBacktestMonitorProviderProps {
  children: ReactNode;
}

export function RealtimeBacktestMonitorProvider({ children }: RealtimeBacktestMonitorProviderProps) {
  const monitor = useRealtimeBacktestMonitor();
  const auth = useOptionalAuth();
  const securitiesState = useOptionalSecuritiesState();
  const cloudMode = Boolean(auth?.cloudEnabled && auth.user);
  const cloudRepository = useMemo(
    () => cloudMode ? createCloudSecuritiesRepository() : null,
    [cloudMode],
  );
  const runReviewCatchUp = useCallback(
    () => cloudRepository
      ? securitiesState
        ? runDailyReviewCatchUpFromSnapshot({
          watchlists: securitiesState.watchlists.data,
          positionLedger: securitiesState.positions.data,
        }, cloudRepository)
        : runDailyReviewCatchUpFromCloudState(cloudRepository)
      : runDailyReviewCatchUp(),
    [cloudRepository, securitiesState],
  );
  useDailyStrategyReviewScheduler({ runCatchUp: runReviewCatchUp });
  return (
    <RealtimeBacktestMonitorContext.Provider value={monitor}>
      {children}
    </RealtimeBacktestMonitorContext.Provider>
  );
}

export function useOptionalRealtimeBacktestMonitorContext(): UseRealtimeBacktestMonitorResult | null {
  return useContext(RealtimeBacktestMonitorContext);
}

export function useRealtimeBacktestMonitorContext(): UseRealtimeBacktestMonitorResult {
  const monitor = useContext(RealtimeBacktestMonitorContext);
  if (!monitor) {
    throw new Error('useRealtimeBacktestMonitorContext必须在RealtimeBacktestMonitorProvider内使用');
  }
  return monitor;
}
