import type { CloudWatchlist } from '../cloud/cloud-securities-repository';
import type { StockPositionLedger } from '../stock-position-ledger';

export interface SecuritiesMonitoringUniverse {
  buyCodes: string[];
  heldCodes: string[];
  allCodes: string[];
}

function normalizeCodes(codes: string[]): string[] {
  return [...new Set(codes.map(code => code.trim()).filter(Boolean))].sort();
}

export function buildSecuritiesMonitoringUniverse(
  watchlists: Array<Pick<CloudWatchlist, 'codes'>>,
  ledger: StockPositionLedger,
): SecuritiesMonitoringUniverse {
  const buyCodes = normalizeCodes(watchlists.flatMap(watchlist => watchlist.codes));
  const heldCodes = normalizeCodes(ledger.positions.map(position => position.code));
  return {
    buyCodes,
    heldCodes,
    allCodes: normalizeCodes([...buyCodes, ...heldCodes]),
  };
}