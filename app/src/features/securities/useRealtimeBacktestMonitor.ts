import { useCallback, useEffect, useRef, useState } from 'react';
import type { StockMarketSessionStatus } from '../../infrastructure/market-data/stock-market-session';
import {
  applyBacktestDecision,
  clearSignalAlerts,
  loadSignalInbox,
  markSignalAlertExecuted,
  markSignalAlertRead,
  saveSignalInbox,
  type BacktestSignalAlert,
  type SignalAlertStatus,
} from './backtest-signal-inbox-store';
import { createRealtimeBacktestMonitor } from './realtime-backtest-monitor';
import { loadMonitoringUniverse, type MonitoringUniverse } from './stock-monitoring-universe';
import { loadStockLedger, type StockPositionLedger } from './stock-position-ledger';
import { useRealtimeStockQuotes } from './useRealtimeStockQuotes';

const UNIVERSE_CHECK_INTERVAL_MS = 3_000;

export interface UseRealtimeBacktestMonitorResult {
  alerts: BacktestSignalAlert[];
  unreadCount: number;
  checking: boolean;
  partialFailureCount: number;
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

function loadLedgerSafely(): StockPositionLedger {
  try {
    return loadStockLedger();
  } catch {
    return { version: 1, groups: [], positions: [], transactions: [] };
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
  const [ledger, setLedger] = useState<StockPositionLedger>(loadLedgerSafely);
  const [inbox, setInbox] = useState(loadSignalInbox);
  const [readyKey, setReadyKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [partialFailureCount, setPartialFailureCount] = useState(0);
  const [monitorError, setMonitorError] = useState('');
  const realtime = useRealtimeStockQuotes(universe.allCodes);
  const allCodesKey = universe.allCodes.join(',');
  const buyCodesKey = universe.buyCodes.join(',');
  const positionKey = ledger.positions
    .map(position => `${position.code}:${position.averageCost}:${position.openedAt}`)
    .sort()
    .join(',');

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
    monitorRef.current?.processSnapshot({
      quotes: realtime.quotes,
      buyCodes: universe.buyCodes,
      positions: ledger.positions.map(position => ({
        code: position.code,
        averageCost: position.averageCost,
        openedAt: position.openedAt,
      })),
      tradingDate: shanghaiTradingDate(new Date(realtime.lastUpdatedAt)),
      signalAt: realtime.lastUpdatedAt,
    }).then(result => {
      if (cancelled) return;
      setPartialFailureCount(result.partialFailureCount);
      if (result.events.length === 0) return;
      setInbox(current => {
        let next = current;
        for (const event of result.events) next = applyBacktestDecision(next, event).state;
        saveSignalInbox(next);
        return next;
      });
    }).catch(error => {
      if (!cancelled) setMonitorError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setChecking(false);
    });
    return () => { cancelled = true; };
  }, [
    realtime.lastUpdatedAt, realtime.marketStatus, realtime.quotes, readyKey,
    allCodesKey, buyCodesKey, universe.buyCodes, positionKey, ledger.positions,
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
    setInbox(current => {
      const next = markSignalAlertRead(current, alertId, new Date().toISOString());
      saveSignalInbox(next);
      return next;
    });
  }, []);

  const markExecuted = useCallback((
    alertId: string,
    status: Extract<SignalAlertStatus, 'bought' | 'sold'>,
    positionRemaining: boolean,
  ) => {
    setInbox(current => {
      const next = markSignalAlertExecuted(current, alertId, status, {
        positionRemaining,
        executedAt: new Date().toISOString(),
      });
      saveSignalInbox(next);
      return next;
    });
  }, []);

  const clearAlerts = useCallback(() => {
    setInbox(current => {
      const next = clearSignalAlerts(current);
      saveSignalInbox(next);
      return next;
    });
  }, []);

  const reloadLedger = useCallback(() => {
    setLedger(loadLedgerSafely());
    setUniverse(loadUniverseSafely());
  }, []);

  const alerts = [...inbox.alerts].reverse();
  return {
    alerts,
    unreadCount: alerts.filter(alert => !alert.readAt).length,
    checking,
    partialFailureCount,
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
