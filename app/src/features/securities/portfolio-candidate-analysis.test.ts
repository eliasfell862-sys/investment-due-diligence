import { describe, expect, it, vi } from 'vitest';
import type { MediumTermBuyAdvice } from '../../engines/market-analysis/medium-term-buy-advice';
import type { StockKLine, StockQuote } from '../../infrastructure/market-data/stock-api';
import type { SecurityMasterRecord } from '../../infrastructure/market-data/security-master';
import type { PortfolioCandidateSnapshot } from './all-watchlists-portfolio-candidates';
import {
  analyzePortfolioCandidates,
  PORTFOLIO_ANALYSIS_CACHE_KEY,
  PORTFOLIO_ANALYSIS_CACHE_TTL_MS,
  type PortfolioCandidateAnalysisDependencies,
} from './portfolio-candidate-analysis';

const NOW = 1_786_000_000_000;

function snapshot(count: number): PortfolioCandidateSnapshot {
  return {
    id: `snapshot-${count}`,
    createdAt: '2026-08-04T08:00:00.000Z',
    sourceWatchlists: [{ id: 'all', name: '全部自选' }],
    warnings: [],
    candidates: Array.from({ length: count }, (_, index) => {
      const code = String(index + 1).padStart(6, '0');
      return {
        code,
        labels: index % 2 ? ['成长'] : ['价值'],
        sources: [{ watchlistId: 'all', watchlistName: '全部自选', groupIds: ['g1'], labels: ['价值'] }],
      };
    }),
  };
}

function quote(code: string): StockQuote {
  return {
    code, name: `股票${code}`, market: 'sz', price: 12, change: 0.2, changePct: 1.7,
    open: 11.8, high: 12.2, low: 11.7, volume: 100000, amount: 1200000,
    preClose: 11.8, turnover: 3, pe: 14, pb: 1.4, totalShares: 100,
    floatShares: 80, totalCap: 800, floatCap: 640,
  };
}

function quotes(count: number): Record<string, StockQuote> {
  return Object.fromEntries(snapshot(count).candidates.map(item => [item.code, quote(item.code)]));
}

function klines(): StockKLine[] {
  return Array.from({ length: 120 }, (_, index) => ({
    date: `2026-${String(index + 1).padStart(3, '0')}`,
    open: 10 + index / 100,
    close: 10.05 + index / 100,
    high: 10.2 + index / 100,
    low: 9.9 + index / 100,
    volume: 100000,
    amount: 1000000,
  }));
}

const advice: MediumTermBuyAdvice = {
  code: '000001', horizon: '1_3_months', action: 'accumulate', label: '分批买入',
  score: 82, confidence: 90, confidenceLabel: '高', reasons: ['趋势向上'], risks: [],
  dataCompleteness: { quote: true, kline: true, fundamental: true },
  calculatedAt: '2026-08-04T08:00:00.000Z',
};

function memoryStorage(seed?: unknown) {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(PORTFOLIO_ANALYSIS_CACHE_KEY, typeof seed === 'string' ? seed : JSON.stringify(seed));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

function dependencies(overrides: Partial<PortfolioCandidateAnalysisDependencies> = {}): PortfolioCandidateAnalysisDependencies {
  return {
    fetchKLine: vi.fn().mockResolvedValue(klines()),
    fetchBasic: vi.fn().mockResolvedValue({ code: '000001' }),
    calcIndicators: vi.fn(),
    scanStrategies: vi.fn().mockReturnValue([]),
    scanPatterns: vi.fn().mockReturnValue([]),
    scoreFundamentals: vi.fn().mockReturnValue({ totalScore: 80, rating: '优秀', breakdown: [], metrics: [] }),
    buildMediumTermAdvice: vi.fn(input => ({ ...advice, code: input.quote.code })),
    storage: memoryStorage(),
    now: () => NOW,
    ...overrides,
  } as PortfolioCandidateAnalysisDependencies;
}

function securityMaster(code: string): SecurityMasterRecord {
  return {
    securityId: `CN.SZSE.${code}`, code, name: `股票${code}`, assetType: 'stock', country: 'CN', currency: 'CNY',
    exchange: 'SZSE', board: 'main', listingStatus: 'unknown', specialTreatment: false,
    industry: '银行', classificationStandard: '申万', classificationStatus: 'official',
    provenance: { directorySource: 'test', classificationSource: 'test', asOf: '2026-08-04', classificationVersion: 'v1' },
  };
}

describe('portfolio candidate analysis', () => {
  it('analyzes every candidate without preselection and preserves identity metadata', async () => {
    const deps = dependencies();
    const source = snapshot(12);
    const result = await analyzePortfolioCandidates(source, quotes(12), {}, { onUpdate: vi.fn() }, deps);
    expect(result).toHaveLength(12);
    expect(deps.fetchKLine).toHaveBeenCalledTimes(12);
    expect(deps.fetchKLine).toHaveBeenCalledWith(expect.any(String), 120);
    expect(result[0]).toEqual(expect.objectContaining({
      status: 'success',
      candidate: expect.objectContaining({ sources: source.candidates[0].sources, labels: source.candidates[0].labels }),
    }));
  });

  it('scores one million yuan of turnover using the quote amount field expressed in ten-thousand yuan', async () => {
    const liquidQuotes = quotes(1);
    liquidQuotes['000001'].amount = 100;
    const thinQuotes = quotes(1);
    thinQuotes['000001'].amount = 99;

    const liquid = await analyzePortfolioCandidates(
      snapshot(1), liquidQuotes, {}, { force: true, onUpdate: vi.fn() }, dependencies(),
    );
    const thin = await analyzePortfolioCandidates(
      snapshot(1), thinQuotes, {}, { force: true, onUpdate: vi.fn() }, dependencies(),
    );

    expect(liquid[0].status).toBe('success');
    expect(thin[0].status).toBe('success');
    if (liquid[0].status === 'success' && thin[0].status === 'success') {
      expect(liquid[0].candidate.score - thin[0].candidate.score).toBe(4);
    }
  });
  it('caps concurrency at four and isolates one failed stock', async () => {
    let active = 0;
    let maximum = 0;
    const fetchKLine = vi.fn(async (code: string) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active -= 1;
      if (code === '000003') throw new Error('network');
      return klines();
    });
    const result = await analyzePortfolioCandidates(snapshot(9), quotes(9), {}, { onUpdate: vi.fn() }, dependencies({ fetchKLine }));
    expect(maximum).toBe(4);
    expect(result.filter(item => item.status === 'error')).toEqual([{ status: 'error', code: '000003', error: 'network' }]);
    expect(result.filter(item => item.status === 'success')).toHaveLength(8);
  });

  it('clones K-lines and degrades fundamental failure without failing the candidate', async () => {
    const original = klines();
    const calcIndicators = vi.fn((rows: StockKLine[]) => { (rows[0] as StockKLine & { mutated?: boolean }).mutated = true; });
    const result = await analyzePortfolioCandidates(snapshot(1), quotes(1), {}, { onUpdate: vi.fn() }, dependencies({
      fetchKLine: vi.fn().mockResolvedValue(original),
      fetchBasic: vi.fn().mockRejectedValue(new Error('fundamental unavailable')),
      calcIndicators,
    }));
    expect((original[0] as StockKLine & { mutated?: boolean }).mutated).toBeUndefined();
    expect(result[0]).toEqual(expect.objectContaining({ status: 'success' }));
    if (result[0].status === 'success') {
      expect(result[0].candidate.fundamental).toBeNull();
      expect(result[0].candidate.dataCompleteness.fundamental).toBe(false);
      expect(result[0].candidate.confidence).toBeLessThan(90);
    }
  });

  it('uses security-master classification and calculates reproducible risk data', async () => {
    const master = securityMaster('000001');
    const result = await analyzePortfolioCandidates(snapshot(1), quotes(1), { '000001': master }, { onUpdate: vi.fn() }, dependencies());
    expect(result[0]).toEqual(expect.objectContaining({
      status: 'success',
      candidate: expect.objectContaining({
        industry: '银行', classificationStatus: 'official',
        score: expect.any(Number), confidence: expect.any(Number),
        risk: expect.objectContaining({ annualizedVolatility: expect.any(Number), maximumDrawdown: expect.any(Number) }),
      }),
    }));
  });

  it('reuses fresh snapshot cache, ignores corrupt cache, and force bypasses cache', async () => {
    const storage = memoryStorage();
    const first = dependencies({ storage });
    await analyzePortfolioCandidates(snapshot(1), quotes(1), {}, { onUpdate: vi.fn() }, first);
    const stored = JSON.parse(storage.getItem(PORTFOLIO_ANALYSIS_CACHE_KEY) ?? '{}');
    expect(stored['snapshot-1:000001'].expiresAt).toBe(NOW + PORTFOLIO_ANALYSIS_CACHE_TTL_MS);

    const cached = dependencies({ storage });
    await analyzePortfolioCandidates(snapshot(1), quotes(1), {}, { onUpdate: vi.fn() }, cached);
    expect(cached.fetchKLine).not.toHaveBeenCalled();

    const corrupt = dependencies({ storage: memoryStorage('{broken') });
    await analyzePortfolioCandidates(snapshot(1), quotes(1), {}, { onUpdate: vi.fn() }, corrupt);
    expect(corrupt.fetchKLine).toHaveBeenCalledOnce();

    const forced = dependencies({ storage });
    await analyzePortfolioCandidates(snapshot(1), quotes(1), {}, { force: true, onUpdate: vi.fn() }, forced);
    expect(forced.fetchKLine).toHaveBeenCalledOnce();
  });

  it('stops publishing progress after shouldPublish becomes false', async () => {
    let publish = true;
    const onUpdate = vi.fn(() => { publish = false; });
    const result = await analyzePortfolioCandidates(snapshot(2), quotes(2), {}, {
      onUpdate,
      shouldPublish: () => publish,
      maxConcurrency: 1,
    }, dependencies());
    expect(result).toHaveLength(2);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(1, 2, expect.objectContaining({ status: 'success' }));
  });
});
