import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRADING_FEE_PROFILE } from '../t-trading/trading-fee-engine';
import type { CalibrationHistoryResult } from '../../../infrastructure/market-data/watchlist-calibration-history';
import {
  FutureDataLeakageError,
  runWatchlistShortTermCalibration,
  type CalibrationServiceDependencies,
} from './calibration-service';
import type { CalibrationSignal, CalibrationTrade } from './types';

const fee = {
  commission: 0, stampDuty: 0, transferFee: 0, modeledSlippage: 0,
  total: 0, source: 'profile_calculated' as const,
};

function history(_code: string, count = 120, mode: 'direct' | 'proxy' = 'direct'): CalibrationHistoryResult {
  return {
    turnoverMode: mode, source: 'test', warnings: [],
    rows: Array.from({ length: count }, (_, index) => ({
      date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`,
      open: 10, close: 10, high: 11, low: 9, volume: 1000, amount: 10_000,
      amplitude: 10, changePct: 0, change: 0, turnover: mode === 'direct' ? 3 : 2,
    })),
  };
}

function signal(code: string, date: string): CalibrationSignal {
  return {
    code, signalDate: date, action: 'strong_buy', entryRange: { low: 9, high: 10 },
    stopLoss: 8, takeProfit1: 11, takeProfit2: 12, maxHoldingTradingDays: 3,
  };
}

function trade(code: string): CalibrationTrade {
  return {
    kind: 'trade', code, action: 'strong_buy', signalDate: '2026-03-05',
    entryDate: '2026-03-06', entryPrice: 10, exitDate: '2026-03-07', exitPrice: 11,
    shares: 100, exitReason: 'take_profit_1', secondTakeProfitReached: false,
    buyFees: fee, sellFees: fee, grossPnl: 100, netPnl: 100, netReturnPct: 10, won: true,
  };
}

function dependencies(overrides: Partial<CalibrationServiceDependencies> = {}): CalibrationServiceDependencies {
  return {
    fetchHistory: async code => history(code),
    generateSignals: (code, rows) => [signal(code, rows[60].date)],
    replaySignal: input => trade(input.signal.code),
    saveRun: vi.fn(async () => undefined),
    now: () => new Date('2026-08-14T12:00:00.000Z'),
    ...overrides,
  };
}

describe('runWatchlistShortTermCalibration', () => {
  it('deduplicates codes and never processes more than two stocks concurrently', async () => {
    let active = 0;
    let maximum = 0;
    const seen: string[] = [];
    const fetchHistory = vi.fn(async (code: string) => {
      seen.push(code); active += 1; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return history(code);
    });

    const result = await runWatchlistShortTermCalibration({
      scopeId: 'user-a', codes: ['600000', '000001', '600000', '300750'],
      feeProfile: DEFAULT_TRADING_FEE_PROFILE, force: false, tradingDate: '2026-08-14',
    }, dependencies({ fetchHistory }));

    expect(seen.sort()).toEqual(['000001', '300750', '600000']);
    expect(maximum).toBe(2);
    expect(result.validStockCount).toBe(3);
  });

  it('continues after one stock fails and skips histories shorter than 120 days', async () => {
    const result = await runWatchlistShortTermCalibration({
      scopeId: 'user-a', codes: ['000001', '300750', '600000'],
      feeProfile: DEFAULT_TRADING_FEE_PROFILE, force: false, tradingDate: '2026-08-14',
    }, dependencies({
      fetchHistory: async code => {
        if (code === '300750') throw new Error('provider down');
        return history(code, code === '600000' ? 119 : 120);
      },
    }));

    expect(result.validStockCount).toBe(1);
    expect(result.skippedStockCount).toBe(2);
    expect(result.coverageRate).toBe(33.33);
    expect(result.skippedStocks.map(item => item.reason)).toEqual([
      'provider down', '历史样本不足（119个交易日）',
    ]);
  });

  it('aggregates direct and proxy stocks, reports progress, and persists locally', async () => {
    const progress: string[] = [];
    const saveRun = vi.fn(async () => undefined);
    const result = await runWatchlistShortTermCalibration({
      scopeId: 'user-a', codes: ['000001', '600000'],
      feeProfile: DEFAULT_TRADING_FEE_PROFILE, force: true, tradingDate: '2026-08-14',
      onProgress: value => progress.push(`${value.completed}/${value.total}:${value.currentCode}`),
    }, dependencies({
      fetchHistory: async code => history(code, 120, code === '600000' ? 'proxy' : 'direct'),
      saveRun,
    }));

    expect(result.directStockCount).toBe(1);
    expect(result.proxyStockCount).toBe(1);
    expect(progress).toHaveLength(2);
    expect(saveRun).toHaveBeenCalledOnce();
  });

  it('keeps the in-memory result when IndexedDB persistence fails', async () => {
    const result = await runWatchlistShortTermCalibration({
      scopeId: 'user-a', codes: ['600000'], feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      force: true, tradingDate: '2026-08-14',
    }, dependencies({ saveRun: vi.fn(async () => { throw new Error('quota'); }) }));
    expect(result.validStockCount).toBe(1);
    expect(result.persistenceWarning).toBe('本次结果可查看，但无法持久保存到本机');
  });

  it('blocks the whole result when a leakage guard fails', async () => {
    const result = await runWatchlistShortTermCalibration({
      scopeId: 'user-a', codes: ['600000'], feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      force: false, tradingDate: '2026-08-14',
    }, dependencies({
      generateSignals: () => { throw new FutureDataLeakageError('future row observed'); },
    }));
    expect(result.trust).toBe('blocked');
  });
});
