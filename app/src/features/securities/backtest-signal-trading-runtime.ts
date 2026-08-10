import { nextAStockTradingDay, shanghaiDateKey } from './a-share-trading-calendar';
import {
  trimRuntimeAlerts,
  type BacktestSignalAlertV3,
  type BacktestSignalRuntimeState,
  type StockSignalStateV3,
} from './backtest-signal-inbox-store';
import type { BacktestDecisionEvent } from './realtime-backtest-monitor';
import { calculateTechnicalSellShares } from './signal-trade-recommendation';
import {
  buyVirtualPosition,
  calculateVirtualAvailability,
  findVirtualPosition,
  sellVirtualPosition,
  type VirtualLedgerOptions,
  type VirtualTransaction,
} from './virtual-trading-ledger';

export interface ApplySignalEventOptions {
  createSignalId?: () => string;
  createLedgerId?: VirtualLedgerOptions['createId'];
}

export interface ApplySignalEventResult {
  state: BacktestSignalRuntimeState;
  createdAlerts: BacktestSignalAlertV3[];
  createdTransactions: VirtualTransaction[];
}

function defaultSignalId(): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `signal-${suffix}`;
}

function cloneState(state: BacktestSignalRuntimeState): BacktestSignalRuntimeState {
  return {
    version: 3,
    alerts: state.alerts.map(alert => ({
      ...alert,
      reasons: [...alert.reasons],
      metrics: { ...alert.metrics },
    })),
    stocks: Object.fromEntries(Object.entries(state.stocks).map(([code, stock]) => [code, {
      ...stock,
      pendingVirtualSell: stock.pendingVirtualSell
        ? { ...stock.pendingVirtualSell, reasons: [...stock.pendingVirtualSell.reasons] }
        : null,
    }])),
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

function defaultStockState(signalAt: string): StockSignalStateV3 {
  return {
    lastBuyDecision: 'hold',
    lastSellDecision: 'hold',
    updatedAt: signalAt,
    blockedSellUntil: null,
    blockedSellNotifiedOn: null,
    pendingVirtualSell: null,
  };
}

function isExitDecision(decision: BacktestDecisionEvent['virtualSellDecision']): boolean {
  return decision.exitReason === 'stop_loss' || decision.exitReason === 'timeout';
}

function actualSellShares(event: BacktestDecisionEvent): number {
  const available = Math.floor(event.actualAvailableShares / 100) * 100;
  if (available < 100) return 0;
  return isExitDecision(event.actualSellDecision)
    ? available
    : calculateTechnicalSellShares(available);
}

function baseAlert(
  event: BacktestDecisionEvent,
  id: string,
  action: 'buy' | 'sell',
  intent: BacktestSignalAlertV3['intent'],
  suggestedShares: number,
  positionSharesAtSignal: number,
  availableSharesAtSignal: number,
  reasons: string[],
  entryPrice: number,
): Omit<BacktestSignalAlertV3,
  'messageKind' | 'virtualTrackingStatus' | 'virtualTradeId' | 'virtualCycleId'
  | 'virtualShares' | 'virtualPrice' | 'virtualPositionSharesAfter'
  | 'virtualAvailableSharesAfter'> {
  return {
    id,
    code: event.code,
    name: event.name,
    price: event.price,
    action,
    intent,
    suggestedShares,
    positionSharesAtSignal,
    availableSharesAtSignal,
    reasons: [...reasons],
    signalAt: event.signalAt,
    status: 'pending',
    readAt: null,
    executedAt: null,
    entryPrice,
    stopLoss: event.stopLoss,
    metrics: { ...event.metrics },
    strategyId: event.strategyId,
    strategyVersion: event.strategyVersion,
  };
}

function virtualExecutionAlert(
  event: BacktestDecisionEvent,
  signalId: string,
  transaction: VirtualTransaction,
  entryPrice: number,
): BacktestSignalAlertV3 {
  return {
    ...baseAlert(
      event,
      signalId,
      transaction.type,
      transaction.intent,
      transaction.shares,
      transaction.type === 'buy'
        ? transaction.positionSharesAfter - transaction.shares
        : transaction.positionSharesAfter + transaction.shares,
      transaction.type === 'buy'
        ? Math.max(0, transaction.availableSharesAfter)
        : transaction.availableSharesAfter + transaction.shares,
      transaction.reasons,
      entryPrice,
    ),
    messageKind: 'virtual_execution',
    virtualTrackingStatus: 'executed',
    virtualTradeId: transaction.id,
    virtualCycleId: transaction.cycleId,
    virtualShares: transaction.shares,
    virtualPrice: transaction.price,
    virtualPositionSharesAfter: transaction.positionSharesAfter,
    virtualAvailableSharesAfter: transaction.availableSharesAfter,
  };
}

function actualRiskAlert(
  event: BacktestDecisionEvent,
  signalId: string,
  action: 'buy' | 'sell',
  shares: number,
): BacktestSignalAlertV3 {
  const exit = action === 'sell'
    && isExitDecision(event.actualSellDecision)
    && shares >= event.actualPositionShares;
  return {
    ...baseAlert(
      event,
      signalId,
      action,
      action === 'buy' ? 'add' : exit ? 'exit' : 'reduce',
      shares,
      event.actualPositionShares,
      event.actualAvailableShares,
      action === 'buy' ? event.buyDecision.reasons : event.actualSellDecision.reasons,
      event.actualEntryPrice,
    ),
    messageKind: 'actual_position_risk',
    virtualTrackingStatus: 'actual_risk_only',
    virtualTradeId: null,
    virtualCycleId: null,
    virtualShares: 0,
    virtualPrice: null,
    virtualPositionSharesAfter: null,
    virtualAvailableSharesAfter: null,
  };
}

export function applySignalDecisionEvent(
  inputState: BacktestSignalRuntimeState,
  event: BacktestDecisionEvent,
  options: ApplySignalEventOptions = {},
): ApplySignalEventResult {
  const state = cloneState(inputState);
  const createdAlerts: BacktestSignalAlertV3[] = [];
  const createdTransactions: VirtualTransaction[] = [];
  if (!Number.isFinite(event.price) || event.price <= 0) return { state, createdAlerts, createdTransactions };

  const previous = state.stocks[event.code] ?? defaultStockState(event.signalAt);
  const pending = previous.pendingVirtualSell ?? null;
  const signalDate = shanghaiDateKey(event.signalAt);
  const virtualPosition = findVirtualPosition(state.virtualLedger, event.code, event.strategyId);
  const pendingUnlocked = Boolean(pending && pending.executableOn <= signalDate);
  let virtualSellDecision = event.virtualSellDecision;
  if (pendingUnlocked && pending && pending.exitReason !== 'signal') {
    virtualSellDecision = { action: 'sell', reasons: [...pending.reasons], exitReason: pending.exitReason };
  }

  const commitAlert = (alert: BacktestSignalAlertV3) => {
    createdAlerts.push(alert);
    state.alerts = trimRuntimeAlerts([...state.alerts, alert]);
  };
  const upsertAlert = (alert: BacktestSignalAlertV3) => {
    createdAlerts.push(alert);
    state.alerts = state.alerts.some(item => item.id === alert.id)
      ? state.alerts.map(item => item.id === alert.id ? alert : item)
      : trimRuntimeAlerts([...state.alerts, alert]);
  };

  if (pendingUnlocked && pending && pending.exitReason === 'signal'
    && event.virtualSellDecision.action !== 'sell') {
    const existingAlert = state.alerts.find(alert => alert.id === pending.alertId);
    if (existingAlert) upsertAlert({
      ...existingAlert,
      reasons: [...existingAlert.reasons, 'T+1 revalidation cancelled the sell signal'],
      virtualTrackingStatus: 'cancelled_revalidation',
    });
    state.stocks[event.code] = {
      ...previous, lastBuyDecision: event.buyDecision.action === 'buy' ? 'buy' : 'hold',
      lastSellDecision: 'hold', updatedAt: event.signalAt,
      blockedSellUntil: null, blockedSellNotifiedOn: null, pendingVirtualSell: null,
    };
    return { state, createdAlerts, createdTransactions };
  }

  const hasActualPosition = event.actualPositionShares > 0;
  const virtualBuyActive = event.buyDecision.action === 'buy'
    && (event.isBuyCandidate || Boolean(virtualPosition));
  const actualOnlyBuyActive = event.buyDecision.action === 'buy'
    && !virtualPosition && !event.isBuyCandidate && hasActualPosition;
  const virtualSellActive = Boolean(virtualPosition) && virtualSellDecision.action === 'sell';
  const actualOnlySellActive = !virtualPosition && hasActualPosition && event.actualSellDecision.action === 'sell';
  const buyDirection = virtualBuyActive || actualOnlyBuyActive ? 'buy' : 'hold';
  const sellDirection = virtualSellActive || actualOnlySellActive ? 'sell' : 'hold';
  const createSignalId = options.createSignalId ?? defaultSignalId;

  if (virtualSellActive && virtualPosition) {
    const availability = calculateVirtualAvailability(state.virtualLedger, event.code, event.strategyId, event.signalAt);
    const availableShares = Math.min(availability.availableShares, Math.max(0, event.virtualAvailableShares));
    const sellShares = isExitDecision(virtualSellDecision)
      ? Math.floor(availableShares / 100) * 100
      : calculateTechnicalSellShares(availableShares);

    if (sellShares >= 100 && (pendingUnlocked || previous.lastSellDecision !== 'sell')) {
      const signalId = pendingUnlocked && pending ? pending.alertId : createSignalId();
      const mutation = sellVirtualPosition(state.virtualLedger, {
        sourceSignalId: signalId, strategyId: event.strategyId, strategyVersion: event.strategyVersion,
        code: event.code, name: event.name, shares: sellShares, price: event.price,
        tradedAt: event.signalAt, reasons: virtualSellDecision.reasons,
      }, { createId: options.createLedgerId });
      state.virtualLedger = mutation.ledger;
      createdTransactions.push(mutation.transaction);
      upsertAlert(virtualExecutionAlert(event, signalId, mutation.transaction, virtualPosition.averageCost));
      state.stocks[event.code] = {
        ...previous, lastBuyDecision: buyDirection, lastSellDecision: 'sell', updatedAt: event.signalAt,
        blockedSellUntil: null, blockedSellNotifiedOn: null, pendingVirtualSell: null,
      };
      return { state, createdAlerts, createdTransactions };
    }

    if (sellShares < 100) {
      let nextPending = pending;
      if (!nextPending) {
        const signalId = createSignalId();
        const desiredShares = isExitDecision(virtualSellDecision)
          ? Math.floor(virtualPosition.shares / 100) * 100
          : calculateTechnicalSellShares(virtualPosition.shares);
        nextPending = {
          alertId: signalId, cycleId: virtualPosition.cycleId,
          executableOn: availability.nextAvailableDate ?? nextAStockTradingDay(signalDate),
          createdAt: event.signalAt, desiredShares, reasons: [...virtualSellDecision.reasons],
          exitReason: virtualSellDecision.exitReason ?? 'signal',
        };
        commitAlert({
          ...baseAlert(event, signalId, 'sell', desiredShares >= virtualPosition.shares ? 'exit' : 'reduce',
            desiredShares, virtualPosition.shares, 0, virtualSellDecision.reasons, virtualPosition.averageCost),
          messageKind: 'virtual_pending', virtualTrackingStatus: 'pending_t1',
          virtualTradeId: null, virtualCycleId: virtualPosition.cycleId,
          virtualShares: 0, virtualPrice: event.price,
          virtualPositionSharesAfter: virtualPosition.shares, virtualAvailableSharesAfter: 0,
        });
      }
      state.stocks[event.code] = {
        ...previous, lastBuyDecision: buyDirection, lastSellDecision: 'hold', updatedAt: event.signalAt,
        blockedSellUntil: nextPending.executableOn, blockedSellNotifiedOn: signalDate,
        pendingVirtualSell: nextPending,
      };
      return { state, createdAlerts, createdTransactions };
    }
  }

  if (actualOnlySellActive && previous.lastSellDecision !== 'sell') {
    const shares = actualSellShares(event);
    if (shares >= 100) commitAlert(actualRiskAlert(event, createSignalId(), 'sell', shares));
  } else if ((virtualBuyActive || actualOnlyBuyActive) && previous.lastBuyDecision !== 'buy') {
    if (virtualBuyActive) {
      const signalId = createSignalId();
      const mutation = buyVirtualPosition(state.virtualLedger, {
        sourceSignalId: signalId, strategyId: event.strategyId, strategyVersion: event.strategyVersion,
        code: event.code, name: event.name, shares: 100, price: event.price,
        tradedAt: event.signalAt, reasons: event.buyDecision.reasons,
      }, { createId: options.createLedgerId });
      state.virtualLedger = mutation.ledger;
      createdTransactions.push(mutation.transaction);
      commitAlert(virtualExecutionAlert(event, signalId, mutation.transaction, virtualPosition?.averageCost ?? event.price));
    } else commitAlert(actualRiskAlert(event, createSignalId(), 'buy', 100));
  }

  state.stocks[event.code] = {
    ...previous, lastBuyDecision: buyDirection, lastSellDecision: sellDirection, updatedAt: event.signalAt,
    blockedSellUntil: pending?.executableOn ?? (sellDirection === 'hold' ? null : previous.blockedSellUntil),
    blockedSellNotifiedOn: pending ? previous.blockedSellNotifiedOn
      : sellDirection === 'hold' ? null : previous.blockedSellNotifiedOn,
    pendingVirtualSell: pending,
  };
  return { state, createdAlerts, createdTransactions };
}
