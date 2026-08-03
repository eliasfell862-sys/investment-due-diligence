import { describe, expect, it } from 'vitest';
import type { StockKLine } from '../../infrastructure/market-data/stock-api';
import { calcRSI } from './technical-indicators';

function risingKLines(count: number): StockKLine[] {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    open: 10 + index,
    close: 10 + index,
    high: 10.5 + index,
    low: 9.5 + index,
    volume: 1000,
    amount: 10000,
  }));
}

describe('calcRSI', () => {
  it('aligns RSI values with the final K-line and never emits NaN', () => {
    const klines = risingKLines(30);

    calcRSI(klines);

    const last = klines.at(-1) as StockKLine & {
      rsi?: { rsi6?: number; rsi12?: number; rsi24?: number };
    };
    expect(last.rsi).toEqual({ rsi6: 100, rsi12: 100, rsi24: 100 });
    expect(Object.values(last.rsi ?? {}).every(Number.isFinite)).toBe(true);
  });
});
