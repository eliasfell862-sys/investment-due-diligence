import { describe, expect, it } from 'vitest';
import { createWorkerRepository } from './supabase-repository';

class Query implements PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> {
  constructor(private readonly result: { data: unknown[] | null; error: { message: string } | null }) {}
  select() { return this; }
  eq() { return this; }
  gt() { return this; }
  then<TResult1 = { data: unknown[] | null; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function client(rows: Record<string, unknown[] | Error>) {
  return {
    from(table: string) {
      const value = rows[table] ?? [];
      return new Query(value instanceof Error
        ? { data: null, error: { message: value.message } }
        : { data: value, error: null });
    },
  };
}

describe('worker Supabase repository', () => {
  it('loads complete per-user monitoring assignments', async () => {
    const repository = createWorkerRepository(client({
      watchlist_items: [{ user_id: 'user-a', code: '000001', enabled: true }],
      positions: [{ id: 'p1', user_id: 'user-a', code: '600519', name: '贵州茅台', shares: 300, average_cost: 1500, opened_at: '2026-08-01T01:30:00Z' }],
      position_lots: [{ user_id: 'user-a', position_id: 'p1', remaining_shares: 200, trading_date: '2026-08-06' }],
      virtual_positions: [{ id: 'v1', user_id: 'user-a', code: '300750', name: '宁德时代', shares: 100, average_cost: 200, opened_at: '2026-08-07T01:30:00Z', strategy_id: 'realtime-technical', strategy_version: '1' }],
      virtual_lots: [{ user_id: 'user-a', position_id: 'v1', remaining_shares: 100, trading_date: '2026-08-07' }],
      strategy_assignments: [{ user_id: 'user-a', strategy_id: 'realtime-technical', strategy_version: '1', config: {}, enabled: true }],
    }) as never, { tradingDate: () => '2026-08-07' });

    const assignments = await repository.loadMonitoringAssignments();

    expect(assignments).toHaveLength(1);
    expect(assignments[0].watchlistCodes).toEqual(['000001']);
    expect(assignments[0].actualPositions[0]).toMatchObject({ code: '600519', availableShares: 200 });
    expect(assignments[0].virtualPositions[0]).toMatchObject({ code: '300750', availableShares: 0 });
  });

  it('rejects the whole load when any required table fails', async () => {
    const repository = createWorkerRepository(client({ positions: new Error('positions unavailable') }) as never);
    await expect(repository.loadMonitoringAssignments()).rejects.toThrow('positions unavailable');
  });
});
