import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrategyLearningDb } from './strategy-learning-db';
import { StrategyLearningRepository } from './strategy-learning-repository';
import type { AuditEvent, DailyStrategyReview } from './types';

const review = (id: string): DailyStrategyReview => ({
  id,
  tradingDate: '2026-08-06',
  strategyId: 'realtime-technical',
  strategyVersion: '1',
  snapshotId: 'snapshot-1',
  status: 'completed',
  portfolioMetrics: {
    returnPct: 1.2,
    maxDrawdownPct: 0.4,
    openPositions: 2,
    transactionCost: 8.6,
  },
  positiveFindings: [],
  negativeFindings: [],
  dataQuality: { completeness: 1, blockingIssues: [] },
  confidence: 0.9,
  createdAt: '2026-08-06T07:10:00.000Z',
  completedAt: '2026-08-06T07:11:00.000Z',
});

const audit = (id: string, value: number): AuditEvent => ({
  id,
  entityType: 'settings',
  entityId: 'promotion-gates',
  eventType: 'updated',
  payload: { value },
  createdAt: `2026-08-06T07:1${value}:00.000Z`,
});

describe('StrategyLearningRepository', () => {
  let db: StrategyLearningDb;
  let repository: StrategyLearningRepository;

  beforeEach(() => {
    db = new StrategyLearningDb(`test-strategy-learning-${crypto.randomUUID()}`);
    repository = new StrategyLearningRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('stores one review per date and strategy version', async () => {
    await repository.saveDailyReview(review('review-1'));

    await expect(repository.saveDailyReview(review('review-2')))
      .rejects.toThrow('该交易日和策略版本已经完成复盘');
  });

  it('clones values when saving and reading', async () => {
    const input = review('review-1');
    await repository.saveDailyReview(input);
    input.portfolioMetrics.returnPct = 99;

    const stored = await repository.getDailyReview('review-1');
    expect(stored?.portfolioMetrics.returnPct).toBe(1.2);

    if (stored) stored.portfolioMetrics.returnPct = 88;
    expect((await repository.getDailyReview('review-1'))?.portfolioMetrics.returnPct).toBe(1.2);
  });

  it('keeps audit events append-only', async () => {
    await repository.appendAudit(audit('audit-1', 2));
    await repository.appendAudit(audit('audit-2', 3));

    expect(await repository.listAuditEvents('settings', 'promotion-gates')).toHaveLength(2);
    await expect(repository.appendAudit(audit('audit-1', 4)))
      .rejects.toThrow('审计事件只允许追加');
  });

  it('exports every table deterministically', async () => {
    await repository.appendAudit(audit('audit-b', 3));
    await repository.appendAudit(audit('audit-a', 2));
    await repository.saveDailyReview(review('review-1'));

    const first = await repository.exportBundle();
    const second = await repository.exportBundle();

    expect(second).toEqual(first);
    expect(first.schemaVersion).toBe(1);
    expect(first.auditEvents.map(({ id }) => id)).toEqual(['audit-a', 'audit-b']);
  });
});
