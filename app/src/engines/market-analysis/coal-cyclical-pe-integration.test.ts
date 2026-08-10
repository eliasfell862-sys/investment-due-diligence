import { describe, expect, it } from 'vitest';
import type { StockKLine, StockQuote } from '../../infrastructure/market-data/stock-api';
import type { FundamentalScore } from './fundamental-scorer';
import { buildMediumTermBuyAdvice, type MediumTermBuyAdviceInput } from './medium-term-buy-advice';

function quote(overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    code: '601088', name: '中国神华', market: 'sh', price: 40, change: 0,
    changePct: 0, open: 40, high: 41, low: 39, volume: 1_000_000,
    amount: 120_000_000, preClose: 40, turnover: 2, pe: 10, pb: 1.5,
    totalShares: 100, floatShares: 80, totalCap: 800, floatCap: 640,
    ...overrides,
  };
}

function rows(): StockKLine[] {
  const result = Array.from({ length: 120 }, (_, index) => ({
    date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    open: 10, close: 10, high: 10.2, low: 9.8, volume: 1_000_000, amount: 10_000_000,
  }));
  Object.assign(result.at(-2)!, {
    macd: { dif: 0.2, dea: 0.2, bar: 0 }, kdj: { k: 50, d: 50, j: 50 },
    rsi: { rsi6: 50, rsi12: 50, rsi24: 50 }, ma: { ma5: 10, ma10: 10, ma20: 10, ma60: 10 },
    boll: { upper: 11, mid: 10, lower: 9 }, atr: 0.3,
  });
  Object.assign(result.at(-1)!, {
    macd: { dif: 0.2, dea: 0.2, bar: 0 }, kdj: { k: 50, d: 50, j: 50 },
    rsi: { rsi6: 50, rsi12: 50, rsi24: 50 }, ma: { ma5: 10, ma10: 10, ma20: 10, ma60: 10 },
    boll: { upper: 11, mid: 10, lower: 9 }, atr: 0.3,
  });
  return result;
}

const fundamental: FundamentalScore = { totalScore: 60, rating: '良好', breakdown: [], metrics: [] };

function input(stock: StockQuote): MediumTermBuyAdviceInput {
  return {
    quote: stock, klines: rows(), fundamental, hasFinancialData: true,
    strategies: [], patterns: [], calculatedAt: '2026-08-05T10:00:00.000Z',
  };
}

describe('coal cyclical PE medium-term integration', () => {
  it('adds cycle-bottom evidence and six points only to the covered coal stock', () => {
    const neutral = buildMediumTermBuyAdvice(input(quote({ pe: 10 })));
    const candidate = buildMediumTermBuyAdvice(input(quote({ pe: 14 })));
    expect(candidate.score).toBe(neutral.score + 6);
    expect(candidate.reasons.some(reason => reason.includes('周期底部候选'))).toBe(true);
  });

  it('deducts eight points for the coal low-PE peak-profit trap', () => {
    const neutral = buildMediumTermBuyAdvice(input(quote({ pe: 10 })));
    const peakRisk = buildMediumTermBuyAdvice(input(quote({ pe: 8 })));
    expect(peakRisk.score).toBe(neutral.score - 8);
    expect(peakRisk.risks.some(risk => risk.includes('低PE陷阱'))).toBe(true);
  });

  it('leaves a non-coal stock unchanged', () => {
    const lowPe = buildMediumTermBuyAdvice(input(quote({ code: '600519', name: '贵州茅台', pe: 8 })));
    const highPe = buildMediumTermBuyAdvice(input(quote({ code: '600519', name: '贵州茅台', pe: 40 })));
    expect(lowPe.score).toBe(highPe.score);
    expect([...lowPe.reasons, ...lowPe.risks].some(item => item.includes('煤炭周期PE'))).toBe(false);
  });
});
