import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StockMarketSessionStatus } from '../../infrastructure/market-data/stock-market-session';
import {
  applyBacktestDecision,
  clearSignalAlerts,
  loadSignalInbox,
  markSignalAlertExecuted,
  markSignalAlertRead,
  saveSignalInbox,
  type BacktestSignalAlert,
  type BacktestSignalInboxState,
  type SignalAlertStatus,
} from './backtest-signal-inbox-store';
import { createRealtimeBacktestMonitor } from './realtime-backtest-monitor';
import { calculateStockPositionAvailability } from './stock-position-availability';
import { loadMonitoringUniverse, type MonitoringUniverse } from './stock-monitoring-universe';
import { useStockPositionLedger } from './useStockPositionLedger';
import { useRealtimeStockQuotes } from './useRealtimeStockQuotes';

const UNIVERSE_CHECK_INTERVAL_MS = 3_000;

export interface UseRealtimeBacktestMonitorResult {
  alerts: BacktestSignalAlert[];
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

function loadUniverseSafely(): MonitoringUniverse {
  try {
    return loadMonitoringUniverse();
  } catch {
    return { buyCodes: [], heldCodes: [], allCodes: [] };
  }
}

function universeSignature(universe: MonitoringUniverse): string {
  return `${universe.buyCodes.join(',')}|${universe.heldCodes.join(',')}`;
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
  const monitorRef = useRef<ReturnType<typeof createRealtimeBacktestMonitor> | null>(null);
  if (!monitorRef.current) monitorRef.current = createRealtimeBacktestMonitor();

  const [universe, setUniverse] = useState<MonitoringUniverse>(loadUniverseSafely);
  const { ledger, reload: reloadPositionLedger } = useStockPositionLedger();
  const [inbox, setInbox] = useState(loadSignalInbox);
  const inboxRef = useRef(inbox);
  const [readyKey, setReadyKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [partialFailureCount, setPartialFailureCount] = useState(0);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [monitorError, setMonitorError] = useState('');
  const realtime = useRealtimeStockQuotes(universe.allCodes);
  const allCodesKey = universe.allCodes.join(',');
  const buyCodesKey = universe.buyCodes.join(',');
  const monitorPositionsResult = useMemo(() => {
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
  const positionKey = monitorPositionsResult.positions
    .map(position => `${position.code}:${position.shares}:${position.availableShares}:${position.averageCost}:${position.openedAt}`)
    .sort()
    .join(',');

  const commitInbox = useCallback((next: BacktestSignalInboxState): boolean => {
    try {
      saveSignalInbox(next);
      inboxRef.current = next;
      setInbox(next);
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
    monitorRef.current?.syncUniverse(universe.allCodes)
      .then(() => {
        if (!cancelled) setReadyKey(allCodesKey);
      })
      .catch(error => {
        if (!cancelled) setMonitorError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => { cancelled = true; };
  }, [allCodesKey, universe.allCodes]);

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
    if (realtime.marketStatus !== 'trading' || readyKey !== allCodesKey || !realtime.lastUpdatedAt) return;
    let cancelled = false;
    setChecking(true);
    if (monitorPositionsResult.error) setMonitorError(monitorPositionsResult.error);
    monitorRef.current?.processSnapshot({
      quotes: realtime.quotes,
      buyCodes: universe.buyCodes,
      positions: monitorPositionsResult.positions,
      tradingDate: shanghaiTradingDate(new Date(realtime.lastUpdatedAt)),
      signalAt: realtime.lastUpdatedAt,
    }).then(result => {
      if (cancelled) return;
      setPartialFailureCount(result.partialFailureCount);
      setLastScanAt(realtime.lastUpdatedAt);
      if (result.events.length === 0) return;
      let next = inboxRef.current;
      for (const event of result.events) next = applyBacktestDecision(next, event).state;
      commitInbox(next);
    }).catch(error => {
      if (!cancelled) setMonitorError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setChecking(false);
    });
    return () => { cancelled = true; };
  }, [
    realtime.lastUpdatedAt, realtime.marketStatus, realtime.quotes, readyKey,
    allCodesKey, buyCodesKey, universe.buyCodes, positionKey, monitorPositionsResult, commitInbox,
  ]);

  useEffect(() => () => monitorRef.current?.dispose(), []);

  const refreshNow = useCallback(async () => {
    setChecking(true);
    setMonitorError('');
    try {
      await monitorRef.current?.reload(universe.allCodes);
      await realtime.refreshNow();
    } catch (error) {
      setMonitorError(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }, [universe.allCodes, realtime]);

  const markRead = useCallback((alertId: string) => {
    const next = markSignalAlertRead(inboxRef.current, alertId, new Date().toISOString());
    commitInbox(next);
  }, [commitInbox]);

  const markExecuted = useCallback((
    alertId: string,
    status: Extract<SignalAlertStatus, 'bought' | 'sold'>,
    positionRemaining: boolean,
  ) => {
    const next = markSignalAlertExecuted(inboxRef.current, alertId, status, {
      positionRemaining,
      executedAt: new Date().toISOString(),
    });
    commitInbox(next);
  }, [commitInbox]);

  const clearAlerts = useCallback(() => {
    commitInbox(clearSignalAlerts(inboxRef.current));
  }, [commitInbox]);

  const reloadLedger = useCallback(() => {
    reloadPositionLedger();
    setUniverse(loadUniverseSafely());
  }, [reloadPositionLedger]);

  const alerts = [...inbox.alerts].reverse();
  return {
    alerts,
    unreadCount: alerts.filter(alert => !alert.readAt).length,
    checking,
    partialFailureCount,
    monitoringCount: universe.allCodes.length,
    watchlistCount: universe.buyCodes.length,
    heldCount: universe.heldCodes.length,
    successfulCount: Math.max(0, universe.allCodes.length - partialFailureCount),
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
