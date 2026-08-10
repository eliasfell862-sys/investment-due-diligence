import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../domain/project/project';

function validProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: '示例科技',
    status: 'draft',
    currency: 'CNY',
    amountUnit: 'ten_thousand',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    dealProfile: {
      strategy: 'growth', investmentAmount: '5000', targetOwnershipPct: '10',
      targetIrrPct: '25', targetMoic: '3', holdingPeriodYears: 5, industryTemplateIds: ['saas'],
    },
    ...overrides,
  };
}

describe('CloudProjectRepository', () => {
  let calls: Array<{ op: string; args: unknown[] }>;
  let rows: unknown[];

  function fakeFrom() {
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = async () => ({ data: rows, error: null });
    chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    chain.upsert = async (payload: unknown, opts?: unknown) => {
      calls.push({ op: 'upsert', args: [payload, opts] });
      return { error: null };
    };
    chain.delete = () => chain;
    return chain;
  }

  beforeEach(() => {
    calls = [];
    rows = [];
    vi.resetModules();
    vi.doMock('./supabase-client', () => ({
      getSupabaseClient: vi.fn(() => ({
        auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
        from: (table: string) => {
          if (table !== 'projects') throw new Error(`unexpected table ${table}`);
          return fakeFrom();
        },
      })),
    }));
  });

  it('saves a project with the current user id via upsert', async () => {
    const { CloudProjectRepository: Repo } = await import('./cloud-project-repository');
    const repo = new Repo();
    const project = validProject();

    await repo.save(project);

    const upsert = calls.find(c => c.op === 'upsert');
    expect(upsert).toBeTruthy();
    const payload = (upsert!.args[0] as Record<string, unknown>);
    expect(payload).toMatchObject({
      id: 'p1', user_id: 'user-1', name: '示例科技', status: 'draft',
      updated_at: '2026-07-21T00:00:00.000Z', payload: project,
    });
  });

  it('reads the stored project payload via get', async () => {
    rows = [{ id: 'p1', payload: validProject({ name: '云端项目' }) }];
    const { CloudProjectRepository: Repo } = await import('./cloud-project-repository');
    const repo = new Repo();

    const found = await repo.get('p1');
    expect(found?.name).toBe('云端项目');
  });

  it('lists projects sorted by updated_at descending', async () => {
    rows = [
      { id: 'a', payload: validProject({ id: 'a', updatedAt: '2026-07-22T00:00:00.000Z' }) },
      { id: 'b', payload: validProject({ id: 'b', updatedAt: '2026-07-21T00:00:00.000Z' }) },
    ];
    const { CloudProjectRepository: Repo } = await import('./cloud-project-repository');
    const repo = new Repo();

    const list = await repo.list();
    expect(list.map(p => p.id)).toEqual(['a', 'b']);
  });
});
