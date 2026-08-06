import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePreMoveOutcomeScheduler } from './usePreMoveOutcomeScheduler';

describe('usePreMoveOutcomeScheduler', () => {
  it('checks due outcomes on mount and when the page becomes visible', async () => {
    const runCatchUp = vi.fn(async () => ({ completed: 0, pending: 1 }));
    renderHook(() => usePreMoveOutcomeScheduler({ runCatchUp, intervalMs: 60_000 }));
    await waitFor(() => expect(runCatchUp).toHaveBeenCalledTimes(1));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(runCatchUp).toHaveBeenCalledTimes(2));
  });

  it('does not overlap slow outcome runs', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const runCatchUp = vi.fn(() => new Promise<{ completed: number; pending: number }>(resolve => {
      release = () => resolve({ completed: 0, pending: 1 });
    }));
    renderHook(() => usePreMoveOutcomeScheduler({ runCatchUp, intervalMs: 1000 }));
    await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(2000); });
    expect(runCatchUp).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await Promise.resolve(); });
    vi.useRealTimers();
  });
});