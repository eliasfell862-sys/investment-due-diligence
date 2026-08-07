import type { MediumTermAdviceAction } from '../../engines/market-analysis/medium-term-buy-advice';
import type { ShortTermAdviceAction } from '../../engines/market-analysis/short-term-trading-advice';
import type { WatchlistAdviceTaskState } from './watchlist-buy-advice-service';
import type { WatchlistShortTermTaskState } from './watchlist-short-term-advice-service';

export type WatchlistAdvicePriority = 'buy' | 'watch' | 'avoid' | 'unrated';

export interface WatchlistSortMetric {
  combinedScore: number | null;
  priority: WatchlistAdvicePriority;
}

type AdviceAction = MediumTermAdviceAction | ShortTermAdviceAction;

const PRIORITY_RANK: Record<WatchlistAdvicePriority, number> = {
  buy: 0,
  watch: 1,
  avoid: 2,
  unrated: 3,
};

function actionPriority(action: AdviceAction): WatchlistAdvicePriority {
  if (
    action === 'accumulate'
    || action === 'cautious_buy'
    || action === 'strong_buy'
    || action === 'buy_on_dip'
  ) return 'buy';
  if (action === 'watch' || action === 'hold_watch') return 'watch';
  if (
    action === 'avoid_buying'
    || action === 'risk_avoidance'
    || action === 'avoid'
    || action === 'reduce_sell'
  ) return 'avoid';
  return 'unrated';
}

function validMedium(state: WatchlistAdviceTaskState | undefined) {
  return state?.status === 'success' && state.advice.action !== 'insufficient_data'
    ? state.advice
    : null;
}

function validShort(state: WatchlistShortTermTaskState | undefined) {
  return state?.status === 'success' && state.advice.action !== 'insufficient_data'
    ? state.advice
    : null;
}

export function deriveWatchlistSortMetric(
  mediumState: WatchlistAdviceTaskState | undefined,
  shortState: WatchlistShortTermTaskState | undefined,
): WatchlistSortMetric {
  const medium = validMedium(mediumState);
  const short = validShort(shortState);
  if (!medium && !short) return { combinedScore: null, priority: 'unrated' };

  const combinedScore = medium && short
    ? medium.score * 0.6 + short.score * 0.4
    : medium?.score ?? short?.score ?? null;
  const priorities = [medium?.action, short?.action]
    .filter((action): action is AdviceAction => Boolean(action))
    .map(actionPriority);
  const priority = priorities.reduce<WatchlistAdvicePriority>((best, current) => (
    PRIORITY_RANK[current] < PRIORITY_RANK[best] ? current : best
  ), 'unrated');

  return { combinedScore, priority };
}

export function sortWatchlistItemsByAdvice<T extends { code: string }>(
  items: readonly T[],
  mediumStates: Readonly<Record<string, WatchlistAdviceTaskState>>,
  shortStates: Readonly<Record<string, WatchlistShortTermTaskState>>,
): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      metric: deriveWatchlistSortMetric(mediumStates[item.code], shortStates[item.code]),
    }))
    .sort((left, right) => {
      const leftRated = left.metric.combinedScore !== null;
      const rightRated = right.metric.combinedScore !== null;
      if (leftRated !== rightRated) return leftRated ? -1 : 1;
      if (left.metric.combinedScore !== right.metric.combinedScore) {
        return (right.metric.combinedScore ?? 0) - (left.metric.combinedScore ?? 0);
      }
      const priorityDifference = PRIORITY_RANK[left.metric.priority] - PRIORITY_RANK[right.metric.priority];
      return priorityDifference || left.index - right.index;
    })
    .map(entry => entry.item);
}
