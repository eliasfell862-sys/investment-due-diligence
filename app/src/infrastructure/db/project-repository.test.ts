import { afterEach, describe, expect, it } from 'vitest';
import { AppDb } from './app-db';
import { ProjectRepository } from './project-repository';

describe('ProjectRepository', () => {
  const db = new AppDb(`test-${crypto.randomUUID()}`);
  const repository = new ProjectRepository(db);

  afterEach(async () => {
    await db.projects.clear();
  });

  it('saves and retrieves a project', async () => {
    await repository.save({
      id: 'p1',
      name: '示例科技',
      status: 'draft',
      currency: 'CNY',
      amountUnit: 'ten_thousand',
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
      dealProfile: {
        strategy: 'growth',
        investmentAmount: '5000',
        targetOwnershipPct: '10',
        targetIrrPct: '25',
        targetMoic: '3',
        holdingPeriodYears: 5,
        industryTemplateIds: ['saas'],
      },
    });

    expect((await repository.get('p1'))?.name).toBe('示例科技');
  });
});
