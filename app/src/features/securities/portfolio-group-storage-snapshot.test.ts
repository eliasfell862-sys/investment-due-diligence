import { describe, expect, it } from 'vitest';
import {
  loadPortfolioGroups,
  PORTFOLIO_GROUPS_KEY,
  savePortfolioVersion,
  type PortfolioVersionDraft,
} from './portfolio-group-storage';

function memoryStorage(seed?: string) {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(PORTFOLIO_GROUPS_KEY, seed);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('reproducible portfolio snapshots', () => {
  it('still loads old v1 versions without reproducibility fields', () => {
    const old = [{
      id: 'pg-old', name: '旧组合', createdAt: '2026-01-01', updatedAt: '2026-01-01',
      currentVersionId: 'pv-old',
      versions: [{
        id: 'pv-old', createdAt: '2026-01-01', capital: 100000, riskLevel: 'balanced',
        positions: [{
          code: '000001', name: '平安银行', groupName: '银行', groupColor: '#fff',
          score: 70, allocation: 100, amount: 100000, shares: 10000, price: 10, rationale: '旧版',
        }],
      }],
    }];
    expect(loadPortfolioGroups(memoryStorage(JSON.stringify(old)))).toHaveLength(1);
  });

  it('saves and deep-copies nested reproducibility data', () => {
    const draft: PortfolioVersionDraft = {
      capital: 100000,
      riskLevel: 'balanced',
      algorithmVersion: 'all-watchlists-risk-parity-v1',
      candidateSnapshotId: 'snapshot-1',
      sourceWatchlists: [{ id: 'wl-1', name: '核心池' }],
      parameters: { scoreThreshold: 65, fallback: false },
      dataAsOf: '2026-08-04',
      cashBreakdown: {
        minimumCashAmount: 10000,
        constraintCashAmount: 5000,
        boardLotCashAmount: 500,
        totalCashAmount: 15500,
      },
      portfolioMetrics: { annualizedVolatility: 0.18, concentration: 0.12, maximumPairCorrelation: 0.72 },
      excludedSummary: [{ code: '000002', reasonCode: 'score_threshold', reason: '评分不足' }],
      positions: [{
        code: '000001', name: '平安银行', groupName: '银行', groupColor: '#fff',
        score: 80, allocation: 20, amount: 20000, shares: 2000, price: 10, rationale: '风险平价',
        targetAllocation: 0.20, actualAllocation: 0.20, riskContribution: 0.25,
        industry: '银行', sourceWatchlistIds: ['wl-1'], tags: ['价值'], confidence: 85, risks: ['波动'],
      }],
    };
    const saved = savePortfolioVersion({ newGroupName: '全股池组合' }, draft, {
      storage: memoryStorage(),
      now: () => '2026-08-04T08:00:00.000Z',
      createId: prefix => `${prefix}-1`,
    }).version;

    draft.sourceWatchlists![0].name = '已修改';
    draft.parameters!.scoreThreshold = 0;
    draft.excludedSummary![0].reason = '已修改';
    draft.positions[0].sourceWatchlistIds!.push('wl-2');
    draft.positions[0].tags!.push('已修改');
    draft.positions[0].risks!.push('已修改');

    expect(saved.algorithmVersion).toBe('all-watchlists-risk-parity-v1');
    expect(saved.sourceWatchlists).toEqual([{ id: 'wl-1', name: '核心池' }]);
    expect(saved.parameters?.scoreThreshold).toBe(65);
    expect(saved.excludedSummary?.[0].reason).toBe('评分不足');
    expect(saved.positions[0].sourceWatchlistIds).toEqual(['wl-1']);
    expect(saved.positions[0].tags).toEqual(['价值']);
    expect(saved.positions[0].risks).toEqual(['波动']);
  });
});
