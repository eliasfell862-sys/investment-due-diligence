import { describe, expect, it } from 'vitest';
import {
  emptySignalCycleState,
  transitionSignalCycle,
  type SignalCycleDecision,
} from './signal-cycle-state';

function decision(
  action: SignalCycleDecision['action'],
  signalAt: string,
): SignalCycleDecision {
  return {
    code: '000001',
    strategyId: 'realtime-technical',
    strategyVersion: '1',
    action,
    intent: action === 'buy' ? 'open' : action === 'sell' ? 'exit' : null,
    signalAt,
  };
}

describe('transitionSignalCycle', () => {
  it('opens once, suppresses continuation, and opens a new cycle after reset', () => {
    const first = transitionSignalCycle(
      emptySignalCycleState('000001', 'realtime-technical', '1'),
      decision('buy', '2026-08-07T01:30:00.000Z'),
    );
    expect(first.kind).toBe('opened');
    expect(first.cycleId).toBeTruthy();

    const repeated = transitionSignalCycle(
      first.state,
      decision('buy', '2026-08-07T01:30:03.000Z'),
    );
    expect(repeated.kind).toBe('continued');
    expect(repeated.cycleId).toBe(first.cycleId);

    const reset = transitionSignalCycle(
      repeated.state,
      decision('hold', '2026-08-07T01:30:06.000Z'),
    );
    expect(reset.kind).toBe('closed');

    const next = transitionSignalCycle(
      reset.state,
      decision('buy', '2026-08-07T01:31:00.000Z'),
    );
    expect(next.kind).toBe('opened');
    expect(next.cycleId).not.toBe(first.cycleId);
  });

  it('reverses from buy to sell with a separate deterministic cycle', () => {
    const opened = transitionSignalCycle(
      emptySignalCycleState('000001', 'realtime-technical', '1'),
      decision('buy', '2026-08-07T01:30:00.000Z'),
    );
    const reversed = transitionSignalCycle(
      opened.state,
      decision('sell', '2026-08-07T02:00:00.000Z'),
    );

    expect(reversed.kind).toBe('reversed');
    expect(reversed.state.buyDirection).toBe('hold');
    expect(reversed.state.sellDirection).toBe('sell');
    expect(reversed.cycleId).not.toBe(opened.cycleId);
  });
});
