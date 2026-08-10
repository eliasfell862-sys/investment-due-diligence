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
      const [watchlistResult, positionResult, positionLotResult, virtualResult, virtualLotResult, strategyResult]
        = await Promise.all([
          client.from<{ user_id: string; code: string }>('watchlist_items').select('user_id,code').eq('enabled', true),
          client.from<PositionRow>('positions').select('id,user_id,code,name,shares,average_cost,opened_at').gt('shares', 0),
          client.from<LotRow>('position_lots').select('user_id,position_id,remaining_shares,trading_date').gt('remaining_shares', 0),
          client.from<PositionRow>('virtual_positions').select('id,user_id,code,name,shares,average_cost,opened_at,strategy_id,strategy_version').gt('shares', 0),
          client.from<LotRow>('virtual_lots').select('user_id,position_id,remaining_shares,trading_date').gt('remaining_shares', 0),
          client.from<{ user_id: string; strategy_id: string; strategy_version: string; config: Record<string, unknown> }>('strategy_assignments')
            .select('user_id,strategy_id,strategy_version,config').eq('enabled', true),
        ]);

      const watchlists = assertResult('watchlist_items', watchlistResult);
      const positions = assertResult('positions', positionResult);
      const positionLots = assertResult('position_lots', positionLotResult);
      const virtualPositions = assertResult('virtual_positions', virtualResult);
      const virtualLots = assertResult('virtual_lots', virtualLotResult);
      const strategies = assertResult('strategy_assignments', strategyResult);
      const users = new Set<string>([
        ...watchlists.map(row => row.user_id),
        ...positions.map(row => row.user_id),
        ...virtualPositions.map(row => row.user_id),
        ...strategies.map(row => row.user_id),
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
        return {
          userId,
          watchlistCodes: [...new Set(watchlists.filter(row => row.user_id === userId).map(row => row.code))].sort(),
          actualPositionCodes: actual.map(position => position.code).sort(),
          virtualPositionCodes: virtual.map(position => position.code).sort(),
          actualPositions: actual,
          virtualPositions: virtual,
          strategies: assignedStrategies,
        };
      });
    },
  };
}
