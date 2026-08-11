import { describe, expect, it } from 'vitest';
import type { StockKLine, StockQuote } from '../../../infrastructure/market-data/stock-api';
import { buildTTradeMarketStructure } from './t-trading-market-structure';

function bars(count: number, direction: 'up' | 'down' = 'up'): StockKLine[] {
  return Array.from({ length: count }, (_, index) => {
    const trend = direction === 'up' ? index * 0.08 : (count - index) * 0.08;
    const close = 10 + trend;
    return {
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      open: close - (direction === 'up' ? 0.03 : -0.03),
      close,
      high: close + 0.15,
      low: close - 0.15,
      volume: 1_000 + index * 20,
      amount: close * (1_000 + index * 20),
    };
  });
}

function quote(price: number, overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    code: '000001',
    name: '平安银行',
    market: 'sz',
    price,
    change: 0.2,
    changePct: 1.2,
    open: price - 0.1,
    high: price + 0.2,
    low: price - 0.2,
    volume: 5_000,
    amount: 50_000,
    preClose: price - 0.2,
    turnover: 1.5,
    pe: 8,
    pb: 0.8,
    totalShares: 0,
    floatShares: 0,
    totalCap: 0,
    floatCap: 0,
    ...overrides,
  };
}

describe('T-trading market structure', () => {
  it('calculates ATRP20 and annualized 20-day volatility from ordered bars', () => {
    const history = bars(80);
    const current = history.at(-1)!.close;
    const result = buildTTradeMarketStructure({
      klines: history,
      quote: quote(current),
      quoteAt: '2026-08-11T02:00:00.000Z',
      evaluatedAt: '2026-08-11T02:00:05.000Z',
      marketStatus: 'trading',
    });

    expect(result.sampleDays).toBe(80);
    expect(result.atr20).toBeGreaterThan(0);
    expect(result.atrp20).toBeCloseTo(result.atr20 / current, 8);
    expect(result.annualizedVolatility20).toBeGreaterThanOrEqual(0);
    expect(result.support).toBeLessThanOrEqual(current);
    expect(result.resistance).toBeGreaterThanOrEqual(current);
    expect(result.dataQuality).toBe('ok');
  });

  it('classifies rising high-volume OBV as inflow', () => {
    const history = bars(40, 'up');
    const current = history.at(-1)!.close;
    const result = buildTTradeMarketStructure({
      klines: history,
      quote: quote(current, { volume: 10_000 }),
      quoteAt: '2026-08-11T02:00:00.000Z',
      evaluatedAt: '2026-08-11T02:00:05.000Z',
      marketStatus: 'trading',
    });

    expect(result.volumeRatio20).toBeGreaterThan(1.2);
    expect(result.obvSlope5).toBeGreaterThan(0);
    expect(result.flowBias).toBe('inflow');
  });

  it('classifies falling high-volume OBV as outflow', () => {
    const history = bars(40, 'down').map((bar, index) => ({
      ...bar,
      volume: 1_000 + index * 30,
    }));
    const current = history.at(-1)!.close;
    const result = buildTTradeMarketStructure({
      klines: history,
      quote: quote(current, { volume: 10_000, change: -0.3, changePct: -2 }),
      quoteAt: '2026-08-11T02:00:00.000Z',
      evaluatedAt: '2026-08-11T02:00:05.000Z',
      marketStatus: 'trading',
    });

    expect(result.obvSlope5).toBeLessThan(0);
    expect(result.flowBias).toBe('outflow');
  });

  it('reports insufficient data below 20 valid bars', () => {
    const result = buildTTradeMarketStructure({
      klines: bars(19),
      quote: quote(11),
      quoteAt: '2026-08-11T02:00:00.000Z',
      evaluatedAt: '2026-08-11T02:00:05.000Z',
      marketStatus: 'trading',
    });

    expect(result.dataQuality).toBe('insufficient');
    expect(result.sampleDays).toBe(19);
  });

  it('reports a trading quote older than 15 seconds as stale', () => {
    const result = buildTTradeMarketStructure({
      klines: bars(40),
      quote: quote(13),
      quoteAt: '2026-08-11T02:00:00.000Z',
      evaluatedAt: '2026-08-11T02:00:16.000Z',
      marketStatus: 'trading',
    });

    expect(result.dataQuality).toBe('stale');
  });
});
