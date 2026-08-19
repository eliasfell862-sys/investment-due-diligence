import { describe, expect, it, vi } from 'vitest';
import { CloudSecuritiesRepository } from './cloud-securities-repository';

function clientWithRows(rows: Record<string, unknown[]>) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null }),
    },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        const result = Promise.resolve({ data: rows[table] ?? [], error: null });
        const query: Record<string, unknown> = {};
        query.eq = () => query;
        query.order = () => query;
        query.limit = () => result;
        query.then = result.then.bind(result);
        return query;
      }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

describe('cloud virtual capital repository', () => {
  it('loads the authoritative shared cash account with the signal runtime', async () => {
    const client = clientWithRows({
      signal_states: [], signal_alerts: [], virtual_cycles: [],
      virtual_positions: [], virtual_transactions: [],
      virtual_cash_accounts: [{
        initial_capital: '200000', cash_balance: '73120.55', reserved_cash: '500',
        version: 9, requires_cleanup: false, updated_at: '2026-08-18T02:00:00Z',
      }],
    });

    const runtime = await new CloudSecuritiesRepository(client as never).loadSignalRuntime();

    expect(runtime.virtualLedger.cashAccount).toEqual({
      initialCapital: 200000,
      cashBalance: 73120.55,
      reservedCash: 500,
      version: 9,
      updatedAt: '2026-08-18T02:00:00Z',
    });
    expect(runtime.virtualLedger.requiresCapitalCleanup).toBe(false);
  });

  it('maps immutable cloud fee and cash snapshots without re-estimating them', async () => {
    const client = clientWithRows({
      signal_states: [],
      signal_alerts: [{
        id: 'alert-a', code: '000001', name: 'A', price: 10, action: 'buy', intent: 'open',
        suggested_shares: 100, signal_at: '2026-08-18T01:00:00Z',
        message_kind: 'virtual_execution', virtual_tracking_status: 'executed',
        strategy_id: 'realtime-technical', strategy_version: '1', reasons: [], metrics: {},
      }],
      virtual_cycles: [{
        id: 'cycle-a', strategy_id: 'realtime-technical', strategy_version: '1',
        code: '000001', name: 'A', opened_at: '2026-08-18T01:00:00Z',
        closed_at: null, realized_profit: 0,
      }],
      virtual_positions: [{
        id: 'position-a', cycle_id: 'cycle-a', strategy_id: 'realtime-technical',
        strategy_version: '1', code: '000001', name: 'A', shares: 100,
        average_cost: '10.05', total_cost: '1005', opened_at: '2026-08-18T01:00:00Z',
        updated_at: '2026-08-18T01:00:00Z',
      }],
      virtual_transactions: [{
        id: 'trade-a', cycle_id: 'cycle-a', position_id: 'position-a',
        source_signal_id: 'alert-a', strategy_id: 'realtime-technical', strategy_version: '1',
        code: '000001', name: 'A', transaction_type: 'buy', shares: 100,
        price: '10', amount: '1000', gross_amount: '1000', fee_amount: '5',
        cash_delta: '-1005', cash_balance_after: '198995',
        fee_profile_snapshot: {
          commissionRate: 0.0003, minimumCommission: 5, sellStampDutyRate: 0.0005,
          transferFeeRate: 0.00001, slippageMode: 'fixed', fixedSlippageRate: 0,
          updatedAt: null,
        },
        fee_estimated: true, realized_profit: 0, traded_at: '2026-08-18T01:00:00Z',
      }],
      virtual_cash_accounts: [{
        initial_capital: '200000', cash_balance: '198995', reserved_cash: '0',
        version: 1, requires_cleanup: false, updated_at: '2026-08-18T01:00:00Z',
      }],
    });

    const runtime = await new CloudSecuritiesRepository(client as never).loadSignalRuntime();

    expect(runtime.virtualLedger.transactions[0]).toMatchObject({
      grossAmount: 1000, feeAmount: 5, cashDelta: -1005,
      cashBalanceAfter: 198995, feeEstimated: true,
      feeProfileSnapshot: { minimumCommission: 5 },
    });
  });

  it('requires the exact preview id and snapshot hash to apply cleanup', async () => {
    const client = clientWithRows({});
    client.rpc.mockResolvedValue({ data: [{
      preview_id: 'preview-1', snapshot_hash: 'sha256-value', ending_cash: '73120.55',
    }], error: null });
    const repository = new CloudSecuritiesRepository(client as never);

    await repository.previewVirtualCapitalCleanup();
    await repository.applyVirtualCapitalCleanup('preview-1', 'sha256-value');

    expect(client.rpc).toHaveBeenNthCalledWith(1, 'preview_virtual_capital_cleanup', {});
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'apply_virtual_capital_cleanup', {
      p_preview_id: 'preview-1', p_snapshot_hash: 'sha256-value',
    });
  });
});
