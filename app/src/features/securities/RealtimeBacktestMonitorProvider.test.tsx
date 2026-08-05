import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  monitorHook: vi.fn(),
  result: {
    alerts: [], unreadCount: 0, checking: false, partialFailureCount: 0,
    monitoringCount: 2, watchlistCount: 2, heldCount: 1, successfulCount: 2,
    lastScanAt: '2026-08-05T01:30:00.000Z', marketStatus: 'trading' as const,
    lastUpdatedAt: '2026-08-05T01:30:00.000Z', error: '',
    refreshNow: vi.fn(), markRead: vi.fn(), markExecuted: vi.fn(),
    clearAlerts: vi.fn(), reloadLedger: vi.fn(),
  },
}));

vi.mock('./useRealtimeBacktestMonitor', () => ({
  useRealtimeBacktestMonitor: mocks.monitorHook,
}));

import { AppShell } from '../../app/AppShell';
import {
  RealtimeBacktestMonitorProvider,
  useRealtimeBacktestMonitorContext,
} from './RealtimeBacktestMonitorProvider';

function Consumer({ label }: { label: string }) {
  const monitor = useRealtimeBacktestMonitorContext();
  return <div>{label}:{monitor.monitoringCount}</div>;
}

function RouteOne() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/two')}>route-one</button>;
}

describe('RealtimeBacktestMonitorProvider', () => {
  it('creates one monitor and shares the same result with all consumers', () => {
    mocks.monitorHook.mockReset().mockReturnValue(mocks.result);
    render(
      <RealtimeBacktestMonitorProvider>
        <Consumer label="first" />
        <Consumer label="second" />
      </RealtimeBacktestMonitorProvider>,
    );

    expect(mocks.monitorHook).toHaveBeenCalledOnce();
    expect(screen.getByText('first:2')).toBeInTheDocument();
    expect(screen.getByText('second:2')).toBeInTheDocument();
  });

  it('keeps the AppShell monitor mounted across child route navigation', async () => {
    const user = userEvent.setup();
    mocks.monitorHook.mockReset().mockReturnValue(mocks.result);
    render(
      <MemoryRouter initialEntries={['/one']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="one" element={<RouteOne />} />
            <Route path="two" element={<div>route-two</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(mocks.monitorHook).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'route-one' }));
    expect(screen.getByText('route-two')).toBeInTheDocument();
    expect(mocks.monitorHook).toHaveBeenCalledOnce();
  });

  it('rejects consumers outside the global provider', () => {
    expect(() => render(<Consumer label="outside" />))
      .toThrow('useRealtimeBacktestMonitorContext必须在RealtimeBacktestMonitorProvider内使用');
  });
});
