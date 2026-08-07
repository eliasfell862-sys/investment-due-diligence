import { useOptionalSecuritiesDataSource } from './cloud/SecuritiesDataSourceProvider';
import { useStockPositionLedger as useLocalStockPositionLedger } from './useStockPositionLedgerBase';

export function useStockPositionLedger() {
  const local = useLocalStockPositionLedger();
  const shared = useOptionalSecuritiesDataSource();
  if (!shared) return local;
  return {
    ledger: shared.ledger,
    error: shared.error,
    reload: shared.reloadLedger,
  };
}
