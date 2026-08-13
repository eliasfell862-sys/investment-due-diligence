import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('removes the exact same event listeners when unmounted', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useStockPositionLedger());

    const changedListener = addSpy.mock.calls.find(([event]) => event === STOCK_POSITION_LEDGER_CHANGED_EVENT)?.[1];
    const focusListener = addSpy.mock.calls.find(([event]) => event === 'focus')?.[1];
    unmount();

    expect(removeSpy).toHaveBeenCalledWith(STOCK_POSITION_LEDGER_CHANGED_EVENT, changedListener);
    expect(removeSpy).toHaveBeenCalledWith('focus', focusListener);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
  it('reports corrupted storage without overwriting it', () => {
    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, '{broken');
    const { result } = renderHook(() => useStockPositionLedger());
    expect(result.current.error).toBe('实际持仓数据损坏');
    expect(result.current.ledger.positions).toEqual([]);
    expect(localStorage.getItem(STOCK_POSITION_LEDGER_KEY)).toBe('{broken');
  });
});
