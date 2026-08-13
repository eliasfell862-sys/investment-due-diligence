import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudWatchlist } from './cloud/cloud-securities-repository';
import type { StockPositionLedger } from './stock-position-ledger';
import {
  clearSecuritiesAccountCache,
  readCachedPositionLedger,
  readCachedWatchlists,
  writeCachedPositionLedger,
  writeCachedWatchlists,
} from './securities-account-cache';

const watchlists = (name: string): CloudWatchlist[] => [{
  id: 'main', name, createdAt: '2026-08-12T00:00:00.000Z', codes: ['000001'],
  groups: [], codeGroups: {},
}];
const ledger = (name: string): StockPositionLedger => ({
  version: 1, groups: [], transactions: [], positions: [{
    id: 'position-a', groupId: 'core', code: '000001', name, shares: 100,
    averageCost: 10, totalCost: 1000, openedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z', sourceAlertIds: [],
  }],
});

describe('securities account cache', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('isolates snapshots by account and overwrites each account snapshot', () => {
    writeCachedWatchlists('user-a', watchlists('A1'));
    writeCachedWatchlists('user-b', watchlists('B'));
    writeCachedWatchlists('user-a', watchlists('A2'));

    expect(readCachedWatchlists('user-a')?.[0].name).toBe('A2');
    expect(readCachedWatchlists('user-b')?.[0].name).toBe('B');
  });

  it('expires snapshots after 24 hours and removes expired storage', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    writeCachedPositionLedger('user-a', ledger('cached'));
    vi.setSystemTime(new Date('2026-08-13T00:00:00.001Z'));

    expect(readCachedPositionLedger('user-a')).toBeNull();
    expect(Object.keys(localStorage).some(key => key.includes('user-a'))).toBe(false);
  });

  it('clears only the requested account', () => {
    writeCachedPositionLedger('user-a', ledger('A'));
    writeCachedPositionLedger('user-b', ledger('B'));
    clearSecuritiesAccountCache('user-a');

    expect(readCachedPositionLedger('user-a')).toBeNull();
    expect(readCachedPositionLedger('user-b')?.positions[0].name).toBe('B');
  });

  it('never keeps more than 500 KB and evicts older account snapshots first', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    writeCachedWatchlists('old-user', watchlists('O'.repeat(300_000)));
    vi.setSystemTime(new Date('2026-08-12T00:00:01.000Z'));
    writeCachedWatchlists('new-user', watchlists('N'.repeat(300_000)));

    const bytes = Object.keys(localStorage).reduce((total, key) => (
      key.startsWith('sec_account_cache_v1:')
        ? total + new Blob([localStorage.getItem(key) ?? '']).size
        : total
    ), 0);
    expect(bytes).toBeLessThanOrEqual(500 * 1024);
    expect(readCachedWatchlists('old-user')).toBeNull();
    expect(readCachedWatchlists('new-user')).not.toBeNull();
  });
});