import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TradingFeeProfile } from '../t-trading/t-trading-types';
import { watchlistShortTermCalibrationDb, type CalibrationRunRecord } from './calibration-db';
import {
  WatchlistShortTermCalibrationRepository,
  calibrationFingerprint,
  isCalibrationStale,
} from './calibration-repository';
import {
  runWatchlistShortTermCalibration,
  type RunCalibrationInput,
} from './calibration-service';
import {
  WATCHLIST_SHORT_TERM_CALIBRATION_MODEL,
  type WatchlistShortTermCalibrationResult,
} from './types';

export interface WatchlistShortTermCalibrationHookDependencies {
  loadLatest: (scopeId: string) => Promise<CalibrationRunRecord | null>;
  hasAttempt: (scopeId: string, tradingDate: string) => Promise<boolean>;
  recordAttempt: (scopeId: string, tradingDate: string, attemptedAt: string) => Promise<void>;
  runCalibration: (input: RunCalibrationInput) => Promise<WatchlistShortTermCalibrationResult>;
  tradingDate: () => string;
}

export interface CalibrationHookState {
  status: 'loading' | 'ready' | 'running' | 'error';
  result: WatchlistShortTermCalibrationResult | null;
  progress: { completed: number; total: number; currentCode: string } | null;
  error: string;
  stale: boolean;
  recalibrate: () => Promise<void>;
}

function shanghaiTradingDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return value.year + '-' + value.month + '-' + value.day;
}

const defaultRepository = new WatchlistShortTermCalibrationRepository(
  watchlistShortTermCalibrationDb,
);
const defaultDependencies: WatchlistShortTermCalibrationHookDependencies = {
  loadLatest: scopeId => defaultRepository.loadLatest(scopeId),
  hasAttempt: (scopeId, tradingDate) => defaultRepository.hasAttempt(scopeId, tradingDate),
  recordAttempt: (scopeId, tradingDate, attemptedAt) =>
    defaultRepository.recordAttempt(scopeId, tradingDate, attemptedAt),
  runCalibration: input => runWatchlistShortTermCalibration(input),
  tradingDate: shanghaiTradingDate,
};

export function useWatchlistShortTermCalibration(
  input: { scopeId: string; codes: string[]; feeProfile: TradingFeeProfile },
  dependencies: WatchlistShortTermCalibrationHookDependencies = defaultDependencies,
): CalibrationHookState {
  const codeKey = useMemo(
    () => [...new Set(input.codes.filter(code => /^\d{6}$/.test(code)))].sort().join(','),
    [input.codes],
  );
  const codes = useMemo(() => codeKey ? codeKey.split(',') : [], [codeKey]);
  const tradingDate = dependencies.tradingDate();
  const fingerprint = calibrationFingerprint({
    codes,
    feeProfile: input.feeProfile,
    modelVersion: WATCHLIST_SHORT_TERM_CALIBRATION_MODEL,
  });
  const [status, setStatus] = useState<CalibrationHookState['status']>('loading');
  const [result, setResult] = useState<WatchlistShortTermCalibrationResult | null>(null);
  const [progress, setProgress] = useState<CalibrationHookState['progress']>(null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const runIdRef = useRef(0);

  const runAndPublish = useCallback(async (force: boolean, publishId: number) => {
    setStatus('running');
    setProgress({ completed: 0, total: codes.length, currentCode: '' });
    setError('');
    try {
      const next = await dependencies.runCalibration({
        scopeId: input.scopeId,
        codes,
        feeProfile: input.feeProfile,
        force,
        tradingDate,
        onProgress: value => {
          if (runIdRef.current === publishId) setProgress(value);
        },
      });
      if (runIdRef.current !== publishId) return;
      setResult(next);
      setStale(false);
      setProgress(null);
      setStatus('ready');
    } catch (runError) {
      if (runIdRef.current !== publishId) return;
      setProgress(null);
      setError(runError instanceof Error ? runError.message : String(runError));
      setStatus('error');
    }
  }, [codes, dependencies, input.feeProfile, input.scopeId, tradingDate]);

  const recalibrate = useCallback(async () => {
    const publishId = ++runIdRef.current;
    try {
      await dependencies.recordAttempt(input.scopeId, tradingDate, new Date().toISOString());
    } catch {
      // The manual calculation can still run when the local attempt marker cannot persist.
    }
    await runAndPublish(true, publishId);
  }, [dependencies, input.scopeId, runAndPublish, tradingDate]);

  useEffect(() => {
    const publishId = ++runIdRef.current;
    let cancelled = false;
    setStatus('loading');
    setError('');
    void (async () => {
      try {
        const stored = await dependencies.loadLatest(input.scopeId);
        if (cancelled || runIdRef.current !== publishId) return;
        const isStale = !stored || isCalibrationStale(stored, {
          fingerprint,
          tradingDate,
          modelVersion: WATCHLIST_SHORT_TERM_CALIBRATION_MODEL,
        });
        setResult(stored?.result ?? null);
        setStale(isStale);
        setStatus('ready');
        if (!isStale || codes.length === 0) return;
        if (await dependencies.hasAttempt(input.scopeId, tradingDate)) return;
        await dependencies.recordAttempt(input.scopeId, tradingDate, new Date().toISOString());
        if (cancelled || runIdRef.current !== publishId) return;
        await runAndPublish(false, publishId);
      } catch (loadError) {
        if (cancelled || runIdRef.current !== publishId) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      if (runIdRef.current === publishId) runIdRef.current += 1;
    };
  }, [
    codes.length,
    dependencies,
    fingerprint,
    input.scopeId,
    runAndPublish,
    tradingDate,
  ]);

  return { status, result, progress, error, stale, recalibrate };
}

