import { describe, expect, it } from 'vitest';
import type { BacktestDecisionEvent } from './realtime-backtest-monitor';
import { createEmptySignalRuntime } from './backtest-signal-inbox-store';
import { applySignalDecisionEvent } from './backtest-signal-trading-runtime';

const hold = { action: 'hold' as const, reasons: [] };

function buyEvent(): BacktestDecisionEvent {
  return {
    code: '000001',
    name: '股票A',
    price: 12.34,
    averageDailyAmount: 100_000_000,
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
    signalAt: '2026-08-18T02:00:00.000Z',
    strategyId: 'realtime-technical',
    strategyVersion: '1',
    metrics: {
      totalTrades: 20, winRate: 60, sharpeRatio: 1.2,
      maxDrawdown: 10, annualReturn: 18, profitFactor: 1.4,
    },
    stopLoss: 11,
  };
}

describe('virtual signal shared cash blocking', () => {
  it('creates a blocked alert but no trade when shared cash cannot cover a buy', () => {
    const state = createEmptySignalRuntime();
    state.virtualLedger.cashAccount.cashBalance = 500;

    const result = applySignalDecisionEvent(state, buyEvent(), {
      createSignalId: () => 'signal-blocked',
      createLedgerId: kind => `${kind}-unused`,
    });

    expect(result.createdTransactions).toEqual([]);
    expect(result.createdAlerts[0]).toMatchObject({
      id: 'signal-blocked',
      messageKind: 'virtual_blocked',
      virtualTrackingStatus: 'blocked_cash',
      virtualTradeId: null,
      virtualShares: 0,
    });
    expect(result.createdAlerts[0]?.reasons).toContain('virtual_cash_insufficient');
    expect(result.state.virtualLedger.cashAccount.cashBalance).toBe(500);
    expect(result.state.virtualLedger.positions).toEqual([]);
  });
});
