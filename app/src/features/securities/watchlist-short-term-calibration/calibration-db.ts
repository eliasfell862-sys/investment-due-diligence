import Dexie, { type EntityTable } from 'dexie';
import type { CalibrationTrade, WatchlistShortTermCalibrationResult } from './types';

export interface CalibrationRunRecord {
  scopeId: string;
  runId: string;
  fingerprint: string;
  tradingDate: string;
  modelVersion: string;
  createdAt: string;
  result: WatchlistShortTermCalibrationResult;
}

export interface CalibrationTradeRecord extends CalibrationTrade {
  id: string;
  runId: string;
}

export interface CalibrationAttemptRecord {
  scopeId: string;
  tradingDate: string;
  attemptedAt: string;
}

export class WatchlistShortTermCalibrationDb extends Dexie {
  runs!: EntityTable<CalibrationRunRecord, 'scopeId'>;
  trades!: EntityTable<CalibrationTradeRecord, 'id'>;
  attempts!: EntityTable<CalibrationAttemptRecord, 'scopeId'>;

  constructor(name = 'watchlist-short-term-calibration') {
    super(name);
    this.version(1).stores({
      runs: '&scopeId, createdAt, tradingDate, modelVersion',
      trades: 'id, runId, code, signalDate, exitDate',
      attempts: '&scopeId, tradingDate, attemptedAt',
    });
  }
}

export const watchlistShortTermCalibrationDb = new WatchlistShortTermCalibrationDb();
