import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DealProfile, Project } from '../../domain/project/project';
import { AppDb } from './app-db';
import { ProjectRepository } from './project-repository';

// 云模式 mock：session 可控（null=本地模式，有 user=云模式）
const mockState = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  cloud: {
    save: vi.fn(async (p: Project) => p),
    get: vi.fn(async () => undefined as Project | undefined),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => [] as Project[]),
  },
}));

vi.mock('../cloud/supabase-client', () => ({
  getSupabaseClient: () => ({
    auth: { getSession: async () => ({ data: { session: mockState.session } }) },
  }),
}));
vi.mock('../cloud/cloud-project-repository', () => ({
  CloudProjectRepository: function () { return mockState.cloud; },
}));

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
    vi.clearAllMocks();
    mockState.session = null; // 默认本地模式
    db = new AppDb(`test-${crypto.randomUUID()}`);
    repository = new ProjectRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  describe('cloud mode (logged in)', () => {
    beforeEach(() => {
      mockState.session = { user: { id: 'user-1' } };
    });

    it('saves through the cloud repository when a session exists', async () => {
      mockState.cloud.save.mockResolvedValue(validProject({ name: '云端项目' }));
      const saved = await repository.save(validProject({ name: '云端项目' }));

      expect(saved.name).toBe('云端项目');
      expect(mockState.cloud.save).toHaveBeenCalledTimes(1);
      // 本地 IndexedDB 不写
      expect(await db.projects.count()).toBe(0);
    });

    it('reads through the cloud repository when a session exists', async () => {
      mockState.cloud.get.mockResolvedValue(validProject({ id: 'cloud-p' }));
      const found = await repository.get('cloud-p');
      expect(found?.id).toBe('cloud-p');
      expect(mockState.cloud.get).toHaveBeenCalledWith('cloud-p');
    });

    it('deletes through the cloud repository and cleans up local storage', async () => {
      localStorage.setItem('dd-p-cloud-p-financials', '{}');
      await repository.delete('cloud-p');
      expect(mockState.cloud.delete).toHaveBeenCalledWith('cloud-p');
      expect(localStorage.getItem('dd-p-cloud-p-financials')).toBeNull();
    });

    it('lists through the cloud repository when a session exists', async () => {
      mockState.cloud.list.mockResolvedValue([validProject({ id: 'a' }), validProject({ id: 'b' })]);
      const list = await repository.list();
      expect(list.map(p => p.id)).toEqual(['a', 'b']);
      expect(mockState.cloud.list).toHaveBeenCalledTimes(1);
    });

    it('migrates local IndexedDB projects to cloud and returns the count', async () => {
      // 直接写本地 IndexedDB 播种（已登录下 repository.save 会走云）
      await db.projects.put(validProject({ id: 'local-1' }));
      await db.projects.put(validProject({ id: 'local-2' }));
      const migrated = await repository.migrateLocalProjectsToCloud();
      expect(migrated).toBe(2);
      const savedIds = mockState.cloud.save.mock.calls.map(call => (call[0] as Project).id);
      expect(savedIds).toContain('local-1');
      expect(savedIds).toContain('local-2');
    });
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
    project.dealProfile.industryTemplateIds[0] = 'consumer';

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
