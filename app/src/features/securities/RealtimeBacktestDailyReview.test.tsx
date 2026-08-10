import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  monitor: vi.fn(() => ({ alerts: [], virtualLedger: { version: 1, positions: [], transactions: [], cycles: [] } })),
  reviewScheduler: vi.fn(),
}));

vi.mock('./useRealtimeBacktestMonitor', () => ({ useRealtimeBacktestMonitor: mocks.monitor }));
vi.mock('./strategy-learning/useDailyStrategyReviewScheduler', () => ({
  useDailyStrategyReviewScheduler: mocks.reviewScheduler,
}));

import { RealtimeBacktestMonitorProvider } from './RealtimeBacktestMonitorProvider';

describe('global daily review scheduling', () => {
  it('keeps the daily strategy review scheduler mounted with the global monitor', () => {
    render(<RealtimeBacktestMonitorProvider><div>child</div></RealtimeBacktestMonitorProvider>);

    expect(mocks.reviewScheduler).toHaveBeenCalledOnce();
  });
});
