import { useCallback, useEffect, useState } from 'react';
import { useOptionalAuth } from '../auth/AuthProvider';
import { createCloudSecuritiesRepository } from './cloud/cloud-securities-repository';
import { readCachedPositionLedger, writeCachedPositionLedger } from './securities-account-cache';
import {
  STOCK_POSITION_LEDGER_CHANGED_EVENT,
  STOCK_POSITION_LEDGER_KEY,
  buyStockPosition,
  loadStockLedger,
  sellStockPosition,
  updateStockPositionGroup,
  type BuyStockPositionInput,
  type SellStockPositionInput,
  type StockPositionLedger,
  type UpdateStockPositionGroupInput,
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
export function useStockPositionLedgerBase(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const auth = useOptionalAuth();
  const cloudMode = Boolean(auth?.cloudEnabled && auth.user);
  const cloudUserId = cloudMode ? auth?.user?.id ?? '' : '';
  const [ledger, setLedger] = useState<StockPositionLedger>(EMPTY_LEDGER);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!enabled) return;
    if (cloudMode) {
      const cached = readCachedPositionLedger(cloudUserId);
      if (cached) setLedger(cached);
      try {
        const next = await createCloudSecuritiesRepository().loadPositionLedger();
        setLedger(next);
        writeCachedPositionLedger(cloudUserId, next);
        setError('');
      } catch (loadError) {
        if (!cached) setLedger(EMPTY_LEDGER);
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
  }, [cloudMode, cloudUserId, enabled]);

  const buy = useCallback(async (input: BuyStockPositionInput) => {
    if (cloudMode) {
      await createCloudSecuritiesRepository().executeManualBuy({
        operationId: input.sourceAlertId,
        code: input.code,
        name: input.name,
        shares: input.shares,
        price: input.price,
        groupId: input.groupId,
        groupName: input.groupName,
        tradedAt: input.tradedAt,
      });
    } else {
      buyStockPosition(input);
    }
    await reload();
  }, [cloudMode, reload]);

  const sell = useCallback(async (input: SellStockPositionInput) => {
    if (cloudMode) {
      await createCloudSecuritiesRepository().executeManualSell({
        operationId: input.sourceAlertId,
        code: input.code,
        shares: input.shares,
        price: input.price,
        tradedAt: input.tradedAt,
      });
    } else {
      sellStockPosition(input);
    }
    await reload();
  }, [cloudMode, reload]);

  const moveGroup = useCallback(async (input: UpdateStockPositionGroupInput) => {
    if (cloudMode) {
      await createCloudSecuritiesRepository().movePositionGroup(input);
    } else {
      updateStockPositionGroup(input);
    }
    await reload();
  }, [cloudMode, reload]);

  useEffect(() => {
    if (!enabled) return undefined;
    void reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key === STOCK_POSITION_LEDGER_KEY && !cloudMode) void reload();
    };
    const onLedgerChanged = () => { if (!cloudMode) void reload(); };
    const onFocus = () => { void reload(); };
    window.addEventListener(STOCK_POSITION_LEDGER_CHANGED_EVENT, onLedgerChanged);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener(STOCK_POSITION_LEDGER_CHANGED_EVENT, onLedgerChanged);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload, cloudMode, enabled]);

  return { ledger, error, reload, buy, sell, moveGroup };
}
