import { describe, expect, it, vi } from 'vitest';
import type { MediumTermBuyAdvice } from '../../../engines/market-analysis/medium-term-buy-advice';
import type { ShortTermTradingAdvice } from '../../../engines/market-analysis/short-term-trading-advice';
import type { DailyBasicData, StockKLine, StockQuote } from '../../../infrastructure/market-data/stock-api';
import {
  clearLiveTradingCandidateCache,
  LIVE_TRADING_CANDIDATE_CACHE_TTL_MS,
  scanLiveTradingCandidates,
  type LiveTradingCandidateScannerDependencies,
} from './live-trading-candidate-scanner';

function quote(code = '000333', name = 'Midea'): StockQuote {
  return {
    code, name, market: code.startsWith('6') ? 'sh' : 'sz', price: 10,
    change: 0.2, changePct: 2, open: 9.8, high: 10.2, low: 9.7,
    volume: 2_000, amount: 20_000, preClose: 9.8, turnover: 2,
    pe: 15, pb: 2, totalShares: 100, floatShares: 80, totalCap: 500, floatCap: 400,
  };
}

function validKlines(count = 120): StockKLine[] {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
    open: 9.8, close: 10, high: 10.2, low: 9.6, volume: 1_000, amount: 10_000,
  }));
}

function mediumAdvice(code: string): MediumTermBuyAdvice {
  return {
    code, horizon: '1_3_months', action: 'accumulate', label: '' as MediumTermBuyAdvice['label'],
    score: 80, confidence: 80, confidenceLabel: '' as MediumTermBuyAdvice['confidenceLabel'],
    reasons: [], risks: [], dataCompleteness: { quote: true, kline: true, fundamental: true },
    calculatedAt: '2026-08-17T02:00:00.000Z',
  };
}

function shortAdvice(code: string): ShortTermTradingAdvice {
  return {
    code, horizon: '3_10_trading_days', action: 'buy_on_dip', label: '' as ShortTermTradingAdvice['label'],
    score: 70, confidence: 80, confidenceLabel: '' as ShortTermTradingAdvice['confidenceLabel'],
    entryRange: { low: 9.8, high: 10 }, stopLoss: 9.5, takeProfit1: 10.5, takeProfit2: 11,
    maxHoldingTradingDays: 7, riskRewardRatio: 2, reasons: [], risks: [], evidence: [],
    dataCompleteness: { quote: true, kline: true, indicators: true, strategies: true },
    dataAsOf: '2026-08-17', calculatedAt: '2026-08-17T02:00:00.000Z', cacheStatus: 'fresh',
  };
}

function dependencies(overrides: Partial<LiveTradingCandidateScannerDependencies> = {}): LiveTradingCandidateScannerDependencies {
  return {
    fetchKLine: vi.fn().mockResolvedValue(validKlines()),
    fetchBasic: vi.fn().mockResolvedValue({ code: '000333' } as DailyBasicData),
    calcIndicators: vi.fn(),
    scanStrategies: vi.fn().mockReturnValue([]),
    scanPatterns: vi.fn().mockReturnValue([]),
    scoreFundamentals: vi.fn().mockReturnValue({ totalScore: 70, rating: '' as never, breakdown: [], metrics: [] }),
    buildMediumAdvice: vi.fn(({ quote: stock }) => mediumAdvice(stock.code)),
    buildShortAdvice: vi.fn(({ quote: stock }) => shortAdvice(stock.code)),
    computeTargets: vi.fn().mockReturnValue({
      buyPrice: '9.90', sellPrice: '10.60', stopLoss: '9.40', supportLevel: '9.60',
      resistanceLevel: '10.80', atr: '0.30', position: '10%', positionNote: 'test',
    }),
    now: vi.fn().mockReturnValue(Date.parse('2026-08-17T02:00:00.000Z')),
    ...overrides,
  };
}

describe('live trading candidate scanner', () => {
  it('builds both advice horizons and formal targets from one K-line and one basic fetch', async () => {
    clearLiveTradingCandidateCache();
    const deps = dependencies();
    const result = await scanLiveTradingCandidates({
      accountId: 'account-a', codes: ['000333'], quotes: { '000333': quote() },
    }, deps);
    expect(deps.fetchKLine).toHaveBeenCalledTimes(1);
    expect(deps.fetchBasic).toHaveBeenCalledTimes(1);
    expect(result[0]).toMatchObject({ code: '000333', name: 'Midea', dataFresh: true, failureReasons: [] });
    expect(result[0].shortAdvice.entryRange).not.toBeNull();
    expect(result[0].mediumAdvice.action).not.toBe('insufficient_data');
    expect(result[0].formalTargets.buyPrice).toBeGreaterThan(0);
    expect(result[0].combinedScore).toBeCloseTo(80 * 0.6 + 70 * 0.4);
  });

  it('uses a five-minute cache scoped by account and stock code', async () => {
    clearLiveTradingCandidateCache();
    let now = Date.parse('2026-08-17T02:00:00.000Z');
    const deps = dependencies({ now: () => now });
    const input = { accountId: 'account-a', codes: ['000333'], quotes: { '000333': quote() } };
    await scanLiveTradingCandidates(input, deps);
    now += LIVE_TRADING_CANDIDATE_CACHE_TTL_MS - 1;
    await scanLiveTradingCandidates(input, deps);
    await scanLiveTradingCandidates({ ...input, accountId: 'account-b' }, deps);
    expect(deps.fetchKLine).toHaveBeenCalledTimes(2);
    expect(deps.fetchBasic).toHaveBeenCalledTimes(2);
  });

  it('never runs more than two stock analyses concurrently', async () => {
    clearLiveTradingCandidateCache();
    let active = 0;
    let peak = 0;
    const fetchKLine = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return validKlines();
    });
    const codes = ['000001', '000002', '000003', '000004'];
    const quotes = Object.fromEntries(codes.map(code => [code, quote(code, code)]));
    await scanLiveTradingCandidates({ accountId: 'account-a', codes, quotes }, dependencies({ fetchKLine }));
    expect(peak).toBe(2);
  });

  it('marks missing targets or insufficient advice as non-fresh with explicit failure reasons', async () => {
    clearLiveTradingCandidateCache();
    const deps = dependencies({
      computeTargets: vi.fn().mockReturnValue(null),
      buildShortAdvice: vi.fn(({ quote: stock }): ShortTermTradingAdvice => ({
        ...shortAdvice(stock.code), action: 'insufficient_data', entryRange: null,
      })),
    });
    const [candidate] = await scanLiveTradingCandidates({
      accountId: 'account-a', codes: ['000333'], quotes: { '000333': quote() },
    }, deps);
    expect(candidate.dataFresh).toBe(false);
    expect(candidate.failureReasons).toEqual(expect.arrayContaining(['short_advice_insufficient', 'formal_targets_missing']));
    expect(candidate.formalTargets).toEqual({
      buyPrice: 0, sellPrice: 0, stopLoss: 0, supportLevel: 0, resistanceLevel: 0, atr: 0,
    });
  });
});
