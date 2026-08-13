import { createContext, useContext } from 'react';
import type { CloudWatchlist } from '../cloud/cloud-securities-repository';
import type { BuyStockPositionInput, SellStockPositionInput, StockPositionLedger, UpdateStockPositionGroupInput } from '../stock-position-ledger';

export interface SecuritiesResourceState<T> {
  data: T;
  loading: boolean;
  refreshing: boolean;
  error: string;
  updatedAt: string | null;
}

export interface SecuritiesStateValue {
  mode: 'local' | 'cloud';
  userId: string;
  positions: SecuritiesResourceState<StockPositionLedger>;
  watchlists: SecuritiesResourceState<CloudWatchlist[]>;
  reloadPositions(options?: { force?: boolean }): Promise<StockPositionLedger>;
  buyPosition(input: BuyStockPositionInput): Promise<void>;
  sellPosition(input: SellStockPositionInput): Promise<void>;
  movePositionGroup(input: UpdateStockPositionGroupInput): Promise<void>;
  reloadWatchlists(options?: { force?: boolean }): Promise<CloudWatchlist[]>;
  replaceWatchlists(next: CloudWatchlist[]): Promise<void>;
}

export const SecuritiesStateContext = createContext<SecuritiesStateValue | null>(null);

export function useOptionalSecuritiesState(): SecuritiesStateValue | null {
  return useContext(SecuritiesStateContext);
}

export function useSecuritiesState(): SecuritiesStateValue {
  const value = useOptionalSecuritiesState();
  if (!value) throw new Error('useSecuritiesState must be used within SecuritiesStateProvider');
  return value;
}
