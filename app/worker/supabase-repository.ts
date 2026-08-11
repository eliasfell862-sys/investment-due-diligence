import { DEFAULT_TRADING_FEE_PROFILE, type TradingFeeProfile } from '../src/features/securities/t-trading/t-trading-types';
import type { UserMonitoringAssignment, WorkerStrategyAssignment } from './types';

interface SupabaseResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

interface SupabaseQuery<T> extends PromiseLike<SupabaseResult<T>> {
  select(columns?: string): SupabaseQuery<T>;
  eq(column: string, value: unknown): SupabaseQuery<T>;
  gt(column: string, value: unknown): SupabaseQuery<T>;
}

export interface WorkerSupabaseClient {
  from<T = Record<string, unknown>>(table: string): SupabaseQuery<T>;
}

interface PositionRow {
  id: string;
  user_id: string;
  code: string;
  name: string;
  shares: number;
  average_cost: number | string;
  opened_at: string;
  strategy_id?: string;
  strategy_version?: string;
}

interface LotRow {
  user_id: string;
  position_id: string;
  remaining_shares: number;
  trading_date: string;
}

interface FeeProfileRow {
  user_id: string;
  commission_rate: number | string;
  minimum_commission: number | string;
  sell_stamp_duty_rate: number | string;
  transfer_fee_rate: number | string;
  slippage_mode: string;
  fixed_slippage_rate: number | string;
  updated_at: string | null;
}

interface TTradeCycleRow {
  id: string;
  user_id: string;
  position_id: string;
  code: string;
  name: string;
  cycle_type: 'profit_t' | 'cost_reduction_t';
  status: string;
  sold_shares: number;
  remaining_buyback_shares: number;
  actual_sell_price: number | string;
  actual_sell_fees: number | string;
  actual_sell_at: string;
  expiry_risk_sent_at: string | null;
  expires_at: string;
  strategy_id: string;
  strategy_version: string;
  signal_basis_snapshot: Record<string, unknown>;
}

export interface WorkerTTradeCycleSnapshot {
  id: string;
  positionId: string;
  code: string;
  name: string;
  cycleType: 'profit_t' | 'cost_reduction_t';
  status: 'buyback_monitoring' | 'buyback_signal_pending' | 'partially_bought_back'
    | 'buyback_paused_risk_review' | 'expired_unfilled';
  soldShares: number;
  remainingBuybackShares: number;
  actualSellPrice: number;
  actualSellFees: number;
  actualSellAt: string;
  expiryRiskSentAt: string | null;
  expiresAt: string;
  strategyId: string;
  strategyVersion: string;
  signalBasis: Record<string, unknown>;
}
export interface WorkerPositionSnapshot {
  id: string;
  code: string;
  name: string;
  shares: number;
  availableShares: number;
  averageCost: number;
  openedAt: string;
  strategyId?: string;
  strategyVersion?: string;
}

export interface CompleteMonitoringAssignment extends UserMonitoringAssignment {
  actualPositions: WorkerPositionSnapshot[];
  virtualPositions: WorkerPositionSnapshot[];
  feeProfile: TradingFeeProfile;
  openTTradeCycles: WorkerTTradeCycleSnapshot[];
}

export interface WorkerRepository {
  loadMonitoringAssignments(): Promise<CompleteMonitoringAssignment[]>;
}

function assertResult<T>(table: string, result: SupabaseResult<T>): T[] {
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return result.data ?? [];
}

function numeric(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function availableByPosition(lots: LotRow[], tradingDate: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const lot of lots) {
    if (lot.trading_date >= tradingDate) continue;
    result.set(lot.position_id, (result.get(lot.position_id) ?? 0) + Math.max(0, lot.remaining_shares));
  }
  return result;
}

export function createWorkerRepository(
  client: WorkerSupabaseClient,
  options: { tradingDate?: () => string } = {},
): WorkerRepository {
  const tradingDate = options.tradingDate ?? (() => new Date().toISOString().slice(0, 10));
  return {
    async loadMonitoringAssignments() {
      const [watchlistResult, positionResult, positionLotResult, virtualResult, virtualLotResult, strategyResult, feeResult, tCycleResult]
        = await Promise.all([
          client.from<{ user_id: string; code: string }>('watchlist_items').select('user_id,code').eq('enabled', true),
          client.from<PositionRow>('positions').select('id,user_id,code,name,shares,average_cost,opened_at').gt('shares', 0),
          client.from<LotRow>('position_lots').select('user_id,position_id,remaining_shares,trading_date').gt('remaining_shares', 0),
          client.from<PositionRow>('virtual_positions').select('id,user_id,code,name,shares,average_cost,opened_at,strategy_id,strategy_version').gt('shares', 0),
          client.from<LotRow>('virtual_lots').select('user_id,position_id,remaining_shares,trading_date').gt('remaining_shares', 0),
          client.from<{ user_id: string; strategy_id: string; strategy_version: string; config: Record<string, unknown> }>('strategy_assignments')
            .select('user_id,strategy_id,strategy_version,config').eq('enabled', true),
          client.from<FeeProfileRow>('trading_fee_profiles').select('*'),
          client.from<TTradeCycleRow>('t_trade_cycles').select('*'),
        ]);

      const watchlists = assertResult('watchlist_items', watchlistResult);
      const positions = assertResult('positions', positionResult);
      const positionLots = assertResult('position_lots', positionLotResult);
      const virtualPositions = assertResult('virtual_positions', virtualResult);
      const virtualLots = assertResult('virtual_lots', virtualLotResult);
      const strategies = assertResult('strategy_assignments', strategyResult);
      const feeProfiles = assertResult('trading_fee_profiles', feeResult);
      const tCycles = assertResult('t_trade_cycles', tCycleResult);
      const users = new Set<string>([
        ...watchlists.map(row => row.user_id),
        ...positions.map(row => row.user_id),
        ...virtualPositions.map(row => row.user_id),
        ...strategies.map(row => row.user_id),
        ...feeProfiles.map(row => row.user_id),
        ...tCycles.map(row => row.user_id),
      ]);
      const date = tradingDate();
      const actualAvailability = availableByPosition(positionLots, date);
      const virtualAvailability = availableByPosition(virtualLots, date);

      return [...users].sort().map(userId => {
        const actual = positions.filter(row => row.user_id === userId).map(row => ({
          id: row.id,
          code: row.code,
          name: row.name,
          shares: row.shares,
          availableShares: actualAvailability.get(row.id) ?? 0,
          averageCost: numeric(row.average_cost),
          openedAt: row.opened_at,
        }));
        const virtual = virtualPositions.filter(row => row.user_id === userId).map(row => ({
          id: row.id,
          code: row.code,
          name: row.name,
          shares: row.shares,
          availableShares: virtualAvailability.get(row.id) ?? 0,
          averageCost: numeric(row.average_cost),
          openedAt: row.opened_at,
          strategyId: row.strategy_id,
          strategyVersion: row.strategy_version,
        }));
        const assignedStrategies: WorkerStrategyAssignment[] = strategies
          .filter(row => row.user_id === userId)
          .map(row => ({
            strategyId: row.strategy_id,
            strategyVersion: row.strategy_version,
            config: row.config ?? {},
          }));
        const feeRow = feeProfiles.find(row => row.user_id === userId);
        const feeProfile: TradingFeeProfile = feeRow ? {
          commissionRate: numeric(feeRow.commission_rate),
          minimumCommission: numeric(feeRow.minimum_commission),
          sellStampDutyRate: numeric(feeRow.sell_stamp_duty_rate),
          transferFeeRate: numeric(feeRow.transfer_fee_rate),
          slippageMode: feeRow.slippage_mode === 'fixed' ? 'fixed' : 'dynamic',
          fixedSlippageRate: numeric(feeRow.fixed_slippage_rate),
          updatedAt: feeRow.updated_at,
        } : { ...DEFAULT_TRADING_FEE_PROFILE };
        const openStatuses = new Set([
          'buyback_monitoring', 'buyback_signal_pending',
          'partially_bought_back', 'buyback_paused_risk_review', 'expired_unfilled',
        ]);
        const openTTradeCycles: WorkerTTradeCycleSnapshot[] = tCycles
          .filter(row => row.user_id === userId && openStatuses.has(row.status))
          .map(row => ({
            id: row.id,
            positionId: row.position_id,
            code: row.code,
            name: row.name,
            cycleType: row.cycle_type,
            status: row.status as WorkerTTradeCycleSnapshot['status'],
            soldShares: row.sold_shares,
            remainingBuybackShares: row.remaining_buyback_shares,
            actualSellPrice: numeric(row.actual_sell_price),
            actualSellFees: numeric(row.actual_sell_fees),
            actualSellAt: row.actual_sell_at,
            expiryRiskSentAt: row.expiry_risk_sent_at,
            expiresAt: row.expires_at,
            strategyId: row.strategy_id,
            strategyVersion: row.strategy_version,
            signalBasis: row.signal_basis_snapshot ?? {},
          }))
          .sort((left, right) => left.code.localeCompare(right.code) || left.id.localeCompare(right.id));
        return {
          userId,
          watchlistCodes: [...new Set(watchlists.filter(row => row.user_id === userId).map(row => row.code))].sort(),
          actualPositionCodes: actual.map(position => position.code).sort(),
          virtualPositionCodes: virtual.map(position => position.code).sort(),
          actualPositions: actual,
          virtualPositions: virtual,
          feeProfile,
          openTTradeCycles,
          strategies: assignedStrategies,
        };
      });
    },
  };
}
