import { describe, expect, it } from 'vitest';
import type {
  VirtualPosition,
  VirtualTradeCycle,
  VirtualTradingLedger,
} from './virtual-trading-ledger';
import { summarizeForwardSimulation } from './forward-simulation-summary';

function cycle(id: string, status: 'open' | 'closed', realizedProfit: number): VirtualTradeCycle {
  return {
    id,
    strategyId: 'realtime-technical',
    strategyVersion: '1',
    code: id,
    name: id,
    status,
    openedAt: '2026-08-01T02:00:00.000Z',
    closedAt: status === 'closed' ? '2026-08-05T02:00:00.000Z' : null,
    buyAmount: 1000,
    sellAmount: status === 'closed' ? 1000 + realizedProfit : 0,
    realizedProfit,
    returnPct: status === 'closed' ? realizedProfit / 10 : null,
    transactionIds: [],
  };
}

function position(overrides: Partial<VirtualPosition> = {}): VirtualPosition {
  return {
    id: 'position-1',
    cycleId: 'open-cycle',
    strategyId: 'realtime-technical',
    strategyVersion: '1',
    code: '000001',
    name: '平安银行',
    shares: 100,
    averageCost: 10,
    totalCost: 1000,
    openedAt: '2026-08-05T02:00:00.000Z',
    updatedAt: '2026-08-05T02:00:00.000Z',
    sourceTradeIds: [],
    ...overrides,
  };
}

function ledger(overrides: Partial<VirtualTradingLedger> = {}): VirtualTradingLedger {
  return {
    version: 2,
    cashAccount: {
      initialCapital: 200000, cashBalance: 200000, reservedCash: 0,
      version: 0, updatedAt: '1970-01-01T00:00:00.000Z',
    },
    requiresCapitalCleanup: false,
    positions: [],
    transactions: [],
    cycles: [],
    ...overrides,
  };
}

describe('forward simulation summary', () => {
  it('counts only closed cycles in win rate', () => {
    const summary = summarizeForwardSimulation(ledger({
      cycles: [cycle('win', 'closed', 200), cycle('loss', 'closed', -50), cycle('open', 'open', 80)],
    }), {});

    expect(summary).toMatchObject({ closedCycles: 2, winningCycles: 1, winRate: 50 });
  });

  it('marks open positions to market without adding them to cycle wins', () => {
    const summary = summarizeForwardSimulation(ledger({
      positions: [position()],
      cycles: [cycle('open-cycle', 'open', 0)],
    }), { '000001': 12 });

    expect(summary.openPositions[0]).toMatchObject({
      currentPrice: 12,
      marketValue: 1200,
      unrealizedProfit: 200,
      unrealizedReturnPct: 20,
    });
    expect(summary).toMatchObject({ closedCycles: 0, unrealizedProfit: 200, totalProfit: 200 });
  });

  it('keeps valuation fields null when the realtime price is missing', () => {
    const summary = summarizeForwardSimulation(ledger({ positions: [position()] }), {});

    expect(summary.openPositions[0]).toMatchObject({
      currentPrice: null,
      marketValue: null,
      unrealizedProfit: null,
      unrealizedReturnPct: null,
    });
  });

  it('combines realized sell profit with valid unrealized profit', () => {
    const summary = summarizeForwardSimulation(ledger({
      positions: [position()],
      transactions: [{
        id: 'sell-1', sourceSignalId: 'signal-1', cycleId: 'closed-1',
        strategyId: 'realtime-technical', strategyVersion: '1', code: '600000', name: '浦发银行',
        type: 'sell', intent: 'exit', shares: 100, price: 11, amount: 1100,
        tradedAt: '2026-08-05T02:00:00.000Z', positionSharesAfter: 0,
        availableSharesAfter: 0, realizedProfit: 100, reasons: [],
      }],
    }), { '000001': 12 });

    expect(summary).toMatchObject({ realizedProfit: 100, unrealizedProfit: 200, totalProfit: 300 });
  });
});
