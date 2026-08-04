import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockedStore = vi.hoisted(() => ({
  subscribe: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn(),
}));

vi.mock('../../infrastructure/market-data/realtime-stock-quotes', async importOriginal => {
  const original = await importOriginal<typeof import('../../infrastructure/market-data/realtime-stock-quotes')>();
  return { ...original, realtimeStockQuoteStore: mockedStore };
});

import { useRealtimeStockQuotes } from './useRealtimeStockQuotes';

describe('useRealtimeStockQuotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStore.subscribe.mockReturnValue(vi.fn());
    mockedStore.refresh.mockResolvedValue(undefined);
  });

  it('subscribes with normalized codes and unsubscribes on unmount', () => {
    const unsubscribe = vi.fn();
    mockedStore.subscribe.mockReturnValue(unsubscribe);
    const { unmount } = renderHook(() => useRealtimeStockQuotes(['600519', '000001', '600519']));
    expect(mockedStore.subscribe).toHaveBeenCalledWith(['000001', '600519'], expect.any(Function));
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not resubscribe when only the code order changes', () => {
    const { rerender } = renderHook(({ codes }) => useRealtimeStockQuotes(codes), {
      initialProps: { codes: ['000001', '600519'] },
    });
    rerender({ codes: ['600519', '000001'] });
    expect(mockedStore.subscribe).toHaveBeenCalledTimes(1);
  });

  it('refreshes only the Hook code set', async () => {
    const { result } = renderHook(() => useRealtimeStockQuotes(['000001']));
    await act(() => result.current.refreshNow());
    expect(mockedStore.refresh).toHaveBeenCalledWith(['000001']);
  });

  it('does not subscribe for an empty code set', () => {
    renderHook(() => useRealtimeStockQuotes([]));
    expect(mockedStore.subscribe).not.toHaveBeenCalled();
  });
});
