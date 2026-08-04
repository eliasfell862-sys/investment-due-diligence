import type { StockQuote } from '../../infrastructure/market-data/stock-api';
import type { PortfolioPositionSnapshot } from './portfolio-group-storage';

export interface MarkedPortfolioPosition {
  savedPrice: number;
  currentPrice: number;
  currentValue: number;
  unrealizedPnl: number;
  returnPct: number;
}

function roundTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function markPortfolioPosition(
  position: PortfolioPositionSnapshot,
  liveQuote?: StockQuote,
): MarkedPortfolioPosition {
  const currentPrice = liveQuote
    && Number.isFinite(liveQuote.price)
    && liveQuote.price > 0
    ? liveQuote.price
    : position.price;
  const currentValue = roundTwo(currentPrice * position.shares);
  const unrealizedPnl = roundTwo(currentValue - position.amount);
  const returnPct = position.amount > 0
    ? roundTwo(unrealizedPnl / position.amount * 100)
    : 0;

  return {
    savedPrice: position.price,
    currentPrice,
    currentValue,
    unrealizedPnl,
    returnPct,
  };
}

export function currentBoardLotShares(amount: number, currentPrice: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return 0;
  return Math.floor(amount / currentPrice / 100) * 100;
}
