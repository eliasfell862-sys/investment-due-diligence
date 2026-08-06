import { describe, expect, it, vi } from 'vitest';
import type { AStockDirectoryItem, StockKLine, StockQuote } from '../../../infrastructure/market-data/stock-api';
import type { CalibrationSample } from './types';
import { scanPreMoveRadar, type PreMoveRadarServiceDependencies } from './radar-service';

function quote(code: string): StockQuote { return { code, name: `股票${code}`, market: code.startsWith('6') ? 'sh' : 'sz',
  price: 10, change: 0.2, changePct: 2, open: 9.8, high: 10.1, low: 9.7, volume: 1000, amount: 10000,
  preClose: 9.8, turnover: 2, pe: 10, pb: 1, totalShares: 0, floatShares: 0, totalCap: 100, floatCap: 80 }; }
function bars(code: string, count = 80): StockKLine[] { return Array.from({ length: count }, (_, index) => {
  const close = 9 + index * 0.015 + Number(code.slice(-1)) * 0.001; return {
    date: `2026-${String(Math.floor(index / 28) + 4).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`,
    open: close - 0.02, close, high: close + 0.08, low: close - 0.08,
    volume: index > count - 4 ? 1600 : 1000, amount: 100000000 } }); }
function calibration(): CalibrationSample[] { return Array.from({ length: 220 }, (_, index) => ({
  id: `v1-x-${index}`, code: 'x', modelVersion: 'pre-move-v1', featureCoverage: ['industry', 'capital_flow', 'kline', 'benchmark', 'indicators'],
  signalDate: `2025-01-${String(index % 28 + 1).padStart(2, '0')}`, score: 70, dataCompleteness: 1,
  marketRegime: 'strong' as const, success: index % 4 !== 0, excessReturnPct: index % 4 !== 0 ? 4 : -1 })); }

function fixture(size = 230, now = new Date('2026-08-06T07:20:00Z')): PreMoveRadarServiceDependencies {
  const directory: AStockDirectoryItem[] = Array.from({ length: size }, (_, index) => ({
    code: String(index + 1).padStart(6, '0'), name: `股票${index + 1}`, industry: '银行', classificationStatus: 'official' }));
  const quotes = directory.map(item => quote(item.code));
  const repository = { getLatestScan: vi.fn(async () => null), listCalibrationSamples: vi.fn(async () => calibration()),
    saveCalibrationSamples: vi.fn(async () => undefined), saveFormalScan: vi.fn(async () => undefined) };
  return { now: () => now, loadWatchlistUniverse: () => ({ buyCodes: directory.slice(0, 20).map(item => item.code), heldCodes: [], allCodes: directory.slice(0, 20).map(item => item.code) }),
    loadDirectory: vi.fn(async () => directory), loadAllQuotes: vi.fn(async () => quotes),
    loadIndustryFlows: vi.fn(async () => [{ industryCode: 'BK1', industryName: '银行', changePct1d: 2,
      mainNet1d: 1000, mainRatio1d: 5, mainNet5d: 2000, mainRatio5d: 6, mainNet10d: 3000, mainRatio10d: 7, leadingStockCode: '000001' }]),
    loadCapitalFlows: vi.fn(async () => quotes.map(item => ({ code: item.code, changePct3d: 1, changePct5d: 2, changePct10d: 3,
      mainNet3d: 100, mainRatio3d: 3, mainNet5d: 200, mainRatio5d: 5, mainNet10d: 300, mainRatio10d: 6 }))),
    loadQuote: vi.fn(async code => quote(code)), loadBars: vi.fn(async code => bars(code)),
    loadCapitalFlowHistory: vi.fn(async () => Array.from({ length: 20 }, (_, index) => ({ date: `2026-07-${String(index + 1).padStart(2, '0')}`,
      mainNet: 100, mainRatio: 3, superLargeNet: 60, largeNet: 40 }))),
    loadBenchmarkBars: vi.fn(async () => bars('000000')), repository: repository as never };
}

describe('scanPreMoveRadar', () => {
  it('deep scans watchlists plus at most two hundred rotation candidates', async () => {
    const deps = fixture(5300); const result = await scanPreMoveRadar({}, deps);
    expect(result.predictions.length).toBeGreaterThan(0);
    expect(deps.loadBars).toHaveBeenCalledTimes(200);
  });

  it('returns the fifteen-minute cached result unless force is true', async () => {
    const deps = fixture(); await scanPreMoveRadar({}, deps); const cached = await scanPreMoveRadar({}, deps);
    expect(cached.cacheStatus).toBe('cached');
    expect(deps.loadIndustryFlows).toHaveBeenCalledTimes(1);
  });

  it('keeps other candidates when one stock request fails', async () => {
    const deps = fixture(); vi.mocked(deps.loadBars).mockImplementation(async code => {
      if (code === '000002') throw new Error('K线失败'); return bars(code);
    });
    const result = await scanPreMoveRadar({}, deps);
    expect(result.predictions.length).toBeGreaterThan(0);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: '000002' }));
  });

  it('persists only the post-close formal scan', async () => {
    const pre = fixture(20, new Date('2026-08-06T06:00:00Z')); await scanPreMoveRadar({}, pre);
    expect(pre.repository.saveFormalScan).not.toHaveBeenCalled();
    const post = fixture(20); await scanPreMoveRadar({ force: true }, post);
    expect(post.repository.saveFormalScan).toHaveBeenCalledTimes(1);
  });
});