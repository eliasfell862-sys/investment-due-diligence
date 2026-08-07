import { describe, expect, it } from 'vitest';
import type {
  MediumTermAdviceAction,
  MediumTermBuyAdvice,
} from '../../engines/market-analysis/medium-term-buy-advice';
import type {
  ShortTermAdviceAction,
  ShortTermTradingAdvice,
} from '../../engines/market-analysis/short-term-trading-advice';
import type { WatchlistAdviceTaskState } from './watchlist-buy-advice-service';
import type { WatchlistShortTermTaskState } from './watchlist-short-term-advice-service';
import {
  deriveWatchlistSortMetric,
  sortWatchlistItemsByAdvice,
} from './watchlist-score-sort';

function mediumSuccess(
  score: number,
  action: MediumTermAdviceAction,
): WatchlistAdviceTaskState {
  return {
    status: 'success',
    advice: {
      code: 'test', horizon: '1_3_months', action, label: '观察等待', score,
      confidence: 70, confidenceLabel: '中', reasons: [], risks: [],
      dataCompleteness: { quote: true, kline: true, fundamental: true },
      calculatedAt: '2026-08-07T02:00:00.000Z',
    } as MediumTermBuyAdvice,
  };
}

function shortSuccess(
  score: number,
  action: ShortTermAdviceAction,
): WatchlistShortTermTaskState {
  return {
    status: 'success',
    advice: {
      code: 'test', horizon: '3_10_trading_days', action, label: '持有观察', score,
      confidence: 70, confidenceLabel: '中', entryRange: null, stopLoss: null,
      takeProfit1: null, takeProfit2: null, maxHoldingTradingDays: null,
      riskRewardRatio: null, reasons: [], risks: [],
      dataCompleteness: { quote: true, kline: true, indicators: true, strategies: true },
      dataAsOf: '2026-08-07', calculatedAt: '2026-08-07T02:00:00.000Z', cacheStatus: 'fresh',
    } as ShortTermTradingAdvice,
  };
}

describe('watchlist score sorting', () => {
  it('weights medium at 60 percent and short at 40 percent without mutating input', () => {
    const items = [{ code: 'A' }, { code: 'B' }];
    const original = [...items];

    const result = sortWatchlistItemsByAdvice(items, {
      A: mediumSuccess(80, 'accumulate'),
      B: mediumSuccess(70, 'accumulate'),
    }, {
      A: shortSuccess(50, 'buy_on_dip'),
      B: shortSuccess(90, 'buy_on_dip'),
    });

    expect(result.map(item => item.code)).toEqual(['B', 'A']);
    expect(items).toEqual(original);
    expect(deriveWatchlistSortMetric(
      mediumSuccess(80, 'accumulate'),
      shortSuccess(50, 'buy_on_dip'),
    ).combinedScore).toBe(68);
  });

  it('uses one available score and sends failures or insufficient data to the unrated group', () => {
    expect(deriveWatchlistSortMetric(mediumSuccess(76, 'watch'), undefined)).toEqual({
      combinedScore: 76,
      priority: 'watch',
    });
    expect(deriveWatchlistSortMetric(undefined, shortSuccess(64, 'hold_watch'))).toEqual({
      combinedScore: 64,
      priority: 'watch',
    });
    expect(deriveWatchlistSortMetric({ status: 'error', error: 'failed' }, undefined)).toEqual({
      combinedScore: null,
      priority: 'unrated',
    });
    expect(deriveWatchlistSortMetric(
      mediumSuccess(99, 'insufficient_data'),
      shortSuccess(99, 'insufficient_data'),
    )).toEqual({ combinedScore: null, priority: 'unrated' });
  });

  it('uses advice priority for equal scores and preserves the original order within a tie', () => {
    const items = [
      { code: 'avoid' },
      { code: 'buy-a' },
      { code: 'watch-conflict' },
      { code: 'buy-b' },
      { code: 'unrated' },
    ];

    const result = sortWatchlistItemsByAdvice(items, {
      avoid: mediumSuccess(60, 'risk_avoidance'),
      'buy-a': mediumSuccess(60, 'accumulate'),
      'watch-conflict': mediumSuccess(60, 'watch'),
      'buy-b': mediumSuccess(60, 'cautious_buy'),
    }, {
      avoid: shortSuccess(60, 'avoid'),
      'buy-a': shortSuccess(60, 'buy_on_dip'),
      'watch-conflict': shortSuccess(60, 'reduce_sell'),
      'buy-b': shortSuccess(60, 'strong_buy'),
    });

    expect(result.map(item => item.code)).toEqual([
      'buy-a',
      'buy-b',
      'watch-conflict',
      'avoid',
      'unrated',
    ]);
  });
});
