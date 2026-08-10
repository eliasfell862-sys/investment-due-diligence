import { describe, expect, it, vi } from 'vitest';
import { emptySignalCycleState } from '../src/engines/market-analysis/signal-cycle-state';
import { runStatefulScan } from './stateful-scan-runner';

describe('stateful scan reset', () => {
  it('persists hold after an active buy so the next buy can open a new cycle', async () => {
    const saveSignalState = vi.fn();
    const commitSignal = vi.fn();
    const repository = {
      loadMonitoringAssignments: async () => [{
        userId: 'user-a', watchlistCodes: ['000001'], actualPositionCodes: [], virtualPositionCodes: [],
        actualPositions: [], virtualPositions: [], strategies: [],
      }],
      loadSignalState: async () => ({
        ...emptySignalCycleState('000001', 'realtime-technical', '1'),
        buyDirection: 'buy' as const,
        buyCycleId: 'old-cycle',
      }),
      saveSignalState,
      commitSignal,
      recordScan: vi.fn(),
    };
    const quote = {
      code: '000001', name: '平安银行', market: 'sz' as const, price: 10,
      change: 0, changePct: 0, open: 10, high: 10, low: 10, volume: 1, amount: 1,
      preClose: 10, turnover: 0, pe: 0, pb: 0, totalShares: 0, floatShares: 0, totalCap: 0, floatCap: 0,
    };

    await runStatefulScan({
      repository,
      marketData: { fetchQuotes: async () => ({ quotes: { '000001': quote }, failures: {}, quoteAt: '2026-08-07T01:30:00.000Z' }) },
      evaluate: async () => [{
        code: '000001', name: '平安银行', price: 10, action: 'hold' as const, intent: null,
        suggestedShares: 0, positionSharesAtSignal: 0, availableSharesAtSignal: 0,
        reasons: [], metrics: {}, entryPrice: 0, stopLoss: 0,
        strategyId: 'realtime-technical', strategyVersion: '1', signalAt: '2026-08-07T01:30:00.000Z',
      }],
      now: () => new Date('2026-08-07T01:30:00.000Z'),
    });

    expect(saveSignalState).toHaveBeenCalledWith('user-a', expect.objectContaining({
      buyDirection: 'hold', buyCycleId: null,
    }));
    expect(commitSignal).not.toHaveBeenCalled();
  });
});
