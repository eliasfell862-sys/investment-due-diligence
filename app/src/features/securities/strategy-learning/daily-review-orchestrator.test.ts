import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockKLine } from '../../../infrastructure/market-data/stock-api';
import { createEmptyVirtualTradingLedger, buyVirtualPosition } from '../virtual-trading-ledger';
import { StrategyLearningDb } from './strategy-learning-db';
import { StrategyLearningRepository } from './strategy-learning-repository';
import { DEFAULT_TECHNICAL_STRATEGY_CONFIG } from './technical-strategy-config';
import {
  latestClosedAStockTradingDate,
  runDailyReviewCatchUp,
  runDailyReviewCatchUpFromCloudState,
  type DailyReviewOrchestratorDependencies,
} from './daily-review-orchestrator';

const bar = (date: string): StockKLine => ({
  date, open: 10, close: 10.1, high: 10.2, low: 9.9, volume: 1_000, amount: 10_000,
});

describe('daily review orchestrator', () => {
  let db: StrategyLearningDb;
  let repository: StrategyLearningRepository;
  let dependencies: DailyReviewOrchestratorDependencies;

  beforeEach(() => {
    db = new StrategyLearningDb(`daily-orchestrator-${crypto.randomUUID()}`);
    repository = new StrategyLearningRepository(db);
    const virtualLedger = buyVirtualPosition(createEmptyVirtualTradingLedger(), {
      sourceSignalId: 'signal-1', strategyId: 'realtime-technical', strategyVersion: '1',
      code: '000001', name: '平安银行', shares: 100, price: 10,
      tradedAt: '2026-08-06T02:00:00.000Z', reasons: ['RSI超卖'],
    }, { createId: kind => `${kind}-1` }).ledger;
    dependencies = {
      repository,
      now: () => new Date('2026-08-06T07:20:00.000Z'),
      getStrategyConfig: vi.fn(async () => DEFAULT_TECHNICAL_STRATEGY_CONFIG),
      loadUniverse: vi.fn(() => ({ buyCodes: ['000001'], heldCodes: [], allCodes: ['000001'] })),
      loadActualLedger: vi.fn(() => ({ version: 1 as const, groups: [], positions: [], transactions: [] })),
      loadVirtualLedger: vi.fn(() => virtualLedger),
      loadBars: vi.fn(async (_code, _limit) => [
        ...Array.from({ length: 59 }, (_, index) => bar(`2026-07-${String(index % 28 + 1).padStart(2, '0')}`)),
        bar('2026-08-06'),
      ]),
    };
  });

  afterEach(async () => { await db.delete(); });

  it('uses today after 15:10 Shanghai time and the previous trading day before close', () => {
    expect(latestClosedAStockTradingDate(new Date('2026-08-06T07:20:00.000Z'))).toBe('2026-08-06');
    expect(latestClosedAStockTradingDate(new Date('2026-08-06T06:00:00.000Z'))).toBe('2026-08-05');
    expect(latestClosedAStockTradingDate(new Date('2026-08-08T03:00:00.000Z'))).toBe('2026-08-07');
  });

  it('creates the latest closed-day review once and returns the stored review on retry', async () => {
    const first = await runDailyReviewCatchUp(dependencies);
    const second = await runDailyReviewCatchUp(dependencies);

    expect(first.status).toBe('created');
    expect(first.review.tradingDate).toBe('2026-08-06');
    expect(first.decisions).toHaveLength(1);
    expect(second.status).toBe('existing');
    expect(await db.dailyReviews.count()).toBe(1);
    expect(dependencies.loadBars).toHaveBeenCalledTimes(1);
  });
  it('builds a review from the authenticated cloud securities state', async () => {
    const cloudVirtualLedger = buyVirtualPosition(createEmptyVirtualTradingLedger(), {
      sourceSignalId: 'cloud-signal-1', strategyId: 'realtime-technical', strategyVersion: '1',
      code: '300750', name: '宁德时代', shares: 100, price: 200,
      tradedAt: '2026-08-06T02:00:00.000Z', reasons: ['云端回测买点'],
    }, { createId: kind => `cloud-${kind}-1` }).ledger;
    const cloudSource = {
      loadWatchlists: vi.fn(async () => [{ codes: ['300750'] }]),
      loadPositionLedger: vi.fn(async () => ({
        version: 1 as const, groups: [], positions: [], transactions: [],
      })),
      loadSignalRuntime: vi.fn(async () => ({
        version: 3 as const, alerts: [], stocks: {}, virtualLedger: cloudVirtualLedger,
      })),
    };

    const result = await runDailyReviewCatchUpFromCloudState(cloudSource, {
      ...dependencies,
      loadBars: vi.fn(async () => [bar('2026-08-06')]),
    });

    expect(result.status).toBe('created');
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.code).toBe('300750');
    expect(cloudSource.loadWatchlists).toHaveBeenCalledOnce();
    expect(cloudSource.loadPositionLedger).toHaveBeenCalledOnce();
    expect(cloudSource.loadSignalRuntime).toHaveBeenCalledOnce();
  });
});
