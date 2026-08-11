import type { BacktestBarDecision } from '../../engines/market-analysis/backtest-strategy';
import { selectSignalTrade, type SignalIntent } from './signal-trade-recommendation';
import {
  createEmptyVirtualTradingLedger,
  type VirtualTradingLedger,
} from './virtual-trading-ledger';

export const BACKTEST_SIGNAL_INBOX_KEY = 'sec_bt_signal_inbox_v2';
export const BACKTEST_SIGNAL_RUNTIME_KEY = 'sec_bt_signal_runtime_v3';
export type SignalAlertStatus = 'pending' | 'bought' | 'sold';

export interface BacktestSignalMetrics {
  totalTrades: number; winRate: number; sharpeRatio: number;
  maxDrawdown: number; annualReturn: number; profitFactor: number;
}

export interface BacktestSignalAlert {
  id: string; code: string; name: string; price: number;
  action: 'buy' | 'sell'; intent: SignalIntent;
  suggestedShares: number; positionSharesAtSignal: number; availableSharesAtSignal: number;
  reasons: string[]; signalAt: string; status: SignalAlertStatus;
  readAt: string | null; executedAt: string | null;
  entryPrice: number; stopLoss: number; metrics: BacktestSignalMetrics;
}

export interface StockSignalState {
  lastBuyDecision: 'buy' | 'hold';
  lastSellDecision: 'sell' | 'hold';
  updatedAt: string;
}

export interface BacktestSignalInboxState {
  version: 2;
  alerts: BacktestSignalAlert[];
  stocks: Record<string, StockSignalState>;
}

export type TTradeMessageKind =
  | 'actual_t_sell'
  | 'actual_t_buyback'
  | 'actual_t_expiry_risk'
  | 'actual_t_risk_review';

export interface TTradeAlertPayload {
  kind: TTradeMessageKind;
  cycleId: string | null;
  positionId: string;
  cycleType: 'profit_t' | 'cost_reduction_t';
  sellRange: [number, number] | null;
  buybackRange: [number, number] | null;
  targetRange: [number, number] | null;
  expectedNetProfit: number;
  expectedRoundTripFees: number;
  riskBuffer: number;
  atr20: number;
  atrp20: number;
  support: number;
  resistance: number;
  volumeRatio20: number;
  flowBias: string;
  actualSellPrice: number;
  remainingBuybackShares: number;
  expiresAt: string | null;
  confirmations: string[];
  reasons: string[];
  sampleStatus?: string;
}

const tRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object'
  ? value as Record<string, unknown> : {};
const tNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const tStrings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string') : [];
const tRange = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const low = tNumber(value[0]);
  const high = tNumber(value[1]);
  return low > 0 && high > 0 ? [low, high] : null;
};

export function parseTTradeAlertPayload(
  messageKind: string,
  metadataValue: unknown,
  cycleId: string | null,
): TTradeAlertPayload | null {
  if (!['actual_t_sell', 'actual_t_buyback', 'actual_t_expiry_risk', 'actual_t_risk_review'].includes(messageKind)) {
    return null;
  }
  const metadata = tRecord(metadataValue);
  const fees = tRecord(metadata.expected_round_trip_fees);
  const sellRange = tRange(metadata.sell_range) ?? (
    tNumber(metadata.sell_low) > 0 && tNumber(metadata.sell_high) > 0
      ? [tNumber(metadata.sell_low), tNumber(metadata.sell_high)] : null
  );
  const buybackRange = tRange(metadata.buyback_range) ?? (
    tNumber(metadata.buyback_low) > 0 && tNumber(metadata.buyback_high) > 0
      ? [tNumber(metadata.buyback_low), tNumber(metadata.buyback_high)] : null
  );
  return {
    kind: messageKind as TTradeMessageKind,
    cycleId,
    positionId: typeof metadata.position_id === 'string' ? metadata.position_id : '',
    cycleType: metadata.cycle_type === 'cost_reduction_t' ? 'cost_reduction_t' : 'profit_t',
    sellRange,
    buybackRange,
    targetRange: tRange(metadata.target_range),
    expectedNetProfit: tNumber(metadata.expected_net_profit),
    expectedRoundTripFees: tNumber(fees.total ?? metadata.expected_round_trip_fees),
    riskBuffer: tNumber(metadata.risk_buffer),
    atr20: tNumber(metadata.atr20),
    atrp20: tNumber(metadata.atrp20),
    support: tNumber(metadata.support),
    resistance: tNumber(metadata.resistance),
    volumeRatio20: tNumber(metadata.volume_ratio20),
    flowBias: typeof metadata.flow_bias === 'string' ? metadata.flow_bias : '',
    actualSellPrice: tNumber(metadata.actual_sell_price),
    remainingBuybackShares: tNumber(metadata.remaining_buyback_shares),
    expiresAt: typeof metadata.expires_at === 'string' ? metadata.expires_at : null,
    confirmations: tStrings(metadata.confirmations),
    reasons: tStrings(metadata.reasons),
    sampleStatus: typeof metadata.sample_status === 'string' ? metadata.sample_status : undefined,
  };
}

export type VirtualTrackingStatus =
  | 'executed'
  | 'blocked_t1'
  | 'pending_t1'
  | 'cancelled_revalidation'
  | 'actual_risk_only'
  | 'legacy_untracked';

export interface BacktestSignalAlertV3 extends BacktestSignalAlert {
  messageKind: 'virtual_execution' | 'virtual_blocked' | 'virtual_pending' | 'actual_position_risk' | 'legacy' | TTradeMessageKind;
  virtualTrackingStatus: VirtualTrackingStatus;
  virtualTradeId: string | null;
  virtualCycleId: string | null;
  virtualShares: number;
  virtualPrice: number | null;
  virtualPositionSharesAfter: number | null;
  virtualAvailableSharesAfter: number | null;
  strategyId: string;
  strategyVersion: string;
  tTrade: TTradeAlertPayload | null;
}

export interface PendingVirtualSell {
  alertId: string;
  cycleId: string;
  executableOn: string;
  createdAt: string;
  desiredShares: number;
  reasons: string[];
  exitReason: 'signal' | 'stop_loss' | 'timeout';
}

export interface StockSignalStateV3 extends StockSignalState {
  blockedSellUntil: string | null;
  blockedSellNotifiedOn: string | null;
  pendingVirtualSell?: PendingVirtualSell | null;
}

export interface BacktestSignalRuntimeState {
  version: 3;
  alerts: BacktestSignalAlertV3[];
  stocks: Record<string, StockSignalStateV3>;
  virtualLedger: VirtualTradingLedger;
}

export interface BacktestDecisionEvent {
  code: string; name: string; price: number;
  buyDecision?: BacktestBarDecision; sellDecision?: BacktestBarDecision;
  decision?: BacktestBarDecision;
  isBuyCandidate: boolean; isHeld: boolean; positionShares?: number; availableShares?: number;
  signalAt: string; metrics: BacktestSignalMetrics;
  entryPrice: number; stopLoss: number;
}

export interface ApplyBacktestDecisionOptions { createId?: () => string; }
export interface MarkSignalExecutedOptions { positionRemaining: boolean; executedAt: string; }
export interface StorageAccess { getItem(key: string): string | null; setItem(key: string, value: string): void; }

interface LegacyBacktestSignalAlert extends Omit<BacktestSignalAlert, 'intent' | 'suggestedShares' | 'positionSharesAtSignal' | 'availableSharesAtSignal'> {
  intent?: SignalIntent;
  suggestedShares?: number;
  positionSharesAtSignal?: number;
  availableSharesAtSignal?: number;
}
interface LegacyStockSignalState {
  phase?: 'waiting_buy' | 'buy_notified' | 'holding' | 'sell_notified';
  lastDecision?: BacktestBarDecision['action'];
  lastBuyDecision?: 'buy' | 'hold';
  lastSellDecision?: 'sell' | 'hold';
  updatedAt?: string;
}

function defaultCreateId(): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `signal-${suffix}`;
}

function isInboxState(value: unknown): value is {
  version: 2;
  alerts: LegacyBacktestSignalAlert[];
  stocks: Record<string, LegacyStockSignalState>;
} {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<BacktestSignalInboxState>;
  return state.version === 2 && Array.isArray(state.alerts)
    && Boolean(state.stocks) && typeof state.stocks === 'object';
}

function normalizeAlert(alert: LegacyBacktestSignalAlert): BacktestSignalAlert {
  const action = alert.action === 'sell' ? 'sell' : 'buy';
  return {
    ...alert,
    action,
    intent: alert.intent ?? (action === 'buy' ? 'open' : 'exit'),
    suggestedShares: Number.isInteger(alert.suggestedShares) && (alert.suggestedShares ?? 0) >= 0
      ? alert.suggestedShares ?? 0
      : action === 'buy' ? 100 : 0,
    positionSharesAtSignal: Number.isInteger(alert.positionSharesAtSignal)
      && (alert.positionSharesAtSignal ?? 0) >= 0
      ? alert.positionSharesAtSignal ?? 0
      : 0,
    availableSharesAtSignal: Number.isInteger(alert.availableSharesAtSignal)
      && (alert.availableSharesAtSignal ?? 0) >= 0
      ? alert.availableSharesAtSignal ?? 0
      : alert.positionSharesAtSignal ?? 0,
    reasons: Array.isArray(alert.reasons) ? [...alert.reasons] : [],
    metrics: { ...alert.metrics },
  };
}

function normalizeStockState(state: LegacyStockSignalState): StockSignalState {
  const legacyDecision = state.lastDecision;
  return {
    lastBuyDecision: state.lastBuyDecision
      ?? (legacyDecision === 'buy' || state.phase === 'buy_notified' ? 'buy' : 'hold'),
    lastSellDecision: state.lastSellDecision
      ?? (legacyDecision === 'sell' || state.phase === 'sell_notified' ? 'sell' : 'hold'),
    updatedAt: state.updatedAt ?? '',
  };
}

function cloneState(state: BacktestSignalInboxState): BacktestSignalInboxState {
  return {
    version: 2,
    alerts: state.alerts.map(alert => normalizeAlert(alert)),
    stocks: Object.fromEntries(Object.entries(state.stocks)
      .map(([code, stock]) => [code, normalizeStockState(stock)])),
  };
}

function trimAlerts(alerts: BacktestSignalAlert[]): BacktestSignalAlert[] {
  const result = [...alerts];
  while (result.length > 100) {
    const executedIndex = result.findIndex(alert => alert.status !== 'pending');
    result.splice(executedIndex >= 0 ? executedIndex : 0, 1);
  }
  return result;
}

function eventDecisions(event: BacktestDecisionEvent) {
  const fallback = event.decision ?? { action: 'hold' as const, reasons: [] };
  return {
    buyDecision: event.buyDecision
      ?? (fallback.action === 'buy' ? fallback : { action: 'hold' as const, reasons: [] }),
    sellDecision: event.sellDecision
      ?? (fallback.action === 'sell' ? fallback : { action: 'hold' as const, reasons: [] }),
  };
}

function createAlert(
  event: BacktestDecisionEvent,
  recommendation: NonNullable<ReturnType<typeof selectSignalTrade>>,
  createId: () => string,
): BacktestSignalAlert {
  return {
    id: createId(), code: event.code, name: event.name, price: event.price,
    action: recommendation.action, intent: recommendation.intent,
    suggestedShares: recommendation.suggestedShares,
    positionSharesAtSignal: event.positionShares ?? 0,
    availableSharesAtSignal: event.availableShares ?? event.positionShares ?? 0,
    reasons: [...recommendation.decision.reasons], signalAt: event.signalAt,
    status: 'pending', readAt: null, executedAt: null,
    entryPrice: event.entryPrice, stopLoss: event.stopLoss, metrics: { ...event.metrics },
  };
}

export function createEmptySignalInbox(): BacktestSignalInboxState {
  return { version: 2, alerts: [], stocks: {} };
}

export function loadSignalInbox(storage: Pick<StorageAccess, 'getItem'> = localStorage): BacktestSignalInboxState {
  try {
    const raw = storage.getItem(BACKTEST_SIGNAL_INBOX_KEY);
    if (!raw) return createEmptySignalInbox();
    const parsed: unknown = JSON.parse(raw);
    if (!isInboxState(parsed)) return createEmptySignalInbox();
    return {
      version: 2,
      alerts: parsed.alerts.map(normalizeAlert),
      stocks: Object.fromEntries(Object.entries(parsed.stocks)
        .map(([code, stock]) => [code, normalizeStockState(stock)])),
    };
  } catch {
    return createEmptySignalInbox();
  }
}

export function saveSignalInbox(
  state: BacktestSignalInboxState,
  storage: Pick<StorageAccess, 'setItem'> = localStorage,
): void {
  storage.setItem(BACKTEST_SIGNAL_INBOX_KEY, JSON.stringify(state));
}

export function applyBacktestDecision(
  inputState: BacktestSignalInboxState,
  event: BacktestDecisionEvent,
  options: ApplyBacktestDecisionOptions = {},
): { state: BacktestSignalInboxState; createdAlert: BacktestSignalAlert | null } {
  const state = cloneState(inputState);
  const previous = state.stocks[event.code] ?? {
    lastBuyDecision: 'hold' as const, lastSellDecision: 'hold' as const, updatedAt: event.signalAt,
  };
  const { buyDecision, sellDecision } = eventDecisions(event);
  const recommendation = selectSignalTrade({
    isBuyCandidate: event.isBuyCandidate,
    isHeld: event.isHeld,
    positionShares: event.positionShares ?? 0,
    availableShares: event.availableShares ?? event.positionShares ?? 0,
    buyDecision,
    sellDecision,
  });
  const buyDirection = (event.isHeld || event.isBuyCandidate) && buyDecision.action === 'buy'
    ? 'buy' as const : 'hold' as const;
  const sellDirection = recommendation?.action === 'sell'
    ? 'sell' as const : 'hold' as const;
  const isNewEdge = recommendation?.action === 'buy'
    ? previous.lastBuyDecision !== 'buy'
    : recommendation?.action === 'sell'
      ? previous.lastSellDecision !== 'sell'
      : false;
  const createdAlert = recommendation && isNewEdge
    ? createAlert(event, recommendation, options.createId ?? defaultCreateId)
    : null;

  state.stocks[event.code] = {
    lastBuyDecision: buyDirection, lastSellDecision: sellDirection, updatedAt: event.signalAt,
  };
  if (createdAlert) state.alerts = trimAlerts([...state.alerts, createdAlert]);
  return { state, createdAlert };
}

function updateAlertRead<T extends BacktestSignalAlert>(
  alerts: T[],
  alertId: string,
  readAt: string,
): T[] {
  return alerts.map(alert => alert.id === alertId && !alert.readAt
    ? { ...alert, readAt } : alert);
}

function updateAlertExecuted<T extends BacktestSignalAlert>(
  alerts: T[],
  alertId: string,
  status: Extract<SignalAlertStatus, 'bought' | 'sold'>,
  options: MarkSignalExecutedOptions,
): T[] {
  const alert = alerts.find(item => item.id === alertId);
  if (!alert) throw new Error('信号消息不存在');
  if (alert.status !== 'pending') throw new Error('该信号已经执行');
  if ((alert.action === 'buy' && status !== 'bought') || (alert.action === 'sell' && status !== 'sold')) {
    throw new Error('信号执行状态不匹配');
  }
  return alerts.map(item => item.id === alertId
    ? { ...item, status, executedAt: options.executedAt, readAt: item.readAt ?? options.executedAt }
    : item);
}

export function markSignalAlertRead<T extends BacktestSignalInboxState | BacktestSignalRuntimeState>(
  inputState: T,
  alertId: string,
  readAt: string,
): T {
  if (inputState.version === 3) {
    const state = cloneRuntimeState(inputState);
    state.alerts = updateAlertRead(state.alerts, alertId, readAt);
    return state as T;
  }
  const state = cloneState(inputState);
  state.alerts = updateAlertRead(state.alerts, alertId, readAt);
  return state as T;
}

export function markSignalAlertExecuted<T extends BacktestSignalInboxState | BacktestSignalRuntimeState>(
  inputState: T,
  alertId: string,
  status: Extract<SignalAlertStatus, 'bought' | 'sold'>,
  options: MarkSignalExecutedOptions,
): T {
  if (inputState.version === 3) {
    const state = cloneRuntimeState(inputState);
    state.alerts = updateAlertExecuted(state.alerts, alertId, status, options);
    return state as T;
  }
  const state = cloneState(inputState);
  state.alerts = updateAlertExecuted(state.alerts, alertId, status, options);
  return state as T;
}

export function clearSignalAlerts<T extends BacktestSignalInboxState | BacktestSignalRuntimeState>(
  inputState: T,
): T {
  if (inputState.version === 3) {
    const state = cloneRuntimeState(inputState);
    state.alerts = [];
    return state as T;
  }
  const state = cloneState(inputState);
  state.alerts = [];
  return state as T;
}
export class SignalRuntimeCorruptionError extends Error {
  readonly code = 'signal_runtime_corrupt';

  constructor(message = '前向模拟数据损坏，请导出或清理后重试') {
    super(message);
    this.name = 'SignalRuntimeCorruptionError';
  }
}

function cloneRuntimeState(state: BacktestSignalRuntimeState): BacktestSignalRuntimeState {
  return {
    version: 3,
    alerts: state.alerts.map(alert => ({
      ...alert,
      reasons: [...alert.reasons],
      metrics: { ...alert.metrics },
      tTrade: alert.tTrade ? { ...alert.tTrade, confirmations: [...alert.tTrade.confirmations], reasons: [...alert.tTrade.reasons] } : null,
    })),
    stocks: Object.fromEntries(Object.entries(state.stocks).map(([code, stock]) => [
      code,
      {
        ...stock,
        pendingVirtualSell: stock.pendingVirtualSell
          ? { ...stock.pendingVirtualSell, reasons: [...stock.pendingVirtualSell.reasons] }
          : null,
      },
    ])),
    virtualLedger: {
      version: 1,
      positions: state.virtualLedger.positions.map(position => ({
        ...position,
        sourceTradeIds: [...position.sourceTradeIds],
      })),
      transactions: state.virtualLedger.transactions.map(transaction => ({
        ...transaction,
        reasons: [...transaction.reasons],
      })),
      cycles: state.virtualLedger.cycles.map(cycle => ({
        ...cycle,
        transactionIds: [...cycle.transactionIds],
      })),
    },
  };
}

function isRuntimeState(value: unknown): value is BacktestSignalRuntimeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<BacktestSignalRuntimeState>;
  if (state.version !== 3 || !Array.isArray(state.alerts)
    || !state.stocks || typeof state.stocks !== 'object'
    || !state.virtualLedger || typeof state.virtualLedger !== 'object') return false;
  const ledger = state.virtualLedger as Partial<VirtualTradingLedger>;
  return ledger.version === 1
    && Array.isArray(ledger.positions)
    && Array.isArray(ledger.transactions)
    && Array.isArray(ledger.cycles)
    && state.alerts.every(alert => Boolean(alert)
      && typeof alert === 'object'
      && typeof (alert as BacktestSignalAlertV3).messageKind === 'string'
      && typeof (alert as BacktestSignalAlertV3).virtualTrackingStatus === 'string');
}

function migrateLegacyAlert(alert: LegacyBacktestSignalAlert): BacktestSignalAlertV3 {
  const normalized = normalizeAlert(alert);
  return {
    ...normalized,
    messageKind: 'legacy',
    virtualTrackingStatus: 'legacy_untracked',
    virtualTradeId: null,
    virtualCycleId: null,
    virtualShares: 0,
    virtualPrice: null,
    virtualPositionSharesAfter: null,
    virtualAvailableSharesAfter: null,
    strategyId: 'legacy-v2',
    strategyVersion: '2',
  tTrade: null,
  };
}

export function createEmptySignalRuntime(): BacktestSignalRuntimeState {
  return {
    version: 3,
    alerts: [],
    stocks: {},
    virtualLedger: createEmptyVirtualTradingLedger(),
  };
}

export function loadSignalRuntime(
  storage: Pick<StorageAccess, 'getItem'> = localStorage,
): BacktestSignalRuntimeState {
  const runtimeRaw = storage.getItem(BACKTEST_SIGNAL_RUNTIME_KEY);
  if (runtimeRaw !== null) {
    try {
      const parsed: unknown = JSON.parse(runtimeRaw);
      if (!isRuntimeState(parsed)) throw new SignalRuntimeCorruptionError();
      return cloneRuntimeState(parsed);
    } catch (error) {
      if (error instanceof SignalRuntimeCorruptionError) throw error;
      throw new SignalRuntimeCorruptionError();
    }
  }

  const legacyRaw = storage.getItem(BACKTEST_SIGNAL_INBOX_KEY);
  if (legacyRaw === null) return createEmptySignalRuntime();
  try {
    const parsed: unknown = JSON.parse(legacyRaw);
    if (!isInboxState(parsed)) return createEmptySignalRuntime();
    return {
      version: 3,
      alerts: parsed.alerts.map(migrateLegacyAlert),
      stocks: Object.fromEntries(Object.entries(parsed.stocks).map(([code, stock]) => {
        const normalized = normalizeStockState(stock);
        return [code, {
          ...normalized,
          blockedSellUntil: null,
          blockedSellNotifiedOn: null,
          pendingVirtualSell: null,
        }];
      })),
      virtualLedger: createEmptyVirtualTradingLedger(),
    };
  } catch {
    return createEmptySignalRuntime();
  }
}

export function saveSignalRuntime(
  state: BacktestSignalRuntimeState,
  storage: Pick<StorageAccess, 'setItem'> = localStorage,
): void {
  if (!isRuntimeState(state)) throw new SignalRuntimeCorruptionError('前向模拟状态无效，未写入存储');
  storage.setItem(BACKTEST_SIGNAL_RUNTIME_KEY, JSON.stringify(state));
}

export function trimRuntimeAlerts(
  alerts: BacktestSignalAlertV3[],
  limit = 100,
): BacktestSignalAlertV3[] {
  const result = alerts.map(alert => ({
    ...alert,
    reasons: [...alert.reasons],
    metrics: { ...alert.metrics },
  }));
  while (result.length > limit) {
    const executedIndex = result.findIndex(alert => alert.status !== 'pending');
    result.splice(executedIndex >= 0 ? executedIndex : 0, 1);
  }
  return result;
}
