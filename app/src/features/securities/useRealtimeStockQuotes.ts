import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  normalizeStockCodes,
  realtimeStockQuoteStore,
  type RealtimeQuoteSnapshot,
} from '../../infrastructure/market-data/realtime-stock-quotes';
import { getStockMarketSessionStatus } from '../../infrastructure/market-data/stock-market-session';

export interface UseRealtimeStockQuotesResult extends RealtimeQuoteSnapshot {
  refreshNow: () => Promise<void>;
}

function emptySnapshot(): RealtimeQuoteSnapshot {
  return {
    quotes: {},
    refreshing: false,
    marketStatus: getStockMarketSessionStatus(new Date()),
    lastUpdatedAt: null,
    stale: false,
    error: '',
  };
}

export function useRealtimeStockQuotes(codes: string[]): UseRealtimeStockQuotesResult {
  const inputKey = codes.join(',');
  const normalizedCodes = useMemo(() => normalizeStockCodes(codes), [inputKey]);
  const codeKey = normalizedCodes.join(',');
  const [snapshot, setSnapshot] = useState<RealtimeQuoteSnapshot>(emptySnapshot);

  useEffect(() => {
    if (!codeKey) {
      setSnapshot(emptySnapshot());
      return undefined;
    }
    return realtimeStockQuoteStore.subscribe(normalizedCodes, setSnapshot);
  }, [codeKey]);

  const refreshNow = useCallback(
    () => realtimeStockQuoteStore.refresh(normalizedCodes),
    [codeKey],
  );

  return { ...snapshot, refreshNow };
}
