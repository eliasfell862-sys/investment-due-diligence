import { describe, expect, it } from 'vitest';
import type { StockKLine, StockQuote } from '../../infrastructure/market-data/stock-api';
import { buildRealtimeAnalysisKlines } from './realtime-analysis-klines';

function historicalKlines(): StockKLine[] {
  return Array.from({ length: 30 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, '0')}`,
    open: 10,
    close: 10,
    high: 10.2,
    low: 9.8,
    volume: 1_000,
    amount: 10_000,
  }));
}

function quote(price: number): StockQuote {
  return {
    code: '000001', name: 'Test Stock', market: 'sz', price,
    change: price - 10, changePct: (price - 10) * 10,
    open: 10, high: price, low: 9.9, volume: 2_000, amount: 20_000,
    preClose: 10, turnover: 1, pe: 10, pb: 1,
    totalShares: 1, floatShares: 1, totalCap: 100, floatCap: 80,
  };
}

describe('buildRealtimeAnalysisKlines', () => {
  it('merges the live quote into one temporary daily candle and recalculates indicators', () => {
    const first = buildRealtimeAnalysisKlines(historicalKlines(), quote(12), {
      tradingDate: '2026-08-04',
      realtime: true,
    });
    const second = buildRealtimeAnalysisKlines(historicalKlines(), quote(13), {
      tradingDate: '2026-08-04',
      realtime: true,
    });

    expect(first).toHaveLength(31);
    expect(first.at(-1)).toMatchObject({ date: '2026-08-04', close: 12, high: 12 });
    expect(second).toHaveLength(31);
    expect(second.at(-1)).toMatchObject({ date: '2026-08-04', close: 13, high: 13 });
    expect((first.at(-1) as any)?.boll).toBeDefined();
    expect((second.at(-1) as any)?.boll).not.toEqual((first.at(-1) as any)?.boll);
  });
});
