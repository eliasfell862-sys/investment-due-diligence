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
import {
  STOCK_POSITION_LEDGER_CHANGED_EVENT,
  STOCK_POSITION_LEDGER_KEY,
  loadStockLedger,
  type StockPositionLedger,
} from '../stock-position-ledger';
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
  const { cloudEnabled, user } = useAuth();
  const cloudMode = cloudEnabled && Boolean(user);
  const repository = useMemo(() => createCloudSecuritiesRepository(), []);
  const [ledger, setLedger] = useState<StockPositionLedger>(EMPTY_LEDGER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reloadLedger = useCallback(async () => {
    setLoading(true);
    try {
      const next = cloudMode ? await repository.loadPositionLedger() : loadStockLedger();
      setLedger(next);
      setError('');
    } catch (loadError) {
      setLedger(EMPTY_LEDGER);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [cloudMode, repository]);

  useEffect(() => { void reloadLedger(); }, [reloadLedger, user?.id]);

  useEffect(() => {
    if (cloudMode) return undefined;
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
  }, [cloudMode, reloadLedger]);

  const value = useMemo<SecuritiesDataSourceValue>(() => ({
    mode: cloudMode ? 'cloud' : 'local', ledger, loading, error, reloadLedger,
  }), [cloudMode, error, ledger, loading, reloadLedger]);

  return <SecuritiesDataSourceContext.Provider value={value}>{children}</SecuritiesDataSourceContext.Provider>;
}

export function useSecuritiesDataSource(): SecuritiesDataSourceValue {
  const value = useContext(SecuritiesDataSourceContext);
  if (!value) throw new Error('useSecuritiesDataSource must be used within SecuritiesDataSourceProvider');
  return value;
}

export function useOptionalSecuritiesDataSource(): SecuritiesDataSourceValue | null {
  return useContext(SecuritiesDataSourceContext);
}
