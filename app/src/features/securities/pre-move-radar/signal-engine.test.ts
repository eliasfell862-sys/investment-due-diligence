import { describe, expect, it } from 'vitest';
import type { StockQuote } from '../../../infrastructure/market-data/stock-api';
import { calculatePreMoveSignal, type PreMoveIndicatorKLine, type PreMoveSignalInput } from './signal-engine';

function quote(overrides: Partial<StockQuote> = {}): StockQuote {
  return { code: '000001', name: '平安银行', market: 'sz', price: 10, change: 0.2, changePct: 2,
    open: 9.9, high: 10.2, low: 9.8, volume: 100000, amount: 12000, preClose: 9.8,
    turnover: 2, pe: 6, pb: 0.7, totalShares: 0, floatShares: 0, totalCap: 1000, floatCap: 900,
    ...overrides };
}

function klines(overheated = false): PreMoveIndicatorKLine[] {
  return Array.from({ length: 70 }, (_, index) => {
    const base = overheated ? 8 + index * 0.08 : 9.7 + index * 0.004;
    return { date: `2026-${index < 31 ? '06' : '07'}-${String((index % 28) + 1).padStart(2, '0')}`,
      open: base, close: base + 0.03, high: base + 0.08, low: base - 0.08,
      volume: index > 65 ? 1500 : 1000, amount: 100000000,
      ma: { ma5: base, ma10: base * 0.999, ma20: base * 0.998, ma60: base * 0.99 },
      macd: { dif: 0.2, dea: 0.1, bar: 0.2 }, kdj: { k: 55, d: 50, j: overheated ? 92 : 65 },
      rsi: { rsi6: overheated ? 90 : 60, rsi12: 58, rsi24: 55 },
      boll: { upper: base * 1.04, mid: base, lower: base * 0.96 }, atr: index < 50 ? 0.2 : 0.1,
      obv: index * 100,
    };
  });
}

function input(overrides: Partial<PreMoveSignalInput> = {}): PreMoveSignalInput {
  return { asOfDate: '2026-08-06', formal: true, quote: quote(),
    industry: { returnPercentile: 90, flowPercentile: 85, breadthPercentile: 80,
      relativeStrengthSlopePercentile: 80, stage: 'starting' },
    capitalFlow: { code: '000001', changePct3d: 1, changePct5d: 2, changePct10d: 3,
      mainNet3d: 100, mainRatio3d: 2, mainNet5d: 500, mainRatio5d: 5,
      mainNet10d: 800, mainRatio10d: 6 },
    flowHistory: Array.from({ length: 8 }, (_, index) => ({ date: `2026-07-${index + 1}`,
      mainNet: 100 + index, mainRatio: 3, superLargeNet: 60, largeNet: 40 })),
    klines: klines(), benchmarkKlines: klines().map(line => ({ ...line, close: line.close * 0.99 })),
    strategySignals: [{ id: 'platform', name: '平台突破', type: 'buy', strength: '中', description: '', conditions: [] }],
    patterns: [{ name: '锤头', type: 'bullish', strength: '中', description: '', position: 69 }],
    specialTreatment: false, suspended: false, ...overrides };
}

describe('calculatePreMoveSignal', () => {
  it('scores strengthening industry rotation above twenty-two points', () => {
    const result = calculatePreMoveSignal(input());
    expect(result.scores.industryRotation).toBeGreaterThanOrEqual(22);
    expect(result.positiveEvidence).toContain('行业资金与相对强度同步改善');
  });

  it('recognizes capital inflow before price fully starts', () => {
    const result = calculatePreMoveSignal(input());
    expect(result.scores.capitalFlow).toBeGreaterThanOrEqual(18);
    expect(result.positiveEvidence).toContain('资金先行流入，价格尚未充分启动');
  });

  it('hard-gates an overheated stock even with strong inputs', () => {
    const result = calculatePreMoveSignal(input({ klines: klines(true), quote: quote({ changePct: 9.8 }) }));
    expect(result.hardRisks).toContain('overheated');
  });

  it('hard-gates missing K-line or capital-flow core data', () => {
    expect(calculatePreMoveSignal(input({ klines: [], capitalFlow: null })).hardRisks)
      .toContain('core_data_missing');
  });

  it('uses the formal close liquidity threshold of fifty million yuan', () => {
    expect(calculatePreMoveSignal(input({ quote: quote({ amount: 4999 }) })).hardRisks)
      .toContain('illiquid');
  });
});