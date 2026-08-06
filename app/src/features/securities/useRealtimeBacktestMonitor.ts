import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StockMarketSessionStatus } from '../../infrastructure/market-data/stock-market-session';
import {
  SignalRuntimeCorruptionError,
  clearSignalAlerts,
  createEmptySignalRuntime,
  loadSignalRuntime,
  markSignalAlertExecuted,
  markSignalAlertRead,
  saveSignalRuntime,
  type BacktestSignalAlertV3,
  type BacktestSignalRuntimeState,
  type SignalAlertStatus,
} from './backtest-signal-inbox-store';
import { applySignalDecisionEvent } from './backtest-signal-trading-runtime';
import { createRealtimeBacktestMonitor } from './realtime-backtest-monitor';
import { calculateStockPositionAvailability } from './stock-position-availability';
import { loadMonitoringUniverse, type MonitoringUniverse } from './stock-monitoring-universe';
import { calculateVirtualAvailability, type VirtualTradingLedger } from './virtual-trading-ledger';
import { useStockPositionLedger } from './useStockPositionLedger';
import { useRealtimeStockQuotes } from './useRealtimeStockQuotes';
import { useActiveTechnicalStrategy } from './strategy-learning/useActiveTechnicalStrategy';

const UNIVERSE_CHECK_INTERVAL_MS = 3_000;

export interface UseRealtimeBacktestMonitorResult {
  alerts: BacktestSignalAlertV3[];
  runtime: BacktestSignalRuntimeState;
  virtualLedger: VirtualTradingLedger;
  prices: Record<string, number>;
  unreadCount: number;
  checking: boolean;
  partialFailureCount: number;
  monitoringCount: number;
  watchlistCount: number;
  heldCount: number;
  successfulCount: number;
  lastScanAt: string | null;
  marketStatus: StockMarketSessionStatus;
  lastUpdatedAt: string | null;
  error: string;
  refreshNow(): Promise<void>;
  markRead(alertId: string): void;
  markExecuted(
    alertId: string,
    status: Extract<SignalAlertStatus, 'bought' | 'sold'>,
    positionRemaining: boolean,
  ): void;
  clearAlerts(): void;
  reloadLedger(): void;
}

interface InitialRuntime {
  runtime: BacktestSignalRuntimeState;
  error: string;
  blocked: boolean;
}

function loadInitialRuntime(): InitialRuntime {
  try {
    return { runtime: loadSignalRuntime(), error: '', blocked: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      runtime: createEmptySignalRuntime(),
      error: message,
      blocked: error instanceof SignalRuntimeCorruptionError,
    };
  }
}

function loadUniverseSafely(): MonitoringUniverse {
  try {
    return loadMonitoringUniverse();
  } catch {
    return { buyCodes: [], heldCodes: [], allCodes: [] };
  }
}

function normalizeCodes(codes: string[]): string[] {
  return [...new Set(codes.map(code => code.trim()).filter(Boolean))].sort();
}

function universeSignature(universe: MonitoringUniverse): string {
  return universe.buyCodes.join(',') + '|' + universe.heldCodes.join(',');
}

function shanghaiTradingDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function useRealtimeBacktestMonitor(): UseRealtimeBacktestMonitorResult {
  const activeStrategy = useActiveTechnicalStrategy();
  const monitorRef = useRef<ReturnType<typeof createRealtimeBacktestMonitor> | null>(null);
  if (!monitorRef.current) monitorRef.current = createRealtimeBacktestMonitor({}, activeStrategy.config);

  const initialRef = useRef<InitialRuntime | null>(null);
  if (!initialRef.current) initialRef.current = loadInitialRuntime();
  const initial = initialRef.current;

  const [universe, setUniverse] = useState<MonitoringUniverse>(loadUniverseSafely);
  const { ledger, reload: reloadPositionLedger } = useStockPositionLedger();
  const [runtime, setRuntime] = useState<BacktestSignalRuntimeState>(initial.runtime);
  const runtimeRef = useRef(runtime);
  const processedSnapshotRef = useRef('');
  const [readyKey, setReadyKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [partialFailureCount, setPartialFailureCount] = useState(0);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [monitorError, setMonitorError] = useState(initial.error);
  useEffect(() => {
    if (typeof monitorRef.current?.setStrategyConfig === 'function') {
      monitorRef.current.setStrategyConfig(activeStrategy.config);
    }
    processedSnapshotRef.current = '';
    if (activeStrategy.error) setMonitorError(activeStrategy.error);
  }, [activeStrategy.config, activeStrategy.error]);

  const effectiveCodesKey = normalizeCodes([
    ...universe.allCodes,
    ...runtime.virtualLedger.positions.map(position => position.code),
  ]).join(',');
  const effectiveCodes = useMemo(
    () => effectiveCodesKey ? effectiveCodesKey.split(',') : [],
    [effectiveCodesKey],
  );
  const realtime = useRealtimeStockQuotes(effectiveCodes);
  const buyCodesKey = universe.buyCodes.join(',');

  const actualPositionsResult = useMemo(() => {
    let error = '';
    const positions = ledger.positions.map(position => {
      let availableShares = 0;
      try {
        availableShares = calculateStockPositionAvailability(
          ledger,
          position.code,
          realtime.lastUpdatedAt ?? new Date(),
        ).availableShares;
      } catch (availabilityError) {
        error = availabilityError instanceof Error
          ? availabilityError.message
          : String(availabilityError);
      }
      return {
        code: position.code,
        shares: position.shares,
        availableShares,
        averageCost: position.averageCost,
        openedAt: position.openedAt,
      };
    });
    return { positions, error };
  }, [ledger, realtime.lastUpdatedAt]);

  const virtualPositionsResult = useMemo(() => {
    let error = '';
    const positions = runtime.virtualLedger.positions.map(position => {
      let availableShares = 0;
      try {
        availableShares = calculateVirtualAvailability(
          runtime.virtualLedger,
          position.code,
          position.strategyId,
          realtime.lastUpdatedAt ?? new Date(),
        ).availableShares;
      } catch (availabilityError) {
        error = availabilityError instanceof Error
          ? availabilityError.message
          : String(availabilityError);
      }
      return {
        code: position.code,
        shares: position.shares,
        availableShares,
        averageCost: position.averageCost,
        openedAt: position.openedAt,
      };
    });
    return { positions, error };
  }, [runtime.virtualLedger, realtime.lastUpdatedAt]);

  const actualPositionKey = actualPositionsResult.positions
    .map(position => [
      position.code,
      position.shares,
      position.availableShares,
      position.averageCost,
      position.openedAt,
    ].join(':'))
    .sort()
    .join(',');
  const virtualPositionKey = virtualPositionsResult.positions
    .map(position => [
      position.code,
      position.shares,
      position.availableShares,
      position.averageCost,
      position.openedAt,
    ].join(':'))
    .sort()
    .join(',');

  const commitRuntime = useCallback((next: BacktestSignalRuntimeState): boolean => {
    try {
      saveSignalRuntime(next);
      runtimeRef.current = next;
      setRuntime(next);
      return true;
    } catch (error) {
      setMonitorError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setReadyKey('');
    monitorRef.current?.syncUniverse(effectiveCodes)
      .then(() => {
        if (!cancelled) setReadyKey(effectiveCodesKey);
      })
      .catch(error => {
        if (!cancelled) setMonitorError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => { cancelled = true; };
  }, [effectiveCodes, effectiveCodesKey]);

  useEffect(() => {
    const timer = setInterval(() => {
      const nextUniverse = loadUniverseSafely();
      setUniverse(current => universeSignature(current) === universeSignature(nextUniverse)
        ? current
        : nextUniverse);
    }, UNIVERSE_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      initial.blocked
      || realtime.marketStatus !== 'trading'
      || readyKey !== effectiveCodesKey
      || !realtime.lastUpdatedAt
    ) return;
    const snapshotKey = [realtime.lastUpdatedAt, effectiveCodesKey].join('|');
    if (processedSnapshotRef.current === snapshotKey) return;
    processedSnapshotRef.current = snapshotKey;
    let cancelled = false;
    setChecking(true);
    const availabilityError = actualPositionsResult.error || virtualPositionsResult.error;
    if (availabilityError) setMonitorError(availabilityError);
    monitorRef.current?.processSnapshot({
      quotes: realtime.quotes,
      buyCodes: universe.buyCodes,
      virtualPositions: virtualPositionsResult.positions,
      actualPositions: actualPositionsResult.positions,
      tradingDate: shanghaiTradingDate(new Date(realtime.lastUpdatedAt)),
      signalAt: realtime.lastUpdatedAt,
    }).then(result => {
      if (cancelled) return;
      setPartialFailureCount(result.partialFailureCount);
      setLastScanAt(realtime.lastUpdatedAt);
      if (result.events.length === 0) return;
      let next = runtimeRef.current;
      for (const event of result.events) {
        next = applySignalDecisionEvent(next, event).state;
      }
      commitRuntime(next);
    }).catch(error => {
      if (!cancelled) setMonitorError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setChecking(false);
    });
    return () => { cancelled = true; };
  }, [
    realtime.lastUpdatedAt,
    realtime.marketStatus,
    realtime.quotes,
    readyKey,
    effectiveCodesKey,
    buyCodesKey,
    universe.buyCodes,
    actualPositionKey,
    virtualPositionKey,
    actualPositionsResult.positions,
    actualPositionsResult.error,
    virtualPositionsResult.positions,
    virtualPositionsResult.error,
    commitRuntime,
    initial.blocked,
  ]);

  useEffect(() => () => monitorRef.current?.dispose(), []);

  const refreshNow = useCallback(async () => {
    setChecking(true);
    setMonitorError(initial.error);
    try {
      await monitorRef.current?.reload(effectiveCodes);
      await realtime.refreshNow();
    } catch (error) {
      setMonitorError(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }, [effectiveCodes, realtime, initial.error]);

  const markRead = useCallback((alertId: string) => {
    commitRuntime(markSignalAlertRead(runtimeRef.current, alertId, new Date().toISOString()));
  }, [commitRuntime]);

  const markExecuted = useCallback((
    alertId: string,
    status: Extract<SignalAlertStatus, 'bought' | 'sold'>,
    positionRemaining: boolean,
  ) => {
    commitRuntime(markSignalAlertExecuted(runtimeRef.current, alertId, status, {
      positionRemaining,
      executedAt: new Date().toISOString(),
    }));
  }, [commitRuntime]);

  const clearAlerts = useCallback(() => {
    commitRuntime(clearSignalAlerts(runtimeRef.current));
  }, [commitRuntime]);

  const reloadLedger = useCallback(() => {
    reloadPositionLedger();
    setUniverse(loadUniverseSafely());
  }, [reloadPositionLedger]);

  const alerts = [...runtime.alerts].reverse();
  const prices = Object.fromEntries(Object.entries(realtime.quotes)
    .filter(([, quote]) => Number.isFinite(quote.price) && quote.price > 0)
    .map(([code, quote]) => [code, quote.price]));

  return {
    alerts,
    runtime,
    virtualLedger: runtime.virtualLedger,
    prices,
    unreadCount: alerts.filter(alert => !alert.readAt).length,
    checking,
    partialFailureCount,
    monitoringCount: effectiveCodes.length,
    watchlistCount: universe.buyCodes.length,
    heldCount: universe.heldCodes.length,
    successfulCount: Math.max(0, effectiveCodes.length - partialFailureCount),
    lastScanAt,
    marketStatus: realtime.marketStatus,
    lastUpdatedAt: realtime.lastUpdatedAt,
    error: monitorError || realtime.error,
    refreshNow,
    markRead,
    markExecuted,
    clearAlerts,
    reloadLedger,
  };
}