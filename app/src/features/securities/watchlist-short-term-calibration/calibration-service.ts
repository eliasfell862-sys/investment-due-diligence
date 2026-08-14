import {
  fetchWatchlistCalibrationHistory,
  type CalibrationHistoryResult,
} from '../../../infrastructure/market-data/watchlist-calibration-history';
import type { TradingFeeProfile } from '../t-trading/t-trading-types';
import { aggregateCalibrationResult } from './aggregate';
import { watchlistShortTermCalibrationDb } from './calibration-db';
import {
  WatchlistShortTermCalibrationRepository,
  calibrationFingerprint,
} from './calibration-repository';
import { generateRollingCalibrationSignals } from './rolling-signals';
import {
  replayCalibrationSignal,
  type ReplayCalibrationSignalInput,
} from './trade-replay';
import {
  WATCHLIST_SHORT_TERM_CALIBRATION_MODEL,
  type CalibrationReplayResult,
  type CalibrationSignal,
  type CalibrationSkippedStock,
  type CalibrationTrade,
  type CalibrationUnfilledSignal,
  type CalibrationValidStock,
  type WatchlistShortTermCalibrationResult,
} from './types';

export class FutureDataLeakageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FutureDataLeakageError';
  }
}

export interface CalibrationServiceDependencies {
  fetchHistory: (code: string, days: number) => Promise<CalibrationHistoryResult>;
  generateSignals: (code: string, rows: CalibrationHistoryResult['rows']) => CalibrationSignal[];
  replaySignal: (input: ReplayCalibrationSignalInput) => CalibrationReplayResult;
  saveRun: (input: {
    scopeId: string;
    fingerprint: string;
    tradingDate: string;
    result: WatchlistShortTermCalibrationResult;
  }) => Promise<void>;
  now: () => Date;
}

export interface RunCalibrationInput {
  scopeId: string;
  codes: string[];
  feeProfile: TradingFeeProfile;
  force: boolean;
  tradingDate: string;
  onProgress?: (progress: { completed: number; total: number; currentCode: string }) => void;
}

interface StockCalibrationOutcome {
  validStock?: CalibrationValidStock;
  skippedStock?: CalibrationSkippedStock;
  trades: CalibrationTrade[];
  unfilled: CalibrationUnfilledSignal[];
  dataAsOf: string;
  leakageBlocked: boolean;
}

function defaultDependencies(): CalibrationServiceDependencies {
  const repository = new WatchlistShortTermCalibrationRepository(watchlistShortTermCalibrationDb);
  return {
    fetchHistory: fetchWatchlistCalibrationHistory,
    generateSignals: generateRollingCalibrationSignals,
    replaySignal: replayCalibrationSignal,
    saveRun: input => repository.saveRun(input),
    now: () => new Date(),
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index]);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => run(),
  ));
  return results;
}

async function calibrateStock(
  code: string,
  feeProfile: TradingFeeProfile,
  dependencies: CalibrationServiceDependencies,
): Promise<StockCalibrationOutcome> {
  try {
    const history = await dependencies.fetchHistory(code, 500);
    if (history.rows.length < 120) {
      return {
        skippedStock: { code, reason: '历史样本不足（' + history.rows.length + '个交易日）' },
        trades: [], unfilled: [], dataAsOf: '', leakageBlocked: false,
      };
    }
    const indexByDate = new Map(history.rows.map((row, index) => [row.date, index]));
    const signals = dependencies.generateSignals(code, history.rows);
    const trades: CalibrationTrade[] = [];
    const unfilled: CalibrationUnfilledSignal[] = [];
    for (const calibrationSignal of signals) {
      const signalIndex = indexByDate.get(calibrationSignal.signalDate);
      if (signalIndex === undefined) {
        throw new FutureDataLeakageError('信号日期不在可见历史窗口内');
      }
      const replay = dependencies.replaySignal({
        signal: calibrationSignal,
        futureRows: history.rows.slice(signalIndex + 1),
        feeProfile,
      });
      if (replay.kind === 'trade') trades.push(replay);
      if (replay.kind === 'unfilled') unfilled.push(replay);
    }
    return {
      validStock: { code, turnoverMode: history.turnoverMode },
      trades,
      unfilled,
      dataAsOf: history.rows.at(-1)?.date ?? '',
      leakageBlocked: false,
    };
  } catch (error) {
    const leakageBlocked = error instanceof FutureDataLeakageError;
    return {
      skippedStock: {
        code,
        reason: error instanceof Error ? error.message : String(error),
      },
      trades: [], unfilled: [], dataAsOf: '', leakageBlocked,
    };
  }
}

export async function runWatchlistShortTermCalibration(
  input: RunCalibrationInput,
  overrides?: CalibrationServiceDependencies,
): Promise<WatchlistShortTermCalibrationResult> {
  const dependencies = overrides ?? defaultDependencies();
  const codes = [...new Set(
    input.codes.map(code => code.trim()).filter(code => /^\d{6}$/.test(code)),
  )].sort();
  let completed = 0;
  const outcomes = await mapWithConcurrency(codes, 2, async code => {
    const outcome = await calibrateStock(code, input.feeProfile, dependencies);
    completed += 1;
    input.onProgress?.({ completed, total: codes.length, currentCode: code });
    return outcome;
  });

  const validStocks = outcomes.flatMap(outcome => outcome.validStock ? [outcome.validStock] : []);
  const skippedStocks = outcomes
    .flatMap(outcome => outcome.skippedStock ? [outcome.skippedStock] : [])
    .sort((left, right) => left.code.localeCompare(right.code));
  const trades = outcomes.flatMap(outcome => outcome.trades);
  const unfilled = outcomes.flatMap(outcome => outcome.unfilled);
  const dataAsOf = outcomes.map(outcome => outcome.dataAsOf).filter(Boolean).sort().at(-1) ?? '';
  const result = aggregateCalibrationResult({
    trades,
    unfilled,
    totalStocks: codes.length,
    validStocks,
    skippedStocks,
    dataAsOf,
    leakageBlocked: outcomes.some(outcome => outcome.leakageBlocked),
    createdAt: dependencies.now().toISOString(),
  });
  const fingerprint = calibrationFingerprint({
    codes,
    feeProfile: input.feeProfile,
    modelVersion: WATCHLIST_SHORT_TERM_CALIBRATION_MODEL,
  });
  try {
    await dependencies.saveRun({
      scopeId: input.scopeId,
      fingerprint,
      tradingDate: input.tradingDate,
      result,
    });
  } catch {
    result.persistenceWarning = '本次结果可查看，但无法持久保存到本机';
  }
  return result;
}

