import { describe, expect, it } from 'vitest';
import type { BacktestDecisionEvent } from './realtime-backtest-monitor';
import { createEmptySignalRuntime } from './backtest-signal-inbox-store';
import { applySignalDecisionEvent, type ApplySignalEventOptions } from './backtest-signal-trading-runtime';
import { buyVirtualPosition } from './virtual-trading-ledger';

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

function sameDayPosition() {
  const state = createEmptySignalRuntime();
  state.virtualLedger = buyVirtualPosition(state.virtualLedger, {
    sourceSignalId: 'opening-signal', strategyId: 'realtime-technical', strategyVersion: '1',
    code: '000001', name: '平安银行', shares: 100, price: 10,
    tradedAt: '2026-08-06T02:00:00.000Z', reasons: ['首次买入'],
  }, { createId: ids().createLedgerId }).ledger;
  return state;
}

function sellEvent(
  signalAt: string,
  decision: BacktestDecisionEvent['virtualSellDecision'],
  availableShares: number,
): BacktestDecisionEvent {
  return {
    code: '000001', name: '平安银行', price: 9.2, isBuyCandidate: false,
    buyDecision: hold, virtualSellDecision: decision, actualSellDecision: hold,
    virtualPositionShares: 100, virtualAvailableShares: availableShares,
    actualPositionShares: 0, actualAvailableShares: 0,
    virtualEntryPrice: 10, actualEntryPrice: 0,
    isHeld: true, positionShares: 100, availableShares,
    sellDecision: decision, entryPrice: 10, signalAt,
    strategyId: 'realtime-technical', strategyVersion: '1', metrics, stopLoss: 9,
  };
}

describe('virtual T+1 pending sell', () => {
  it('stores a same-day stop loss as a pending sell instead of a failed sale', () => {
    const result = applySignalDecisionEvent(
      sameDayPosition(),
      sellEvent('2026-08-06T03:00:00.000Z', {
        action: 'sell', reasons: ['止损'], exitReason: 'stop_loss',
      }, 0),
      ids(),
    );

    expect(result.createdTransactions).toEqual([]);
    expect(result.createdAlerts[0]).toMatchObject({
      messageKind: 'virtual_pending', virtualTrackingStatus: 'pending_t1',
    });
    expect(result.state.stocks['000001']).toMatchObject({
      pendingVirtualSell: {
        alertId: result.createdAlerts[0].id,
        executableOn: '2026-08-07',
        exitReason: 'stop_loss',
      },
    });
  });

  it('executes a pending stop loss next trading day at the new realtime price', () => {
    const pending = applySignalDecisionEvent(
      sameDayPosition(),
      sellEvent('2026-08-06T03:00:00.000Z', {
        action: 'sell', reasons: ['止损'], exitReason: 'stop_loss',
      }, 0),
      ids(),
    );
    const executed = applySignalDecisionEvent(
      pending.state,
      { ...sellEvent('2026-08-07T01:31:00.000Z', hold, 100), price: 8.9 },
      ids(),
    );

    expect(executed.createdTransactions[0]).toMatchObject({
      type: 'sell', shares: 100, price: 8.9,
      sourceSignalId: pending.createdAlerts[0].id,
    });
    expect(executed.state.stocks['000001'].pendingVirtualSell).toBeNull();
    expect(executed.state.alerts.find(alert => alert.id === pending.createdAlerts[0].id))
      .toMatchObject({ messageKind: 'virtual_execution', virtualTrackingStatus: 'executed' });
  });

  it('cancels an ordinary technical sell when the signal disappears after unlock', () => {
    const pending = applySignalDecisionEvent(
      sameDayPosition(),
      sellEvent('2026-08-06T03:00:00.000Z', {
        action: 'sell', reasons: ['MACD死叉'], exitReason: 'signal',
      }, 0),
      ids(),
    );
    const reviewed = applySignalDecisionEvent(
      pending.state,
      sellEvent('2026-08-07T01:31:00.000Z', hold, 100),
      ids(),
    );

    expect(reviewed.createdTransactions).toEqual([]);
    expect(reviewed.state.stocks['000001'].pendingVirtualSell).toBeNull();
    expect(reviewed.state.alerts.find(alert => alert.id === pending.createdAlerts[0].id))
      .toMatchObject({ virtualTrackingStatus: 'cancelled_revalidation' });
  });
});
