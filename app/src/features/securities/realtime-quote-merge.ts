import type { StockQuote } from '../../infrastructure/market-data/stock-api';

export function overlayRealtimeQuote<T extends { code: string }>(
  saved: T,
  live?: StockQuote,
): T {
  if (!live || live.code !== saved.code) return { ...saved };

  return {
    ...saved,
    name: live.name,
    market: live.market,
    price: live.price,
    change: live.change,
    changePct: live.changePct,
    open: live.open,
    high: live.high,
    low: live.low,
    volume: live.volume,
    amount: live.amount,
    preClose: live.preClose,
    turnover: live.turnover,
    pe: live.pe,
    pb: live.pb,
    totalShares: live.totalShares,
    floatShares: live.floatShares,
    totalCap: live.totalCap,
    floatCap: live.floatCap,
  } as T;
}

export function overlayRealtimeQuotesPreservingOrder<T extends { code: string }>(
  saved: T[],
  live: Record<string, StockQuote>,
): T[] {
  return saved.map(item => overlayRealtimeQuote(item, live[item.code]));
}
