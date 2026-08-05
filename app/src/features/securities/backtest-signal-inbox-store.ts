import type { BacktestBarDecision } from '../../engines/market-analysis/backtest-strategy';
import { selectSignalTrade, type SignalIntent } from './signal-trade-recommendation';

export const BACKTEST_SIGNAL_INBOX_KEY = 'sec_bt_signal_inbox_v2';
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
interface StorageAccess { getItem(key: string): string | null; setItem(key: string, value: string): void; }

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

export function markSignalAlertRead(
  inputState: BacktestSignalInboxState,
  alertId: string,
  readAt: string,
): BacktestSignalInboxState {
  const state = cloneState(inputState);
  state.alerts = state.alerts.map(alert => alert.id === alertId && !alert.readAt
    ? { ...alert, readAt } : alert);
  return state;
}

export function markSignalAlertExecuted(
  inputState: BacktestSignalInboxState,
  alertId: string,
  status: Extract<SignalAlertStatus, 'bought' | 'sold'>,
  options: MarkSignalExecutedOptions,
): BacktestSignalInboxState {
  const state = cloneState(inputState);
  const alert = state.alerts.find(item => item.id === alertId);
  if (!alert) throw new Error('信号消息不存在');
  if (alert.status !== 'pending') throw new Error('该信号已经执行');
  if ((alert.action === 'buy' && status !== 'bought') || (alert.action === 'sell' && status !== 'sold')) {
    throw new Error('信号执行状态不匹配');
  }
  state.alerts = state.alerts.map(item => item.id === alertId
    ? { ...item, status, executedAt: options.executedAt, readAt: item.readAt ?? options.executedAt }
    : item);
  return state;
}

export function clearSignalAlerts(inputState: BacktestSignalInboxState): BacktestSignalInboxState {
  const state = cloneState(inputState);
  state.alerts = [];
  return state;
}
