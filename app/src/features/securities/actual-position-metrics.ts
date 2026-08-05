import type { StockQuote } from '../../infrastructure/market-data/stock-api';
import type { StockPosition } from './stock-position-ledger';

export interface ActualPositionMetrics {
  currentPrice: number | null;
  marketValue: number | null;
  floatingProfit: number | null;
  floatingProfitRate: number | null;
}

export interface ActualPortfolioSummary {
  positionCount: number;
  totalCost: number;
  marketValue: number | null;
  floatingProfit: number | null;
  unpricedCount: number;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateActualPositionMetrics(
  position: StockPosition,
  quote?: StockQuote,
): ActualPositionMetrics {
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
    return {
      currentPrice: null,
      marketValue: null,
      floatingProfit: null,
      floatingProfitRate: null,
    };
  }
  const marketValue = roundMoney(quote.price * position.shares);
  const floatingProfit = roundMoney((quote.price - position.averageCost) * position.shares);
  const floatingProfitRate = roundMoney((quote.price / position.averageCost - 1) * 100);
  return { currentPrice: quote.price, marketValue, floatingProfit, floatingProfitRate };
}

export function calculateActualPortfolioSummary(
  rows: Array<{ position: StockPosition; metrics: ActualPositionMetrics }>,
): ActualPortfolioSummary {
  const totalCost = roundMoney(rows.reduce((sum, row) => sum + row.position.totalCost, 0));
  const unpricedCount = rows.filter(row => row.metrics.marketValue === null).length;
  return {
    positionCount: rows.length,
    totalCost,
    marketValue: unpricedCount > 0
      ? null
      : roundMoney(rows.reduce((sum, row) => sum + (row.metrics.marketValue ?? 0), 0)),
    floatingProfit: unpricedCount > 0
      ? null
      : roundMoney(rows.reduce((sum, row) => sum + (row.metrics.floatingProfit ?? 0), 0)),
    unpricedCount,
  };
}
