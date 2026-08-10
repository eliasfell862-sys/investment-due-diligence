import { describe, expect, it, vi } from 'vitest';
import { emptySignalCycleState } from '../src/engines/market-analysis/signal-cycle-state';
import { runScan } from './scan-runner';

describe('runScan', () => {
  it('scans the full universe, continues after quote failures, and commits only new edges', async () => {
    const watchlistCodes = Array.from({ length: 36 }, (_, index) => String(index + 1).padStart(6, '0'));
    const committed: unknown[] = [];
    const repository = {
      loadMonitoringAssignments: async () => [{
        userId: 'user-a', watchlistCodes, actualPositionCodes: ['600519'], virtualPositionCodes: ['300750'],
        actualPositions: [], virtualPositions: [], strategies: [],
      }],
      loadSignalState: vi.fn(async (_userId: string, code: string) => code === '000002'
        ? { ...emptySignalCycleState(code, 'realtime-technical', '1'), buyDirection: 'buy' as const, buyCycleId: 'existing' }
        : emptySignalCycleState(code, 'realtime-technical', '1')),
      commitSignal: vi.fn(async payload => { committed.push(payload); return 'alert-1'; }),
      recordScan: vi.fn(async summary => summary),
    };
    const quotes = Object.fromEntries([...watchlistCodes, '600519'].map(code => [code, {
      code, name: code, market: code.startsWith('6') ? 'sh' : 'sz', price: 10,
      change: 0, changePct: 0, open: 10, high: 10, low: 10, volume: 1, amount: 1,
      preClose: 10, turnover: 0, pe: 0, pb: 0, totalShares: 0, floatShares: 0, totalCap: 0, floatCap: 0,
    }]));

    const summary = await runScan({
      repository,
      marketData: { fetchQuotes: async () => ({ quotes, failures: { '300750': 'timeout' }, quoteAt: '2026-08-07T01:30:00.000Z' }) },
      evaluate: async ({ code }) => code === '000001' || code === '000002' ? [{
        code, name: code, price: 10, action: 'buy' as const, intent: 'open' as const,
        suggestedShares: 100, positionSharesAtSignal: 0, availableSharesAtSignal: 0,
        reasons: ['test'], metrics: {}, entryPrice: 10, stopLoss: 9,
        strategyId: 'realtime-technical', strategyVersion: '1', signalAt: '2026-08-07T01:30:00.000Z',
      }] : [],
      now: () => new Date('2026-08-07T01:30:00.000Z'),
    });

    expect(summary.uniqueCodes).toBe(38);
    expect(summary.successCount).toBe(37);
    expect(summary.failureCount).toBe(1);
    expect(summary.openedSignals).toBe(1);
    expect(committed).toHaveLength(1);
    expect(repository.recordScan).toHaveBeenCalledOnce();
  });
});
