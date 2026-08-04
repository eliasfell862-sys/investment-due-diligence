import { describe, expect, it } from 'vitest';
import type { StockKLine, StockQuote } from '../../infrastructure/market-data/stock-api';
import type { FundamentalScore } from './fundamental-scorer';
import type { PatternResult } from './kline-patterns';
import type { StrategySignal } from './trading-strategies';
import { buildMediumTermBuyAdvice, type MediumTermBuyAdviceInput } from './medium-term-buy-advice';

function quote(overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    code: '000001', name: '平安银行', market: 'sz', price: 12, change: 0.2,
    changePct: 1.7, open: 11.8, high: 12.2, low: 11.7, volume: 1_000_000,
    amount: 120_000_000, preClose: 11.8, turnover: 3, pe: 14, pb: 1.4,
    totalShares: 100, floatShares: 80, totalCap: 800, floatCap: 640,
    ...overrides,
  };
}

function bullishKlines(): StockKLine[] {
  const rows = Array.from({ length: 120 }, (_, index) => {
    const close = 10 + index * 0.015;
    return {
      date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      open: close - 0.05, close, high: close + 0.1, low: close - 0.1,
      volume: 1_000_000 + index * 1000, amount: 12_000_000,
    };
  });
  Object.assign(rows.at(-2)!, {
    macd: { dif: 0.2, dea: 0.3, bar: -0.1 }, kdj: { k: 45, d: 48, j: 39 },
    rsi: { rsi6: 48, rsi12: 50, rsi24: 52 }, ma: { ma5: 11.8, ma10: 11.5, ma20: 11, ma60: 10 },
    boll: { upper: 13, mid: 11, lower: 9 }, atr: 0.4,
  });
  Object.assign(rows.at(-1)!, {
    close: 12, macd: { dif: 0.5, dea: 0.35, bar: 0.15 }, kdj: { k: 55, d: 50, j: 65 },
    rsi: { rsi6: 58, rsi12: 55, rsi24: 53 }, ma: { ma5: 12, ma10: 11.7, ma20: 11.2, ma60: 10.2 },
    boll: { upper: 13.2, mid: 11.2, lower: 9.2 }, atr: 0.42,
  });
  return rows;
}

function fundamental(overrides: Partial<FundamentalScore> = {}): FundamentalScore {
  return { totalScore: 82, rating: '优秀', breakdown: [], metrics: [], ...overrides };
}

function bullishStrategies(): StrategySignal[] {
  return [{ id: 'breakout', name: '平台突破', type: 'buy', strength: '强', description: '放量突破', conditions: [] }];
}

function bullishPatterns(): PatternResult[] {
  return [{ name: '早晨之星', type: 'bullish', strength: '强', description: '底部反转', position: 119 }];
}

function baseInput(overrides: Partial<MediumTermBuyAdviceInput> = {}): MediumTermBuyAdviceInput {
  return {
    quote: quote(), klines: bullishKlines(), fundamental: fundamental(), hasFinancialData: true,
    strategies: bullishStrategies(), patterns: bullishPatterns(),
    calculatedAt: '2026-08-04T10:00:00.000Z', ...overrides,
  };
}

describe('buildMediumTermBuyAdvice', () => {
  it('returns accumulate for complete multi-dimensional bullish evidence', () => {
    const advice = buildMediumTermBuyAdvice(baseInput());
    expect(advice).toMatchObject({ action: 'accumulate', label: '分批买入', horizon: '1_3_months' });
    expect(advice.score).toBeGreaterThanOrEqual(78);
    expect(advice.confidenceLabel).toBe('高');
  });

  it('caps bullish advice at cautious buy when financial data is missing', () => {
    const advice = buildMediumTermBuyAdvice(baseInput({ hasFinancialData: false }));
    expect(advice.action).toBe('cautious_buy');
    expect(advice.score).toBeLessThanOrEqual(77);
    expect(advice.dataCompleteness.fundamental).toBe(false);
    expect(advice.risks).toContain('基本面数据缺失');
  });

  it('downgrades to watch when strong sell evidence is present', () => {
    const advice = buildMediumTermBuyAdvice(baseInput({
      strategies: [{ id: 'sell', name: '趋势转弱', type: 'sell', strength: '强', description: '强卖出', conditions: [] }],
    }));
    expect(advice.score).toBeLessThanOrEqual(67);
    expect(advice.action).toBe('watch');
  });

  it('returns insufficient data for invalid price or fewer than 60 K-lines', () => {
    expect(buildMediumTermBuyAdvice(baseInput({ quote: quote({ price: 0 }) })).action).toBe('insufficient_data');
    expect(buildMediumTermBuyAdvice(baseInput({ klines: bullishKlines().slice(-30) })).action).toBe('insufficient_data');
  });

  it('limits score, reasons, and risks', () => {
    const advice = buildMediumTermBuyAdvice(baseInput());
    expect(advice.score).toBeGreaterThanOrEqual(0);
    expect(advice.score).toBeLessThanOrEqual(100);
    expect(advice.reasons.length).toBeLessThanOrEqual(3);
    expect(advice.risks.length).toBeLessThanOrEqual(3);
  });
});
