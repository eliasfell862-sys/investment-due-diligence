import type { BacktestBarDecision } from '../../engines/market-analysis/backtest-strategy';

export const BACKTEST_SIGNAL_INBOX_KEY = 'sec_bt_signal_inbox_v2';

export type SignalPhase = 'waiting_buy' | 'buy_notified' | 'holding' | 'sell_notified';
export type SignalAlertStatus = 'pending' | 'bought' | 'sold';

export interface BacktestSignalMetrics {
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  annualReturn: number;
  profitFactor: number;
}

export interface BacktestSignalAlert {
  id: string;
  code: string;
  name: string;
  price: number;
  action: 'buy' | 'sell';
  reasons: string[];
  signalAt: string;
  status: SignalAlertStatus;
  readAt: string | null;
  executedAt: string | null;
  entryPrice: number;
  stopLoss: number;
  metrics: BacktestSignalMetrics;
}

export interface StockSignalState {
  phase: SignalPhase;
  lastDecision: BacktestBarDecision['action'];
  updatedAt: string;
}

export interface BacktestSignalInboxState {
  version: 2;
  alerts: BacktestSignalAlert[];
  stocks: Record<string, StockSignalState>;
}

export interface BacktestDecisionEvent {
  code: string;
  name: string;
  price: number;
  decision: BacktestBarDecision;
  isBuyCandidate: boolean;
  isHeld: boolean;
  signalAt: string;
  metrics: BacktestSignalMetrics;
  entryPrice: number;
  stopLoss: number;
}

export interface ApplyBacktestDecisionOptions {
  createId?: () => string;
}

export interface MarkSignalExecutedOptions {
  positionRemaining: boolean;
  executedAt: string;
}

interface StorageAccess {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultCreateId(): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `signal-${suffix}`;
}

function isInboxState(value: unknown): value is BacktestSignalInboxState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<BacktestSignalInboxState>;
  return state.version === 2 && Array.isArray(state.alerts)
    && Boolean(state.stocks) && typeof state.stocks === 'object';
}

function cloneState(state: BacktestSignalInboxState): BacktestSignalInboxState {
  return {
    version: 2,
    alerts: state.alerts.map(alert => ({
      ...alert,
      reasons: [...alert.reasons],
      metrics: { ...alert.metrics },
    })),
    stocks: Object.fromEntries(
      Object.entries(state.stocks).map(([code, stock]) => [code, { ...stock }]),
    ),
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

function createAlert(
  event: BacktestDecisionEvent,
  action: 'buy' | 'sell',
  createId: () => string,
): BacktestSignalAlert {
  return {
    id: createId(),
    code: event.code,
    name: event.name,
    price: event.price,
    action,
    reasons: [...event.decision.reasons],
    signalAt: event.signalAt,
    status: 'pending',
    readAt: null,
    executedAt: null,
    entryPrice: event.entryPrice,
    stopLoss: event.stopLoss,
    metrics: { ...event.metrics },
  };
}

export function createEmptySignalInbox(): BacktestSignalInboxState {
  return { version: 2, alerts: [], stocks: {} };
}

export function loadSignalInbox(
  storage: Pick<StorageAccess, 'getItem'> = localStorage,
): BacktestSignalInboxState {
  try {
    const raw = storage.getItem(BACKTEST_SIGNAL_INBOX_KEY);
    if (!raw) return createEmptySignalInbox();
    const parsed: unknown = JSON.parse(raw);
    return isInboxState(parsed) ? cloneState(parsed) : createEmptySignalInbox();
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
    phase: event.isHeld ? 'holding' : 'waiting_buy',
    lastDecision: 'hold',
    updatedAt: event.signalAt,
  };
  let phase: SignalPhase = previous.phase;
  let createdAlert: BacktestSignalAlert | null = null;

  if (event.isHeld) {
    if (event.decision.action === 'sell') {
      if (previous.lastDecision !== 'sell' && previous.phase !== 'sell_notified') {
        createdAlert = createAlert(event, 'sell', options.createId ?? defaultCreateId);
        phase = 'sell_notified';
      }
    } else {
      phase = 'holding';
    }
  } else if (event.isBuyCandidate && event.decision.action === 'buy') {
    if (previous.lastDecision !== 'buy' && previous.phase !== 'buy_notified') {
      createdAlert = createAlert(event, 'buy', options.createId ?? defaultCreateId);
      phase = 'buy_notified';
    }
  } else {
    phase = 'waiting_buy';
  }

  state.stocks[event.code] = {
    phase,
    lastDecision: event.decision.action,
    updatedAt: event.signalAt,
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
    ? { ...alert, readAt }
    : alert);
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
  const current = state.stocks[alert.code] ?? {
    phase: 'waiting_buy' as const,
    lastDecision: alert.action,
    updatedAt: options.executedAt,
  };
  state.stocks[alert.code] = {
    phase: status === 'bought' || options.positionRemaining ? 'holding' : 'waiting_buy',
    lastDecision: current.lastDecision,
    updatedAt: options.executedAt,
  };
  return state;
}

export function clearSignalAlerts(
  inputState: BacktestSignalInboxState,
): BacktestSignalInboxState {
  const state = cloneState(inputState);
  state.alerts = [];
  return state;
}
