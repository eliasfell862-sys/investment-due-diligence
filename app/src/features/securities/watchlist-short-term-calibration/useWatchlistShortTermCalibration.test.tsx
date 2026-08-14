import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRADING_FEE_PROFILE } from '../t-trading/trading-fee-engine';
import { aggregateCalibrationResult } from './aggregate';
import type { CalibrationRunRecord } from './calibration-db';
import type { RunCalibrationInput } from './calibration-service';
import {
  useWatchlistShortTermCalibration,
  type WatchlistShortTermCalibrationHookDependencies,
} from './useWatchlistShortTermCalibration';

function result(createdAt = '2026-08-13T12:00:00.000Z') {
  return aggregateCalibrationResult({
    trades: [], unfilled: [], totalStocks: 1,
    validStocks: [{ code: '600000', turnoverMode: 'direct' }], skippedStocks: [],
    dataAsOf: createdAt.slice(0, 10), leakageBlocked: false, createdAt,
  });
}

function stored(value = result()): CalibrationRunRecord {
  return {
    scopeId: 'user-a', runId: 'run-old', fingerprint: 'old-fingerprint',
    tradingDate: '2026-08-13', modelVersion: value.modelVersion,
    createdAt: value.createdAt, result: value,
  };
}

function dependencies(
  overrides: Partial<WatchlistShortTermCalibrationHookDependencies> = {},
): WatchlistShortTermCalibrationHookDependencies {
  return {
    loadLatest: vi.fn(async () => stored()),
    hasAttempt: vi.fn(async () => false),
    recordAttempt: vi.fn(async () => undefined),
    runCalibration: vi.fn(async input => result(input.tradingDate + 'T12:00:00.000Z')),
    tradingDate: () => '2026-08-14',
    ...overrides,
  };
}

const input = {
  scopeId: 'user-a', codes: ['600000'], feeProfile: DEFAULT_TRADING_FEE_PROFILE,
};

describe('useWatchlistShortTermCalibration', () => {
  it('shows the previous result and does not repeat an automatic run already attempted today', async () => {
    const runCalibration = vi.fn(async () => result('2026-08-14T12:00:00.000Z'));
    const deps = dependencies({ hasAttempt: vi.fn(async () => true), runCalibration });
    const { result: hook } = renderHook(() => useWatchlistShortTermCalibration(input, deps));

    await waitFor(() => expect(hook.current.status).toBe('ready'));
    expect(hook.current.result?.createdAt).toBe('2026-08-13T12:00:00.000Z');
    expect(hook.current.stale).toBe(true);
    expect(runCalibration).not.toHaveBeenCalled();
  });

  it('automatically runs once on a new trading day and publishes progress', async () => {
    const recordAttempt = vi.fn(async () => undefined);
    const runCalibration = vi.fn(async options => {
      options.onProgress?.({ completed: 1, total: 1, currentCode: '600000' });
      return result('2026-08-14T12:00:00.000Z');
    });
    const deps = dependencies({ recordAttempt, runCalibration });
    const { result: hook } = renderHook(() => useWatchlistShortTermCalibration(input, deps));

    await waitFor(() => expect(hook.current.result?.createdAt).toBe('2026-08-14T12:00:00.000Z'));
    expect(recordAttempt).toHaveBeenCalledWith('user-a', '2026-08-14', expect.any(String));
    expect(runCalibration).toHaveBeenCalledOnce();
    expect(hook.current.status).toBe('ready');
    expect(hook.current.stale).toBe(false);
  });

  it('allows a manual recalibration even when today was already attempted', async () => {
    const runCalibration = vi.fn(async (_options: RunCalibrationInput) => result('2026-08-14T13:00:00.000Z'));
    const deps = dependencies({ hasAttempt: vi.fn(async () => true), runCalibration });
    const { result: hook } = renderHook(() => useWatchlistShortTermCalibration(input, deps));
    await waitFor(() => expect(hook.current.status).toBe('ready'));

    await act(async () => { await hook.current.recalibrate(); });

    expect(runCalibration).toHaveBeenCalledOnce();
    expect(runCalibration.mock.calls[0]?.[0].force).toBe(true);
    expect(hook.current.result?.createdAt).toBe('2026-08-14T13:00:00.000Z');
  });

  it('keeps the previous result visible when recalibration fails', async () => {
    const deps = dependencies({
      hasAttempt: vi.fn(async () => true),
      runCalibration: vi.fn(async () => { throw new Error('network down'); }),
    });
    const { result: hook } = renderHook(() => useWatchlistShortTermCalibration(input, deps));
    await waitFor(() => expect(hook.current.status).toBe('ready'));

    await act(async () => { await hook.current.recalibrate(); });

    expect(hook.current.status).toBe('error');
    expect(hook.current.error).toBe('network down');
    expect(hook.current.result?.createdAt).toBe('2026-08-13T12:00:00.000Z');
  });
});
