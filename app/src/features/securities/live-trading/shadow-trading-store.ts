import type { LiveTradeIntentKind, ShadowFill, ShadowOrder } from './live-trading-types';

export const SHADOW_TRADING_STORAGE_VERSION = 1;
export const SHADOW_TRADING_STORAGE_PREFIX = 'sec_live_shadow_v1:';

interface TReserve {
  fillId: string;
  amount: number;
}

interface StoredShadowState {
  version: 1;
  accountId: string;
  orders: ShadowOrder[];
  fills: ShadowFill[];
  tReserves: TReserve[];
  riskSnapshots: unknown[];
  qualificationOutcomes: unknown[];
  bridgeProbeSummaries: unknown[];
}

export interface ShadowTradingSnapshot extends StoredShadowState {
  reservedTBuybackCash: number;
}

function emptyState(accountId: string): StoredShadowState {
  return {
    version: SHADOW_TRADING_STORAGE_VERSION,
    accountId,
    orders: [],
    fills: [],
    tReserves: [],
    riskSnapshots: [],
    qualificationOutcomes: [],
    bridgeProbeSummaries: [],
  };
}

function loadState(storage: Pick<Storage, 'getItem'>, accountId: string): StoredShadowState {
  const raw = storage.getItem(`${SHADOW_TRADING_STORAGE_PREFIX}${accountId}`);
  if (!raw) return emptyState(accountId);
  try {
    const parsed = JSON.parse(raw) as StoredShadowState;
    if (parsed.accountId !== accountId) throw new Error('cross_account_shadow_state');
    if (parsed.version !== SHADOW_TRADING_STORAGE_VERSION) return emptyState(accountId);
    return {
      ...emptyState(accountId),
      ...parsed,
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      fills: Array.isArray(parsed.fills) ? parsed.fills : [],
      tReserves: Array.isArray(parsed.tReserves) ? parsed.tReserves : [],
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'cross_account_shadow_state') throw error;
    return emptyState(accountId);
  }
}

export function createShadowTradingStore(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  accountId: string,
) {
  if (!accountId.trim()) throw new Error('shadow_account_required');
  let state = loadState(storage, accountId);
  const persist = () => storage.setItem(`${SHADOW_TRADING_STORAGE_PREFIX}${accountId}`, JSON.stringify(state));
  const reserved = () => state.tReserves.reduce((sum, item) => sum + item.amount, 0);

  return {
    append(order: ShadowOrder): void {
      if (state.orders.some(existing => existing.idempotencyKey === order.idempotencyKey)) {
        throw new Error('duplicate_shadow_order');
      }
      state = { ...state, orders: [...state.orders, { ...order }] };
      persist();
    },
    replace(order: ShadowOrder): void {
      const index = state.orders.findIndex(existing => existing.id === order.id);
      if (index < 0) throw new Error('shadow_order_not_found');
      const orders = [...state.orders];
      orders[index] = { ...order };
      state = { ...state, orders };
      persist();
    },
    recordFill(fill: ShadowFill): void {
      if (state.fills.some(existing => existing.id === fill.id)) return;
      state = { ...state, fills: [...state.fills, { ...fill }] };
      persist();
    },
    recordTSellFill(fill: ShadowFill, expectedBuybackFees: number): void {
      if (fill.side !== 'sell' || expectedBuybackFees < 0) throw new Error('invalid_t_sell_fill');
      if (state.tReserves.some(existing => existing.fillId === fill.id)) return;
      const amount = fill.price * fill.shares + expectedBuybackFees;
      state = {
        ...state,
        fills: state.fills.some(existing => existing.id === fill.id) ? state.fills : [...state.fills, { ...fill }],
        tReserves: [...state.tReserves, { fillId: fill.id, amount }],
      };
      persist();
    },
    resolveTReserve(fillId: string): void {
      state = { ...state, tReserves: state.tReserves.filter(item => item.fillId !== fillId) };
      persist();
    },
    availableCashFor(kind: LiveTradeIntentKind, availableCash: number): number {
      return kind === 'core_buy' ? Math.max(0, availableCash - reserved()) : availableCash;
    },
    snapshot(): ShadowTradingSnapshot {
      return JSON.parse(JSON.stringify({ ...state, reservedTBuybackCash: reserved() })) as ShadowTradingSnapshot;
    },
  };
}

export function calculateShadowQualification(orders: ShadowOrder[]): { validTerminalOrders: number; blockingFailures: number } {
  const terminalStatuses = new Set(['filled', 'cancelled', 'expired']);
  const blockingKinds = new Set(['wrong_code', 'duplicate_execution']);
  return {
    validTerminalOrders: orders.filter(order => terminalStatuses.has(order.status) && !order.failureKind).length,
    blockingFailures: orders.filter(order => order.failureKind && blockingKinds.has(order.failureKind)).length,
  };
}
