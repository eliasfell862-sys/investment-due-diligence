import type { CloudWatchlist } from './cloud/cloud-securities-repository';
import type { StockPositionLedger } from './stock-position-ledger';

const CACHE_PREFIX = 'sec_account_cache_v1:';
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_BYTES = 500 * 1024;

type CacheKind = 'watchlists' | 'position-ledger';
interface CacheEnvelope<T> {
  version: 1;
  userId: string;
  kind: CacheKind;
  savedAt: number;
  data: T;
}

function key(userId: string, kind: CacheKind): string {
  return `${CACHE_PREFIX}${encodeURIComponent(userId)}:${kind}`;
}

function bytes(value: string): number {
  return new Blob([value]).size;
}

function cacheEntries(): Array<{ key: string; raw: string; savedAt: number }> {
  const entries: Array<{ key: string; raw: string; savedAt: number }> = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const storageKey = localStorage.key(index);
    if (!storageKey?.startsWith(CACHE_PREFIX)) continue;
    const raw = localStorage.getItem(storageKey);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Partial<CacheEnvelope<unknown>>;
      if (parsed.version !== CACHE_VERSION || typeof parsed.savedAt !== 'number') {
        localStorage.removeItem(storageKey);
        continue;
      }
      if (Date.now() - parsed.savedAt > CACHE_TTL_MS) {
        localStorage.removeItem(storageKey);
        continue;
      }
      entries.push({ key: storageKey, raw, savedAt: parsed.savedAt });
    } catch {
      localStorage.removeItem(storageKey);
    }
  }
  return entries;
}

function enforceLimit(): void {
  const entries = cacheEntries().sort((left, right) => left.savedAt - right.savedAt);
  let total = entries.reduce((sum, entry) => sum + bytes(entry.raw), 0);
  for (const entry of entries) {
    if (total <= CACHE_MAX_BYTES) break;
    localStorage.removeItem(entry.key);
    total -= bytes(entry.raw);
  }
}

function write<T>(userId: string, kind: CacheKind, data: T): void {
  if (!userId) return;
  const storageKey = key(userId, kind);
  const raw = JSON.stringify({ version: CACHE_VERSION, userId, kind, savedAt: Date.now(), data });
  if (bytes(raw) > CACHE_MAX_BYTES) {
    localStorage.removeItem(storageKey);
    enforceLimit();
    return;
  }
  try {
    localStorage.setItem(storageKey, raw);
    enforceLimit();
  } catch {
    localStorage.removeItem(storageKey);
    enforceLimit();
  }
}

function read<T>(userId: string, kind: CacheKind): T | null {
  if (!userId) return null;
  const storageKey = key(userId, kind);
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (parsed.version !== CACHE_VERSION || parsed.userId !== userId || parsed.kind !== kind
      || Date.now() - parsed.savedAt > CACHE_TTL_MS) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return parsed.data;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

export function readCachedWatchlists(userId: string): CloudWatchlist[] | null {
  return read<CloudWatchlist[]>(userId, 'watchlists');
}
export function writeCachedWatchlists(userId: string, watchlists: CloudWatchlist[]): void {
  write(userId, 'watchlists', watchlists);
}
export function readCachedPositionLedger(userId: string): StockPositionLedger | null {
  return read<StockPositionLedger>(userId, 'position-ledger');
}
export function writeCachedPositionLedger(userId: string, ledger: StockPositionLedger): void {
  write(userId, 'position-ledger', ledger);
}
export function clearSecuritiesAccountCache(userId?: string): void {
  const prefix = userId ? `${CACHE_PREFIX}${encodeURIComponent(userId)}:` : CACHE_PREFIX;
  for (const storageKey of Object.keys(localStorage)) {
    if (storageKey.startsWith(prefix)) localStorage.removeItem(storageKey);
  }
}