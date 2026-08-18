import { describe, expect, it, vi } from 'vitest';
import type { StockKLine, StockQuote } from '../src/infrastructure/market-data/stock-api';
import { DEFAULT_TRADING_FEE_PROFILE } from '../src/features/securities/t-trading/trading-fee-engine';
import { createWorkerTTradingEvaluator } from './t-trading-evaluator';

function history(count = 80): StockKLine[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 10 + index * 0.025 + Math.sin(index / 4) * 0.1;
    return {
      date: `2026-01-${String(index + 1).padStart(3, '0')}`,
      open: close - 0.03, high: close + 0.18, low: close - 0.18, close,
      volume: 1_000_000 + index * 1_000, amount: close * (1_000_000 + index * 1_000),
    };
  });
}

function quote(price: number): StockQuote {
  return {
    code: '600001', name: 'test', market: 'sh', price, change: -0.05, changePct: -0.4,
    open: price - 0.05, high: price + 0.08, low: price - 0.1,
    volume: 2_000_000, amount: 24_000_000, preClose: price + 0.05,
    turnover: 1, pe: 10, pb: 1, totalShares: 0, floatShares: 0, totalCap: 0, floatCap: 0,
  };
}

function assignment() {
  return {
    userId: 'user-a',
    watchlistCodes: ['000001'],
    actualPositionCodes: ['600001'],
    virtualPositionCodes: [],
    actualPositions: [{
      id: 'position-1', code: '600001', name: 'test', shares: 1000,
      availableShares: 1000, averageCost: 11, openedAt: '2026-08-01T01:00:00Z',
    }],
    virtualPositions: [],
    strategies: [],
    feeProfile: DEFAULT_TRADING_FEE_PROFILE,
    openTTradeCycles: [],
  };
}

describe('worker T-trading evaluator', () => {
  it('requests 250 bars and emits a fee-positive sell for an actual position', async () => {
    const bars = history();
    const current = bars.at(-1)!.close;
    const fetchHistory = vi.fn().mockResolvedValue(bars);
    const evaluate = createWorkerTTradingEvaluator({
      marketData: { fetchHistory } as never,
    });

    const result = await evaluate({
      assignment: assignment(),
      position: assignment().actualPositions[0],
      cycle: null,
      quote: quote(current),
      quoteAt: '2026-08-11T02:00:00.000Z',
    });

    expect(fetchHistory).toHaveBeenCalledWith('600001', 250);
    expect(result?.signalKind).toBe('actual_t_sell');
    expect(result?.payload).toMatchObject({
      user_id: 'user-a', position_id: 'position-1', code: '600001',
      strategy_id: 'actual-t',
    });
  });

  it('evaluates an open cycle as buyback or risk review without a generic signal state', async () => {
    const bars = history();
    const fetchHistory = vi.fn().mockResolvedValue(bars);
    const evaluate = createWorkerTTradingEvaluator({
      marketData: { fetchHistory } as never,
    });
    const currentAssignment = assignment();
    const cycle = {
      id: 'cycle-1', positionId: 'position-1', code: '600001', name: 'test',
      cycleType: 'profit_t' as const, status: 'buyback_monitoring' as const,
      soldShares: 300, remainingBuybackShares: 300,
      actualSellPrice: 12, actualSellFees: 6,
      actualSellAt: '2026-08-11T02:00:00Z',
      expiryRiskSentAt: null, expiresAt: '2026-08-11T07:00:00Z',
      strategyId: 'actual-t', strategyVersion: '1',
      signalBasis: {},
    };

    const result = await evaluate({
      assignment: { ...currentAssignment, openTTradeCycles: [cycle] },
      position: currentAssignment.actualPositions[0],
      cycle,
      quote: quote(11.5),
      quoteAt: '2026-08-11T03:00:00.000Z',
    });

    expect(['actual_t_buyback', 'actual_t_risk_review', null])
      .toContain(result?.signalKind ?? null);
  });

  it('blocks a virtual T buyback when shared cash cannot cover gross amount and fees', async () => {
    const bars = history();
    const current = bars.at(-1)!.close;
    const evaluate = createWorkerTTradingEvaluator({
      marketData: { fetchHistory: vi.fn().mockResolvedValue(bars) } as never,
    });
    const virtualPosition = {
      id: 'virtual-position-1', scope: 'virtual' as const,
      code: '600001', name: 'test', shares: 1000,
      availableShares: 1000, averageCost: 11, openedAt: '2026-08-01T01:00:00Z',
      strategyId: 'realtime-technical', strategyVersion: '1',
    };
    const cycle = {
      id: 'virtual-cycle-1', positionScope: 'virtual' as const,
      positionId: '', virtualPositionId: virtualPosition.id,
      code: '600001', name: 'test', cycleType: 'profit_t' as const,
      status: 'buyback_monitoring' as const, soldShares: 100,
      remainingBuybackShares: 100, actualSellPrice: current + 1,
      actualSellFees: 6, actualSellAt: '2026-08-11T02:00:00Z',
      expiryRiskSentAt: null, expiresAt: '2026-08-11T07:00:00Z',
      strategyId: 'virtual-t', strategyVersion: '1', signalBasis: {},
    };
    const currentAssignment = {
      ...assignment(), actualPositions: [], actualPositionCodes: [],
      virtualPositions: [virtualPosition], virtualPositionCodes: ['600001'],
      virtualCashBalance: 300, openTTradeCycles: [cycle],
    };

    const result = await evaluate({
      assignment: currentAssignment,
      position: virtualPosition,
      cycle,
      quote: { ...quote(current), change: 0.1, changePct: 0.8 },
      quoteAt: '2026-08-11T03:00:00.000Z',
    });

    expect(result?.signalKind).toBe('virtual_t_cash_blocked');
    expect(result?.payload).toMatchObject({
      position_scope: 'virtual', virtual_position_id: 'virtual-position-1',
      suggested_shares: 100,
      signal_metadata: {
        remaining_buyback_shares: 100,
        available_cash: 300,
      },
    });
  });
});
