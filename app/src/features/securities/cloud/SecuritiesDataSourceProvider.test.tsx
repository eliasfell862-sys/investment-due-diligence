import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cloudEnabled: true,
  user: { id: 'user-a' } as { id: string } | null,
  loadPositionLedger: vi.fn(),
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ cloudEnabled: mocks.cloudEnabled, user: mocks.user }),
  useOptionalAuth: () => ({ cloudEnabled: mocks.cloudEnabled, user: mocks.user, loading: false }),
}));

vi.mock('./cloud-securities-repository', () => ({
  createCloudSecuritiesRepository: () => ({ loadPositionLedger: mocks.loadPositionLedger }),
}));

import { writeCachedPositionLedger } from '../securities-account-cache';
import { SecuritiesStateProvider } from '../state/SecuritiesStateProvider';
import { SecuritiesDataSourceProvider, useSecuritiesDataSource } from './SecuritiesDataSourceProvider';

const cloudLedger = {
  version: 1 as const, groups: [], transactions: [],
  positions: [{
    id: 'p1', groupId: 'core', code: '000001', name: '平安银行', shares: 300,
    averageCost: 10, totalCost: 3000, openedAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-07T00:00:00Z', sourceAlertIds: [],
  }],
};

describe('SecuritiesDataSourceProvider', () => {
  beforeEach(() => {
    mocks.cloudEnabled = true;
    mocks.user = { id: 'user-a' };
    mocks.loadPositionLedger.mockReset().mockResolvedValue(cloudLedger);
    localStorage.clear();
  });

  it('loads the authenticated cloud ledger in cloud mode', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SecuritiesDataSourceProvider>{children}</SecuritiesDataSourceProvider>
    );
    const { result } = renderHook(() => useSecuritiesDataSource(), { wrapper });

    await waitFor(() => expect(result.current.ledger.positions[0]?.shares).toBe(300));
    expect(result.current.mode).toBe('cloud');
  });
  it('shows the current-account cached ledger while the cloud ledger is loading', async () => {
    let resolveCloud!: (value: typeof cloudLedger) => void;
    mocks.loadPositionLedger.mockImplementation(() => new Promise(resolve => { resolveCloud = resolve; }));
    writeCachedPositionLedger('user-a', {
      ...cloudLedger,
      positions: [{ ...cloudLedger.positions[0], shares: 200 }],
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SecuritiesDataSourceProvider>{children}</SecuritiesDataSourceProvider>
    );
    const { result } = renderHook(() => useSecuritiesDataSource(), { wrapper });

    await waitFor(() => expect(result.current.ledger.positions[0]?.shares).toBe(200));
    resolveCloud(cloudLedger);
    await waitFor(() => expect(result.current.ledger.positions[0]?.shares).toBe(300));
  });

  it('stays in local mode when cloud configuration is unavailable', async () => {
    mocks.cloudEnabled = false;
    mocks.user = null;
    localStorage.setItem('sec_stock_position_ledger_v1', JSON.stringify(cloudLedger));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SecuritiesDataSourceProvider>{children}</SecuritiesDataSourceProvider>
    );
    const { result } = renderHook(() => useSecuritiesDataSource(), { wrapper });

    await waitFor(() => expect(result.current.ledger.positions[0]?.shares).toBe(300));
    expect(result.current.mode).toBe('local');
    expect(mocks.loadPositionLedger).not.toHaveBeenCalled();
  });

  it('reuses the unified position state instead of issuing a second cloud read', async () => {
    function Consumer({ label }: { label: string }) {
      const source = useSecuritiesDataSource();
      return <span>{label}:{source.ledger.positions[0]?.shares ?? 0}</span>;
    }
    render(
      <SecuritiesStateProvider>
        <SecuritiesDataSourceProvider>
          <Consumer label="first" />
          <Consumer label="second" />
        </SecuritiesDataSourceProvider>
      </SecuritiesStateProvider>,
    );

    expect(await screen.findByText('first:300')).toBeInTheDocument();
    expect(screen.getByText('second:300')).toBeInTheDocument();
    expect(mocks.loadPositionLedger).toHaveBeenCalledOnce();
  });});
