import { describe, expect, it } from 'vitest';
import type { StockQuote } from '../../infrastructure/market-data/stock-api';
import { computeRealtimePriceTargets } from './realtime-price-targets';

function klines(): any[] {
  const rows: any[] = Array.from({ length: 20 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, '0')}`,
    open: 10, close: 10, high: 10.5, low: 9.5, volume: 1_000, amount: 10_000,
  }));
  rows[rows.length - 1] = {
    ...rows.at(-1),
    boll: { lower: 9.6, mid: 10, upper: 10.4 },
    ma: { ma20: 10 },
    atr: 0.2,
  };
  return rows;
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

describe('computeRealtimePriceTargets', () => {
  it('moves both suggested prices with the live quote while retaining technical levels', () => {
    const first = computeRealtimePriceTargets(klines(), quote(10.2));
    const second = computeRealtimePriceTargets(klines(), quote(10.3));

    expect(first).toMatchObject({ buyPrice: '10.00', sellPrice: '10.40', supportLevel: '9.60', resistanceLevel: '10.40' });
    expect(second).toMatchObject({ buyPrice: '10.10', sellPrice: '10.50', supportLevel: '9.60', resistanceLevel: '10.40' });
  });
});
