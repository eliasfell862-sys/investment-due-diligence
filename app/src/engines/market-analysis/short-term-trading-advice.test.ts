import { describe, expect, it } from 'vitest';
import type { StockKLine, StockQuote } from '../../infrastructure/market-data/stock-api';
import {
  actionForShortTermScore,
  buildShortTermTradingAdvice,
  type ShortTermAdviceBaseInput,
} from './short-term-trading-advice';

type IndicatorRow = StockKLine & {
  ma: { ma5: number; ma10: number; ma20: number; ma60: number };
  macd: { dif: number; dea: number; bar: number };
  kdj: { k: number; d: number; j: number };
  rsi: { rsi6: number; rsi12: number; rsi24: number };
  boll: { upper: number; mid: number; lower: number };
  atr: number;
};

function quote(overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    code: '000001', name: '平安银行', market: 'sz', price: 10.8, change: 0.2, changePct: 1.9,
    open: 10.55, high: 10.9, low: 10.5, volume: 1_600_000, amount: 170_000_000,
    preClose: 10.6, turnover: 3.2, pe: 12, pb: 1.1, totalShares: 100, floatShares: 80,
    totalCap: 800, floatCap: 640, ...overrides,
  };
}

function bullishRows(count = 60, overrides: Partial<IndicatorRow> = {}): IndicatorRow[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 8.4 + index * 0.04;
    return {
      date: `2026-05-${String(index + 1).padStart(2, '0')}`,
      open: close - 0.05, close, high: close + 0.2, low: close - 0.2,
      volume: index === count - 1 ? 1_600_000 : 1_000_000, amount: 100_000_000,
      ma: { ma5: close - 0.08, ma10: close - 0.16, ma20: close - 0.3, ma60: close - 0.6 },
      macd: { dif: 0.35, dea: 0.22, bar: 0.26 },
      kdj: { k: 62, d: 55, j: 70 },
      rsi: { rsi6: 62, rsi12: 58, rsi24: 55 },
      boll: { upper: close + 0.9, mid: close - 0.15, lower: close - 1.2 },
      atr: 0.32,
      ...overrides,
    };
  });
}

function baseInput(overrides: Partial<ShortTermAdviceBaseInput> = {}): ShortTermAdviceBaseInput {
  return {
    quote: quote(),
    klines: bullishRows(),
    strategies: [{ id: 'breakout', name: '平台突破', type: 'buy', strength: '强', description: '', conditions: [] }],
    patterns: [{ name: '早晨之星', type: 'bullish', strength: '强', description: '', position: 59 }],
    dataAsOf: '2026-08-04T10:00:00.000Z',
    calculatedAt: '2026-08-04T10:00:01.000Z',
    ...overrides,
  };
}

describe('buildShortTermTradingAdvice', () => {
  it('maps the fixed score thresholds', () => {
    expect(actionForShortTermScore(80)).toBe('strong_buy');
    expect(actionForShortTermScore(70)).toBe('buy_on_dip');
    expect(actionForShortTermScore(58)).toBe('hold_watch');
    expect(actionForShortTermScore(45)).toBe('avoid');
    expect(actionForShortTermScore(44)).toBe('reduce_sell');
  });

  it('returns insufficient data without thirty valid indicator rows', () => {
    const result = buildShortTermTradingAdvice(baseInput({ klines: bullishRows(29) }));
    expect(result).toMatchObject({
      action: 'insufficient_data', entryRange: null, stopLoss: null,
      takeProfit1: null, takeProfit2: null, riskRewardRatio: null,
    });
  });

  it('returns ordered executable prices for a qualified setup', () => {
    const result = buildShortTermTradingAdvice(baseInput());
    expect(['strong_buy', 'buy_on_dip']).toContain(result.action);
    expect(result.entryRange!.low).toBeLessThanOrEqual(result.entryRange!.high);
    expect(result.stopLoss).toBeLessThan(result.entryRange!.low);
    expect(result.takeProfit1).toBeGreaterThan(result.entryRange!.high);
    expect(result.takeProfit2).toBeGreaterThan(result.takeProfit1!);
    expect(result.riskRewardRatio).toBeGreaterThanOrEqual(1.5);
    expect(result.maxHoldingTradingDays).toBeGreaterThanOrEqual(3);
    expect(result.maxHoldingTradingDays).toBeLessThanOrEqual(10);
  });

  it('caps an overbought near-limit-up setup at hold watch', () => {
    const rows = bullishRows(60);
    rows[59] = {
      ...rows[59], close: 11.65, high: 11.66,
      rsi: { rsi6: 88, rsi12: 79, rsi24: 70 },
      kdj: { k: 92, d: 88, j: 100 },
    };
    const result = buildShortTermTradingAdvice(baseInput({
      quote: quote({ price: 11.65, changePct: 9.91, preClose: 10.6 }),
      klines: rows,
    }));
    expect(['hold_watch', 'avoid', 'reduce_sell']).toContain(result.action);
  });

  it('caps strong sell signals and records no more than three reasons or risks', () => {
    const result = buildShortTermTradingAdvice(baseInput({
      strategies: [{ id: 'sell', name: '放量跌停', type: 'sell', strength: '强', description: '', conditions: [] }],
      patterns: [
        { name: '三只乌鸦', type: 'bearish', strength: '强', description: '', position: 59 },
        { name: '乌云盖顶', type: 'bearish', strength: '强', description: '', position: 59 },
      ],
    }));
    expect(['avoid', 'reduce_sell']).toContain(result.action);
    expect(result.reasons.length).toBeLessThanOrEqual(3);
    expect(result.risks.length).toBeLessThanOrEqual(3);
  });
});
