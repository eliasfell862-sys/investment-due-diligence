import type { TradingFeeProfile } from '../t-trading/t-trading-types';
import type {
  CalibrationRunRecord,
  CalibrationTradeRecord,
  WatchlistShortTermCalibrationDb,
} from './calibration-db';
import type { CalibrationTrade, WatchlistShortTermCalibrationResult } from './types';

export interface SaveCalibrationRunInput {
  scopeId: string;
  fingerprint: string;
  tradingDate: string;
  result: WatchlistShortTermCalibrationResult;
}

export class WatchlistShortTermCalibrationRepository {
  readonly db: WatchlistShortTermCalibrationDb;

  constructor(db: WatchlistShortTermCalibrationDb) {
    this.db = db;
  }

  async saveRun(input: SaveCalibrationRunInput): Promise<void> {
    const runId = input.scopeId + ':' + input.fingerprint + ':' + input.result.createdAt;
    const recentTrades = [...input.result.trades]
      .sort((left, right) =>
        right.exitDate.localeCompare(left.exitDate) || right.signalDate.localeCompare(left.signalDate))
      .slice(0, 100);
    await this.db.transaction('rw', this.db.runs, this.db.trades, async () => {
      const previous = await this.db.runs.get(input.scopeId);
      if (previous) await this.db.trades.where('runId').equals(previous.runId).delete();
      const record: CalibrationRunRecord = {
        scopeId: input.scopeId,
        runId,
        fingerprint: input.fingerprint,
        tradingDate: input.tradingDate,
        modelVersion: input.result.modelVersion,
        createdAt: input.result.createdAt,
        result: { ...input.result, trades: [], unfilled: [] },
      };
      await this.db.runs.put(record);
      const records: CalibrationTradeRecord[] = recentTrades.map((trade, index) => ({
        ...trade,
        id: runId + ':' + index + ':' + trade.code + ':' + trade.signalDate,
        runId,
      }));
      if (records.length > 0) await this.db.trades.bulkPut(records);
    });
  }

  async loadLatest(scopeId: string): Promise<CalibrationRunRecord | null> {
    const record = await this.db.runs.get(scopeId);
    if (!record) return null;
    const rows = await this.db.trades.where('runId').equals(record.runId).toArray();
    const trades: CalibrationTrade[] = rows
      .sort((left, right) =>
        right.exitDate.localeCompare(left.exitDate) || right.signalDate.localeCompare(left.signalDate))
      .map(({ id: _id, runId: _runId, ...trade }) => trade);
    return {
      ...record,
      result: { ...record.result, trades, unfilled: [] },
    };
  }

  async recordAttempt(scopeId: string, tradingDate: string, attemptedAt: string): Promise<void> {
    await this.db.attempts.put({ scopeId, tradingDate, attemptedAt });
  }

  async hasAttempt(scopeId: string, tradingDate: string): Promise<boolean> {
    return (await this.db.attempts.get(scopeId))?.tradingDate === tradingDate;
  }
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function calibrationFingerprint(input: {
  codes: string[];
  feeProfile: TradingFeeProfile;
  modelVersion: string;
}): string {
  const profile = input.feeProfile;
  const normalized = {
    codes: [...new Set(input.codes)].sort(),
    feeProfile: {
      commissionRate: profile.commissionRate,
      minimumCommission: profile.minimumCommission,
      sellStampDutyRate: profile.sellStampDutyRate,
      transferFeeRate: profile.transferFeeRate,
      slippageMode: profile.slippageMode,
      fixedSlippageRate: profile.fixedSlippageRate,
      updatedAt: profile.updatedAt,
    },
    modelVersion: input.modelVersion,
  };
  return 'calibration-' + fnv1a(JSON.stringify(normalized));
}

export function isCalibrationStale(
  stored: { fingerprint: string; tradingDate: string; modelVersion: string },
  current: { fingerprint: string; tradingDate: string; modelVersion: string },
): boolean {
  return stored.fingerprint !== current.fingerprint
    || stored.tradingDate !== current.tradingDate
    || stored.modelVersion !== current.modelVersion;
}

