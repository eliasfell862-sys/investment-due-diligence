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
        actualPositions: [], virtualPositions: [], strategies: [], openTTradeCycles: [],
        virtualCashBalance: 200_000, virtualReservedCash: 0,
        feeProfile: {
          commissionRate: 0.0003, minimumCommission: 5, sellStampDutyRate: 0.0005,
          transferFeeRate: 0.00001, slippageMode: 'fixed', fixedSlippageRate: 0.0005, updatedAt: null,
        },
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
    expect(decisions[0]).toMatchObject({
      action: 'buy', intent: 'open', suggestedShares: 100, price: 10, executeVirtualTrade: true,
    });
  });
  it('suppresses a virtual buy when available cash cannot cover shares and estimated fees', async () => {
    const monitor = {
      syncUniverse: vi.fn(),
      processSnapshot: vi.fn(async () => ({ events: [{
        code: '600519', name: 'Kweichow Moutai', price: 1500, isBuyCandidate: true,
        buyDecision: { action: 'buy', reasons: ['buy signal'] },
        virtualSellDecision: { action: 'hold', reasons: [] },
        actualSellDecision: { action: 'hold', reasons: [] },
        virtualPositionShares: 0, virtualAvailableShares: 0,
        actualPositionShares: 0, actualAvailableShares: 0,
        virtualEntryPrice: 0, actualEntryPrice: 0,
        signalAt: '2026-08-19T01:30:00.000Z', strategyId: 'realtime-technical', strategyVersion: '1',
        metrics: {}, stopLoss: 1400,
      }], partialFailureCount: 0 })),
      reload: vi.fn(), setStrategyConfig: vi.fn(), dispose: vi.fn(),
    };
    const evaluate = createWorkerSignalEvaluator({ createMonitor: () => monitor as never });

    const [decision] = await evaluate({
      assignment: {
        userId: 'user-a', watchlistCodes: ['600519'], actualPositionCodes: [], virtualPositionCodes: [],
        actualPositions: [], virtualPositions: [], strategies: [], openTTradeCycles: [],
        virtualCashBalance: 1_000, virtualReservedCash: 0,
        feeProfile: {
          commissionRate: 0.0003, minimumCommission: 5, sellStampDutyRate: 0.0005,
          transferFeeRate: 0.00001, slippageMode: 'fixed', fixedSlippageRate: 0.0005, updatedAt: null,
        },
      },
      code: '600519',
      quote: {
        code: '600519', name: 'Kweichow Moutai', market: 'sh', price: 1500, change: 0, changePct: 0,
        open: 1500, high: 1500, low: 1500, volume: 1, amount: 150000, preClose: 1500,
        turnover: 0, pe: 0, pb: 0, totalShares: 0, floatShares: 0, totalCap: 0, floatCap: 0,
      },
      quoteAt: '2026-08-19T01:30:00.000Z',
    });

    expect(decision).toMatchObject({
      action: 'hold', intent: null, suggestedShares: 0, executeVirtualTrade: false,
      reasons: ['virtual_cash_insufficient_suppressed'],
    });
  });});
