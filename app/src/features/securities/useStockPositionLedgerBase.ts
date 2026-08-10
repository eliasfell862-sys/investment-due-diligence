import { useCallback, useEffect, useState } from 'react';
import { useOptionalAuth } from '../auth/AuthProvider';
import { createCloudSecuritiesRepository } from './cloud/cloud-securities-repository';
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

/**
 * 持仓账本 hook —— 登录感知双模式：
 * - 已登录（云模式）→ 从云端 loadPositionLedger 读持仓
 * - 未登录 → 读本地 localStorage（sec_stock_position_ledger_v1）
 */
export function useStockPositionLedger() {
  const auth = useOptionalAuth();
  const cloudMode = Boolean(auth?.cloudEnabled && auth.user);
  const [ledger, setLedger] = useState<StockPositionLedger>(EMPTY_LEDGER);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (cloudMode) {
      try {
        setLedger(await createCloudSecuritiesRepository().loadPositionLedger());
        setError('');
      } catch (loadError) {
        setLedger(EMPTY_LEDGER);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } else {
      try {
        setLedger(loadStockLedger());
        setError('');
      } catch (loadError) {
        setLedger(EMPTY_LEDGER);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    }
  }, [cloudMode]);

  useEffect(() => {
    void reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key === STOCK_POSITION_LEDGER_KEY && !cloudMode) void reload();
    };
    window.addEventListener(STOCK_POSITION_LEDGER_CHANGED_EVENT, () => { if (!cloudMode) void reload(); });
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', () => void reload());
    return () => {
      window.removeEventListener(STOCK_POSITION_LEDGER_CHANGED_EVENT, () => { if (!cloudMode) void reload(); });
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', () => void reload());
    };
  }, [reload, cloudMode]);

  return { ledger, error, reload };
}
