import { describe, expect, it } from 'vitest';
import type { BacktestDecisionEvent } from './realtime-backtest-monitor';
import {
  createEmptySignalRuntime,
  type BacktestSignalRuntimeState,
} from './backtest-signal-inbox-store';
import { buyVirtualPosition } from './virtual-trading-ledger';
import { applySignalDecisionEvent, type ApplySignalEventOptions } from './backtest-signal-trading-runtime';

const hold = { action: 'hold' as const, reasons: [] };
const metrics = {
  totalTrades: 12, winRate: 58, sharpeRatio: 1.1,
  maxDrawdown: 12, annualReturn: 18, profitFactor: 1.4,
};
let sequence = 0;

function ids(): ApplySignalEventOptions {
  return {
    createSignalId: () => `signal-${++sequence}`,
    createLedgerId: kind => `${kind}-${++sequence}`,
  };
}

function event(overrides: Partial<BacktestDecisionEvent> = {}): BacktestDecisionEvent {
  return {
    code: '000001',
    name: '平安银行',
    price: 12.34,
    isBuyCandidate: true,
    buyDecision: { action: 'buy', reasons: ['MACD金叉'] },
    virtualSellDecision: hold,
    actualSellDecision: hold,
    virtualPositionShares: 0,
    virtualAvailableShares: 0,
    actualPositionShares: 0,
    actualAvailableShares: 0,
    virtualEntryPrice: 0,
    actualEntryPrice: 0,
    isHeld: false,
    positionShares: 0,
    availableShares: 0,
    sellDecision: hold,
    entryPrice: 0,
    signalAt: '2026-08-06T02:00:00.000Z',
    strategyId: 'realtime-technical',
    strategyVersion: '1',
    metrics,
    stopLoss: 11.2,
    ...overrides,
  };
}

function runtimeWithVirtualPosition(
  shares: number,
  tradedAt = '2026-08-05T02:00:00.000Z',
): BacktestSignalRuntimeState {
  const state = createEmptySignalRuntime();
  state.virtualLedger = buyVirtualPosition(state.virtualLedger, {
    sourceSignalId: 'seed-buy',
    strategyId: 'realtime-technical',
    strategyVersion: '1',
    code: '000001',
    name: '平安银行',
    shares,
    price: 10,
    tradedAt,
    reasons: ['初始虚拟持仓'],
  }, { createId: ids().createLedgerId }).ledger;
  return state;
}

function virtualSellEvent(overrides: Partial<BacktestDecisionEvent> = {}): BacktestDecisionEvent {
  return event({
    isBuyCandidate: false,
    buyDecision: hold,
    virtualSellDecision: { action: 'sell', reasons: ['MACD死叉'], exitReason: 'signal' },
    virtualPositionShares: 500,
    virtualAvailableShares: 500,
    virtualEntryPrice: 10,
    ...overrides,
  });
}

describe('atomic signal trading runtime', () => {
  it('executes 100 shares before projecting a linked buy alert', () => {
    const result = applySignalDecisionEvent(createEmptySignalRuntime(), event(), ids());

    expect(result.createdTransactions).toHaveLength(1);
    expect(result.createdTransactions[0]).toMatchObject({ shares: 100, price: 12.34, intent: 'open' });
    expect(result.createdAlerts[0]).toMatchObject({
      messageKind: 'virtual_execution',
      virtualTrackingStatus: 'executed',
      virtualTradeId: result.createdTransactions[0].id,
      virtualShares: 100,
      virtualPrice: 12.34,
    });
  });

  it('does not execute the same continuous buy edge twice, including after reload', () => {
    const first = applySignalDecisionEvent(createEmptySignalRuntime(), event(), ids());
    const reloaded = JSON.parse(JSON.stringify(first.state)) as BacktestSignalRuntimeState;
    const repeated = applySignalDecisionEvent(reloaded, event({
      signalAt: '2026-08-06T02:01:00.000Z',
    }), ids());

    expect(repeated.createdTransactions).toEqual([]);
    expect(repeated.createdAlerts).toEqual([]);
  });

  it('rearms a buy only after the direction returns to hold', () => {
    const first = applySignalDecisionEvent(createEmptySignalRuntime(), event(), ids());
    const reset = applySignalDecisionEvent(first.state, event({
      buyDecision: hold,
      signalAt: '2026-08-06T02:01:00.000Z',
    }), ids());
    const second = applySignalDecisionEvent(reset.state, event({
      signalAt: '2026-08-06T02:02:00.000Z',
    }), ids());

    expect(second.createdTransactions[0]).toMatchObject({ type: 'buy', intent: 'add', shares: 100 });
    expect(second.state.virtualLedger.positions[0].shares).toBe(200);
  });

  it('does not create a transaction or executed alert for an invalid snapshot price', () => {
    const result = applySignalDecisionEvent(createEmptySignalRuntime(), event({ price: Number.NaN }), ids());
    expect(result.createdTransactions).toEqual([]);
    expect(result.createdAlerts).toEqual([]);
    expect(result.state.stocks).toEqual({});
  });

  it('caps an ordinary technical sell to virtual available board lots', () => {
    const state = runtimeWithVirtualPosition(500);
    const result = applySignalDecisionEvent(state, virtualSellEvent(), ids());

    expect(result.createdTransactions[0]).toMatchObject({ type: 'sell', shares: 100, intent: 'reduce' });
    expect(result.state.virtualLedger.positions[0].shares).toBe(400);
  });

  it('sells all available board lots for a stop loss', () => {
    const state = runtimeWithVirtualPosition(500);
    const result = applySignalDecisionEvent(state, virtualSellEvent({
      virtualSellDecision: { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' },
      virtualAvailableShares: 300,
    }), ids());

    expect(result.createdTransactions[0]).toMatchObject({ type: 'sell', shares: 300, intent: 'reduce' });
  });

  it('creates one blocked alert for same-day frozen shares and retries next trading day', () => {
    const state = runtimeWithVirtualPosition(100, '2026-08-06T02:00:00.000Z');
    const first = applySignalDecisionEvent(state, virtualSellEvent({
      virtualPositionShares: 100,
      virtualAvailableShares: 0,
      signalAt: '2026-08-06T03:00:00.000Z',
    }), ids());
    const repeated = applySignalDecisionEvent(first.state, virtualSellEvent({
      virtualPositionShares: 100,
      virtualAvailableShares: 0,
      signalAt: '2026-08-06T04:00:00.000Z',
    }), ids());
    const nextDay = applySignalDecisionEvent(repeated.state, virtualSellEvent({
      virtualPositionShares: 100,
      virtualAvailableShares: 100,
      signalAt: '2026-08-07T02:00:00.000Z',
    }), ids());

    expect(first.createdTransactions).toEqual([]);
    expect(first.createdAlerts[0]).toMatchObject({
      messageKind: 'virtual_blocked', virtualTrackingStatus: 'blocked_t1',
    });
    expect(repeated.createdAlerts).toEqual([]);
    expect(nextDay.createdTransactions[0]).toMatchObject({ type: 'sell', shares: 100, intent: 'exit' });
  });

  it('creates an actual-position-only risk alert without a virtual transaction', () => {
    const result = applySignalDecisionEvent(createEmptySignalRuntime(), event({
      isBuyCandidate: false,
      buyDecision: hold,
      actualSellDecision: { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' },
      actualPositionShares: 500,
      actualAvailableShares: 300,
      actualEntryPrice: 14,
    }), ids());

    expect(result.createdTransactions).toEqual([]);
    expect(result.createdAlerts[0]).toMatchObject({
      action: 'sell',
      messageKind: 'actual_position_risk',
      virtualTrackingStatus: 'actual_risk_only',
      virtualTradeId: null,
      suggestedShares: 300,
      entryPrice: 14,
    });
  });

  it('does not turn an actual-only add signal into a virtual opening trade', () => {
    const result = applySignalDecisionEvent(createEmptySignalRuntime(), event({
      isBuyCandidate: false,
      actualPositionShares: 500,
      actualAvailableShares: 500,
      actualEntryPrice: 10,
    }), ids());

    expect(result.createdTransactions).toEqual([]);
    expect(result.createdAlerts[0]).toMatchObject({
      action: 'buy', intent: 'add', messageKind: 'actual_position_risk',
    });
  });
});
