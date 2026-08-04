import { describe, expect, it, vi } from 'vitest';
import type { PortfolioCandidateAnalysis, PortfolioCandidateAnalysisResult } from './portfolio-candidate-analysis';
import type { PortfolioCandidateSnapshot } from './all-watchlists-portfolio-candidates';
import {
  buildAllWatchlistsPortfolio,
  type AllWatchlistsPortfolioDependencies,
} from './all-watchlists-portfolio-service';

function snapshot(count = 12): PortfolioCandidateSnapshot {
  return {
    id: 'snapshot-all', createdAt: '2026-08-04T08:00:00.000Z', warnings: [],
    sourceWatchlists: [{ id: 'all', name: '全部自选' }],
    candidates: Array.from({ length: count }, (_, index) => ({
      code: String(index + 1).padStart(6, '0'), labels: [],
      sources: [{ watchlistId: 'all', watchlistName: '全部自选', groupIds: [], labels: [] }],
    })),
  };
}

function analysis(code: string): PortfolioCandidateAnalysis {
  const returns = Array.from({ length: 80 }, (_, index) => ({
    date: `2026-${String(index + 1).padStart(3, '0')}`,
    value: ((index % 7) - 3) / 100,
  }));
  return {
    code, name: `股票${code}`,
    quote: {
      code, name: `股票${code}`, market: 'sz', price: 10, change: 0, changePct: 0,
      open: 10, high: 10.2, low: 9.8, volume: 100000, amount: 2_000_000,
      preClose: 10, turnover: 2, pe: 15, pb: 1.5, totalShares: 100,
      floatShares: 80, totalCap: 500, floatCap: 400,
    },
    industry: `行业${code}`, classificationStatus: 'official', sources: [], labels: [],
    score: 80, confidence: 85,
    mediumTermAdvice: {
      code, horizon: '1_3_months', action: 'accumulate', label: '分批买入', score: 80,
      confidence: 85, confidenceLabel: '高', reasons: [], risks: [],
      dataCompleteness: { quote: true, kline: true, fundamental: true },
      calculatedAt: '2026-08-04T08:00:00.000Z',
    },
    fundamental: { totalScore: 80, rating: '优秀', breakdown: [], metrics: [] },
    strategies: [], patterns: [],
    risk: { returns, annualizedVolatility: 0.2, maximumDrawdown: 0.15 }, returns,
    dataCompleteness: { quote: true, kline: true, fundamental: true, industry: true },
    dataAsOf: '2026-08-04',
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

function dependencies(overrides: Partial<AllWatchlistsPortfolioDependencies> = {}): AllWatchlistsPortfolioDependencies {
  const source = snapshot();
  const analyzed = source.candidates.map(item => ({ status: 'success', candidate: analysis(item.code) }) as PortfolioCandidateAnalysisResult);
  const analyzeCandidates = vi.fn(async (_snapshot, _quotes, _master, options) => {
    analyzed.forEach((result, index) => options.onUpdate(index + 1, analyzed.length, result));
    return analyzed;
  });
  return {
    aggregateCandidates: vi.fn(() => source),
    fetchQuotes: vi.fn(async (codes: string[]) => Object.fromEntries(codes.map(code => [code, analysis(code).quote]))),
    loadSecurityMaster: vi.fn(async () => ({})),
    analyzeCandidates,
    selectCandidates: vi.fn(candidates => ({ selected: candidates.slice(0, 2), excluded: [], highCorrelationPairs: [] })),
    covariance: vi.fn(() => ({ codes: ['000001', '000002'], matrix: [[0.04, 0], [0, 0.04]], commonDays: 80 })),
    solveRiskParity: vi.fn(() => ({
      weights: { '000001': 0.5, '000002': 0.5 },
      riskContributions: { '000001': 0.5, '000002': 0.5 },
      method: 'risk_parity', converged: true,
    })),
    constrain: vi.fn(() => ({
      weights: { '000001': 0.2, '000002': 0.2 }, removed: [], stockWeight: 0.4,
      minimumCash: 0.1, constraintCash: 0.5,
      exposures: { industries: { '行业000001': 0.2, '行业000002': 0.2 }, labels: {} },
    })),
    sizeTrades: vi.fn(() => ({
      positions: [], investedAmount: 40000, actualStockWeight: 0.4,
      minimumCashAmount: 10000, constraintCashAmount: 50000,
      boardLotCashAmount: 0, totalCashAmount: 60000,
    })),
    storage: memoryStorage(),
    ...overrides,
  } as AllWatchlistsPortfolioDependencies;
}

describe('all-watchlists portfolio service', () => {
  it('waits for every candidate before selection and reports full-pool progress', async () => {
    const order: string[] = [];
    const deps = dependencies();
    const originalAnalyze = deps.analyzeCandidates;
    const wrappedAnalyze: typeof originalAnalyze = async (source, quotesByCode, master, options, overrides) => {
      const result = await originalAnalyze(source, quotesByCode, master, options, overrides);
      order.push('analysis-complete');
      return result;
    };
    deps.analyzeCandidates = vi.fn(wrappedAnalyze);
    const originalSelect = deps.selectCandidates;
    const wrappedSelect: typeof originalSelect = (candidates, riskLevel) => {
      order.push('selection');
      return originalSelect(candidates, riskLevel);
    };
    deps.selectCandidates = vi.fn(wrappedSelect);
    const progress: string[] = [];
    const result = await buildAllWatchlistsPortfolio(
      { capital: 100000, riskLevel: 'balanced' },
      { onProgress: item => progress.push(`${item.completed}/${item.total}`) },
      deps,
    );
    expect(order).toEqual(['analysis-complete', 'selection']);
    expect(progress.at(-1)).toBe('12/12');
    expect(result.snapshot.candidates).toHaveLength(12);
    expect(result.selected.length).toBeLessThanOrEqual(10);
    expect(result.algorithmVersion).toBe('all-watchlists-risk-parity-v1');
  });

  it('reuses complete candidate analysis when only risk preference changes', async () => {
    const deps = dependencies();
    await buildAllWatchlistsPortfolio({ capital: 100000, riskLevel: 'balanced' }, {}, deps);
    await buildAllWatchlistsPortfolio({ capital: 100000, riskLevel: 'conservative' }, {}, deps);
    expect(deps.analyzeCandidates).toHaveBeenCalledTimes(1);
    expect(deps.selectCandidates).toHaveBeenCalledTimes(2);
  });

  it('force bypasses the reusable analysis snapshot', async () => {
    const deps = dependencies();
    await buildAllWatchlistsPortfolio({ capital: 100000, riskLevel: 'balanced' }, {}, deps);
    await buildAllWatchlistsPortfolio({ capital: 100000, riskLevel: 'balanced', force: true }, {}, deps);
    expect(deps.analyzeCandidates).toHaveBeenCalledTimes(2);
  });

  it('marks a completed result stale when publishing is superseded', async () => {
    let publish = true;
    const result = await buildAllWatchlistsPortfolio(
      { capital: 100000, riskLevel: 'balanced' },
      { shouldPublish: () => publish, onProgress: () => { publish = false; } },
      dependencies(),
    );
    expect(result.stale).toBe(true);
  });

  it('throws NO_QUOTES so the page can retain its last successful result', async () => {
    const deps = dependencies({ fetchQuotes: vi.fn(async () => ({})) });
    await expect(buildAllWatchlistsPortfolio(
      { capital: 100000, riskLevel: 'balanced' }, {}, deps,
    )).rejects.toMatchObject({ code: 'NO_QUOTES' });
    expect(deps.analyzeCandidates).not.toHaveBeenCalled();
  });
});
