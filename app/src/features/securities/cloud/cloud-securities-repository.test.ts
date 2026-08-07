import { describe, expect, it, vi } from 'vitest';
import { calculateStockPositionAvailability } from '../stock-position-availability';
import { CloudSecuritiesRepository } from './cloud-securities-repository';

function fakeClient(rows: Record<string, unknown[]>) {
  const eq = vi.fn((table: string, column: string, value: string) => {
    expect(column).toBe('user_id');
    expect(value).toBe('user-a');
    return Promise.resolve({ data: rows[table] ?? [], error: null });
  });
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null }),
    },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({ eq: (column: string, value: string) => eq(table, column, value) })),
    })),
    rpc: vi.fn(),
    _eq: eq,
  };
}

describe('CloudSecuritiesRepository', () => {
  it('maps cloud rows into the existing actual-position ledger with T+1 history', async () => {
    const client = fakeClient({
      position_groups: [{ id: 'group-cloud', source_id: 'core', name: '核心持仓' }],
      positions: [{
        id: 'position-cloud', source_id: 'position-1', group_id: 'group-cloud',
        code: '000001', name: '平安银行', shares: 300, average_cost: '10.50',
        total_cost: '3150', opened_at: '2026-08-06T01:30:00.000Z', updated_at: '2026-08-07T02:00:00.000Z',
      }],
      position_transactions: [
        {
          id: 'transaction-cloud-1', source_id: 'tx-1', group_id: 'group-cloud',
          code: '000001', name: '平安银行', transaction_type: 'buy', shares: 200,
          price: '10', amount: '2000', traded_at: '2026-08-06T01:30:00.000Z',
          source_alert_id: null, realized_profit: '0',
        },
        {
          id: 'transaction-cloud-2', source_id: 'tx-2', group_id: 'group-cloud',
          code: '000001', name: '平安银行', transaction_type: 'buy', shares: 100,
          price: '11.5', amount: '1150', traded_at: '2026-08-07T01:30:00.000Z',
          source_alert_id: 'alert-cloud', realized_profit: '0',
        },
      ],
    });
    const repository = new CloudSecuritiesRepository(client as never);

    const ledger = await repository.loadPositionLedger();

    expect(ledger.positions[0]).toMatchObject({ code: '000001', shares: 300, groupId: 'core' });
    expect(calculateStockPositionAvailability(ledger, '000001', '2026-08-07T03:00:00.000Z'))
      .toMatchObject({ totalShares: 300, availableShares: 200 });
  });

  it('maps cloud alerts to the current inbox shape', async () => {
    const client = fakeClient({
      signal_alerts: [{
        id: 'alert-cloud', code: '600519', name: '贵州茅台', price: '1500', action: 'sell',
        intent: 'reduce', suggested_shares: 100, position_shares_at_signal: 300,
        available_shares_at_signal: 200, reasons: ['止盈条件触发'], metrics: { winRate: 0.6 },
        entry_price: '1300', stop_loss: '1200', signal_at: '2026-08-07T02:00:00.000Z',
        status: 'pending', read_at: null, executed_at: null, message_kind: 'actual_position_risk',
        virtual_tracking_status: 'actual_risk_only', virtual_trade_id: null, virtual_cycle_id: null,
        virtual_shares: 0, virtual_price: null, virtual_position_shares_after: null,
        virtual_available_shares_after: null, strategy_id: 'realtime', strategy_version: '3',
      }],
    });
    const repository = new CloudSecuritiesRepository(client as never);

    const alerts = await repository.loadSignalAlerts();

    expect(alerts[0]).toMatchObject({
      id: 'alert-cloud', code: '600519', action: 'sell', intent: 'reduce',
      suggestedShares: 100, availableSharesAtSignal: 200, strategyVersion: '3',
    });
  });
});
