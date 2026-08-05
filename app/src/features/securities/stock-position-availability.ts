import type { StockPositionLedger } from './stock-position-ledger';
import {
  A_SHARE_CALENDAR_COVERAGE,
  isAStockTradingDay,
  nextAStockTradingDay,
  shanghaiDateKey,
} from './a-share-trading-calendar';

export interface StockPositionAvailability {
  totalShares: number;
  availableShares: number;
  frozenShares: number;
  nextAvailableDate: string | null;
}

const EMPTY_AVAILABILITY: StockPositionAvailability = {
  totalShares: 0,
  availableShares: 0,
  frozenShares: 0,
  nextAvailableDate: null,
};

export function calculateStockPositionAvailability(
  ledger: StockPositionLedger,
  code: string,
  asOf: Date | string,
): StockPositionAvailability {
  const position = ledger.positions.find(item => item.code === code) ?? null;
  if (!position) return { ...EMPTY_AVAILABILITY };

  const asOfDate = shanghaiDateKey(asOf);
  isAStockTradingDay(asOfDate);

  const lockedBuys = ledger.transactions
    .filter(transaction => transaction.code === code && transaction.type === 'buy')
    .flatMap(transaction => {
      const buyDate = shanghaiDateKey(transaction.tradedAt);
      const buyYear = Number(buyDate.slice(0, 4));
      if (buyYear < A_SHARE_CALENDAR_COVERAGE.firstYear) return [];
      const availableOn = nextAStockTradingDay(buyDate);
      return availableOn > asOfDate
        ? [{ shares: transaction.shares, availableOn }]
        : [];
    });

  const frozenShares = Math.min(
    position.shares,
    lockedBuys.reduce((sum, batch) => sum + batch.shares, 0),
  );
  const nextAvailableDate = lockedBuys
    .map(batch => batch.availableOn)
    .sort()[0] ?? null;

  return {
    totalShares: position.shares,
    availableShares: position.shares - frozenShares,
    frozenShares,
    nextAvailableDate,
  };
}
