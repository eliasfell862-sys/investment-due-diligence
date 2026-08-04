import type { StockKLine, StockQuote } from '../../infrastructure/market-data/stock-api';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';

interface RealtimeAnalysisOptions {
  tradingDate: string;
  realtime: boolean;
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function buildRealtimeAnalysisKlines(
  historicalKlines: StockKLine[],
  quote: StockQuote,
  options: RealtimeAnalysisOptions,
): StockKLine[] {
  if (!options.realtime || historicalKlines.length === 0 || quote.price <= 0) {
    return historicalKlines;
  }

  const klines = historicalKlines.map(kline => ({ ...kline }));
  const last = klines.at(-1)!;
  const open = positiveOr(quote.open, positiveOr(quote.preClose, quote.price));
  const high = Math.max(open, quote.price, positiveOr(quote.high, quote.price));
  const low = Math.min(open, quote.price, positiveOr(quote.low, quote.price));
  const liveCandle: StockKLine = {
    date: options.tradingDate,
    open,
    close: quote.price,
    high,
    low,
    volume: Math.max(0, quote.volume),
    amount: Math.max(0, quote.amount),
  };

  if (last.date === options.tradingDate) {
    klines[klines.length - 1] = {
      ...liveCandle,
      open: positiveOr(last.open, open),
      high: Math.max(last.high, high),
      low: Math.min(positiveOr(last.low, low), low),
    };
  } else {
    klines.push(liveCandle);
  }

  calcAllIndicators(klines);
  return klines;
}
