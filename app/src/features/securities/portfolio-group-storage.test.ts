import { describe, expect, it } from 'vitest';
import {
  deletePortfolioGroup,
  findPortfolioVersion,
  loadPortfolioGroups,
  PORTFOLIO_GROUPS_KEY,
  saveGeneratedPortfolioVersion,
  savePortfolioVersion,
  type PortfolioVersionDraft,
} from './portfolio-group-storage';

function memoryStorage(seed?: string) {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(PORTFOLIO_GROUPS_KEY, seed);

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const draft: PortfolioVersionDraft = {
  capital: 100000,
  riskLevel: 'balanced',
  sourceWatchlistId: 'wl-1',
  sourceWatchlistName: '核心池',
  aiSummary: '',
  positions: [
    {
      code: '000001',
      name: '平安银行',
      groupName: '银行',
      groupColor: '#70b8b0',
      score: 72,
      allocation: 100,
      amount: 100000,
      shares: 8600,
      price: 11.62,
      rationale: '低PE',
    },
  ],
};

describe('portfolio group storage', () => {
  it('creates a group with its first immutable version', () => {
    const storage = memoryStorage();
    const workingDraft = structuredClone(draft);
    const result = savePortfolioVersion({ newGroupName: '稳健组合' }, workingDraft, {
      storage,
      now: () => '2026-08-03T10:00:00.000Z',
      createId: prefix => `${prefix}-1`,
    });

    workingDraft.positions[0].allocation = 0;

    expect(result.group).toMatchObject({
      id: 'pg-1',
      name: '稳健组合',
      currentVersionId: 'pv-1',
    });
    expect(result.group.versions).toHaveLength(1);
    expect(result.version.positions[0].allocation).toBe(100);
    expect(loadPortfolioGroups(storage)).toHaveLength(1);
  });

  it('creates one generated group and reuses the same version for an identical analysis snapshot', () => {
    const storage = memoryStorage();
    const options = {
      storage,
      now: () => '2026-08-03T10:00:00.000Z',
      createId: (prefix: 'pg' | 'pv') => prefix + '-generated',
    };
    const generatedDraft = {
      ...draft,
      algorithmVersion: 'all-watchlists-risk-parity-v1',
      candidateSnapshotId: 'snapshot-1',
      dataAsOf: '2026-08-03',
    };

    const first = saveGeneratedPortfolioVersion(generatedDraft, options);
    const second = saveGeneratedPortfolioVersion(structuredClone(generatedDraft), options);

    expect(first.group).toMatchObject({ name: '智能持仓组合', generated: true });
    expect(second.reused).toBe(true);
    expect(loadPortfolioGroups(storage)).toHaveLength(1);
    expect(loadPortfolioGroups(storage)[0].versions).toHaveLength(1);
  });
  it('appends a version without replacing the previous version', () => {
    const storage = memoryStorage();
    const first = savePortfolioVersion({ newGroupName: '稳健组合' }, draft, {
      storage,
      now: () => '2026-08-03T10:00:00.000Z',
      createId: prefix => `${prefix}-1`,
    });
    const second = savePortfolioVersion(
      { groupId: first.group.id },
      { ...draft, capital: 200000 },
      {
        storage,
        now: () => '2026-08-03T11:00:00.000Z',
        createId: prefix => `${prefix}-2`,
      },
    );

    expect(second.group.versions.map(version => version.capital)).toEqual([100000, 200000]);
    expect(second.group.currentVersionId).toBe('pv-2');
  });

  it('rejects duplicate group names', () => {
    const storage = memoryStorage();
    savePortfolioVersion({ newGroupName: '稳健组合' }, draft, { storage });

    expect(() => savePortfolioVersion({ newGroupName: ' 稳健组合 ' }, draft, { storage }))
      .toThrow('持仓组名称已存在');
  });

  it('rejects a version without positions', () => {
    const storage = memoryStorage();

    expect(() => savePortfolioVersion(
      { newGroupName: '空组合' },
      { ...draft, positions: [] },
      { storage },
    )).toThrow('当前没有可保存的持仓');
  });

  it('loads corrupted JSON as an empty collection', () => {
    expect(loadPortfolioGroups(memoryStorage('{broken'))).toEqual([]);
  });

  it('finds a saved version', () => {
    const storage = memoryStorage();
    const saved = savePortfolioVersion({ newGroupName: '组合一' }, draft, { storage });

    expect(findPortfolioVersion(
      loadPortfolioGroups(storage),
      saved.group.id,
      saved.version.id,
    )).toEqual(saved.version);
  });

  it('deletes only the requested group', () => {
    const storage = memoryStorage();
    const one = savePortfolioVersion({ newGroupName: '组合一' }, draft, { storage });
    savePortfolioVersion({ newGroupName: '组合二' }, draft, { storage });

    expect(deletePortfolioGroup(one.group.id, storage).map(group => group.name)).toEqual(['组合二']);
  });
});
