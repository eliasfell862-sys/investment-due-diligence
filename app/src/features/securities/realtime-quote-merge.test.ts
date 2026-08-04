import { describe, expect, it } from 'vitest';
import type { StockQuote } from '../../infrastructure/market-data/stock-api';
import { overlayRealtimeQuote, overlayRealtimeQuotesPreservingOrder } from './realtime-quote-merge';

function liveQuote(code: string, price: number): StockQuote {
  return {
    code,
    name: `live-${code}`,
    market: code.startsWith('6') ? 'sh' : 'sz',
    price,
    change: 2,
    changePct: 3,
    open: price - 1,
    high: price + 1,
    low: price - 2,
    volume: 100,
    amount: 1000,
    preClose: price - 2,
    turnover: 4,
    pe: 12,
    pb: 2,
    totalShares: 10,
    floatShares: 8,
    totalCap: 100,
    floatCap: 80,
  };
}

describe('realtime quote overlay', () => {
  it('overlays quote fields while preserving custom analysis fields', () => {
    const saved = {
      code: '000001',
      name: 'saved',
      price: 10,
      score: 88,
      signalCount: 3,
      signals: ['低估'],
      summary: '保持原判断',
    };
    const merged = overlayRealtimeQuote(saved, liveQuote('000001', 12));
    expect(merged).toMatchObject({
      name: 'live-000001',
      price: 12,
      changePct: 3,
      score: 88,
      signalCount: 3,
      signals: ['低估'],
      summary: '保持原判断',
    });
    expect(saved).toEqual({
      code: '000001',
      name: 'saved',
      price: 10,
      score: 88,
      signalCount: 3,
      signals: ['低估'],
      summary: '保持原判断',
    });
  });

  it('preserves array order and does not mutate source records', () => {
    const saved = [
      { code: '600519', price: 1000, score: 90 },
      { code: '000001', price: 10, score: 80 },
    ];
    const original = structuredClone(saved);
    const merged = overlayRealtimeQuotesPreservingOrder(saved, {
      '000001': liveQuote('000001', 12),
      '600519': liveQuote('600519', 1300),
    });
    expect(merged.map(item => item.code)).toEqual(['600519', '000001']);
    expect(merged.map(item => item.price)).toEqual([1300, 12]);
    expect(merged.map(item => item.score)).toEqual([90, 80]);
    expect(saved).toEqual(original);
    expect(merged[0]).not.toBe(saved[0]);
  });

  it('returns a new unchanged record when no live quote exists', () => {
    const saved = { code: '000001', price: 10, allocation: 25 };
    const merged = overlayRealtimeQuote(saved);
    expect(merged).toEqual(saved);
    expect(merged).not.toBe(saved);
  });
});
