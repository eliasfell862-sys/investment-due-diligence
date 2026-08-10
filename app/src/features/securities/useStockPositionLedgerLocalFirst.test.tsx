import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { STOCK_POSITION_LEDGER_KEY } from './stock-position-ledger';

const reloadLedger = vi.fn().mockResolvedValue(undefined);
vi.mock('./cloud/SecuritiesDataSourceProvider', () => ({
  useOptionalSecuritiesDataSource: () => ({
    mode: 'cloud', loading: false, error: '', reloadLedger,
    ledger: {
      version: 1, groups: [], transactions: [],
      positions: [{
        id: 'cloud-position', groupId: 'core', code: '000001', name: 'cloud', shares: 300,
        averageCost: 10, totalCost: 3000, openedAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-07T00:00:00Z', sourceAlertIds: [],
      }],
    },
  }),
}));

import { useStockPositionLedger } from './useStockPositionLedger';

describe('local-first position ledger', () => {
  it('keeps local positions when cloud notification is configured', async () => {
    localStorage.clear();
    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify({
      version: 1, groups: [], transactions: [],
      positions: [{
        id: 'local-position', groupId: 'core', code: '600000', name: 'local', shares: 100,
        averageCost: 10, totalCost: 1000, openedAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-07T00:00:00Z', sourceAlertIds: [],
      }],
    }));

    const { result } = renderHook(() => useStockPositionLedger());
    await waitFor(() => expect(result.current.ledger.positions[0]?.shares).toBe(100));
    expect(result.current.reload).not.toBe(reloadLedger);
  });
});
