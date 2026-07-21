import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DealProfile, Project } from '../../domain/project/project';
import { AppDb } from './app-db';
import { ProjectRepository } from './project-repository';

type ProjectOverrides = Omit<Partial<Project>, 'dealProfile'> & {
  dealProfile?: Partial<DealProfile>;
};

function validProject(overrides: ProjectOverrides = {}): Project {
  return {
    id: 'p1',
    name: '示例科技',
    status: 'draft',
    currency: 'CNY',
    amountUnit: 'ten_thousand',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    ...overrides,
    dealProfile: {
      strategy: 'growth',
      investmentAmount: '5000',
      targetOwnershipPct: '10',
      targetIrrPct: '25',
      targetMoic: '3',
      holdingPeriodYears: 5,
      industryTemplateIds: ['saas'],
      ...overrides.dealProfile,
    },
  };
}

describe('ProjectRepository', () => {
  let db: AppDb;
  let repository: ProjectRepository;

  beforeEach(() => {
    db = new AppDb(`test-${crypto.randomUUID()}`);
    repository = new ProjectRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('returns and persists a canonical clone of the project', async () => {
    const project = validProject({
      name: '  示例科技  ',
      createdAt: '2026-07-21T00:00:00Z',
      updatedAt: '2026-07-21T00:00:00.1Z',
    });

    const saved = await repository.save(project);

    expect(saved).toMatchObject({
      name: '示例科技',
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.100Z',
    });

    project.name = '被调用方修改';
    project.dealProfile.industryTemplateIds[0] = 'changed';

    expect(await repository.get(project.id)).toMatchObject({
      name: '示例科技',
      dealProfile: { industryTemplateIds: ['saas'] },
    });
  });

  it('rejects an invalid save without corrupting the existing row', async () => {
    const existing = await repository.save(validProject());

    await expect(
      repository.save(validProject({ name: '   ' })),
    ).rejects.toThrow();

    expect(await repository.get(existing.id)).toEqual(existing);
  });

  it('upserts a project with the same id', async () => {
    await repository.save(validProject({ name: '旧名称' }));

    const replacement = await repository.save(
      validProject({
        name: '新名称',
        updatedAt: '2026-07-22T00:00:00Z',
      }),
    );

    expect(await repository.get(replacement.id)).toEqual(replacement);
    expect(await db.projects.count()).toBe(1);
  });

  it('lists projects newest first with deterministic id ordering for ties', async () => {
    await repository.save(
      validProject({ id: 'older', updatedAt: '2026-07-21T00:00:00Z' }),
    );
    await repository.save(
      validProject({ id: 'newer', updatedAt: '2026-07-21T00:00:00.100Z' }),
    );
    await repository.save(
      validProject({ id: 'tie-b', updatedAt: '2026-07-21T00:00:00.200Z' }),
    );
    await repository.save(
      validProject({ id: 'tie-a', updatedAt: '2026-07-21T00:00:00.200Z' }),
    );

    expect((await repository.list()).map(({ id }) => id)).toEqual([
      'tie-a',
      'tie-b',
      'newer',
      'older',
    ]);
  });
});
