import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  monitor: vi.fn(() => ({ alerts: [], virtualLedger: { version: 1, positions: [], transactions: [], cycles: [] } })),
  reviewScheduler: vi.fn(),
  cloudCatchUp: vi.fn(async () => ({ status: 'existing' })),
  snapshotCatchUp: vi.fn(async () => ({ status: 'existing' })),
  securitiesState: {
    watchlists: { data: [{ codes: ['300750'] }], loading: false },
    positions: { data: { version: 1, groups: [], positions: [], transactions: [] }, loading: false },
  },
  auth: { cloudEnabled: true, user: { id: 'user-a' }, loading: false },
}));

vi.mock('./useRealtimeBacktestMonitor', () => ({ useRealtimeBacktestMonitor: mocks.monitor }));
vi.mock('./strategy-learning/useDailyStrategyReviewScheduler', () => ({
  useDailyStrategyReviewScheduler: mocks.reviewScheduler,
}));
vi.mock('./strategy-learning/daily-review-orchestrator', () => ({
  runDailyReviewCatchUp: vi.fn(async () => ({ status: 'existing' })),
  runDailyReviewCatchUpFromCloudState: mocks.cloudCatchUp,
  runDailyReviewCatchUpFromSnapshot: mocks.snapshotCatchUp,
}));
vi.mock('../auth/AuthProvider', () => ({ useOptionalAuth: () => mocks.auth }));
vi.mock('./state/securities-state-context', () => ({ useOptionalSecuritiesState: () => mocks.securitiesState }));
vi.mock('./cloud/cloud-securities-repository', () => ({
  createCloudSecuritiesRepository: () => ({ source: 'cloud' }),
}));

import { RealtimeBacktestMonitorProvider } from './RealtimeBacktestMonitorProvider';

describe('global daily review scheduling', () => {
  it('keeps the daily strategy review scheduler mounted with the global monitor', () => {
    render(<RealtimeBacktestMonitorProvider><div>child</div></RealtimeBacktestMonitorProvider>);

    expect(mocks.reviewScheduler).toHaveBeenCalledOnce();
  });
  it('schedules the daily review with authenticated cloud holdings and trade history', async () => {
    render(<RealtimeBacktestMonitorProvider><div>child</div></RealtimeBacktestMonitorProvider>);

    const options = mocks.reviewScheduler.mock.calls.at(-1)?.[0];
    await act(async () => { await options.runCatchUp(); });

    expect(mocks.snapshotCatchUp).toHaveBeenCalledWith({
      watchlists: mocks.securitiesState.watchlists.data,
      positionLedger: mocks.securitiesState.positions.data,
    }, { source: 'cloud' });
    expect(mocks.cloudCatchUp).not.toHaveBeenCalled();
  });

});
