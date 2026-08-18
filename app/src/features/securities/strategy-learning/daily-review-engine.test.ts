import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrategyLearningDb } from './strategy-learning-db';
import { StrategyLearningRepository } from './strategy-learning-repository';
import { runDailyStrategyReview } from './daily-review-engine';
import type { StrategyLearningSnapshot } from './types';
import type { VirtualTradingLedger } from '../virtual-trading-ledger';

const snapshot = (): StrategyLearningSnapshot => ({
  id: 'snapshot-1', tradingDate: '2026-08-06', strategyId: 'realtime-technical',
  strategyVersion: '1', capturedAt: '2026-08-06T07:10:00.000Z', inputHash: 'hash',
  strategyConfig: { strategyId: 'realtime-technical', version: '1', buyScoreThreshold: 1,
    sellScoreThreshold: 1, weights: { macd: 1, kdj: 1, rsi: 1, boll: 1, ma20: 1 },
    kdjBuyThreshold: 20, kdjSellThreshold: 85, rsiBuyThreshold: 30,
    bollTolerancePct: 1, stopLossPct: 8, maxHoldingDays: 60 },
  stocks: { '000001': { code: '000001', bars: [{ date: '2026-08-06', open: 10,
    close: 10.1, high: 10.2, low: 9.9, volume: 1000, amount: 10000,
    rsi: { rsi6: 26 }, atr: 0.3 } as never] } },
  watchlistCodes: ['000001'], actualPositions: [], marketRegime: 'sideways',
  dataSources: ['fixture'], dataQuality: { completeness: 1, blockingIssues: [] },
  virtualLedger: {}, payload: {},
});

const ledger: VirtualTradingLedger = {
  version: 2,
  cashAccount: {
    initialCapital: 200000, cashBalance: 199000, reservedCash: 0,
    version: 1, updatedAt: '2026-08-06T02:00:00.000Z',
  },
  requiresCapitalCleanup: false, positions: [], cycles: [], transactions: [{
    id: 'trade-1', sourceSignalId: 'signal-1', cycleId: 'cycle-1',
    strategyId: 'realtime-technical', strategyVersion: '1', code: '000001', name: '平安银行',
    type: 'buy', intent: 'open', shares: 100, price: 10, amount: 1000,
    tradedAt: '2026-08-06T02:00:00.000Z', positionSharesAfter: 100,
    availableSharesAfter: 0, realizedProfit: 0, reasons: ['RSI超卖'],
  }],
};

describe('runDailyStrategyReview', () => {
  let db: StrategyLearningDb;
  let repository: StrategyLearningRepository;
  beforeEach(() => { db = new StrategyLearningDb(`review-${crypto.randomUUID()}`); repository = new StrategyLearningRepository(db); });
  afterEach(async () => { await db.delete(); });

  it('persists one review and its decision attribution idempotently', async () => {
    const first = await runDailyStrategyReview({ repository, snapshot: snapshot(), ledger });
    const second = await runDailyStrategyReview({ repository, snapshot: snapshot(), ledger });

    expect(second.review.id).toBe(first.review.id);
    expect(first.decisions).toHaveLength(1);
    expect(await db.dailyReviews.count()).toBe(1);
    expect(await db.decisionReviews.count()).toBe(1);
    expect(await db.snapshots.count()).toBe(1);
  });
});
