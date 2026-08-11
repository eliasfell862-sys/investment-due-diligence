import { act, renderHook, waitFor } from '@testing-library/react';
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
const executeBuy = vi.fn();
const executeManualBuy = vi.fn();
const executeManualSell = vi.fn();
const movePositionGroup = vi.fn();

vi.mock('../auth/AuthProvider', () => ({
  useOptionalAuth: () => ({ cloudEnabled: true, user: { id: 'user-1' } }),
}));
vi.mock('./cloud/cloud-securities-repository', () => ({
  createCloudSecuritiesRepository: () => ({
    loadPositionLedger, executeBuy, executeManualBuy, executeManualSell, movePositionGroup,
  }),
}));

import { useStockPositionLedger } from './useStockPositionLedger';

describe('useStockPositionLedger cloud mode', () => {
  beforeEach(() => {
    loadPositionLedger.mockReset();
    executeBuy.mockReset();
    executeManualBuy.mockReset();
    executeManualSell.mockReset();
    movePositionGroup.mockReset();
  });

  it('reads the cloud ledger when logged in (cloud mode)', async () => {
    loadPositionLedger.mockResolvedValue(cloudLedger);
    const { result } = renderHook(() => useStockPositionLedger());

    await waitFor(() => expect(result.current.ledger.positions).toHaveLength(1));
    expect(result.current.ledger.positions[0].code).toBe('000001');
    expect(loadPositionLedger).toHaveBeenCalledTimes(1);
  });

  it('writes a watchlist buy to the cloud ledger and reloads it', async () => {
    loadPositionLedger.mockResolvedValue(cloudLedger);
    executeManualBuy.mockResolvedValue(undefined);
    const { result } = renderHook(() => useStockPositionLedger());
    await waitFor(() => expect(result.current.ledger.positions).toHaveLength(1));

    await act(async () => {
      await result.current.buy({
        code: '000002',
        name: 'Vanke',
        shares: 100,
        price: 8.5,
        groupId: 'default',
        groupName: 'Default',
        sourceAlertId: 'manual-watchlist-000002-1',
        tradedAt: '2026-08-11T02:00:00.000Z',
      });
    });

    expect(executeManualBuy).toHaveBeenCalledWith({
      operationId: 'manual-watchlist-000002-1',
      code: '000002',
      name: 'Vanke',
      shares: 100,
      price: 8.5,
      groupId: 'default',
      groupName: 'Default',
      tradedAt: '2026-08-11T02:00:00.000Z',
    });
    expect(loadPositionLedger).toHaveBeenCalledTimes(2);
  });

  it('writes manual sells and group changes to the cloud ledger', async () => {
    loadPositionLedger.mockResolvedValue(cloudLedger);
    executeManualSell.mockResolvedValue(undefined);
    movePositionGroup.mockResolvedValue(undefined);
    const { result } = renderHook(() => useStockPositionLedger());
    await waitFor(() => expect(result.current.ledger.positions).toHaveLength(1));

    await act(async () => {
      await result.current.sell({
        code: '000001', shares: 100, price: 12,
        sourceAlertId: 'manual-portfolio-sell-000001-1',
        tradedAt: '2026-08-11T02:00:00.000Z',
      });
      await result.current.moveGroup({
        code: '000001', groupId: 'core', groupName: 'Core',
        updatedAt: '2026-08-11T02:01:00.000Z',
      });
    });

    expect(executeManualSell).toHaveBeenCalledWith({
      operationId: 'manual-portfolio-sell-000001-1', code: '000001', shares: 100,
      price: 12, tradedAt: '2026-08-11T02:00:00.000Z',
    });
    expect(movePositionGroup).toHaveBeenCalledWith({
      code: '000001', groupId: 'core', groupName: 'Core',
      updatedAt: '2026-08-11T02:01:00.000Z',
    });
  });
  it('falls back to an empty ledger when the cloud read fails', async () => {
    loadPositionLedger.mockRejectedValue(new Error('cloud down'));
    const { result } = renderHook(() => useStockPositionLedger());

    await waitFor(() => expect(result.current.error).toBe('cloud down'));
    expect(result.current.ledger.positions).toEqual([]);
  });
});
