import { describe, expect, it, vi } from 'vitest';
import { createWorkerSignalEvaluator } from './signal-evaluator';

describe('worker signal evaluator', () => {
  it('maps the existing realtime monitor buy decision to a 100-share cloud decision', async () => {
    const monitor = {
      syncUniverse: vi.fn(),
      processSnapshot: vi.fn(async () => ({ events: [{
        code: '000001', name: '平安银行', price: 10, isBuyCandidate: true,
        buyDecision: { action: 'buy', reasons: ['MACD金叉'] },
        virtualSellDecision: { action: 'hold', reasons: [] },
        actualSellDecision: { action: 'hold', reasons: [] },
        virtualPositionShares: 0, virtualAvailableShares: 0,
        actualPositionShares: 0, actualAvailableShares: 0,
        virtualEntryPrice: 0, actualEntryPrice: 0,
        signalAt: '2026-08-07T01:30:00.000Z', strategyId: 'realtime-technical', strategyVersion: '1',
        metrics: { totalTrades: 1, winRate: 50, sharpeRatio: 1, maxDrawdown: 5, annualReturn: 10, profitFactor: 1.2 },
        stopLoss: 9,
      }], partialFailureCount: 0 })),
      reload: vi.fn(), setStrategyConfig: vi.fn(), dispose: vi.fn(),
    };
    const evaluate = createWorkerSignalEvaluator({ createMonitor: () => monitor as never });

    const decisions = await evaluate({
      assignment: {
        userId: 'user-a', watchlistCodes: ['000001'], actualPositionCodes: [], virtualPositionCodes: [],
        actualPositions: [], virtualPositions: [], strategies: [],
      },
      code: '000001',
      quote: {
        code: '000001', name: '平安银行', market: 'sz', price: 10, change: 0, changePct: 0,
        open: 10, high: 10, low: 10, volume: 1, amount: 1, preClose: 10, turnover: 0,
        pe: 0, pb: 0, totalShares: 0, floatShares: 0, totalCap: 0, floatCap: 0,
      },
      quoteAt: '2026-08-07T01:30:00.000Z',
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ action: 'buy', intent: 'open', suggestedShares: 100, price: 10 });
  });
});
