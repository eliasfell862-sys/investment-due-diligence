import { describe, expect, it, vi } from 'vitest';
import { calculateStockPositionAvailability } from '../stock-position-availability';
import { CloudSecuritiesRepository } from './cloud-securities-repository';

function fakeClient(rows: Record<string, unknown[]>) {
  const eq = vi.fn((table: string, column: string, value: string) => {
    expect(column).toBe('user_id');
    expect(value).toBe('user-a');
    return rows[table] ?? [];
  });
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null }),
    },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        const result = Promise.resolve({ data: rows[table] ?? [], error: null });
        const query: Record<string, unknown> = {};
        query.eq = (column: string, value: string) => {
          eq(table, column, value);
          return query;
        };
        query.order = () => query;
        query.limit = () => result;
        query.then = result.then.bind(result);
        return query;
      }),
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
  it('loads only the latest 200 signal alerts with explicit columns', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null }) },
      from: vi.fn(() => ({ select })),
      rpc: vi.fn(),
    };

    await new CloudSecuritiesRepository(client as never).loadSignalAlerts();

    expect(select).toHaveBeenCalledWith(expect.not.stringContaining('*'));
    expect(eq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(order).toHaveBeenCalledWith('signal_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(200);
  });
  it('maps T-trading signal metadata into a typed alert payload', async () => {
    const client = fakeClient({
      signal_alerts: [{
        id: 't-alert', code: '000685', name: '中山公用', price: '11.8', action: 'sell',
        intent: 'reduce', suggested_shares: 300, position_shares_at_signal: 1000,
        available_shares_at_signal: 1000, reasons: ['outflow'], metrics: {},
        entry_price: '11.1', stop_loss: '0', signal_at: '2026-08-11T06:00:00Z',
        status: 'pending', read_at: null, executed_at: null, message_kind: 'actual_t_sell',
        virtual_tracking_status: 'actual_risk_only', strategy_id: 'actual-t', strategy_version: '1',
        t_trade_cycle_id: null,
        signal_metadata: {
          position_id: 'position-a', cycle_type: 'profit_t', sell_low: '11.8', sell_high: '12',
          buyback_low: '11.2', buyback_high: '11.4', expected_net_profit: '168',
          expected_round_trip_fees: { total: '11.5' }, atr20: '.42', resistance: '11.95',
        },
      }],
    });
    const [alert] = await new CloudSecuritiesRepository(client as never).loadSignalAlerts();
    expect(alert.messageKind).toBe('actual_t_sell');
    expect(alert.tTrade).toMatchObject({
      kind: 'actual_t_sell', positionId: 'position-a', sellRange: [11.8, 12],
      buybackRange: [11.2, 11.4], expectedNetProfit: 168, expectedRoundTripFees: 11.5,
    });
  });
  it('preserves virtual T message kinds and scoped position metadata from cloud alerts', async () => {
    const client = fakeClient({
      signal_alerts: [{
        id: 'virtual-t-alert', code: '000001', name: 'A', price: '10', action: 'buy',
        intent: 'add', suggested_shares: 100, position_shares_at_signal: 100,
        available_shares_at_signal: 100, reasons: ['virtual_cash_insufficient'], metrics: {},
        entry_price: '10', stop_loss: '0', signal_at: '2026-08-18T02:00:00Z',
        status: 'pending', read_at: null, executed_at: null, message_kind: 'virtual_t_cash_blocked',
        virtual_tracking_status: 'blocked_cash', strategy_id: 'virtual-t', strategy_version: '1',
        t_trade_cycle_id: 'cycle-1',
        signal_metadata: {
          position_scope: 'virtual', virtual_position_id: 'virtual-position-1',
          remaining_buyback_shares: 100,
        },
      }],
    });
    const [alert] = await new CloudSecuritiesRepository(client as never).loadSignalAlerts();
    expect(alert.messageKind).toBe('virtual_t_cash_blocked');
    expect(alert.tTrade).toMatchObject({
      kind: 'virtual_t_cash_blocked', positionScope: 'virtual',
      virtualPositionId: 'virtual-position-1', remainingBuybackShares: 100,
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
      virtual_cash_accounts: [{
        initial_capital: '200000', cash_balance: '180000', reserved_cash: '0',
        version: 1, requires_cleanup: true, updated_at: '2026-08-06T02:00:00.000Z',
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

  it('maps fee profiles, cycles and immutable executions into T-trading state', async () => {
    const client = fakeClient({
      trading_fee_profiles: [{
        commission_rate: '0.0002', minimum_commission: '6',
        sell_stamp_duty_rate: '0.0005', transfer_fee_rate: '0.00001',
        slippage_mode: 'fixed', fixed_slippage_rate: '0.0008',
        updated_at: '2026-08-11T01:00:00.000Z',
      }],
      t_trade_cycles: [
        {
          id: 'cycle-b', position_id: 'position-b', code: '000002', name: 'B',
          cycle_type: 'cost_reduction_t', status: 'partially_bought_back',
          pre_cycle_average_cost: '13', pre_cycle_total_shares: 1000,
          sold_shares: 300, remaining_buyback_shares: 200,
          kept_as_reduction_shares: 0, realized_t_profit: '93',
          cost_reduction_per_share: '0', adjusted_average_cost: '13',
          signal_basis_snapshot: { riskReviewReasons: ['support'] },
          created_at: '2026-08-11T02:00:00.000Z',
        },
        {
          id: 'cycle-a', position_id: 'position-a', code: '000001', name: 'A',
          cycle_type: 'profit_t', status: 'completed',
          pre_cycle_average_cost: '11.1', pre_cycle_total_shares: 1000,
          sold_shares: 300, remaining_buyback_shares: 0,
          kept_as_reduction_shares: 0, realized_t_profit: '284',
          cost_reduction_per_share: '0.284', adjusted_average_cost: '10.816',
          signal_basis_snapshot: {},
          created_at: '2026-08-11T01:00:00.000Z',
        },
      ],
      t_trade_executions: [
        {
          id: 'execution-buy', cycle_id: 'cycle-a', idempotency_key: 'buy-1',
          side: 'buyback', price: '11', shares: 300, total_fees: '5',
          executed_at: '2026-08-11T03:00:00.000Z',
        },
        {
          id: 'execution-sell', cycle_id: 'cycle-a', idempotency_key: 'sell-1',
          side: 'sell', price: '12', shares: 300, total_fees: '6',
          executed_at: '2026-08-11T02:00:00.000Z',
        },
      ],
    });
    const repository = new CloudSecuritiesRepository(client as never);

    const state = await repository.loadTTradingState();

    expect(state.feeProfile).toMatchObject({
      commissionRate: 0.0002, minimumCommission: 6,
      slippageMode: 'fixed', fixedSlippageRate: 0.0008,
    });
    expect(state.cycles.map(cycle => cycle.id)).toEqual(['cycle-a', 'cycle-b']);
    expect(state.cycles[0].executions.map(execution => execution.id))
      .toEqual(['execution-sell', 'execution-buy']);
    expect(state.cycles[1]).toMatchObject({
      cycleType: 'cost_reduction_t', remainingBuybackShares: 200,
      realizedTProfit: 93, riskReviewReasons: ['support'],
    });
  });

  it('sends user execution inputs through authoritative T-trading RPCs', async () => {
    const client = fakeClient({});
    client.rpc.mockResolvedValue({
      data: { cycle_id: 'cycle-1', execution_id: 'execution-1' },
      error: null,
    });
    const repository = new CloudSecuritiesRepository(client as never);

    await repository.executeTTradeSell({
      alertId: 'alert-1', price: 12, shares: 300,
      tradedAt: '2026-08-11T02:00:00.000Z', brokerActualTotalFee: 6,
    });

    expect(client.rpc).toHaveBeenCalledWith('execute_t_trade_sell', {
      p_payload: {
        alert_id: 'alert-1', price: 12, shares: 300,
        traded_at: '2026-08-11T02:00:00.000Z', broker_actual_total_fee: 6,
      },
    });
  });

});
