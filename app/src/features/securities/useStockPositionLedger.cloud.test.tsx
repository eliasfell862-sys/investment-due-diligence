import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const reloadLedger = vi.fn().mockResolvedValue(undefined);
vi.mock('./cloud/SecuritiesDataSourceProvider', () => ({
  useOptionalSecuritiesDataSource: () => ({
    mode: 'cloud', loading: false, error: '', reloadLedger,
    ledger: {
      version: 1, groups: [], transactions: [],
      positions: [{
        id: 'cloud-position', groupId: 'core', code: '000001', name: '平安银行', shares: 300,
        averageCost: 10, totalCost: 3000, openedAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-07T00:00:00Z', sourceAlertIds: [],
      }],
    },
  }),
}));

import { useStockPositionLedger } from './useStockPositionLedger';

describe('useStockPositionLedger cloud mode', () => {
  it('does not replace local storage with the cloud ledger', () => {
    localStorage.clear();
    const { result } = renderHook(() => useStockPositionLedger());

    expect(result.current.ledger.positions).toEqual([]);
    expect(result.current.reload).not.toBe(reloadLedger);
  });
});
