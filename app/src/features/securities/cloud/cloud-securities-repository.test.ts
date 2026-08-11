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
  it('rebuilds the signal runtime and virtual ledger from cloud tables', async () => {
    const client = fakeClient({
      signal_states: [{
        code: '300750', strategy_id: 'realtime-technical', strategy_version: '1',
        buy_direction: 'buy', sell_direction: 'hold',
        pending_virtual_sell: null, updated_at: '2026-08-07T02:00:00.000Z',
      }],
      signal_alerts: [{
        id: 'alert-cloud', code: '300750', name: 'CATL', price: '200', action: 'buy',
        intent: 'open', suggested_shares: 100, position_shares_at_signal: 0,
        available_shares_at_signal: 0, reasons: ['breakout'], metrics: {},
        entry_price: '200', stop_loss: '184', signal_at: '2026-08-06T02:00:00.000Z',
        status: 'pending', read_at: null, executed_at: null, message_kind: 'virtual_execution',
        virtual_tracking_status: 'executed', virtual_trade_id: 'trade-cloud',
        virtual_cycle_id: 'cycle-cloud', virtual_shares: 100, virtual_price: '200',
        virtual_position_shares_after: 100, virtual_available_shares_after: 0,
        strategy_id: 'realtime-technical', strategy_version: '1',
      }],
      virtual_cycles: [{
        id: 'cycle-cloud', strategy_id: 'realtime-technical', strategy_version: '1',
        code: '300750', name: 'CATL', opened_at: '2026-08-06T02:00:00.000Z',
        closed_at: null, realized_profit: '0',
      }],
      virtual_positions: [{
        id: 'position-cloud', cycle_id: 'cycle-cloud', strategy_id: 'realtime-technical',
        strategy_version: '1', code: '300750', name: 'CATL', shares: 100,
        average_cost: '200', total_cost: '20000', opened_at: '2026-08-06T02:00:00.000Z',
        updated_at: '2026-08-06T02:00:00.000Z',
      }],
      virtual_transactions: [{
        id: 'trade-cloud', cycle_id: 'cycle-cloud', position_id: 'position-cloud',
        source_signal_id: 'alert-cloud', strategy_id: 'realtime-technical', strategy_version: '1',
        code: '300750', name: 'CATL', transaction_type: 'buy', shares: 100,
        price: '200', amount: '20000', realized_profit: '0',
        traded_at: '2026-08-06T02:00:00.000Z',
      }],
    });
    const repository = new CloudSecuritiesRepository(client as never);
    const runtime = await repository.loadSignalRuntime();
    expect(runtime.stocks['300750']).toMatchObject({
      lastBuyDecision: 'buy', lastSellDecision: 'hold',
      updatedAt: '2026-08-07T02:00:00.000Z',
    });
    expect(runtime.alerts).toHaveLength(1);
    expect(runtime.virtualLedger.positions[0]).toMatchObject({
      id: 'position-cloud', cycleId: 'cycle-cloud', shares: 100,
      sourceTradeIds: ['trade-cloud'],
    });
    expect(runtime.virtualLedger.transactions[0]).toMatchObject({
      id: 'trade-cloud', sourceSignalId: 'alert-cloud', intent: 'open',
      positionSharesAfter: 100,
    });
    expect(runtime.virtualLedger.cycles[0]).toMatchObject({
      id: 'cycle-cloud', status: 'open', buyAmount: 20000,
      sellAmount: 0, transactionIds: ['trade-cloud'],
    });
  });
});
