import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { useOptionalSecuritiesState } from '../state/securities-state-context';
import {
  STOCK_POSITION_LEDGER_CHANGED_EVENT,
  STOCK_POSITION_LEDGER_KEY,
  loadStockLedger,
  type StockPositionLedger,
} from '../stock-position-ledger';
import { readCachedPositionLedger, writeCachedPositionLedger } from '../securities-account-cache';
import { createCloudSecuritiesRepository } from './cloud-securities-repository';

const EMPTY_LEDGER: StockPositionLedger = { version: 1, groups: [], positions: [], transactions: [] };

export interface SecuritiesDataSourceValue {
  mode: 'local' | 'cloud';
  ledger: StockPositionLedger;
  loading: boolean;
  error: string;
  reloadLedger(): Promise<void>;
}

const SecuritiesDataSourceContext = createContext<SecuritiesDataSourceValue | null>(null);

export function SecuritiesDataSourceProvider({ children }: { children: ReactNode }) {
  const shared = useOptionalSecuritiesState();
  const { cloudEnabled, user } = useAuth();
  const cloudMode = cloudEnabled && Boolean(user);
  const cloudUserId = cloudMode ? user?.id ?? '' : '';
  const repository = useMemo(() => createCloudSecuritiesRepository(), []);
  const [ledger, setLedger] = useState<StockPositionLedger>(EMPTY_LEDGER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reloadLedger = useCallback(async () => {
    if (shared) {
      await shared.reloadPositions({ force: true });
      return;
    }
    const cached = cloudMode ? readCachedPositionLedger(cloudUserId) : null;
    if (cached) setLedger(cached);
    setLoading(true);
    try {
      const next = cloudMode ? await repository.loadPositionLedger() : loadStockLedger();
      setLedger(next);
      if (cloudMode) writeCachedPositionLedger(cloudUserId, next);
      setError('');
    } catch (loadError) {
      if (!cached) setLedger(EMPTY_LEDGER);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [cloudMode, cloudUserId, repository, shared]);

  useEffect(() => { if (!shared) void reloadLedger(); }, [reloadLedger, shared, user?.id]);

  useEffect(() => {
    if (cloudMode || shared) return undefined;
    const reload = () => { void reloadLedger(); };
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
  }, [cloudMode, reloadLedger, shared]);

  const fallbackValue = useMemo<SecuritiesDataSourceValue>(() => ({
    mode: cloudMode ? 'cloud' : 'local', ledger, loading, error, reloadLedger,
  }), [cloudMode, error, ledger, loading, reloadLedger]);
  const sharedValue = useMemo<SecuritiesDataSourceValue | null>(() => shared ? ({
    mode: shared.mode,
    ledger: shared.positions.data,
    loading: shared.positions.loading || shared.positions.refreshing,
    error: shared.positions.error,
    reloadLedger: async () => { await shared.reloadPositions({ force: true }); },
  }) : null, [shared]);

  return (
    <SecuritiesDataSourceContext.Provider value={sharedValue ?? fallbackValue}>
      {children}
    </SecuritiesDataSourceContext.Provider>
  );
}

export function useSecuritiesDataSource(): SecuritiesDataSourceValue {
  const value = useContext(SecuritiesDataSourceContext);
  if (!value) throw new Error('useSecuritiesDataSource must be used within SecuritiesDataSourceProvider');
  return value;
}

export function useOptionalSecuritiesDataSource(): SecuritiesDataSourceValue | null {
  return useContext(SecuritiesDataSourceContext);
}