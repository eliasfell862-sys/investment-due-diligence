import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TRADING_FEE_PROFILE } from '../t-trading/trading-fee-engine';
import { aggregateCalibrationResult } from './aggregate';
import { WatchlistShortTermCalibrationDb } from './calibration-db';
import {
  WatchlistShortTermCalibrationRepository,
  calibrationFingerprint,
  isCalibrationStale,
} from './calibration-repository';
import type { CalibrationTrade } from './types';

const fee = {
  commission: 0, stampDuty: 0, transferFee: 0, modeledSlippage: 0,
  total: 0, source: 'profile_calculated' as const,
};

function trade(index: number, createdAt = '2026-08-14'): CalibrationTrade {
  return {
    kind: 'trade', code: String(index).padStart(6, '0'), action: 'strong_buy',
    signalDate: '2026-01-01', entryDate: '2026-01-02', entryPrice: 10,
    exitDate: `${createdAt.slice(0, 8)}${String(index % 28 + 1).padStart(2, '0')}`,
    exitPrice: 11, shares: 100, exitReason: 'take_profit_1',
    secondTakeProfitReached: false, buyFees: fee, sellFees: fee,
    grossPnl: 100, netPnl: 100, netReturnPct: 10, won: true,
  };
}

function result(trades: CalibrationTrade[], createdAt = '2026-08-14T12:00:00.000Z') {
  return aggregateCalibrationResult({
    trades, unfilled: [], totalStocks: 1,
    validStocks: [{ code: '600000', turnoverMode: 'direct' }], skippedStocks: [],
    dataAsOf: '2026-08-14', leakageBlocked: false, createdAt,
  });
}

describe('WatchlistShortTermCalibrationRepository', () => {
  let db: WatchlistShortTermCalibrationDb;
  let repository: WatchlistShortTermCalibrationRepository;

  beforeEach(() => {
    db = new WatchlistShortTermCalibrationDb(`watchlist-calibration-${crypto.randomUUID()}`);
    repository = new WatchlistShortTermCalibrationRepository(db);
  });

  afterEach(async () => { await db.delete(); });

  it('isolates latest calibration runs by account scope', async () => {
    await repository.saveRun({
      scopeId: 'user-a', fingerprint: 'fp-a', tradingDate: '2026-08-14', result: result([trade(1)]),
    });
    await repository.saveRun({
      scopeId: 'user-b', fingerprint: 'fp-b', tradingDate: '2026-08-14', result: result([trade(2)]),
    });

    expect((await repository.loadLatest('user-a'))?.fingerprint).toBe('fp-a');
    expect((await repository.loadLatest('user-a'))?.result.trades[0]?.code).toBe('000001');
    expect((await repository.loadLatest('user-b'))?.result.trades[0]?.code).toBe('000002');
  });

  it('replaces the previous run transactionally and keeps only the latest 100 trades', async () => {
    await repository.saveRun({
      scopeId: 'user-a', fingerprint: 'old', tradingDate: '2026-08-13', result: result([trade(1)]),
    });
    await repository.saveRun({
      scopeId: 'user-a', fingerprint: 'new', tradingDate: '2026-08-14',
      result: result(Array.from({ length: 105 }, (_, index) => trade(index + 10))),
    });

    const stored = await repository.loadLatest('user-a');
    expect(stored?.fingerprint).toBe('new');
    expect(stored?.result.trades).toHaveLength(100);
    expect(await db.trades.count()).toBe(100);
    expect((await db.trades.toArray()).some(item => item.runId.includes('old'))).toBe(false);
  });

  it('records at most one automatic attempt marker per account and trading date', async () => {
    expect(await repository.hasAttempt('user-a', '2026-08-14')).toBe(false);
    await repository.recordAttempt('user-a', '2026-08-14', '2026-08-14T09:30:00.000Z');
    expect(await repository.hasAttempt('user-a', '2026-08-14')).toBe(true);
    expect(await repository.hasAttempt('user-b', '2026-08-14')).toBe(false);
  });

  it('builds deterministic fingerprints and detects every invalidating change', () => {
    const first = calibrationFingerprint({
      codes: ['600000', '000001'], feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      modelVersion: 'watchlist-short-term-v1',
    });
    const reordered = calibrationFingerprint({
      codes: ['000001', '600000', '600000'], feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      modelVersion: 'watchlist-short-term-v1',
    });
    const changedFee = calibrationFingerprint({
      codes: ['000001', '600000'],
      feeProfile: { ...DEFAULT_TRADING_FEE_PROFILE, commissionRate: 0.0002 },
      modelVersion: 'watchlist-short-term-v1',
    });
    expect(reordered).toBe(first);
    expect(changedFee).not.toBe(first);
    expect(isCalibrationStale({ fingerprint: first, tradingDate: '2026-08-14', modelVersion: 'watchlist-short-term-v1' }, {
      fingerprint: first, tradingDate: '2026-08-14', modelVersion: 'watchlist-short-term-v1',
    })).toBe(false);
    expect(isCalibrationStale({ fingerprint: first, tradingDate: '2026-08-14', modelVersion: 'watchlist-short-term-v1' }, {
      fingerprint: first, tradingDate: '2026-08-15', modelVersion: 'watchlist-short-term-v1',
    })).toBe(true);
  });
});
