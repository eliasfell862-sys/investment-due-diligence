import { useOptionalSecuritiesState } from './state/securities-state-context';
import { useStockPositionLedgerBase } from './useStockPositionLedgerBase';

export function useStockPositionLedger() {
  const shared = useOptionalSecuritiesState();
  const fallback = useStockPositionLedgerBase({ enabled: !shared });
  if (!shared) return fallback;
  return {
    ledger: shared.positions.data,
    error: shared.positions.error,
    reload: () => shared.reloadPositions({ force: true }),
    buy: shared.buyPosition,
    sell: shared.sellPosition,
    moveGroup: shared.movePositionGroup,
  };
}