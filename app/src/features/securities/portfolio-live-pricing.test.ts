import { describe, expect, it } from 'vitest';
import type { StockQuote } from '../../infrastructure/market-data/stock-api';
import type { PortfolioPositionSnapshot } from './portfolio-group-storage';
import { currentBoardLotShares, markPortfolioPosition } from './portfolio-live-pricing';

function savedPosition(overrides: Partial<PortfolioPositionSnapshot> = {}): PortfolioPositionSnapshot {
  return {
    code: '000001',
    name: 'Test Stock',
    groupName: 'Core',
    groupColor: '#70b8b0',
    score: 80,
    allocation: 100,
    amount: 10_000,
    shares: 1000,
    price: 10,
    rationale: 'saved',
    ...overrides,
  };
}

function quote(price: number): StockQuote {
  return {
    code: '000001', name: 'Test Stock', market: 'sz', price,
    change: 0, changePct: 0, open: price, high: price, low: price,
    volume: 0, amount: 0, preClose: price, turnover: 0, pe: 0, pb: 0,
    totalShares: 0, floatShares: 0, totalCap: 0, floatCap: 0,
  };
}

describe('portfolio live pricing', () => {
  it('keeps the saved price while calculating current value and return', () => {
    const position = savedPosition();
    const marked = markPortfolioPosition(position, quote(12));
    expect(marked).toEqual({
      savedPrice: 10,
      currentPrice: 12,
      currentValue: 12_000,
      unrealizedPnl: 2000,
      returnPct: 20,
    });
    expect(position.price).toBe(10);
    expect(position.amount).toBe(10_000);
  });

  it('falls back to the saved price when live data is missing', () => {
    const marked = markPortfolioPosition(savedPosition());
    expect(marked.currentPrice).toBe(10);
    expect(marked.unrealizedPnl).toBe(0);
  });

  it('recalculates board-lot shares from fixed amount and current price', () => {
    expect(currentBoardLotShares(10_000, 12)).toBe(800);
    expect(currentBoardLotShares(10_000, 0)).toBe(0);
  });
});
