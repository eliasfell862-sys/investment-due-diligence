import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockQuote } from '../../infrastructure/market-data/stock-api';

const mocks = vi.hoisted(() => ({
  universe: {
    buyCodes: ['000001', '600519'],
    heldCodes: [],
    allCodes: ['000001', '600519'],
  },
  quoteSnapshot: {} as any,
  loadMonitoringUniverse: vi.fn(),
  loadStockLedger: vi.fn(),
  useRealtimeStockQuotes: vi.fn(),
  syncUniverse: vi.fn().mockResolvedValue(undefined),
  processSnapshot: vi.fn().mockResolvedValue({ events: [], partialFailureCount: 0 }),
  reload: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn(),
}));

vi.mock('./stock-monitoring-universe', () => ({
  loadMonitoringUniverse: mocks.loadMonitoringUniverse,
}));
vi.mock('./stock-position-ledger', async importOriginal => {
  const original = await importOriginal<typeof import('./stock-position-ledger')>();
  return { ...original, loadStockLedger: mocks.loadStockLedger };
});
vi.mock('./useRealtimeStockQuotes', () => ({
  useRealtimeStockQuotes: mocks.useRealtimeStockQuotes,
}));
vi.mock('./realtime-backtest-monitor', () => ({
  createRealtimeBacktestMonitor: () => ({
    syncUniverse: mocks.syncUniverse,
    processSnapshot: mocks.processSnapshot,
    reload: mocks.reload,
    dispose: mocks.dispose,
  }),
}));

import { useRealtimeBacktestMonitor } from './useRealtimeBacktestMonitor';

function quote(code = '000001'): StockQuote {
  return {
    code, name: code === '000001' ? '平安银行' : '贵州茅台', market: code.startsWith('6') ? 'sh' : 'sz',
    price: 10, change: 0, changePct: 0, open: 10, high: 10, low: 10,
    volume: 1_000, amount: 10_000, preClose: 10, turnover: 1,
    pe: 10, pb: 1, totalShares: 1, floatShares: 1, totalCap: 1, floatCap: 1,
  };
}

function tradingSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    quotes: { '000001': quote('000001'), '600519': quote('600519') },
    refreshing: false,
    marketStatus: 'trading',
    lastUpdatedAt: '2026-08-04T01:30:00.000Z',
    stale: false,
    error: '',
    refreshNow: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const buyEvent = {
  code: '000001', name: '平安银行', price: 10,
  decision: { action: 'buy' as const, reasons: ['MACD金叉'] },
  isBuyCandidate: true, isHeld: false,
  signalAt: '2026-08-04T01:30:00.000Z',
  metrics: {
    totalTrades: 12, winRate: 58, sharpeRatio: 1.1,
    maxDrawdown: 12, annualReturn: 18, profitFactor: 1.4,
  },
  entryPrice: 10, stopLoss: 9.2,
};

describe('useRealtimeBacktestMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.universe = {
      buyCodes: ['000001', '600519'], heldCodes: [], allCodes: ['000001', '600519'],
    };
    mocks.loadMonitoringUniverse.mockImplementation(() => mocks.universe);
    mocks.loadStockLedger.mockReturnValue({ version: 1, groups: [], positions: [], transactions: [] });
    mocks.quoteSnapshot = tradingSnapshot();
    mocks.useRealtimeStockQuotes.mockImplementation(() => mocks.quoteSnapshot);
    mocks.syncUniverse.mockResolvedValue(undefined);
    mocks.processSnapshot.mockResolvedValue({ events: [], partialFailureCount: 0 });
    mocks.reload.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes all monitoring codes and applies realtime signal events to the inbox', async () => {
    mocks.processSnapshot.mockResolvedValue({ events: [buyEvent], partialFailureCount: 0 });
    const { result } = renderHook(() => useRealtimeBacktestMonitor());

    expect(mocks.useRealtimeStockQuotes).toHaveBeenCalledWith(['000001', '600519']);
    await waitFor(() => expect(mocks.syncUniverse).toHaveBeenCalledWith(['000001', '600519']));
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    expect(result.current.alerts[0]).toMatchObject({ code: '000001', action: 'buy' });
    expect(result.current.unreadCount).toBe(1);
  });

  it('does not evaluate signals outside trading status', async () => {
    mocks.quoteSnapshot = tradingSnapshot({ marketStatus: 'lunch_break' });
    renderHook(() => useRealtimeBacktestMonitor());
    await waitFor(() => expect(mocks.syncUniverse).toHaveBeenCalled());
    expect(mocks.processSnapshot).not.toHaveBeenCalled();
  });

  it('refreshes shared quotes and reloads historical data on demand', async () => {
    const refreshNow = vi.fn().mockResolvedValue(undefined);
    mocks.quoteSnapshot = tradingSnapshot({ refreshNow });
    const { result } = renderHook(() => useRealtimeBacktestMonitor());
    await waitFor(() => expect(mocks.syncUniverse).toHaveBeenCalled());

    await act(() => result.current.refreshNow());
    expect(mocks.reload).toHaveBeenCalledWith(['000001', '600519']);
    expect(refreshNow).toHaveBeenCalledOnce();
  });

  it('rechecks the lightweight monitoring universe every three seconds', async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(() => useRealtimeBacktestMonitor());
    await act(async () => { await Promise.resolve(); });

    mocks.universe = {
      buyCodes: ['300750'], heldCodes: [], allCodes: ['300750'],
    };
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    rerender();

    expect(mocks.useRealtimeStockQuotes).toHaveBeenLastCalledWith(['300750']);
    expect(mocks.syncUniverse).toHaveBeenCalledWith(['300750']);
  });

  it('marks one alert read, clears messages, reloads positions, and disposes cleanly', async () => {
    mocks.processSnapshot.mockResolvedValue({ events: [buyEvent], partialFailureCount: 1 });
    const { result, unmount } = renderHook(() => useRealtimeBacktestMonitor());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    const alertId = result.current.alerts[0].id;

    act(() => result.current.markRead(alertId));
    expect(result.current.alerts[0].readAt).not.toBeNull();
    expect(result.current.partialFailureCount).toBe(1);

    act(() => result.current.clearAlerts());
    expect(result.current.alerts).toEqual([]);
    act(() => result.current.reloadLedger());
    expect(mocks.loadStockLedger).toHaveBeenCalled();

    unmount();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
