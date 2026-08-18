import { describe, expect, it, vi } from 'vitest';
import { emptySignalCycleState } from '../src/engines/market-analysis/signal-cycle-state';
import { createWorkerRuntimeRepository } from './runtime-repository';

describe('worker runtime repository', () => {
  it('writes lease, state, heartbeat, scan summary, and signal RPC payloads', async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === 'claim_worker_lease' ? true : 'alert-1', error: null }));
    const upserts: Array<{ table: string; value: unknown }> = [];
    const inserts: Array<{ table: string; value: unknown }> = [];
    const client = {
      rpc,
      from(table: string) {
        return {
          upsert: async (value: unknown) => { upserts.push({ table, value }); return { data: null, error: null }; },
          insert: async (value: unknown) => { inserts.push({ table, value }); return { data: null, error: null }; },
        };
      },
    };
    const repository = createWorkerRuntimeRepository(client as never, {
      workerName: 'cloud-signal-monitor', ownerId: 'worker-a', workerVersion: '1',
      assignmentRepository: { loadMonitoringAssignments: async () => [] },
    });

    expect(await repository.claimLease()).toBe(true);
    await repository.saveSignalState('user-a', {
      ...emptySignalCycleState('000001', 'realtime-technical', '1'), updatedAt: '2026-08-07T01:30:00Z',
    });
    await repository.writeHeartbeat('running', { market: 'trading' });
    await repository.recordScan({
      uniqueCodes: 1, assignmentCount: 1, successCount: 1, failureCount: 0,
      openedSignals: 0, durationMs: 10, quoteAt: '2026-08-07T01:30:00Z',
    });
    expect(await repository.commitSignal({ code: '000001' })).toBe('alert-1');

    expect(rpc).toHaveBeenCalledWith('claim_worker_lease', expect.objectContaining({ p_owner_id: 'worker-a' }));
    expect(upserts.map(item => item.table)).toEqual(['signal_states', 'worker_heartbeats']);
    expect(inserts[0].table).toBe('scan_runs');
    expect(rpc).toHaveBeenCalledWith('commit_signal_transition', { p_payload: { code: '000001' } });
  });

  it('commits T signals and expires T cycles through isolated RPCs', async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name === 'commit_t_trade_signal' ? 't-alert-1'
        : name === 'commit_virtual_t_trade' ? 'virtual-t-alert-1'
          : 2,
      error: null,
    }));
    const repository = createWorkerRuntimeRepository({
      rpc,
      from: () => ({ upsert: vi.fn(), insert: vi.fn() }),
    } as never, {
      workerName: 'cloud-signal-monitor', ownerId: 'worker-a', workerVersion: '1',
      assignmentRepository: { loadMonitoringAssignments: async () => [] },
    });

    expect(await repository.commitTTradeSignal({ signal_kind: 'actual_t_sell' })).toBe('t-alert-1');
    expect(await repository.expireTTradeCycles('2026-08-11T07:00:00Z')).toBe(2);
    expect(await repository.commitTTradeSignal({
      position_scope: 'virtual', signal_kind: 'virtual_t_sell',
    })).toBe('virtual-t-alert-1');
    expect(rpc).toHaveBeenCalledWith('commit_t_trade_signal', {
      p_payload: { signal_kind: 'actual_t_sell' },
    });
    expect(rpc).toHaveBeenCalledWith('commit_virtual_t_trade', {
      p_payload: { position_scope: 'virtual', signal_kind: 'virtual_t_sell' },
    });
    expect(rpc).toHaveBeenCalledWith('expire_t_trade_cycles', {
      p_as_of: '2026-08-11T07:00:00Z',
    });
  });

});
