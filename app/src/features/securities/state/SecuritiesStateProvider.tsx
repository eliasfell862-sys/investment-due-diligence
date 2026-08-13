import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useOptionalAuth } from '../../auth/AuthProvider';
import { createCloudSecuritiesRepository, type CloudWatchlist } from '../cloud/cloud-securities-repository';
import { readCachedPositionLedger, readCachedWatchlists, writeCachedPositionLedger, writeCachedWatchlists } from '../securities-account-cache';
import {
  STOCK_POSITION_LEDGER_CHANGED_EVENT,
  STOCK_POSITION_LEDGER_KEY,
  loadStockLedger,
  buyStockPosition,
  sellStockPosition,
  updateStockPositionGroup,
  type BuyStockPositionInput,
  type SellStockPositionInput,
  type UpdateStockPositionGroupInput,
  type StockPositionLedger,
} from '../stock-position-ledger';
import { createRequestCoordinator } from './securities-request-coordinator';
import {
  SecuritiesStateContext,
  type SecuritiesResourceState,
  type SecuritiesStateValue,
} from './securities-state-context';

const EMPTY_LEDGER: StockPositionLedger = { version: 1, groups: [], positions: [], transactions: [] };
const LOCAL_WATCHLISTS_KEY = 'sec_watchlists_v2';

function loadLocalWatchlists(): CloudWatchlist[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_WATCHLISTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function initialWatchlists(data: CloudWatchlist[], loading: boolean): SecuritiesResourceState<CloudWatchlist[]> {
  return { data, loading, refreshing: loading && data.length > 0, error: '', updatedAt: null };
}

function initialPositions(data: StockPositionLedger, loading: boolean): SecuritiesResourceState<StockPositionLedger> {
  return { data, loading, refreshing: loading && data.positions.length > 0, error: '', updatedAt: null };
}

export function SecuritiesStateProvider({ children }: { children: ReactNode }) {
  const auth = useOptionalAuth();
  const cloudMode = Boolean(auth?.cloudEnabled && auth.user);
  const userId = cloudMode ? auth?.user?.id ?? '' : '';
  const coordinatorRef = useRef(createRequestCoordinator<StockPositionLedger>());
  const watchlistCoordinatorRef = useRef(createRequestCoordinator<CloudWatchlist[]>());
  const accountGenerationRef = useRef(0);
  const [positions, setPositions] = useState<SecuritiesResourceState<StockPositionLedger>>(
    () => initialPositions(EMPTY_LEDGER, true),
  );
  const [watchlists, setWatchlists] = useState<SecuritiesResourceState<CloudWatchlist[]>>(
    () => initialWatchlists([], true),
  );

  const reloadPositions = useCallback(async (options: { force?: boolean } = {}) => {
    const generation = accountGenerationRef.current;
    const cached = cloudMode ? readCachedPositionLedger(userId) : null;
    if (cached) {
      setPositions(current => ({ ...current, data: cached, loading: false, refreshing: true, error: '' }));
    } else {
      setPositions(current => ({ ...current, loading: true, refreshing: false, error: '' }));
    }

    try {
      const result = await coordinatorRef.current.run(
        () => cloudMode ? createCloudSecuritiesRepository().loadPositionLedger() : Promise.resolve(loadStockLedger()),
        options,
      );
      if (!result.current || generation !== accountGenerationRef.current) return result.value;
      if (cloudMode) writeCachedPositionLedger(userId, result.value);
      setPositions({
        data: result.value,
        loading: false,
        refreshing: false,
        error: '',
        updatedAt: new Date().toISOString(),
      });
      return result.value;
    } catch (error) {
      if (generation === accountGenerationRef.current) {
        setPositions(current => ({
          ...current,
          loading: false,
          refreshing: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      throw error;
    }
  }, [cloudMode, userId]);

  const buyPosition = useCallback(async (input: BuyStockPositionInput) => {
    coordinatorRef.current.invalidate();
    if (cloudMode) {
      await createCloudSecuritiesRepository().executeManualBuy({
        operationId: input.sourceAlertId, code: input.code, name: input.name,
        shares: input.shares, price: input.price, groupId: input.groupId,
        groupName: input.groupName, tradedAt: input.tradedAt,
      });
    } else {
      buyStockPosition(input);
    }
    await reloadPositions({ force: true });
  }, [cloudMode, reloadPositions]);

  const sellPosition = useCallback(async (input: SellStockPositionInput) => {
    coordinatorRef.current.invalidate();
    if (cloudMode) {
      await createCloudSecuritiesRepository().executeManualSell({
        operationId: input.sourceAlertId, code: input.code, shares: input.shares,
        price: input.price, tradedAt: input.tradedAt,
      });
    } else {
      sellStockPosition(input);
    }
    await reloadPositions({ force: true });
  }, [cloudMode, reloadPositions]);

  const movePositionGroup = useCallback(async (input: UpdateStockPositionGroupInput) => {
    coordinatorRef.current.invalidate();
    if (cloudMode) await createCloudSecuritiesRepository().movePositionGroup(input);
    else updateStockPositionGroup(input);
    await reloadPositions({ force: true });
  }, [cloudMode, reloadPositions]);
  const reloadWatchlists = useCallback(async (options: { force?: boolean } = {}) => {
    const generation = accountGenerationRef.current;
    const cached = cloudMode ? readCachedWatchlists(userId) : null;
    if (cached) setWatchlists(current => ({ ...current, data: cached, loading: false, refreshing: true, error: '' }));
    else setWatchlists(current => ({ ...current, loading: true, refreshing: false, error: '' }));
    try {
      const result = await watchlistCoordinatorRef.current.run(
        () => cloudMode ? createCloudSecuritiesRepository().loadWatchlists() : Promise.resolve(loadLocalWatchlists()),
        options,
      );
      if (!result.current || generation !== accountGenerationRef.current) return result.value;
      if (cloudMode) writeCachedWatchlists(userId, result.value);
      setWatchlists({ data: result.value, loading: false, refreshing: false, error: '', updatedAt: new Date().toISOString() });
      return result.value;
    } catch (error) {
      if (generation === accountGenerationRef.current) setWatchlists(current => ({ ...current, loading: false, refreshing: false, error: error instanceof Error ? error.message : String(error) }));
      throw error;
    }
  }, [cloudMode, userId]);

  const replaceWatchlists = useCallback(async (next: CloudWatchlist[]) => {
    watchlistCoordinatorRef.current.invalidate();
    if (cloudMode) await createCloudSecuritiesRepository().saveWatchlists(next);
    else localStorage.setItem(LOCAL_WATCHLISTS_KEY, JSON.stringify(next));
    await reloadWatchlists({ force: true });
  }, [cloudMode, reloadWatchlists]);
  useEffect(() => {
    accountGenerationRef.current += 1;
    coordinatorRef.current.invalidate();
    watchlistCoordinatorRef.current.invalidate();
    const cached = cloudMode ? readCachedPositionLedger(userId) : null;
    setPositions(initialPositions(cached ?? EMPTY_LEDGER, true));
    const cachedWatchlists = cloudMode ? readCachedWatchlists(userId) : loadLocalWatchlists();
    setWatchlists(initialWatchlists(cachedWatchlists ?? [], true));
    void reloadPositions().catch(() => undefined);
    void reloadWatchlists().catch(() => undefined);
  }, [cloudMode, reloadPositions, reloadWatchlists, userId]);

  useEffect(() => {
    if (cloudMode) return undefined;
    const reload = () => { void reloadPositions({ force: true }).catch(() => undefined); };
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
  }, [cloudMode, reloadPositions]);

  const value = useMemo<SecuritiesStateValue>(() => ({
    mode: cloudMode ? 'cloud' : 'local',
    userId,
    positions,
    watchlists,
    reloadPositions,
    buyPosition,
    sellPosition,
    movePositionGroup,
    reloadWatchlists,
    replaceWatchlists,
  }), [buyPosition, cloudMode, movePositionGroup, positions, reloadPositions, reloadWatchlists, replaceWatchlists, sellPosition, userId, watchlists]);

  return <SecuritiesStateContext.Provider value={value}>{children}</SecuritiesStateContext.Provider>;
}
