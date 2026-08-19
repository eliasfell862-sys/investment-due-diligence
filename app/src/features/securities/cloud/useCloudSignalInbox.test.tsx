import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCloudSignalInbox } from './useCloudSignalInbox';

const alert = (id: string) => ({
  id, code: '000001', name: '平安银行', price: 10, action: 'buy' as const, intent: 'open' as const,
  suggestedShares: 100, positionSharesAtSignal: 0, availableSharesAtSignal: 0,
  reasons: ['测试信号'], signalAt: '2026-08-07T01:30:00Z', status: 'pending' as const,
  readAt: null, executedAt: null, entryPrice: 10, stopLoss: 9,
  metrics: { totalTrades: 1, winRate: 0.5, sharpeRatio: 1, maxDrawdown: 0.1, annualReturn: 0.2, profitFactor: 1.2 },
  messageKind: 'actual_position_risk' as const, virtualTrackingStatus: 'actual_risk_only' as const,
  virtualTradeId: null, virtualCycleId: null, virtualShares: 0, virtualPrice: null,
  virtualPositionSharesAfter: null, virtualAvailableSharesAfter: null,
  strategyId: 'realtime', strategyVersion: '3',
});

describe('useCloudSignalInbox', () => {
  it('applies realtime insert/update events without reloading the full inbox', async () => {
    let realtimeCallback: ((payload: Record<string, unknown>) => void) | null = null;
    const repository = {
      loadSignalAlerts: vi.fn().mockResolvedValue([alert('a')]),
      mapSignalAlert: vi.fn((value: unknown) => value),
      markAlertRead: vi.fn(),
    };
    const channel = {
      on: vi.fn((_event, _filter, callback) => { realtimeCallback = callback; return channel; }),
      subscribe: vi.fn(() => channel),
    };
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn() };

    const { result } = renderHook(() => useCloudSignalInbox('user-a', { repository, client } as never));
    await waitFor(() => expect(result.current.alerts.map(item => item.id)).toEqual(['a']));

    await act(async () => { realtimeCallback?.({ eventType: 'INSERT', new: alert('b') }); });
    await waitFor(() => expect(result.current.alerts.map(item => item.id)).toEqual(['b', 'a']));
    await act(async () => { realtimeCallback?.({ eventType: 'UPDATE', new: { ...alert('b'), readAt: '2026-08-07T03:00:00Z' } }); });
    expect(result.current.alerts).toHaveLength(2);
    expect(result.current.alerts[0]?.readAt).toBe('2026-08-07T03:00:00Z');
    expect(repository.loadSignalAlerts).toHaveBeenCalledOnce();
  });

  it('marks an alert read through the cloud repository and refreshes state', async () => {
    const repository = {
      loadSignalAlerts: vi.fn().mockResolvedValue([alert('a')]),
      mapSignalAlert: vi.fn((value: unknown) => value),
      markAlertRead: vi.fn().mockResolvedValue(undefined),
    };
    const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) };
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn() };
    const { result } = renderHook(() => useCloudSignalInbox('user-a', { repository, client } as never));
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));

    await act(async () => { await result.current.markRead('a'); });

    expect(repository.markAlertRead).toHaveBeenCalledWith('a', expect.any(String));
    const readAt = repository.markAlertRead.mock.calls[0]?.[1];
    expect(result.current.alerts[0]?.readAt).toBe(readAt);
    expect(repository.loadSignalAlerts).toHaveBeenCalledOnce();
  });
});
