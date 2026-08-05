import { describe, expect, it } from 'vitest';
import {
  BACKTEST_SIGNAL_INBOX_KEY,
  applyBacktestDecision,
  clearSignalAlerts,
  createEmptySignalInbox,
  loadSignalInbox,
  markSignalAlertExecuted,
  markSignalAlertRead,
  saveSignalInbox,
  type BacktestDecisionEvent,
} from './backtest-signal-inbox-store';

const metrics = {
  totalTrades: 12, winRate: 58, sharpeRatio: 1.1,
  maxDrawdown: 12, annualReturn: 18, profitFactor: 1.4,
};

function event(overrides: Partial<BacktestDecisionEvent> = {}): BacktestDecisionEvent {
  return {
    code: '000001', name: '平安银行', price: 10,
    buyDecision: { action: 'buy', reasons: ['MACD金叉'] },
    sellDecision: { action: 'hold', reasons: [] },
    isBuyCandidate: true, isHeld: false, positionShares: 0, availableShares: 0,
    signalAt: '2026-08-05T01:30:00.000Z', metrics,
    entryPrice: 10, stopLoss: 9.2,
    ...overrides,
  };
}

function memoryStorage(seed?: string) {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(BACKTEST_SIGNAL_INBOX_KEY, seed);
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    raw() { return values.get(BACKTEST_SIGNAL_INBOX_KEY) ?? null; },
  };
}

describe('backtest signal inbox state machine', () => {
  it('creates one frozen open alert on a new buy edge and ignores a continuous signal', () => {
    const first = applyBacktestDecision(createEmptySignalInbox(), event(), {
      createId: () => 'alert-open-1',
    });
    expect(first.createdAlert).toMatchObject({
      id: 'alert-open-1', action: 'buy', intent: 'open', status: 'pending', readAt: null,
      price: 10, suggestedShares: 100, positionSharesAtSignal: 0, availableSharesAtSignal: 0,
      reasons: ['MACD金叉'],
    });
    expect(first.state.stocks['000001']).toMatchObject({
      lastBuyDecision: 'buy', lastSellDecision: 'hold',
    });

    const duplicate = applyBacktestDecision(first.state, event({
      price: 10.2, signalAt: '2026-08-05T01:30:03.000Z',
    }));
    expect(duplicate.createdAlert).toBeNull();
    expect(duplicate.state.alerts).toHaveLength(1);
    expect(duplicate.state.alerts[0].price).toBe(10);
  });

  it('rearms a buy alert only after the buy direction returns to hold', () => {
    const first = applyBacktestDecision(createEmptySignalInbox(), event(), {
      createId: () => 'alert-open-1',
    });
    const reset = applyBacktestDecision(first.state, event({
      buyDecision: { action: 'hold', reasons: [] },
      signalAt: '2026-08-05T01:31:00.000Z',
    }));
    expect(reset.state.stocks['000001'].lastBuyDecision).toBe('hold');

    const second = applyBacktestDecision(reset.state, event({
      signalAt: '2026-08-05T01:32:00.000Z',
    }), { createId: () => 'alert-open-2' });
    expect(second.createdAlert?.id).toBe('alert-open-2');
    expect(second.state.alerts).toHaveLength(2);
  });

  it('creates an add alert for a held stock without requiring watchlist membership', () => {
    const result = applyBacktestDecision(createEmptySignalInbox(), event({
      isBuyCandidate: false, isHeld: true, positionShares: 500, availableShares: 500,
    }), { createId: () => 'alert-add-1' });
    expect(result.createdAlert).toMatchObject({
      id: 'alert-add-1', action: 'buy', intent: 'add',
      suggestedShares: 100, positionSharesAtSignal: 500,
    });
  });

  it('creates a partial reduction and suppresses its continuous sell edge independently', () => {
    const first = applyBacktestDecision(createEmptySignalInbox(), event({
      isHeld: true, positionShares: 1000, availableShares: 1000,
      buyDecision: { action: 'hold', reasons: [] },
      sellDecision: { action: 'sell', reasons: ['MACD死叉'], exitReason: 'signal' },
    }), { createId: () => 'alert-reduce-1' });
    expect(first.createdAlert).toMatchObject({
      action: 'sell', intent: 'reduce', suggestedShares: 200,
      positionSharesAtSignal: 1000, availableSharesAtSignal: 1000, reasons: ['MACD死叉'],
    });
    expect(first.state.stocks['000001']).toMatchObject({
      lastBuyDecision: 'hold', lastSellDecision: 'sell',
    });

    const duplicate = applyBacktestDecision(first.state, event({
      isHeld: true, positionShares: 1000, availableShares: 1000,
      buyDecision: { action: 'buy', reasons: ['RSI超卖'] },
      sellDecision: { action: 'sell', reasons: ['MACD死叉'], exitReason: 'signal' },
      signalAt: '2026-08-05T01:30:03.000Z',
    }));
    expect(duplicate.createdAlert).toBeNull();
    expect(duplicate.state.stocks['000001'].lastBuyDecision).toBe('buy');
  });

  it('creates a complete exit for stop loss and gives it priority over an add', () => {
    const result = applyBacktestDecision(createEmptySignalInbox(), event({
      isHeld: true, positionShares: 500, availableShares: 500,
      buyDecision: { action: 'buy', reasons: ['RSI超卖'] },
      sellDecision: { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' },
    }), { createId: () => 'alert-exit-1' });
    expect(result.createdAlert).toMatchObject({
      id: 'alert-exit-1', action: 'sell', intent: 'exit', suggestedShares: 500,
    });
  });

  it('rearms sell independently after the sell direction returns to hold', () => {
    const first = applyBacktestDecision(createEmptySignalInbox(), event({
      isHeld: true, positionShares: 500, availableShares: 500,
      buyDecision: { action: 'hold', reasons: [] },
      sellDecision: { action: 'sell', reasons: ['KDJ超买'], exitReason: 'signal' },
    }), { createId: () => 'alert-reduce-1' });
    const reset = applyBacktestDecision(first.state, event({
      isHeld: true, positionShares: 400, availableShares: 400,
      buyDecision: { action: 'hold', reasons: [] },
      sellDecision: { action: 'hold', reasons: [] },
    }));
    expect(reset.state.stocks['000001'].lastSellDecision).toBe('hold');

    const second = applyBacktestDecision(reset.state, event({
      isHeld: true, positionShares: 400, availableShares: 400,
      buyDecision: { action: 'hold', reasons: [] },
      sellDecision: { action: 'sell', reasons: ['KDJ超买'], exitReason: 'signal' },
    }), { createId: () => 'alert-reduce-2' });
    expect(second.createdAlert?.id).toBe('alert-reduce-2');
  });

  it('creates a sell alert when shares unlock while the raw sell decision stays active', () => {
    const frozen = applyBacktestDecision(createEmptySignalInbox(), event({
      isHeld: true, positionShares: 500, availableShares: 0,
      buyDecision: { action: 'hold', reasons: [] },
      sellDecision: { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' },
    }));
    expect(frozen.createdAlert).toBeNull();
    expect(frozen.state.stocks['000001'].lastSellDecision).toBe('hold');

    const unlocked = applyBacktestDecision(frozen.state, event({
      isHeld: true, positionShares: 500, availableShares: 300,
      buyDecision: { action: 'hold', reasons: [] },
      sellDecision: { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' },
      signalAt: '2026-08-06T01:30:00.000Z',
    }), { createId: () => 'alert-unlocked' });

    expect(unlocked.createdAlert).toMatchObject({
      id: 'alert-unlocked', action: 'sell', suggestedShares: 300,
      positionSharesAtSignal: 500, availableSharesAtSignal: 300,
    });
  });
  it('marks alerts read and executed without changing the frozen recommendation', () => {
    const first = applyBacktestDecision(createEmptySignalInbox(), event(), {
      createId: () => 'alert-open-1',
    }).state;
    const read = markSignalAlertRead(first, 'alert-open-1', '2026-08-05T01:31:00.000Z');
    const executed = markSignalAlertExecuted(read, 'alert-open-1', 'bought', {
      positionRemaining: true, executedAt: '2026-08-05T01:32:00.000Z',
    });
    expect(executed.alerts[0]).toMatchObject({
      status: 'bought', price: 10, suggestedShares: 100,
      executedAt: '2026-08-05T01:32:00.000Z',
    });
    expect(() => markSignalAlertExecuted(executed, 'alert-open-1', 'bought', {
      positionRemaining: true, executedAt: '2026-08-05T01:33:00.000Z',
    })).toThrow('该信号已经执行');
  });

  it('loads legacy version-2 alerts and stock phases without deleting them', () => {
    const legacy = {
      version: 2,
      alerts: [{
        id: 'legacy-buy', code: '000001', name: '平安银行', price: 10,
        action: 'buy', reasons: ['MACD金叉'], signalAt: '2026-08-04T01:30:00.000Z',
        status: 'pending', readAt: null, executedAt: null, entryPrice: 10, stopLoss: 9.2,
        metrics,
      }],
      stocks: {
        '000001': {
          phase: 'buy_notified', lastDecision: 'buy', updatedAt: '2026-08-04T01:30:00.000Z',
        },
      },
    };
    const loaded = loadSignalInbox(memoryStorage(JSON.stringify(legacy)));
    expect(loaded.alerts).toHaveLength(1);
    expect(loaded.alerts[0]).toMatchObject({
      id: 'legacy-buy', intent: 'open', suggestedShares: 100, positionSharesAtSignal: 0, availableSharesAtSignal: 0,
    });
    expect(loaded.stocks['000001']).toMatchObject({
      lastBuyDecision: 'buy', lastSellDecision: 'hold',
    });
  });

  it('persists enriched state and clears messages without losing signal edges', () => {
    const storage = memoryStorage();
    const state = applyBacktestDecision(createEmptySignalInbox(), event(), {
      createId: () => 'alert-open-1',
    }).state;
    saveSignalInbox(state, storage);
    expect(loadSignalInbox(storage)).toEqual(state);

    const cleared = clearSignalAlerts(state);
    expect(cleared.alerts).toEqual([]);
    expect(cleared.stocks['000001'].lastBuyDecision).toBe('buy');
    expect(loadSignalInbox(memoryStorage('{broken'))).toEqual(createEmptySignalInbox());
  });
});
