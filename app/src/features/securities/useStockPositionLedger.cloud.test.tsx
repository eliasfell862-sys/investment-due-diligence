import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloudLedger = {
  version: 1, groups: [], transactions: [],
  positions: [{
    id: 'cloud-position', groupId: 'core', code: '000001', name: '平安银行', shares: 300,
    averageCost: 10, totalCost: 3000, openedAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-07T00:00:00Z', sourceAlertIds: [],
  }],
};
const loadPositionLedger = vi.fn();

vi.mock('../auth/AuthProvider', () => ({
  useOptionalAuth: () => ({ cloudEnabled: true, user: { id: 'user-1' } }),
}));
vi.mock('./cloud/cloud-securities-repository', () => ({
  createCloudSecuritiesRepository: () => ({ loadPositionLedger }),
}));

import { useStockPositionLedger } from './useStockPositionLedger';

describe('useStockPositionLedger cloud mode', () => {
  beforeEach(() => { loadPositionLedger.mockReset(); });

  it('reads the cloud ledger when logged in (cloud mode)', async () => {
    loadPositionLedger.mockResolvedValue(cloudLedger);
    const { result } = renderHook(() => useStockPositionLedger());

    await waitFor(() => expect(result.current.ledger.positions).toHaveLength(1));
    expect(result.current.ledger.positions[0].code).toBe('000001');
    expect(loadPositionLedger).toHaveBeenCalledTimes(1);
  });

  it('falls back to an empty ledger when the cloud read fails', async () => {
    loadPositionLedger.mockRejectedValue(new Error('cloud down'));
    const { result } = renderHook(() => useStockPositionLedger());

    await waitFor(() => expect(result.current.error).toBe('cloud down'));
    expect(result.current.ledger.positions).toEqual([]);
  });
});
