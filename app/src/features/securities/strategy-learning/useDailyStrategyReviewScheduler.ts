import { useCallback, useEffect, useRef } from 'react';
import { runDailyReviewCatchUp } from './daily-review-orchestrator';

export const DAILY_STRATEGY_REVIEW_UPDATED_EVENT = 'sec-daily-strategy-review-updated';
export const DAILY_STRATEGY_REVIEW_ERROR_EVENT = 'sec-daily-strategy-review-error';

export interface DailyStrategyReviewSchedulerOptions {
  runCatchUp?: () => Promise<{ status: string }>;
  intervalMs?: number;
}

export function useDailyStrategyReviewScheduler(
  options: DailyStrategyReviewSchedulerOptions = {},
): void {
  const runCatchUp = options.runCatchUp ?? runDailyReviewCatchUp;
  const intervalMs = options.intervalMs ?? 60_000;
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const result = await runCatchUp();
      if (result.status === 'created' && typeof window !== 'undefined') {
        window.dispatchEvent(new Event(DAILY_STRATEGY_REVIEW_UPDATED_EVENT));
      }
    } catch (error) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(DAILY_STRATEGY_REVIEW_ERROR_EVENT, {
          detail: error instanceof Error ? error.message : String(error),
        }));
      }
    } finally {
      runningRef.current = false;
    }
  }, [runCatchUp]);

  useEffect(() => {
    void run();
    const timer = window.setInterval(() => { void run(); }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, run]);
}
