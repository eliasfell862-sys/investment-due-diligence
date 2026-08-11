import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRADING_FEE_PROFILE } from './trading-fee-engine';
import { LOCAL_T_TRADING_STORAGE_KEY } from './local-t-trading-store';
import { useTTradingState } from './useTTradingState';

const mocks = vi.hoisted(() => ({
  auth: null as null | { cloudEnabled: boolean; user: { id: string } | null },
  repository: {
    loadTTradingState: vi.fn(),
    saveTradingFeeProfile: vi.fn(),
    executeTTradeSell: vi.fn(),
    executeTTradeBuyback: vi.fn(),
    resolveTTradeCycle: vi.fn(),
    subscribeTTradingState: vi.fn(() => () => undefined),
  },
}));

vi.mock('../../auth/AuthProvider', () => ({
  useOptionalAuth: () => mocks.auth,
}));
vi.mock('../cloud/cloud-securities-repository', () => ({
  createCloudSecuritiesRepository: () => mocks.repository,
}));

const cycle = {
  id: 'cycle-local',
  positionId: 'position-local',
  code: '000685',
  cycleType: 'profit_t' as const,
  status: 'buyback_monitoring' as const,
  preCycleAverageCost: 11.1,
  preCycleTotalShares: 1000,
  soldShares: 300,
  remainingBuybackShares: 300,
  keptAsReductionShares: 0,
  realizedTProfit: 0,
  costReductionPerShare: 0,
  adjustedAverageCost: 11.1,
  monitoringEnabled: true,
  riskReviewReasons: [],
  executions: [],
};

describe('useTTradingState mode selection', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.auth = null;
    mocks.repository.subscribeTTradingState.mockReturnValue(() => undefined);
  });

  it('loads cloud state for a logged-in cloud user', async () => {
    mocks.auth = { cloudEnabled: true, user: { id: 'user-a' } };
    mocks.repository.loadTTradingState.mockResolvedValue({
      version: 1,
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      cycles: [{ ...cycle, id: 'cycle-cloud' }],
    });

    const { result } = renderHook(() => useTTradingState());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.repository.loadTTradingState).toHaveBeenCalledTimes(1);
    expect(result.current.state.cycles[0].id).toBe('cycle-cloud');
  });

  it('loads local state when no authenticated cloud user exists', async () => {
    mocks.auth = { cloudEnabled: false, user: null };
    localStorage.setItem(LOCAL_T_TRADING_STORAGE_KEY, JSON.stringify({
      version: 1,
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      cycles: [cycle],
    }));

    const { result } = renderHook(() => useTTradingState());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.state.cycles[0].id).toBe('cycle-local');
    expect(mocks.repository.loadTTradingState).not.toHaveBeenCalled();
  });

  it('surfaces cloud failure without substituting local state', async () => {
    mocks.auth = { cloudEnabled: true, user: { id: 'user-a' } };
    localStorage.setItem(LOCAL_T_TRADING_STORAGE_KEY, JSON.stringify({
      version: 1,
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      cycles: [cycle],
    }));
    mocks.repository.loadTTradingState.mockRejectedValue(new Error('cloud unavailable'));

    const { result } = renderHook(() => useTTradingState());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('cloud unavailable');
    expect(result.current.state.cycles).toEqual([]);
  });
});
