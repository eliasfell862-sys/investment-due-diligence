import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../../infrastructure/cloud/supabase-client';
import type {
  BacktestSignalAlertV3,
  BacktestSignalMetrics,
  BacktestSignalRuntimeState,
  PendingVirtualSell,
  StockSignalStateV3,} from '../backtest-signal-inbox-store';
import { parseTTradeAlertPayload } from '../backtest-signal-inbox-store';
import type { StockPositionLedger, StockTransaction } from '../stock-position-ledger';
import {
  migrateVirtualTradingLedger,
  type LegacyVirtualTransaction,
  type VirtualTradeCycle,
} from '../virtual-trading-ledger';
import type { TradingFeeProfile } from '../t-trading/trading-fee-engine';

interface ServiceError { message?: string; code?: string }
interface QueryResult { data: unknown[] | null; error: ServiceError | null }
interface CloudClient {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: ServiceError | null }> };
  from(table: string): { select(columns?: string): { eq(column: string, value: string): PromiseLike<QueryResult> } };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: ServiceError | null }>;
}

export class CloudSecuritiesError extends Error {
  readonly operation: string;
  readonly retryable: boolean;

  constructor(operation: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'CloudSecuritiesError';
    this.operation = operation;
    this.retryable = retryable;
  }
}

const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object'
  ? value as Record<string, unknown> : {};
const stringValue = (value: unknown): string => typeof value === 'string' ? value : '';
const numberValue = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const integerValue = (value: unknown): number => Number.isInteger(Number(value)) ? Number(value) : 0;
const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string') : [];
const isRetryable = (code?: string): boolean => !code || code.startsWith('08') || code === '57014';
const nullableString = (value: unknown): string | null => stringValue(value) || null;

function mapFeeProfile(value: unknown): TradingFeeProfile | undefined {
  const input = row(value);
  if (Object.keys(input).length === 0) return undefined;
  return {
    commissionRate: numberValue(input.commissionRate),
    minimumCommission: numberValue(input.minimumCommission),
    sellStampDutyRate: numberValue(input.sellStampDutyRate),
    transferFeeRate: numberValue(input.transferFeeRate),
    slippageMode: input.slippageMode === 'fixed' ? 'fixed' : 'dynamic',
    fixedSlippageRate: numberValue(input.fixedSlippageRate),
    updatedAt: nullableString(input.updatedAt),
  };
}

function mapPendingVirtualSell(value: unknown): PendingVirtualSell | null {
  const input = row(value);
  const alertId = stringValue(input.alertId) || stringValue(input.alert_id);
  const cycleId = stringValue(input.cycleId) || stringValue(input.cycle_id);
  const executableOn = stringValue(input.executableOn) || stringValue(input.executable_on);
  if (!alertId || !cycleId || !executableOn) return null;
  const exitReason = input.exitReason ?? input.exit_reason;
  return {
    alertId,
    cycleId,
    executableOn,
    createdAt: stringValue(input.createdAt) || stringValue(input.created_at),
    desiredShares: integerValue(input.desiredShares ?? input.desired_shares),
    reasons: stringArray(input.reasons),
    exitReason: exitReason === 'stop_loss' || exitReason === 'timeout' ? exitReason : 'signal',
  };
}


function mapMetrics(value: unknown): BacktestSignalMetrics {
  const input = row(value);
  return {
    totalTrades: integerValue(input.totalTrades),
    winRate: numberValue(input.winRate),
    sharpeRatio: numberValue(input.sharpeRatio),
    maxDrawdown: numberValue(input.maxDrawdown),
    annualReturn: numberValue(input.annualReturn),
    profitFactor: numberValue(input.profitFactor),
  };
}

function mapAlert(input: Record<string, unknown>): BacktestSignalAlertV3 {
  const rawMessageKind = stringValue(input.message_kind);
  const messageKind = ['virtual_execution', 'virtual_blocked', 'virtual_pending', 'actual_position_risk',
    'actual_t_sell', 'actual_t_buyback', 'actual_t_expiry_risk', 'actual_t_risk_review',
    'virtual_t_sell', 'virtual_t_buyback', 'virtual_t_cash_blocked', 'virtual_t_expiry_risk'].includes(rawMessageKind)
    ? rawMessageKind as BacktestSignalAlertV3['messageKind'] : 'legacy';
  const tracking = input.virtual_tracking_status === 'executed'
    || input.virtual_tracking_status === 'blocked_t1'
    || input.virtual_tracking_status === 'blocked_cash'
    || input.virtual_tracking_status === 'pending_t1'
    || input.virtual_tracking_status === 'cancelled_revalidation'
    || input.virtual_tracking_status === 'actual_risk_only'
    ? input.virtual_tracking_status : 'legacy_untracked';
  return {
    id: stringValue(input.id), code: stringValue(input.code), name: stringValue(input.name),
    price: numberValue(input.price), action: input.action === 'sell' ? 'sell' : 'buy',
    intent: input.intent === 'add' || input.intent === 'reduce' || input.intent === 'exit' ? input.intent : 'open',
    suggestedShares: integerValue(input.suggested_shares),
    positionSharesAtSignal: integerValue(input.position_shares_at_signal),
    availableSharesAtSignal: integerValue(input.available_shares_at_signal),
    reasons: stringArray(input.reasons), signalAt: stringValue(input.signal_at),
    status: input.status === 'bought' || input.status === 'sold' ? input.status : 'pending',
    readAt: stringValue(input.read_at) || null, executedAt: stringValue(input.executed_at) || null,
    entryPrice: numberValue(input.entry_price), stopLoss: numberValue(input.stop_loss),
    metrics: mapMetrics(input.metrics), messageKind, virtualTrackingStatus: tracking,
    virtualTradeId: stringValue(input.virtual_trade_id) || null,
    virtualCycleId: stringValue(input.virtual_cycle_id) || null,
    virtualShares: integerValue(input.virtual_shares),
    virtualPrice: input.virtual_price == null ? null : numberValue(input.virtual_price),
    virtualPositionSharesAfter: input.virtual_position_shares_after == null
      ? null : integerValue(input.virtual_position_shares_after),
    virtualAvailableSharesAfter: input.virtual_available_shares_after == null
      ? null : integerValue(input.virtual_available_shares_after),
    strategyId: stringValue(input.strategy_id), strategyVersion: stringValue(input.strategy_version),
    tTrade: parseTTradeAlertPayload(messageKind, input.signal_metadata, nullableString(input.t_trade_cycle_id)),
  };
}

export class CloudSecuritiesRepository {
  private readonly client: CloudClient;

  constructor(client: CloudClient = getSupabaseClient() as unknown as CloudClient) {
    this.client = client;
  }

  private async getUserId(operation: string): Promise<string> {
    const { data, error } = await this.client.auth.getUser();
    if (error) throw new CloudSecuritiesError(operation, error.message ?? '读取云账户失败', true);
    if (!data.user) throw new CloudSecuritiesError(operation, '云账户未登录', false);
    return data.user.id;
  }

  private async loadRows(table: string, operation: string): Promise<Record<string, unknown>[]> {
    const userId = await this.getUserId(operation);
    const { data, error } = await this.client.from(table).select('*').eq('user_id', userId);
    if (error) throw new CloudSecuritiesError(
      operation, error.message ?? `${table}读取失败`, isRetryable(error.code),
    );
    return (data ?? []).map(row);
  }

  async loadPositionLedger(): Promise<StockPositionLedger> {
    const [groupsInput, positionsInput, transactionsInput] = await Promise.all([
      this.loadRows('position_groups', 'loadPositionLedger'),
      this.loadRows('positions', 'loadPositionLedger'),
      this.loadRows('position_transactions', 'loadPositionLedger'),
    ]);
    const groupId = new Map(groupsInput.map(item => [
      stringValue(item.id), stringValue(item.source_id) || stringValue(item.id),
    ]));
    const groups = groupsInput.map(item => ({
      id: stringValue(item.source_id) || stringValue(item.id), name: stringValue(item.name),
    })).sort((left, right) => left.id.localeCompare(right.id));
    const sourceAlerts = new Map<string, string[]>();
    const transactions: StockTransaction[] = transactionsInput.map((item): StockTransaction => {
      const code = stringValue(item.code);
      const sourceAlertId = stringValue(item.source_alert_id);
      if (sourceAlertId) sourceAlerts.set(code, [...(sourceAlerts.get(code) ?? []), sourceAlertId]);
      return {
        id: stringValue(item.source_id) || stringValue(item.id),
        groupId: groupId.get(stringValue(item.group_id)) ?? stringValue(item.group_id),
        code, name: stringValue(item.name), type: item.transaction_type === 'sell' ? 'sell' : 'buy',
        shares: integerValue(item.shares), price: numberValue(item.price), amount: numberValue(item.amount),
        tradedAt: stringValue(item.traded_at), sourceAlertId, realizedProfit: numberValue(item.realized_profit),
      };
    }).sort((left, right) => left.tradedAt.localeCompare(right.tradedAt) || left.id.localeCompare(right.id));
    const positions = positionsInput.map(item => {
      const code = stringValue(item.code);
      return {
        id: stringValue(item.source_id) || stringValue(item.id),
        groupId: groupId.get(stringValue(item.group_id)) ?? stringValue(item.group_id),
        code, name: stringValue(item.name), shares: integerValue(item.shares),
        averageCost: numberValue(item.average_cost), totalCost: numberValue(item.total_cost),
        openedAt: stringValue(item.opened_at), updatedAt: stringValue(item.updated_at),
        sourceAlertIds: [...new Set(sourceAlerts.get(code) ?? [])],
      };
    }).sort((left, right) => left.code.localeCompare(right.code));
    return { version: 1, groups, positions, transactions };
  }

  async loadSignalAlerts(): Promise<BacktestSignalAlertV3[]> {
    const alerts = (await this.loadRows('signal_alerts', 'loadSignalAlerts')).map(mapAlert);
    return alerts.sort((left, right) => right.signalAt.localeCompare(left.signalAt));
  }

  async loadSignalRuntime(): Promise<BacktestSignalRuntimeState> {
    const [stateRows, alertRows, cycleRows, positionRows, transactionRows, cashRows] = await Promise.all([
      this.loadRows('signal_states', 'loadSignalRuntime'),
      this.loadRows('signal_alerts', 'loadSignalRuntime'),
      this.loadRows('virtual_cycles', 'loadSignalRuntime'),
      this.loadRows('virtual_positions', 'loadSignalRuntime'),
      this.loadRows('virtual_transactions', 'loadSignalRuntime'),
      this.loadRows('virtual_cash_accounts', 'loadSignalRuntime'),
    ]);
    const alerts = alertRows.map(mapAlert)
      .sort((left, right) => left.signalAt.localeCompare(right.signalAt) || left.id.localeCompare(right.id));
    const alertById = new Map(alerts.map(alert => [alert.id, alert]));

    const stocks: Record<string, StockSignalStateV3> = {};
    for (const input of [...stateRows].sort((left, right) => (
      stringValue(left.updated_at).localeCompare(stringValue(right.updated_at))
    ))) {
      const code = stringValue(input.code);
      if (!code) continue;
      const pendingVirtualSell = mapPendingVirtualSell(input.pending_virtual_sell);
      stocks[code] = {
        lastBuyDecision: input.buy_direction === 'buy' ? 'buy' : 'hold',
        lastSellDecision: input.sell_direction === 'sell' ? 'sell' : 'hold',
        updatedAt: stringValue(input.updated_at),
        blockedSellUntil: pendingVirtualSell?.executableOn ?? null,
        blockedSellNotifiedOn: null,
        pendingVirtualSell,
      };
    }

    const orderedRows = [...transactionRows].sort((left, right) => (
      stringValue(left.traded_at).localeCompare(stringValue(right.traded_at))
      || stringValue(left.id).localeCompare(stringValue(right.id))
    ));
    const sharesByCycle = new Map<string, number>();
    const transactionIdsByCycle = new Map<string, string[]>();
    const transactions: LegacyVirtualTransaction[] = orderedRows.map(input => {
      const id = stringValue(input.id);
      const cycleId = stringValue(input.cycle_id);
      const sourceSignalId = stringValue(input.source_signal_id);
      const type = input.transaction_type === 'sell' ? 'sell' as const : 'buy' as const;
      const shares = integerValue(input.shares);
      const before = sharesByCycle.get(cycleId) ?? 0;
      const after = Math.max(0, type === 'buy' ? before + shares : before - shares);
      sharesByCycle.set(cycleId, after);
      transactionIdsByCycle.set(cycleId, [...(transactionIdsByCycle.get(cycleId) ?? []), id]);
      const alert = alertById.get(sourceSignalId);
      return {
        id, sourceSignalId, cycleId,
        strategyId: stringValue(input.strategy_id),
        strategyVersion: stringValue(input.strategy_version),
        code: stringValue(input.code), name: stringValue(input.name), type,
        intent: alert?.intent ?? (type === 'buy'
          ? (before === 0 ? 'open' : 'add') : (after === 0 ? 'exit' : 'reduce')),
        shares, price: numberValue(input.price), amount: numberValue(input.amount),
        tradedAt: stringValue(input.traded_at), positionSharesAfter: after,
        availableSharesAfter: alert?.virtualAvailableSharesAfter ?? 0,
        realizedProfit: numberValue(input.realized_profit),
        reasons: [...(alert?.reasons ?? [])],
      };
    });

    const positions = positionRows.map(input => {
      const cycleId = stringValue(input.cycle_id);
      return {
        id: stringValue(input.id), cycleId,
        strategyId: stringValue(input.strategy_id),
        strategyVersion: stringValue(input.strategy_version),
        code: stringValue(input.code), name: stringValue(input.name),
        shares: integerValue(input.shares), averageCost: numberValue(input.average_cost),
        totalCost: numberValue(input.total_cost), openedAt: stringValue(input.opened_at),
        updatedAt: stringValue(input.updated_at),
        sourceTradeIds: [...(transactionIdsByCycle.get(cycleId) ?? [])],
      };
    }).sort((left, right) => left.code.localeCompare(right.code));

    const transactionsByCycle = new Map<string, LegacyVirtualTransaction[]>();
    for (const transaction of transactions) {
      transactionsByCycle.set(transaction.cycleId, [
        ...(transactionsByCycle.get(transaction.cycleId) ?? []), transaction,
      ]);
    }
    const cycles: VirtualTradeCycle[] = cycleRows.map(input => {
      const id = stringValue(input.id);
      const cycleTransactions = transactionsByCycle.get(id) ?? [];
      const buyAmount = cycleTransactions.filter(item => item.type === 'buy')
        .reduce((sum, item) => sum + item.amount, 0);
      const sellAmount = cycleTransactions.filter(item => item.type === 'sell')
        .reduce((sum, item) => sum + item.amount, 0);
      const realizedProfit = numberValue(input.realized_profit);
      const closedAt = nullableString(input.closed_at);
      return {
        id, strategyId: stringValue(input.strategy_id),
        strategyVersion: stringValue(input.strategy_version),
        code: stringValue(input.code), name: stringValue(input.name),
        status: closedAt ? 'closed' as const : 'open' as const,
        openedAt: stringValue(input.opened_at), closedAt, buyAmount, sellAmount,
        realizedProfit,
        returnPct: closedAt && buyAmount > 0
          ? Math.round(realizedProfit / buyAmount * 10_000) / 100 : null,
        transactionIds: [...(transactionIdsByCycle.get(id) ?? [])],
      };
    }).sort((left, right) => left.openedAt.localeCompare(right.openedAt) || left.id.localeCompare(right.id));

    const cash = cashRows[0];
    if (!cash) {
      throw new CloudSecuritiesError('loadSignalRuntime', 'virtual_cash_account_missing', false);
    }
    const migrated = migrateVirtualTradingLedger({ version: 1, positions, transactions, cycles });
    const sourceRows = new Map(transactionRows.map(input => [stringValue(input.id), input]));
    const mappedTransactions = migrated.transactions.map(transaction => {
      const input = sourceRows.get(transaction.id) ?? {};
      return {
        ...transaction,
        grossAmount: input.gross_amount == null ? transaction.grossAmount : numberValue(input.gross_amount),
        feeAmount: input.fee_amount == null ? transaction.feeAmount : numberValue(input.fee_amount),
        cashDelta: input.cash_delta == null ? transaction.cashDelta : numberValue(input.cash_delta),
        cashBalanceAfter: input.cash_balance_after == null
          ? transaction.cashBalanceAfter : numberValue(input.cash_balance_after),
        feeProfileSnapshot: mapFeeProfile(input.fee_profile_snapshot) ?? transaction.feeProfileSnapshot,
        feeEstimated: input.fee_estimated == null
          ? transaction.feeEstimated : input.fee_estimated === true,
      };
    });
    const mappedByCycle = new Map<string, typeof mappedTransactions>();
    for (const transaction of mappedTransactions) {
      mappedByCycle.set(transaction.cycleId, [
        ...(mappedByCycle.get(transaction.cycleId) ?? []), transaction,
      ]);
    }
    const mappedCycles = cycles.map(cycle => {
      const items = mappedByCycle.get(cycle.id) ?? [];
      return {
        ...cycle,
        buyAmount: items.filter(item => item.type === 'buy').reduce(
          (sum, item) => sum + (item.grossAmount ?? item.amount) + (item.feeAmount ?? 0), 0,
        ),
        sellAmount: items.filter(item => item.type === 'sell').reduce(
          (sum, item) => sum + (item.grossAmount ?? item.amount) - (item.feeAmount ?? 0), 0,
        ),
      };
    });
    return {
      version: 3, alerts, stocks,
      virtualLedger: {
        version: 2,
        cashAccount: {
          initialCapital: numberValue(cash.initial_capital),
          cashBalance: numberValue(cash.cash_balance),
          reservedCash: numberValue(cash.reserved_cash),
          version: integerValue(cash.version),
          updatedAt: stringValue(cash.updated_at),
        },
        positions, transactions: mappedTransactions, cycles: mappedCycles,
        requiresCapitalCleanup: cash.requires_cleanup === true,
      },
    };
  }


  async executeBuy(payload: Record<string, unknown>): Promise<void> {
    await this.callRpc('execute_cloud_position_buy', payload, 'executeBuy');
  }

  async executeSell(payload: Record<string, unknown>): Promise<void> {
    await this.callRpc('execute_cloud_position_sell', payload, 'executeSell');
  }

  private async callRpc(name: string, payload: Record<string, unknown>, operation: string): Promise<void> {
    await this.getUserId(operation);
    const { error } = await this.client.rpc(name, { p_payload: payload });
    if (error) throw new CloudSecuritiesError(operation, error.message ?? `${operation}失败`, isRetryable(error.code));
  }
}

export function createCloudSecuritiesRepository(client?: SupabaseClient): CloudSecuritiesRepository {
  return new CloudSecuritiesRepository(client as unknown as CloudClient | undefined);
}
