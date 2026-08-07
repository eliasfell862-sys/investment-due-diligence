import { useCallback, useEffect, useState } from 'react';
import {
  STOCK_POSITION_LEDGER_CHANGED_EVENT,
  STOCK_POSITION_LEDGER_KEY,
  loadStockLedger,
  type StockPositionLedger,
} from './stock-position-ledger';

const EMPTY_LEDGER: StockPositionLedger = {
  version: 1,
  groups: [],
  positions: [],
  transactions: [],
};

export function useStockPositionLedger() {
  const [ledger, setLedger] = useState<StockPositionLedger>(EMPTY_LEDGER);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    try {
      setLedger(loadStockLedger());
      setError('');
    } catch (loadError) {
      setLedger(EMPTY_LEDGER);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key === STOCK_POSITION_LEDGER_KEY) reload();
    };
    window.addEventListener(STOCK_POSITION_LEDGER_CHANGED_EVENT, reload);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', reload);
    return () => {
      window.removeEventListener(STOCK_POSITION_LEDGER_CHANGED_EVENT, reload);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', reload);
    };
  }, [reload]);

  return { ledger, error, reload };
}
