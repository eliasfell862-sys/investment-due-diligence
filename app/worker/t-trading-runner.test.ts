import { describe, expect, it, vi } from 'vitest';
import { runTTradingScan } from './t-trading-runner';

describe('worker T-trading runner', () => {
  it('scans all actual positions but ignores watchlist-only stocks', async () => {
    const assignment = {
      userId: 'user-a', watchlistCodes: ['000001'],
      actualPositionCodes: ['600001', '600002'], virtualPositionCodes: [],
      actualPositions: [
        { id: 'p1', code: '600001', name: 'A', shares: 1000, availableShares: 1000, averageCost: 10, openedAt: '' },
        { id: 'p2', code: '600002', name: 'B', shares: 1000, availableShares: 1000, averageCost: 10, openedAt: '' },
      ],
      virtualPositions: [], strategies: [], feeProfile: {}, openTTradeCycles: [],
    };
    const commitTTradeSignal = vi.fn().mockResolvedValue('alert-1');
    const fetchQuotes = vi.fn().mockResolvedValue({
      quotes: {
        '600001': { code: '600001', price: 12 },
        '600002': { code: '600002', price: 12 },
      },
      failures: {},
      quoteAt: '2026-08-11T02:00:00Z',
    });
    const evaluate = vi.fn()
      .mockResolvedValueOnce({ signalKind: 'actual_t_sell', payload: { code: '600001' } })
      .mockRejectedValueOnce(new Error('history failed'));

    const summary = await runTTradingScan({
      repository: {
        loadMonitoringAssignments: vi.fn().mockResolvedValue([assignment]),
        commitTTradeSignal,
        expireTTradeCycles: vi.fn(),
      } as never,
      marketData: { fetchQuotes } as never,
      evaluate,
    });

    expect(fetchQuotes).toHaveBeenCalledWith(['600001', '600002']);
    expect(commitTTradeSignal).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ candidateCount: 2, successCount: 1, failureCount: 1 });
  });

  it('scans every open virtual position even when it is absent from watchlists', async () => {
    const assignment = {
      userId: 'user-a', watchlistCodes: [],
      actualPositionCodes: [], virtualPositionCodes: ['000001', '000002'],
      actualPositions: [],
      virtualPositions: [
        { id: 'v1', code: '000001', name: 'A', shares: 100, availableShares: 100, averageCost: 10, openedAt: '' },
        { id: 'v2', code: '000002', name: 'B', shares: 100, availableShares: 100, averageCost: 20, openedAt: '' },
      ],
      strategies: [], feeProfile: {}, openTTradeCycles: [],
    };
    const fetchQuotes = vi.fn().mockResolvedValue({
      quotes: {
        '000001': { code: '000001', price: 11 },
        '000002': { code: '000002', price: 21 },
      },
      failures: {}, quoteAt: '2026-08-11T02:00:00Z',
    });
    const evaluate = vi.fn().mockResolvedValue(null);

    const summary = await runTTradingScan({
      repository: {
        loadMonitoringAssignments: vi.fn().mockResolvedValue([assignment]),
        commitTTradeSignal: vi.fn(), expireTTradeCycles: vi.fn(),
      } as never,
      marketData: { fetchQuotes } as never,
      evaluate,
    });

    expect(fetchQuotes).toHaveBeenCalledWith(['000001', '000002']);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(summary.candidateCount).toBe(2);
  });

  it('deduplicates quotes but evaluates actual and virtual positions separately', async () => {
    const position = { code: '000001', name: 'A', shares: 100, availableShares: 100, averageCost: 10, openedAt: '' };
    const assignment = {
      userId: 'user-a', watchlistCodes: [],
      actualPositionCodes: ['000001'], virtualPositionCodes: ['000001'],
      actualPositions: [{ ...position, id: 'p1' }],
      virtualPositions: [{ ...position, id: 'v1' }],
      strategies: [], feeProfile: {}, openTTradeCycles: [],
    };
    const fetchQuotes = vi.fn().mockResolvedValue({
      quotes: { '000001': { code: '000001', price: 11 } },
      failures: {}, quoteAt: '2026-08-11T02:00:00Z',
    });
    const evaluate = vi.fn().mockResolvedValue(null);

    await runTTradingScan({
      repository: {
        loadMonitoringAssignments: vi.fn().mockResolvedValue([assignment]),
        commitTTradeSignal: vi.fn(), expireTTradeCycles: vi.fn(),
      } as never,
      marketData: { fetchQuotes } as never,
      evaluate,
    });

    expect(fetchQuotes).toHaveBeenCalledWith(['000001']);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });
});
