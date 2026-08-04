import { loadStockLedger } from './stock-position-ledger';

const WATCHLISTS_KEY = 'sec_watchlists_v2';

export interface MonitoringUniverse {
  buyCodes: string[];
  heldCodes: string[];
  allCodes: string[];
}

interface StorageReader {
  getItem(key: string): string | null;
}

function normalizeCodes(values: unknown[]): string[] {
  return [...new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean),
  )].sort();
}

function loadAllWatchlistCodes(storage: StorageReader): string[] {
  try {
    const raw = storage.getItem(WATCHLISTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeCodes(parsed.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const codes = (item as { codes?: unknown }).codes;
      return Array.isArray(codes) ? codes : [];
    }));
  } catch {
    return [];
  }
}

export function loadMonitoringUniverse(
  storage: StorageReader = localStorage,
): MonitoringUniverse {
  const buyCodes = loadAllWatchlistCodes(storage);
  const heldCodes = normalizeCodes(loadStockLedger(storage).positions.map(position => position.code));
  return {
    buyCodes,
    heldCodes,
    allCodes: normalizeCodes([...buyCodes, ...heldCodes]),
  };
}
