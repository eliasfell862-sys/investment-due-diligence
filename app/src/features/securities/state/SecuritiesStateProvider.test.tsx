import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeCachedPositionLedger } from '../securities-account-cache';
import type { StockPositionLedger } from '../stock-position-ledger';

const mocks = vi.hoisted(() => ({
  auth: {
    cloudEnabled: true,
    loading: false,
    user: { id: 'user-a' } as { id: string } | null,
  },
  loadPositionLedger: vi.fn(),
  executeManualBuy: vi.fn(),
  executeManualSell: vi.fn(),
  movePositionGroup: vi.fn(),
  loadWatchlists: vi.fn(),
  saveWatchlists: vi.fn(),
}));

vi.mock('../../auth/AuthProvider', () => ({
  useOptionalAuth: () => mocks.auth,
}));
vi.mock('../cloud/cloud-securities-repository', () => ({
  createCloudSecuritiesRepository: () => ({
    loadPositionLedger: mocks.loadPositionLedger,
    executeManualBuy: mocks.executeManualBuy,
    executeManualSell: mocks.executeManualSell,
    movePositionGroup: mocks.movePositionGroup,
    loadWatchlists: mocks.loadWatchlists,
    saveWatchlists: mocks.saveWatchlists,
  }),
}));

import { SecuritiesStateProvider } from './SecuritiesStateProvider';
import { useSecuritiesState } from './securities-state-context';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function ledger(id: string, shares: number): StockPositionLedger {
  return {
    version: 1,
    groups: [],
    transactions: [],
    positions: [{
      id, groupId: 'core', code: '000001', name: id, shares,
      averageCost: 10, totalCost: shares * 10,
      openedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-12T00:00:00Z', sourceAlertIds: [],
    }],
  };
}

function Consumer({ label }: { label: string }) {
  const state = useSecuritiesState();
  return (
    <div>
      <span>{label}:{state.positions.data.positions[0]?.name ?? 'empty'}</span>
      <span>{label}-error:{state.positions.error || 'none'}</span>
    </div>
  );
}
function TradingConsumer() {
  const state = useSecuritiesState();
  return (
    <div>
      <button onClick={() => void state.buyPosition({ code: '000001', name: 'Ping An', shares: 100, price: 10, groupId: 'core', groupName: 'Core', sourceAlertId: 'buy-1', tradedAt: '2026-08-12T01:00:00Z' })}>buy</button>
      <button onClick={() => void state.sellPosition({ code: '000001', shares: 100, price: 11, sourceAlertId: 'sell-1', tradedAt: '2026-08-12T02:00:00Z' }).catch(() => undefined)}>sell</button>
    </div>
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  return <SecuritiesStateProvider>{children}</SecuritiesStateProvider>;
}

describe('SecuritiesStateProvider positions', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.auth.cloudEnabled = true;
    mocks.auth.loading = false;
    mocks.auth.user = { id: 'user-a' };
    mocks.loadPositionLedger.mockReset();
  });

  it('loads the cloud position ledger once for multiple consumers', async () => {
    const cloud = createDeferred<StockPositionLedger>();
    mocks.loadPositionLedger.mockReturnValue(cloud.promise);
    render(<Wrapper><Consumer label="first" /><Consumer label="second" /></Wrapper>);
    mocks.executeManualBuy.mockReset();
    mocks.executeManualSell.mockReset();
    mocks.movePositionGroup.mockReset();
    mocks.loadWatchlists.mockReset().mockResolvedValue([]);
    mocks.saveWatchlists.mockReset();

    expect(mocks.loadPositionLedger).toHaveBeenCalledOnce();
    cloud.resolve(ledger('cloud-a', 300));

    expect(await screen.findByText('first:cloud-a')).toBeInTheDocument();
    expect(screen.getByText('second:cloud-a')).toBeInTheDocument();
  });

  it('keeps the cached ledger visible when the cloud refresh fails', async () => {
    writeCachedPositionLedger('user-a', ledger('cached-a', 200));
    mocks.loadPositionLedger.mockRejectedValue(new Error('cloud down'));
    render(<Wrapper><Consumer label="first" /></Wrapper>);

    expect(await screen.findByText('first:cached-a')).toBeInTheDocument();
    expect(await screen.findByText('first-error:cloud down')).toBeInTheDocument();
  });

  it('isolates account state and ignores the previous account slow response', async () => {
    const userA = createDeferred<StockPositionLedger>();
    const userB = createDeferred<StockPositionLedger>();
    mocks.loadPositionLedger.mockReturnValueOnce(userA.promise).mockReturnValueOnce(userB.promise);
    const view = render(<Wrapper><Consumer label="first" /></Wrapper>);

    mocks.auth.user = { id: 'user-b' };
    view.rerender(<Wrapper><Consumer label="first" /></Wrapper>);
    await waitFor(() => expect(mocks.loadPositionLedger).toHaveBeenCalledTimes(2));
    expect(screen.getByText('first:empty')).toBeInTheDocument();

    await act(async () => { userB.resolve(ledger('cloud-b', 400)); });
    expect(await screen.findByText('first:cloud-b')).toBeInTheDocument();
    await act(async () => { userA.resolve(ledger('cloud-a', 300)); });
    expect(screen.getByText('first:cloud-b')).toBeInTheDocument();
    expect(screen.queryByText('first:cloud-a')).not.toBeInTheDocument();
  });

  it('refreshes one authoritative ledger for every consumer after a successful buy', async () => {
    mocks.loadPositionLedger.mockResolvedValueOnce(ledger('before-buy', 100)).mockResolvedValueOnce(ledger('after-buy', 200));
    mocks.executeManualBuy.mockResolvedValue(undefined);
    render(<Wrapper><Consumer label="first" /><Consumer label="second" /><TradingConsumer /></Wrapper>);
    expect(await screen.findByText('first:before-buy')).toBeInTheDocument();
    screen.getByRole('button', { name: 'buy' }).click();
    expect(await screen.findByText('first:after-buy')).toBeInTheDocument();
    expect(screen.getByText('second:after-buy')).toBeInTheDocument();
    expect(mocks.executeManualBuy).toHaveBeenCalledOnce();
    expect(mocks.loadPositionLedger).toHaveBeenCalledTimes(2);
  });

  it('keeps the original ledger and skips refresh when a sell mutation fails', async () => {
    mocks.loadPositionLedger.mockResolvedValue(ledger('before-sell', 200));
    mocks.executeManualSell.mockRejectedValue(new Error('sell failed'));
    render(<Wrapper><Consumer label="first" /><TradingConsumer /></Wrapper>);
    expect(await screen.findByText('first:before-sell')).toBeInTheDocument();
    screen.getByRole('button', { name: 'sell' }).click();
    await waitFor(() => expect(mocks.executeManualSell).toHaveBeenCalledOnce());
    expect(screen.getByText('first:before-sell')).toBeInTheDocument();
    expect(mocks.loadPositionLedger).toHaveBeenCalledOnce();
  });
  it('loads the existing local watchlist when cloud mode is disabled', async () => {
    mocks.auth.cloudEnabled = false;
    mocks.auth.user = null;
    localStorage.setItem('sec_watchlists_v2', JSON.stringify([{
      id: 'local', name: 'Local list', createdAt: '2026-08-12', codes: ['000001'], groups: [], codeGroups: {},
    }]));

    function WatchlistConsumer() {
      const state = useSecuritiesState();
      return <span>watchlists:{state.watchlists.data[0]?.name ?? 'empty'}</span>;
    }

    render(<SecuritiesStateProvider><WatchlistConsumer /></SecuritiesStateProvider>);

    expect(await screen.findByText('watchlists:Local list')).toBeInTheDocument();
    expect(mocks.loadWatchlists).not.toHaveBeenCalled();
  });
  it('loads watchlists once and publishes the authoritative cloud result', async () => {
    mocks.loadPositionLedger.mockResolvedValue(ledger('positions', 100));
    mocks.loadWatchlists.mockResolvedValue([{ id: 'main', name: 'Cloud list', createdAt: '2026-08-12', codes: ['000001'], groups: [], codeGroups: {} }]);
    function WatchlistConsumer() {
      const state = useSecuritiesState();
      return <span>watchlists:{state.watchlists.data[0]?.name ?? 'empty'}</span>;
    }
    render(<Wrapper><WatchlistConsumer /><WatchlistConsumer /></Wrapper>);

    expect(await screen.findAllByText('watchlists:Cloud list')).toHaveLength(2);
    expect(mocks.loadWatchlists).toHaveBeenCalledOnce();
  });

  it('saves watchlists before refreshing every consumer from the cloud', async () => {
    mocks.loadPositionLedger.mockResolvedValue(ledger('positions', 100));
    mocks.loadWatchlists
      .mockResolvedValueOnce([{ id: 'main', name: 'Before', createdAt: '2026-08-12', codes: [], groups: [], codeGroups: {} }])
      .mockResolvedValueOnce([{ id: 'main', name: 'After', createdAt: '2026-08-12', codes: ['000001'], groups: [], codeGroups: {} }]);
    mocks.saveWatchlists.mockResolvedValue(undefined);
    function WatchlistTradingConsumer() {
      const state = useSecuritiesState();
      return <><span>watchlists:{state.watchlists.data[0]?.name ?? 'empty'}</span><button onClick={() => void state.replaceWatchlists([{ id: 'main', name: 'Draft', createdAt: '2026-08-12', codes: ['000001'], groups: [], codeGroups: {} }])}>save-watchlists</button></>;
    }
    render(<Wrapper><WatchlistTradingConsumer /></Wrapper>);
    expect(await screen.findByText('watchlists:Before')).toBeInTheDocument();
    screen.getByRole('button', { name: 'save-watchlists' }).click();

    expect(await screen.findByText('watchlists:After')).toBeInTheDocument();
    expect(mocks.saveWatchlists).toHaveBeenCalledOnce();
    expect(mocks.loadWatchlists).toHaveBeenCalledTimes(2);
  });});
