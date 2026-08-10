import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDailyStrategyReviewScheduler } from './useDailyStrategyReviewScheduler';

describe('useDailyStrategyReviewScheduler', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('runs catch-up on mount and checks again on the configured interval', async () => {
    vi.useFakeTimers();
    const runCatchUp = vi.fn(async () => ({ status: 'existing' as const }));
    renderHook(() => useDailyStrategyReviewScheduler({ runCatchUp, intervalMs: 60_000 }));

    await act(async () => { await Promise.resolve(); });
    expect(runCatchUp).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(runCatchUp).toHaveBeenCalledTimes(2);
  });

  it('does not overlap a slow review run', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const runCatchUp = vi.fn(() => new Promise<{ status: string }>(resolve => {
      release = () => resolve({ status: 'created' });
    }));
    renderHook(() => useDailyStrategyReviewScheduler({ runCatchUp, intervalMs: 1_000 }));

    await act(async () => { await Promise.resolve(); });
    expect(runCatchUp).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(runCatchUp).toHaveBeenCalledTimes(1);
    await act(async () => { release?.(); });
  });
});