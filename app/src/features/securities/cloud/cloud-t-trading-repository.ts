import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../../infrastructure/cloud/supabase-client';
import {
  DEFAULT_TRADING_FEE_PROFILE,
  type LocalTTradingState,
  type TTradeCycle,
  type TTradeCycleStatus,
  type TTradeExecution,
  type TradingFeeProfile,
} from '../t-trading/t-trading-types';
import { CloudSecuritiesRepository as CoreCloudSecuritiesRepository } from './cloud-securities-repository-base';

interface ServiceError { message?: string }
interface QueryResult { data: unknown[] | null; error: ServiceError | null }
interface RealtimeChannelAccess {
  on(event: string, filter: Record<string, string>, callback: () => void): RealtimeChannelAccess;
  subscribe(): unknown;
  unsubscribe(): PromiseLike<unknown> | unknown;
}
interface TTradingCloudClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error: ServiceError | null }>;
  };
  from(table: string): {
    select(columns?: string): {
      eq(column: string, value: string): PromiseLike<QueryResult>;
    };
  };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: ServiceError | null;
  }>;
  channel?(name: string): RealtimeChannelAccess;
}

export interface ExecuteTTradeSellInput {
  alertId: string;
  price: number;
  shares: number;
  tradedAt: string;
  brokerActualTotalFee: number | null;
}
export interface ExecuteTTradeBuybackInput extends ExecuteTTradeSellInput {}
export interface ResolveTTradeCycleInput {
  cycleId: string;
  resolution: 'record_buyback' | 'keep_as_reduction';
  resolvedAt: string;
  price?: number;
  shares?: number;
  brokerActualTotalFee?: number | null;
}
export interface TTradeMutationResult {
  cycleId: string;
  executionId: string | null;
  positionTransactionId: string | null;
  status: string | null;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object'
  ? value as Record<string, unknown> : {};
const textValue = (value: unknown): string => typeof value === 'string' ? value : '';
const numberValue = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const integerValue = (value: unknown): number => Number.isInteger(Number(value)) ? Number(value) : 0;
const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string') : [];

const T_CYCLE_STATUSES = new Set<TTradeCycleStatus>([
  'sell_executed', 'buyback_monitoring', 'buyback_signal_pending',
  'partially_bought_back', 'completed', 'buyback_paused_risk_review',
  'expired_unfilled', 'kept_as_reduction', 'cancelled_by_user',
]);

function mapExecution(value: unknown): TTradeExecution {
  const input = record(value);
  return {
    id: textValue(input.id),
    idempotencyKey: textValue(input.idempotency_key),
    side: input.side === 'buyback' ? 'buyback' : 'sell',
    price: numberValue(input.price),
    shares: integerValue(input.shares),
    totalFees: numberValue(input.total_fees),
    executedAt: textValue(input.executed_at),
  };
}

function mapMutation(value: unknown): TTradeMutationResult {
  const input = record(value);
  return {
    cycleId: textValue(input.cycle_id),
    executionId: textValue(input.execution_id) || null,
    positionTransactionId: textValue(input.position_transaction_id) || null,
    status: textValue(input.status) || null,
  };
}

export class CloudTTradingRepositoryBase extends CoreCloudSecuritiesRepository {
  private readonly tClient: TTradingCloudClient;

  constructor(client: TTradingCloudClient = getSupabaseClient() as unknown as TTradingCloudClient) {
    super(client as never);
    this.tClient = client;
  }

  private async tAuthenticatedUserId(): Promise<string> {
    const { data, error } = await this.tClient.auth.getUser();
    if (error) throw new Error(error.message ?? 'Failed to read cloud account');
    if (!data.user) throw new Error('Cloud account is not signed in');
    return data.user.id;
  }

  async loadTTradingState(): Promise<LocalTTradingState> {
    const userId = await this.tAuthenticatedUserId();
    const [profileResult, cycleResult, executionResult] = await Promise.all([
      this.tClient.from('trading_fee_profiles').select('*').eq('user_id', userId),
      this.tClient.from('t_trade_cycles').select('*').eq('user_id', userId),
      this.tClient.from('t_trade_executions').select('*').eq('user_id', userId),
    ]);
    for (const [operation, result] of [
      ['loadTradingFeeProfile', profileResult],
      ['loadTTradeCycles', cycleResult],
      ['loadTTradeExecutions', executionResult],
    ] as const) {
      if (result.error) throw new Error(result.error.message ?? operation + ' failed');
    }

    const profileInput = record(profileResult.data?.[0]);
    const feeProfile: TradingFeeProfile = profileResult.data?.[0] ? {
      commissionRate: numberValue(profileInput.commission_rate),
      minimumCommission: numberValue(profileInput.minimum_commission),
      sellStampDutyRate: numberValue(profileInput.sell_stamp_duty_rate),
      transferFeeRate: numberValue(profileInput.transfer_fee_rate),
      slippageMode: profileInput.slippage_mode === 'fixed' ? 'fixed' : 'dynamic',
      fixedSlippageRate: numberValue(profileInput.fixed_slippage_rate),
      updatedAt: textValue(profileInput.updated_at) || null,
    } : { ...DEFAULT_TRADING_FEE_PROFILE };

    const executionsByCycle = new Map<string, TTradeExecution[]>();
    for (const value of executionResult.data ?? []) {
      const input = record(value);
      const cycleId = textValue(input.cycle_id);
      if (!cycleId) continue;
      executionsByCycle.set(cycleId, [
        ...(executionsByCycle.get(cycleId) ?? []),
        mapExecution(input),
      ]);
    }
    for (const executions of executionsByCycle.values()) {
      executions.sort((left, right) => (
        left.executedAt.localeCompare(right.executedAt) || left.id.localeCompare(right.id)
      ));
    }

    const activeStatuses = new Set<TTradeCycleStatus>([
      'sell_executed', 'buyback_monitoring', 'buyback_signal_pending',
      'partially_bought_back',
    ]);
    const createdAt = new Map<string, string>();
    const cycles: TTradeCycle[] = (cycleResult.data ?? []).map((value) => {
      const input = record(value);
      const statusValue = textValue(input.status) as TTradeCycleStatus;
      const status = T_CYCLE_STATUSES.has(statusValue) ? statusValue : 'cancelled_by_user';
      const basis = record(input.signal_basis_snapshot);
      const id = textValue(input.id);
      const cycleType: TTradeCycle['cycleType'] = input.cycle_type === 'cost_reduction_t'
        ? 'cost_reduction_t' : 'profit_t';
      createdAt.set(id, textValue(input.created_at));
      return {
        id,
        positionId: textValue(input.position_id),
        code: textValue(input.code),
        cycleType,
        status,
        preCycleAverageCost: numberValue(input.pre_cycle_average_cost),
        preCycleTotalShares: integerValue(input.pre_cycle_total_shares),
        soldShares: integerValue(input.sold_shares),
        remainingBuybackShares: integerValue(input.remaining_buyback_shares),
        keptAsReductionShares: integerValue(input.kept_as_reduction_shares),
        realizedTProfit: numberValue(input.realized_t_profit),
        costReductionPerShare: numberValue(input.cost_reduction_per_share),
        adjustedAverageCost: numberValue(input.adjusted_average_cost),
        monitoringEnabled: activeStatuses.has(status),
        riskReviewReasons: stringArray(
          basis.riskReviewReasons ?? basis.risk_review_reasons,
        ),
        executions: [...(executionsByCycle.get(id) ?? [])],
      };
    }).sort((left, right) => (
      (createdAt.get(left.id) ?? '').localeCompare(createdAt.get(right.id) ?? '')
      || left.id.localeCompare(right.id)
    ));

    return { version: 1, feeProfile, cycles };
  }

  async saveTradingFeeProfile(profile: TradingFeeProfile): Promise<void> {
    await this.callTTradingRpc('upsert_trading_fee_profile', {
      commission_rate: profile.commissionRate,
      minimum_commission: profile.minimumCommission,
      sell_stamp_duty_rate: profile.sellStampDutyRate,
      transfer_fee_rate: profile.transferFeeRate,
      slippage_mode: profile.slippageMode,
      fixed_slippage_rate: profile.fixedSlippageRate,
    });
  }

  async executeTTradeSell(input: ExecuteTTradeSellInput): Promise<TTradeMutationResult> {
    return this.callTTradingRpc('execute_t_trade_sell', {
      alert_id: input.alertId,
      price: input.price,
      shares: input.shares,
      traded_at: input.tradedAt,
      broker_actual_total_fee: input.brokerActualTotalFee,
    }, mapMutation);
  }

  async executeTTradeBuyback(input: ExecuteTTradeBuybackInput): Promise<TTradeMutationResult> {
    return this.callTTradingRpc('execute_t_trade_buyback', {
      alert_id: input.alertId,
      price: input.price,
      shares: input.shares,
      traded_at: input.tradedAt,
      broker_actual_total_fee: input.brokerActualTotalFee,
    }, mapMutation);
  }

  async resolveTTradeCycle(input: ResolveTTradeCycleInput): Promise<TTradeMutationResult> {
    return this.callTTradingRpc('resolve_t_trade_cycle', {
      cycle_id: input.cycleId,
      resolution: input.resolution,
      resolved_at: input.resolvedAt,
      price: input.price,
      shares: input.shares,
      broker_actual_total_fee: input.brokerActualTotalFee,
    }, mapMutation);
  }

  subscribeTTradingState(userId: string, onChange: () => void): () => void {
    if (!this.tClient.channel) return () => undefined;
    let channel = this.tClient.channel('t-trading:' + userId);
    for (const table of ['trading_fee_profiles', 't_trade_cycles', 't_trade_executions']) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: 'user_id=eq.' + userId },
        onChange,
      );
    }
    channel.subscribe();
    return () => { void channel.unsubscribe(); };
  }

  private async callTTradingRpc<T = void>(
    name: string,
    payload: Record<string, unknown>,
    mapResult?: (value: unknown) => T,
  ): Promise<T> {
    await this.tAuthenticatedUserId();
    const { data, error } = await this.tClient.rpc(name, { p_payload: payload });
    if (error) throw new Error(error.message ?? name + ' failed');
    return mapResult ? mapResult(data) : data as T;
  }
}

export type TTradingRepositoryClient = SupabaseClient;
