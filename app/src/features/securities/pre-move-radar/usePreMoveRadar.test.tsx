import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreMoveRadar } from './usePreMoveRadar';

const scan = vi.hoisted(() => vi.fn());
vi.mock('./radar-service', async importOriginal => ({ ...(await importOriginal()), scanPreMoveRadar: scan }));

const prediction = (source: 'watchlist' | 'rotation') => ({ code: source === 'watchlist' ? '000001' : '000002', name: '测试', industry: '银行', source,
  currentPrice: 10, signalScore: 70, scores: { industryRotation: 20, capitalFlow: 20, accumulation: 15, relativeStrength: 8, upsideRoom: 7, total: 70 },
  rawFeatures: {}, featureCoverage: [], probability: 68, confidence: 70, formalProbability: true, sampleSize: 220, similarSampleSize: 42,
  status: 'layout_ready' as const, expectedWindow: '5_10' as const, positiveEvidence: [], risks: [], invalidationConditions: [],
  dataCompleteness: 1, dataSources: [], dataAsOf: '2026-08-06T07:20:00Z' });
const result = { scanId: 'scan', tradingDate: '2026-08-06', formal: true, marketRegime: 'strong' as const,
  industries: [], predictions: [prediction('watchlist'), prediction('rotation')], errors: [], dataAsOf: '2026-08-06T07:20:00Z', cacheStatus: 'fresh' as const };

describe('usePreMoveRadar', () => {
  beforeEach(() => scan.mockReset().mockResolvedValue(result));
  it('loads cached data on mount and forces a scan on refresh', async () => {
    const { result: hook } = renderHook(() => usePreMoveRadar());
    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(scan).toHaveBeenCalledWith({ force: false });
    await act(async () => hook.current.refresh());
    expect(scan).toHaveBeenLastCalledWith({ force: true });
  });
  it('filters candidates without recalculating', async () => {
    const { result: hook } = renderHook(() => usePreMoveRadar());
    await waitFor(() => expect(hook.current.loading).toBe(false));
    act(() => hook.current.setFilter('watchlist'));
    expect(hook.current.visiblePredictions).toHaveLength(1);
    expect(scan).toHaveBeenCalledTimes(1);
  });
});