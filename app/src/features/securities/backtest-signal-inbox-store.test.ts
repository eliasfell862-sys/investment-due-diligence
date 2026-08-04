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
  totalTrades: 12,
  winRate: 58,
  sharpeRatio: 1.1,
  maxDrawdown: 12,
  annualReturn: 18,
  profitFactor: 1.4,
};

function event(overrides: Partial<BacktestDecisionEvent> = {}): BacktestDecisionEvent {
  return {
    code: '000001',
    name: '平安银行',
    price: 10,
    decision: { action: 'buy', reasons: ['MACD金叉'] },
    isBuyCandidate: true,
    isHeld: false,
    signalAt: '2026-08-04T01:30:00.000Z',
    metrics,
    entryPrice: 10,
    stopLoss: 9.2,
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
  it('creates one buy alert on a new buy edge and ignores a continuous signal', () => {
    const first = applyBacktestDecision(createEmptySignalInbox(), event(), {
      createId: () => 'alert-buy-1',
    });
    expect(first.createdAlert).toMatchObject({
      id: 'alert-buy-1', action: 'buy', status: 'pending', readAt: null,
      reasons: ['MACD金叉'],
    });
    expect(first.state.stocks['000001']).toMatchObject({
      phase: 'buy_notified', lastDecision: 'buy',
    });

    const duplicate = applyBacktestDecision(first.state, event({
      signalAt: '2026-08-04T01:30:03.000Z',
    }));
    expect(duplicate.createdAlert).toBeNull();
    expect(duplicate.state.alerts).toHaveLength(1);
  });

  it('rearbs a buy alert only after the signal returns to hold', () => {
    const first = applyBacktestDecision(createEmptySignalInbox(), event(), {
      createId: () => 'alert-buy-1',
    });
    const reset = applyBacktestDecision(first.state, event({
      decision: { action: 'hold', reasons: [] },
      signalAt: '2026-08-04T01:31:00.000Z',
    }));
    expect(reset.state.stocks['000001'].phase).toBe('waiting_buy');

    const second = applyBacktestDecision(reset.state, event({
      signalAt: '2026-08-04T01:32:00.000Z',
    }), { createId: () => 'alert-buy-2' });
    expect(second.createdAlert?.id).toBe('alert-buy-2');
    expect(second.state.alerts).toHaveLength(2);
  });

  it('does not create sell alerts for unheld stocks', () => {
    const result = applyBacktestDecision(createEmptySignalInbox(), event({
      decision: { action: 'sell', reasons: ['MACD死叉'], exitReason: 'signal' },
      isHeld: false,
    }));
    expect(result.createdAlert).toBeNull();
    expect(result.state.stocks['000001'].phase).toBe('waiting_buy');
  });

  it('creates one sell alert for a held stock and suppresses continuous sell signals', () => {
    const holding = applyBacktestDecision(createEmptySignalInbox(), event({
      decision: { action: 'hold', reasons: [] },
      isHeld: true,
    })).state;
    const first = applyBacktestDecision(holding, event({
      decision: { action: 'sell', reasons: ['KDJ超买'], exitReason: 'signal' },
      isHeld: true,
    }), { createId: () => 'alert-sell-1' });
    expect(first.createdAlert).toMatchObject({ action: 'sell', reasons: ['KDJ超买'] });
    expect(first.state.stocks['000001'].phase).toBe('sell_notified');

    const duplicate = applyBacktestDecision(first.state, event({
      decision: { action: 'sell', reasons: ['KDJ超买'], exitReason: 'signal' },
      isHeld: true,
      signalAt: '2026-08-04T01:30:03.000Z',
    }));
    expect(duplicate.createdAlert).toBeNull();
  });

  it('keeps a partial sale in holding without repeating the same sell edge', () => {
    const holding = applyBacktestDecision(createEmptySignalInbox(), event({
      decision: { action: 'hold', reasons: [] }, isHeld: true,
    })).state;
    const sell = applyBacktestDecision(holding, event({
      decision: { action: 'sell', reasons: ['MACD死叉'], exitReason: 'signal' },
      isHeld: true,
    }), { createId: () => 'alert-sell-1' });
    const executed = markSignalAlertExecuted(sell.state, 'alert-sell-1', 'sold', {
      positionRemaining: true,
      executedAt: '2026-08-04T01:31:00.000Z',
    });
    expect(executed.stocks['000001']).toMatchObject({ phase: 'holding', lastDecision: 'sell' });

    const duplicate = applyBacktestDecision(executed, event({
      decision: { action: 'sell', reasons: ['MACD死叉'], exitReason: 'signal' },
      isHeld: true,
      signalAt: '2026-08-04T01:31:03.000Z',
    }));
    expect(duplicate.createdAlert).toBeNull();
  });

  it('returns to waiting for buy after a full sale', () => {
    const holding = applyBacktestDecision(createEmptySignalInbox(), event({
      decision: { action: 'hold', reasons: [] }, isHeld: true,
    })).state;
    const sell = applyBacktestDecision(holding, event({
      decision: { action: 'sell', reasons: ['MACD死叉'], exitReason: 'signal' },
      isHeld: true,
    }), { createId: () => 'alert-sell-1' });
    const executed = markSignalAlertExecuted(sell.state, 'alert-sell-1', 'sold', {
      positionRemaining: false,
      executedAt: '2026-08-04T01:31:00.000Z',
    });
    expect(executed.stocks['000001'].phase).toBe('waiting_buy');
    expect(executed.alerts[0]).toMatchObject({ status: 'sold', executedAt: '2026-08-04T01:31:00.000Z' });
  });

  it('marks only the selected alert as read and rejects duplicate execution', () => {
    const first = applyBacktestDecision(createEmptySignalInbox(), event(), {
      createId: () => 'alert-buy-1',
    }).state;
    const read = markSignalAlertRead(first, 'alert-buy-1', '2026-08-04T01:31:00.000Z');
    expect(read.alerts[0].readAt).toBe('2026-08-04T01:31:00.000Z');

    const executed = markSignalAlertExecuted(read, 'alert-buy-1', 'bought', {
      positionRemaining: true,
      executedAt: '2026-08-04T01:32:00.000Z',
    });
    expect(executed.alerts[0].status).toBe('bought');
    expect(() => markSignalAlertExecuted(executed, 'alert-buy-1', 'bought', {
      positionRemaining: true,
      executedAt: '2026-08-04T01:33:00.000Z',
    })).toThrow('该信号已经执行');
  });

  it('persists state, loads it safely, and clears messages without losing stock phases', () => {
    const storage = memoryStorage();
    const state = applyBacktestDecision(createEmptySignalInbox(), event(), {
      createId: () => 'alert-buy-1',
    }).state;
    saveSignalInbox(state, storage);
    expect(loadSignalInbox(storage)).toEqual(state);

    const cleared = clearSignalAlerts(state);
    expect(cleared.alerts).toEqual([]);
    expect(cleared.stocks['000001'].phase).toBe('buy_notified');
    expect(loadSignalInbox(memoryStorage('{broken'))).toEqual(createEmptySignalInbox());
  });
});
