import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../../infrastructure/cloud/supabase-client';
import type { BacktestSignalAlertV3, BacktestSignalMetrics } from '../backtest-signal-inbox-store';
import type { StockPositionLedger, StockTransaction } from '../stock-position-ledger';

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
  const messageKind = input.message_kind === 'virtual_execution'
    || input.message_kind === 'virtual_blocked' || input.message_kind === 'virtual_pending'
    || input.message_kind === 'actual_position_risk' ? input.message_kind : 'legacy';
  const tracking = input.virtual_tracking_status === 'executed'
    || input.virtual_tracking_status === 'blocked_t1'
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
