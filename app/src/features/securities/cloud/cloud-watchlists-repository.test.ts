import { describe, expect, it, vi } from 'vitest';
import { CloudSecuritiesRepository } from './cloud-securities-repository';

function client(rows: Record<string, unknown[]> = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null }) },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: rows[table] ?? [], error: null }),
      })),
    })),
    rpc,
  };
}

describe('CloudSecuritiesRepository watchlists', () => {
  it('reconstructs watchlist groups and code labels from cloud metadata', async () => {
    const service = client({
      watchlists: [{
        id: 'cloud-wl-1', source_id: 'wl-1', name: '核心', created_at: '2026-08-01T00:00:00Z',
        metadata: { groups: [{ id: 'g1', name: '价值', color: '#abc' }], codeGroups: { '000001': ['g1'] } },
      }],
      watchlist_items: [
        { watchlist_id: 'cloud-wl-1', code: '600519' },
        { watchlist_id: 'cloud-wl-1', code: '000001' },
      ],
    });
    const repository = new CloudSecuritiesRepository(service as never);

    const watchlists = await repository.loadWatchlists();

    expect(watchlists).toEqual([{
      id: 'wl-1', name: '核心', createdAt: '2026-08-01T00:00:00Z',
      codes: ['000001', '600519'],
      groups: [{ id: 'g1', name: '价值', color: '#abc' }],
      codeGroups: { '000001': ['g1'] },
    }]);
  });

  it('saves the complete watchlist set through one authenticated RPC', async () => {
    const service = client();
    const repository = new CloudSecuritiesRepository(service as never);

    await repository.saveWatchlists([{
      id: 'wl-1', name: '核心', createdAt: '2026-08-01T00:00:00Z', codes: ['600519', '000001'],
      groups: [{ id: 'g1', name: '价值', color: '#abc' }], codeGroups: { '000001': ['g1'] },
    }]);

    expect(service.rpc).toHaveBeenCalledWith('replace_cloud_watchlists', {
      p_payload: { watchlists: [{
        source_id: 'wl-1', name: '核心', created_at: '2026-08-01T00:00:00Z',
        codes: ['000001', '600519'],
        metadata: { groups: [{ id: 'g1', name: '价值', color: '#abc' }], codeGroups: { '000001': ['g1'] } },
      }] },
    });
  });
});
