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
  ledgerHook: {} as any,
  useStockPositionLedger: vi.fn(),
  useRealtimeStockQuotes: vi.fn(),
  syncUniverse: vi.fn().mockResolvedValue(undefined),
  processSnapshot: vi.fn().mockResolvedValue({ events: [], partialFailureCount: 0 }),
  reload: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn(),
}));

vi.mock('./stock-monitoring-universe', () => ({
  loadMonitoringUniverse: mocks.loadMonitoringUniverse,
}));
vi.mock('./useStockPositionLedger', () => ({
  useStockPositionLedger: mocks.useStockPositionLedger,
}));
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
  isBuyCandidate: true,
  buyDecision: { action: 'buy' as const, reasons: ['MACD金叉'] },
  virtualSellDecision: { action: 'hold' as const, reasons: [] },
  actualSellDecision: { action: 'hold' as const, reasons: [] },
  virtualPositionShares: 0, virtualAvailableShares: 0,
  actualPositionShares: 0, actualAvailableShares: 0,
  virtualEntryPrice: 0, actualEntryPrice: 0,
  isHeld: false, positionShares: 0, availableShares: 0,
  sellDecision: { action: 'hold' as const, reasons: [] },
  signalAt: '2026-08-04T01:30:00.000Z',
  strategyId: 'realtime-technical', strategyVersion: '1',
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
    mocks.ledgerHook = {
      ledger: { version: 1, groups: [], positions: [], transactions: [] },
      error: '',
      reload: vi.fn(),
    };
    mocks.useStockPositionLedger.mockImplementation(() => mocks.ledgerHook);
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
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    mocks.processSnapshot.mockResolvedValue({ events: [buyEvent], partialFailureCount: 0 });
    const { result } = renderHook(() => useRealtimeBacktestMonitor());

    expect(mocks.useRealtimeStockQuotes).toHaveBeenCalledWith(['000001', '600519']);
    await waitFor(() => expect(mocks.syncUniverse).toHaveBeenCalledWith(['000001', '600519']));
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    expect(result.current.alerts[0]).toMatchObject({
      code: '000001', action: 'buy', messageKind: 'virtual_execution',
    });
    expect(result.current.virtualLedger.transactions).toHaveLength(1);
    expect(result.current.alerts[0].virtualTradeId)
      .toBe(result.current.virtualLedger.transactions[0].id);
    expect(result.current.unreadCount).toBe(1);
    expect(storageWrite).toHaveBeenCalledTimes(1);
    storageWrite.mockRestore();
    expect(result.current).toMatchObject({
      monitoringCount: 2,
      watchlistCount: 2,
      heldCount: 0,
      successfulCount: 2,
      lastScanAt: '2026-08-04T01:30:00.000Z',
    });
  });

  it('continues monitoring a virtual holding removed from watchlists and actual positions', async () => {
    localStorage.setItem('sec_bt_signal_runtime_v3', JSON.stringify({
      version: 3,
      alerts: [],
      stocks: {},
      virtualLedger: {
        version: 1,
        positions: [{
          id: 'virtual-position', cycleId: 'cycle-1',
          strategyId: 'realtime-technical', strategyVersion: '1',
          code: '300750', name: '宁德时代', shares: 100,
          averageCost: 200, totalCost: 20000,
          openedAt: '2026-08-01T01:30:00.000Z',
          updatedAt: '2026-08-01T01:30:00.000Z',
          sourceTradeIds: ['trade-1'],
        }],
        transactions: [{
          id: 'trade-1', sourceSignalId: 'signal-1', cycleId: 'cycle-1',
          strategyId: 'realtime-technical', strategyVersion: '1',
          code: '300750', name: '宁德时代', type: 'buy', intent: 'open',
          shares: 100, price: 200, amount: 20000,
          tradedAt: '2026-08-01T01:30:00.000Z',
          positionSharesAfter: 100, availableSharesAfter: 0,
          realizedProfit: 0, reasons: [],
        }],
        cycles: [{
          id: 'cycle-1', strategyId: 'realtime-technical', strategyVersion: '1',
          code: '300750', name: '宁德时代', status: 'open',
          openedAt: '2026-08-01T01:30:00.000Z', closedAt: null,
          buyAmount: 20000, sellAmount: 0, realizedProfit: 0,
          returnPct: null, transactionIds: ['trade-1'],
        }],
      },
    }));

    renderHook(() => useRealtimeBacktestMonitor());

    expect(mocks.useRealtimeStockQuotes).toHaveBeenCalledWith(['000001', '300750', '600519']);
    await waitFor(() => expect(mocks.syncUniverse)
      .toHaveBeenCalledWith(['000001', '300750', '600519']));
  });

  it('blocks processing and exposes an actionable error for corrupt V3 state', async () => {
    localStorage.setItem('sec_bt_signal_runtime_v3', '{"version":3,"alerts":[]}');

    const { result } = renderHook(() => useRealtimeBacktestMonitor());

    await waitFor(() => expect(result.current.error).toContain('前向模拟数据损坏'));
    expect(mocks.processSnapshot).not.toHaveBeenCalled();
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

  it('passes a manually added watchlist position into sell-signal processing', async () => {
    mocks.ledgerHook.ledger = {
      version: 1,
      groups: [{ id: 'default', name: '默认持仓' }],
      positions: [{
        id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
        shares: 100, averageCost: 10.8, totalCost: 1_080,
        openedAt: '2026-08-05T01:30:00.000Z', updatedAt: '2026-08-05T01:30:00.000Z',
        sourceAlertIds: ['manual-watchlist-000001-1'],
      }],
      transactions: [],
    };
    renderHook(() => useRealtimeBacktestMonitor());

    await waitFor(() => expect(mocks.processSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        actualPositions: [expect.objectContaining({
          code: '000001', shares: 100, averageCost: 10.8,
          openedAt: '2026-08-05T01:30:00.000Z',
        })],
      }),
    ));
  });
  it('passes total and T+1 available shares into signal processing', async () => {
    vi.setSystemTime('2026-08-05T06:00:00.000Z');
    mocks.quoteSnapshot = tradingSnapshot({ lastUpdatedAt: '2026-08-05T06:00:00.000Z' });
    mocks.ledgerHook.ledger = {
      version: 1,
      groups: [{ id: 'default', name: '默认持仓' }],
      positions: [{
        id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
        shares: 500, averageCost: 10.8, totalCost: 5_400,
        openedAt: '2025-08-01T01:30:00.000Z', updatedAt: '2026-08-05T01:30:00.000Z',
        sourceAlertIds: ['historical', 'buy-today'],
      }],
      transactions: [{
        id: 'transaction-1', groupId: 'default', code: '000001', name: '平安银行',
        type: 'buy', shares: 200, price: 10.8, amount: 2_160,
        tradedAt: '2026-08-05T01:30:00.000Z', sourceAlertId: 'buy-today', realizedProfit: 0,
      }],
    };

    renderHook(() => useRealtimeBacktestMonitor());

    await waitFor(() => expect(mocks.processSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        actualPositions: [expect.objectContaining({
          code: '000001', shares: 500, availableShares: 300,
        })],
      }),
    ));
  });
  it('reports an inbox persistence failure without publishing the new alert', async () => {
    mocks.processSnapshot.mockResolvedValue({ events: [buyEvent], partialFailureCount: 0 });
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => { throw new Error('存储空间不足'); });
    const { result } = renderHook(() => useRealtimeBacktestMonitor());

    await waitFor(() => expect(result.current.error).toContain('存储空间不足'));
    expect(result.current.alerts).toEqual([]);
    storageWrite.mockRestore();
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
    expect(mocks.ledgerHook.reload).toHaveBeenCalled();

    unmount();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it('does not reprocess the same quote snapshot after an actual buy is confirmed', async () => {
    mocks.processSnapshot.mockResolvedValue({ events: [buyEvent], partialFailureCount: 0 });
    const { result, rerender } = renderHook(() => useRealtimeBacktestMonitor());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    const alertId = result.current.alerts[0].id;

    act(() => result.current.markExecuted(alertId, 'bought', true));
    mocks.ledgerHook = {
      ...mocks.ledgerHook,
      ledger: {
        version: 1,
        groups: [{ id: 'default', name: 'Default' }],
        positions: [{
          id: 'position-1', groupId: 'default', code: '000001', name: 'Ping An Bank',
          shares: 100, averageCost: 10, totalCost: 1_000,
          openedAt: '2026-08-04T01:30:00.000Z', updatedAt: '2026-08-04T01:30:00.000Z',
          sourceAlertIds: [alertId],
        }],
        transactions: [],
      },
    };
    rerender();

    await waitFor(() => expect(result.current.alerts[0].status).toBe('bought'));
    expect(mocks.processSnapshot).toHaveBeenCalledTimes(1);
    expect(result.current.virtualLedger.transactions).toHaveLength(1);
  });
});
