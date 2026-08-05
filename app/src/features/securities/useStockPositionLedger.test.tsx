import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  STOCK_POSITION_LEDGER_CHANGED_EVENT,
  STOCK_POSITION_LEDGER_KEY,
} from './stock-position-ledger';
import { useStockPositionLedger } from './useStockPositionLedger';

const heldLedger = {
  version: 1 as const,
  groups: [{ id: 'default', name: '默认持仓' }],
  positions: [{
    id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
    shares: 100, averageCost: 10, totalCost: 1_000,
    openedAt: '2026-08-05T01:30:00.000Z', updatedAt: '2026-08-05T01:30:00.000Z',
    sourceAlertIds: ['manual-1'],
  }],
  transactions: [],
};

describe('useStockPositionLedger', () => {
  beforeEach(() => localStorage.clear());

  it('reloads after same-tab, cross-tab, and focus notifications', () => {
    const { result } = renderHook(() => useStockPositionLedger());
    expect(result.current.ledger.positions).toEqual([]);

    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify(heldLedger));
    act(() => window.dispatchEvent(new Event(STOCK_POSITION_LEDGER_CHANGED_EVENT)));
    expect(result.current.ledger.positions[0]).toMatchObject({ code: '000001', shares: 100 });

    localStorage.removeItem(STOCK_POSITION_LEDGER_KEY);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: STOCK_POSITION_LEDGER_KEY })));
    expect(result.current.ledger.positions).toEqual([]);

    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify(heldLedger));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current.ledger.positions).toHaveLength(1);
  });

  it('reports corrupted storage without overwriting it', () => {
    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, '{broken');
    const { result } = renderHook(() => useStockPositionLedger());
    expect(result.current.error).toBe('实际持仓数据损坏');
    expect(result.current.ledger.positions).toEqual([]);
    expect(localStorage.getItem(STOCK_POSITION_LEDGER_KEY)).toBe('{broken');
  });
});
