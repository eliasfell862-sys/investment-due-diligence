import { describe, expect, it } from 'vitest';
import { aggregateAllWatchlistCandidates } from './all-watchlists-portfolio-candidates';

function storageWith(value: unknown): Pick<Storage, 'getItem'> {
  return { getItem: () => JSON.stringify(value) };
}

function watchlist(
  id: string,
  name: string,
  codes: string[],
  groups: Array<{ id: string; name: string; color: string }> = [],
  codeGroups: Record<string, string[]> = {},
) {
  return { id, name, codes, groups, codeGroups, createdAt: '2026-08-01' };
}

describe('aggregateAllWatchlistCandidates', () => {
  it('deduplicates normalized codes and preserves every source and label', () => {
    const result = aggregateAllWatchlistCandidates(storageWith([
      watchlist('a', '核心池', ['000001', '600519'], [{ id: 'g1', name: '价值', color: '#fff' }], { '000001': ['g1'] }),
      watchlist('b', '观察池', ['000001 '], [{ id: 'g2', name: '低波', color: '#000' }], { '000001': ['g2'] }),
    ]), () => '2026-08-04T10:00:00.000Z');

    expect(result.candidates.map(item => item.code)).toEqual(['000001', '600519']);
    expect(result.candidates[0].labels).toEqual(['低波', '价值']);
    expect(result.candidates[0].sources).toEqual([
      { watchlistId: 'a', watchlistName: '核心池', groupIds: ['g1'], labels: ['价值'] },
      { watchlistId: 'b', watchlistName: '观察池', groupIds: ['g2'], labels: ['低波'] },
    ]);
    expect(result.sourceWatchlists).toEqual([{ id: 'a', name: '核心池' }, { id: 'b', name: '观察池' }]);
  });

  it('keeps valid pools when another persisted record is malformed', () => {
    const result = aggregateAllWatchlistCandidates(storageWith([
      { id: 9, name: '损坏记录' },
      watchlist('valid', '有效池', ['600519']),
    ]));

    expect(result.candidates.map(item => item.code)).toEqual(['600519']);
    expect(result.warnings).toContain('已忽略1个损坏的自选股池记录');
  });

  it('produces the same snapshot id regardless of watchlist order and creation time', () => {
    const first = aggregateAllWatchlistCandidates(storageWith([
      watchlist('b', '观察池', ['600519']),
      watchlist('a', '核心池', ['000001']),
    ]), () => '2026-08-04T10:00:00.000Z');
    const second = aggregateAllWatchlistCandidates(storageWith([
      watchlist('a', '核心池', ['000001']),
      watchlist('b', '观察池', ['600519']),
    ]), () => '2026-08-05T10:00:00.000Z');

    expect(first.id).toBe(second.id);
    expect(first.createdAt).not.toBe(second.createdAt);
  });

  it('returns an empty degraded snapshot for invalid JSON', () => {
    const result = aggregateAllWatchlistCandidates({ getItem: () => '{broken' });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(['自选股池数据损坏，已按空候选池处理']);
  });
});
