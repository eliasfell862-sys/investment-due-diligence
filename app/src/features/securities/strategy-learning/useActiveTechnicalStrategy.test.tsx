import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { strategyLearningDb } from './strategy-learning-db';
import { useActiveTechnicalStrategy } from './useActiveTechnicalStrategy';

describe('useActiveTechnicalStrategy', () => {
  afterEach(async () => { await strategyLearningDb.strategyVersions.clear(); });

  it('loads an active stored version and reacts to the version-change event', async () => {
    const { result } = renderHook(() => useActiveTechnicalStrategy());
    expect(result.current.config.version).toBe('1');
    await strategyLearningDb.strategyVersions.put({
      id: 'realtime-technical-2', strategyId: 'realtime-technical', version: '2', status: 'active',
      config: { strategyId: 'realtime-technical', version: '2', buyScoreThreshold: 1,
        sellScoreThreshold: 1, weights: { macd: 1, kdj: 1, rsi: 1, boll: 1, ma20: 1 },
        kdjBuyThreshold: 20, kdjSellThreshold: 85, rsiBuyThreshold: 28,
        bollTolerancePct: 1, stopLossPct: 8, maxHoldingDays: 60 },
      createdAt: '2026-08-06T08:00:00.000Z',
    });
    window.dispatchEvent(new Event('sec-strategy-version-changed'));
    await waitFor(() => expect(result.current.config.version).toBe('2'));
  });
});
