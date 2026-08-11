import { DEFAULT_TRADING_FEE_PROFILE } from './trading-fee-engine';
import type {
  LocalTTradingState,
  TTradeCycle,
  TTradeExecution,
  TradingFeeProfile,
} from './t-trading-types';

export const LOCAL_T_TRADING_STORAGE_KEY = 'sec_actual_t_runtime_v1';
export const LOCAL_T_TRADING_EVENT = 'sec-actual-t-runtime-changed';

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter {
  setItem(key: string, value: string): void;
}

export class LocalTTradingStateCorruptionError extends Error {
  readonly code = 'local_t_trading_state_corrupt';

  constructor(message = 'Local T-trading state is corrupt') {
    super(message);
    this.name = 'LocalTTradingStateCorruptionError';
  }
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isFeeProfile(value: unknown): value is TradingFeeProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<TradingFeeProfile>;
  return isFiniteNonNegative(profile.commissionRate)
    && isFiniteNonNegative(profile.minimumCommission)
    && isFiniteNonNegative(profile.sellStampDutyRate)
    && isFiniteNonNegative(profile.transferFeeRate)
    && (profile.slippageMode === 'dynamic' || profile.slippageMode === 'fixed')
    && isFiniteNonNegative(profile.fixedSlippageRate)
    && (profile.updatedAt === null || typeof profile.updatedAt === 'string');
}

function isExecution(value: unknown): value is TTradeExecution {
  if (!value || typeof value !== 'object') return false;
  const execution = value as Partial<TTradeExecution>;
  return typeof execution.id === 'string'
    && typeof execution.idempotencyKey === 'string'
    && (execution.side === 'sell' || execution.side === 'buyback')
    && typeof execution.price === 'number'
    && Number.isFinite(execution.price)
    && typeof execution.shares === 'number'
    && Number.isInteger(execution.shares)
    && execution.shares > 0
    && execution.shares % 100 === 0
    && isFiniteNonNegative(execution.totalFees)
    && typeof execution.executedAt === 'string';
}

function isCycle(value: unknown): value is TTradeCycle {
  if (!value || typeof value !== 'object') return false;
  const cycle = value as Partial<TTradeCycle>;
  return typeof cycle.id === 'string'
    && typeof cycle.positionId === 'string'
    && typeof cycle.code === 'string'
    && (cycle.cycleType === 'profit_t' || cycle.cycleType === 'cost_reduction_t')
    && typeof cycle.status === 'string'
    && typeof cycle.soldShares === 'number'
    && typeof cycle.remainingBuybackShares === 'number'
    && Array.isArray(cycle.riskReviewReasons)
    && Array.isArray(cycle.executions)
    && cycle.executions.every(isExecution);
}

function isState(value: unknown): value is LocalTTradingState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<LocalTTradingState>;
  return state.version === 1
    && isFeeProfile(state.feeProfile)
    && Array.isArray(state.cycles)
    && state.cycles.every(isCycle);
}

function cloneState(state: LocalTTradingState): LocalTTradingState {
  return {
    version: 1,
    feeProfile: { ...state.feeProfile },
    cycles: state.cycles.map((cycle) => ({
      ...cycle,
      riskReviewReasons: [...cycle.riskReviewReasons],
      executions: cycle.executions.map((execution) => ({ ...execution })),
    })),
  };
}

export function createEmptyLocalTTradingState(): LocalTTradingState {
  return {
    version: 1,
    feeProfile: { ...DEFAULT_TRADING_FEE_PROFILE },
    cycles: [],
  };
}

export function loadLocalTTradingState(
  storage: StorageReader = localStorage,
): LocalTTradingState {
  const raw = storage.getItem(LOCAL_T_TRADING_STORAGE_KEY);
  if (raw === null) return createEmptyLocalTTradingState();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isState(parsed)) throw new LocalTTradingStateCorruptionError();
    return cloneState(parsed);
  } catch (error) {
    if (error instanceof LocalTTradingStateCorruptionError) throw error;
    throw new LocalTTradingStateCorruptionError();
  }
}

export function saveLocalTTradingState(
  state: LocalTTradingState,
  storage: StorageWriter = localStorage,
): void {
  if (!isState(state)) throw new LocalTTradingStateCorruptionError('Invalid state was not saved');
  storage.setItem(LOCAL_T_TRADING_STORAGE_KEY, JSON.stringify(state));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCAL_T_TRADING_EVENT));
}
