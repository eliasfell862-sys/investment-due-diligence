import { describe, expect, it, vi } from 'vitest';
import type { StockKLine, StockQuote } from '../../infrastructure/market-data/stock-api';
import type { MediumTermBuyAdvice } from '../../engines/market-analysis/medium-term-buy-advice';
import {
  analyzeWatchlistQuotes,
  analyzeWatchlistStock,
  clearWatchlistAdviceCache,
  WATCHLIST_ADVICE_CACHE_KEY,
  WATCHLIST_ADVICE_CACHE_TTL_MS,
  type WatchlistAdviceDependencies,
} from './watchlist-buy-advice-service';

const NOW = 1_786_000_000_000;

function quote(code = '000001'): StockQuote {
  return {
    code, name: code === '000001' ? '平安银行' : '贵州茅台', market: code.startsWith('6') ? 'sh' : 'sz',
    price: 12, change: 0, changePct: 0, open: 12, high: 12.2, low: 11.8, volume: 1000,
    amount: 10000, preClose: 12, turnover: 3, pe: 14, pb: 1.4, totalShares: 100,
    floatShares: 80, totalCap: 800, floatCap: 640,
  };
}

function klineFixtures(): StockKLine[] {
  return Array.from({ length: 120 }, (_, index) => ({
    date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    open: 10, close: 10 + index / 100, high: 11.5, low: 9.5, volume: 1000, amount: 10000,
  }));
}

const cachedAdvice: MediumTermBuyAdvice = {
  code: '000001', horizon: '1_3_months', action: 'accumulate', label: '分批买入', score: 82,
  confidence: 90, confidenceLabel: '高', reasons: ['趋势向上'], risks: [],
  dataCompleteness: { quote: true, kline: true, fundamental: true },
  calculatedAt: '2026-08-04T10:00:00.000Z',
};

function memoryStorage(seed?: unknown) {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(WATCHLIST_ADVICE_CACHE_KEY, typeof seed === 'string' ? seed : JSON.stringify(seed));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

function deps(overrides: Partial<WatchlistAdviceDependencies> = {}): WatchlistAdviceDependencies {
  return {
    fetchKLine: vi.fn().mockResolvedValue(klineFixtures()),
    fetchBasic: vi.fn().mockResolvedValue({ code: '000001' }),
    calcIndicators: vi.fn(),
    scanStrategies: vi.fn().mockReturnValue([]),
    scanPatterns: vi.fn().mockReturnValue([]),
    scoreFundamentals: vi.fn().mockReturnValue({ totalScore: 80, rating: '优秀', breakdown: [], metrics: [] }),
    buildAdvice: vi.fn().mockImplementation(input => ({ ...cachedAdvice, code: input.quote.code })),
    storage: memoryStorage(),
    now: () => NOW,
    ...overrides,
  } as WatchlistAdviceDependencies;
}

function storedEntry(storage: Pick<Storage, 'getItem'>, code: string) {
  return JSON.parse(storage.getItem(WATCHLIST_ADVICE_CACHE_KEY) ?? '{}')[code];
}

describe('watchlist buy advice service', () => {
  it('returns a fresh cached advice without requesting market data', async () => {
    const dependencies = deps({ storage: memoryStorage({ '000001': { expiresAt: NOW + 1000, advice: cachedAdvice } }) });
    const result = await analyzeWatchlistStock(quote(), {}, dependencies);
    expect(result).toEqual(cachedAdvice);
    expect(dependencies.fetchKLine).not.toHaveBeenCalled();
  });

  it('recomputes an expired cache entry and stores a four-hour expiry', async () => {
    const storage = memoryStorage({ '000001': { expiresAt: NOW - 1, advice: cachedAdvice } });
    const dependencies = deps({ storage });
    await analyzeWatchlistStock(quote(), {}, dependencies);
    expect(dependencies.fetchKLine).toHaveBeenCalledWith('000001', 120);
    expect(storedEntry(storage, '000001').expiresAt).toBe(NOW + WATCHLIST_ADVICE_CACHE_TTL_MS);
  });

  it('clones K-lines before indicator calculation', async () => {
    const original = klineFixtures();
    const calcIndicators = vi.fn((rows: StockKLine[]) => { (rows[0] as any).mutated = true; });
    await analyzeWatchlistStock(quote(), {}, deps({ fetchKLine: vi.fn().mockResolvedValue(original), calcIndicators }));
    expect((original[0] as any).mutated).toBeUndefined();
  });

  it('degrades successfully when the financial request rejects', async () => {
    const buildAdvice = vi.fn().mockReturnValue(cachedAdvice);
    await analyzeWatchlistStock(quote(), {}, deps({
      fetchBasic: vi.fn().mockRejectedValue(new Error('financial unavailable')), buildAdvice,
    }));
    expect(buildAdvice).toHaveBeenCalledWith(expect.objectContaining({ hasFinancialData: false }));
  });

  it('never runs more than four stocks concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchKLine = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return klineFixtures();
    });
    const quotes = ['000001', '600519', '000002', '600000', '000333', '601318'].map(quote);
    await analyzeWatchlistQuotes(quotes, { onUpdate: vi.fn() }, deps({ fetchKLine }));
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it('publishes one stock failure without stopping successful stocks', async () => {
    const onUpdate = vi.fn();
    await analyzeWatchlistQuotes([quote(), quote('600519')], { onUpdate }, deps({
      fetchKLine: vi.fn(code => code === '000001' ? Promise.reject(new Error('network')) : Promise.resolve(klineFixtures())),
    }));
    expect(onUpdate).toHaveBeenCalledWith('000001', { status: 'error', error: 'network' });
    expect(onUpdate).toHaveBeenCalledWith('600519', expect.objectContaining({ status: 'success' }));
  });

  it('does not publish stale results when shouldPublish becomes false', async () => {
    const onUpdate = vi.fn();
    await analyzeWatchlistQuotes([quote()], { onUpdate, shouldPublish: () => false }, deps());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('treats corrupted cache as empty and force bypasses a fresh entry', async () => {
    const corrupted = deps({ storage: memoryStorage('{broken') });
    await analyzeWatchlistStock(quote(), {}, corrupted);
    expect(corrupted.fetchKLine).toHaveBeenCalledOnce();

    const forced = deps({ storage: memoryStorage({ '000001': { expiresAt: NOW + 1000, advice: cachedAdvice } }) });
    await analyzeWatchlistStock(quote(), { force: true }, forced);
    expect(forced.fetchKLine).toHaveBeenCalledOnce();
  });

  it('clears selected cached codes while preserving the rest', () => {
    const storage = memoryStorage({
      '000001': { expiresAt: NOW + 1000, advice: cachedAdvice },
      '600519': { expiresAt: NOW + 1000, advice: { ...cachedAdvice, code: '600519' } },
    });
    clearWatchlistAdviceCache(['000001'], storage);
    expect(storedEntry(storage, '000001')).toBeUndefined();
    expect(storedEntry(storage, '600519').advice.code).toBe('600519');
  });
});
