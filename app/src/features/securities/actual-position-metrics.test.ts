import { describe, expect, it } from 'vitest';
import type { StockQuote } from '../../infrastructure/market-data/stock-api';
import type { StockPosition } from './stock-position-ledger';
import {
  calculateActualPortfolioSummary,
  calculateActualPositionMetrics,
  type ActualPositionMetrics,
} from './actual-position-metrics';

function position(overrides: Partial<StockPosition> = {}): StockPosition {
  return {
    id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
    shares: 100, averageCost: 10, totalCost: 1_000,
    openedAt: '2026-08-05T01:30:00.000Z', updatedAt: '2026-08-05T01:30:00.000Z',
    sourceAlertIds: ['manual-1'], ...overrides,
  };
}

function quote(price: number): StockQuote {
  return {
    code: '000001', name: '平安银行', market: 'sz', price,
    change: 0, changePct: 0, open: price, high: price, low: price,
    volume: 1_000, amount: price * 1_000, preClose: price, turnover: 1,
    pe: 10, pb: 1, totalShares: 1, floatShares: 1, totalCap: 1, floatCap: 1,
  };
}

function metrics(marketValue: number | null, floatingProfit: number | null): ActualPositionMetrics {
  return {
    currentPrice: marketValue === null ? null : 12,
    marketValue,
    floatingProfit,
    floatingProfitRate: floatingProfit === null ? null : 20,
  };
}

describe('actual position metrics', () => {
  it('calculates market value and floating profit from a valid realtime quote', () => {
    expect(calculateActualPositionMetrics(position(), quote(12))).toEqual({
      currentPrice: 12, marketValue: 1_200, floatingProfit: 200, floatingProfitRate: 20,
    });
  });

  it('returns unavailable metrics instead of zero when realtime price is missing', () => {
    expect(calculateActualPositionMetrics(position(), undefined)).toEqual({
      currentPrice: null, marketValue: null, floatingProfit: null, floatingProfitRate: null,
    });
  });

  it('marks the portfolio summary unavailable when any position lacks pricing', () => {
    const summary = calculateActualPortfolioSummary([
      { position: position({ code: '000001', totalCost: 1_000 }), metrics: metrics(1_200, 200) },
      { position: position({ code: '600519', totalCost: 2_000 }), metrics: metrics(null, null) },
    ]);
    expect(summary).toEqual({
      positionCount: 2, totalCost: 3_000, marketValue: null,
      floatingProfit: null, unpricedCount: 1,
    });
  });
});
