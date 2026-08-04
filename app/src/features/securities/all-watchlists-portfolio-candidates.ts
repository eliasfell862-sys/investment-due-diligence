export const ALL_WATCHLISTS_STORAGE_KEY = 'sec_watchlists_v2';

export interface PortfolioCandidateSource {
  watchlistId: string;
  watchlistName: string;
  groupIds: string[];
  labels: string[];
}

export interface PortfolioCandidateIdentity {
  code: string;
  sources: PortfolioCandidateSource[];
  labels: string[];
}

export interface PortfolioCandidateSnapshot {
  id: string;
  createdAt: string;
  candidates: PortfolioCandidateIdentity[];
  sourceWatchlists: Array<{ id: string; name: string }>;
  warnings: string[];
}

interface PersistedGroup {
  id: string;
  name: string;
}

interface PersistedWatchlist {
  id: string;
  name: string;
  codes: string[];
  groups: PersistedGroup[];
  codeGroups: Record<string, string[]>;
}

function normalizeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return /^\d{6}$/.test(code) ? code : null;
}

function normalizeGroup(value: unknown): PersistedGroup | null {
  if (!value || typeof value !== 'object') return null;
  const group = value as Partial<PersistedGroup>;
  if (typeof group.id !== 'string' || typeof group.name !== 'string') return null;
  const id = group.id.trim();
  const name = group.name.trim();
  return id && name ? { id, name } : null;
}

function normalizeWatchlist(value: unknown): PersistedWatchlist | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.name !== 'string' || !Array.isArray(record.codes)) return null;
  const id = record.id.trim();
  const name = record.name.trim();
  if (!id || !name) return null;

  const groups = Array.isArray(record.groups)
    ? record.groups.map(normalizeGroup).filter((group): group is PersistedGroup => group !== null)
    : [];
  const rawCodeGroups = record.codeGroups && typeof record.codeGroups === 'object' && !Array.isArray(record.codeGroups)
    ? record.codeGroups as Record<string, unknown>
    : {};
  const codeGroups: Record<string, string[]> = {};
  for (const [rawCode, rawGroupIds] of Object.entries(rawCodeGroups)) {
    const code = normalizeCode(rawCode);
    if (!code || !Array.isArray(rawGroupIds)) continue;
    codeGroups[code] = rawGroupIds.filter((groupId): groupId is string => typeof groupId === 'string');
  }

  return {
    id,
    name,
    codes: record.codes.filter((code): code is string => typeof code === 'string'),
    groups,
    codeGroups,
  };
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `watchlists-${hash.toString(16).padStart(8, '0')}`;
}

function stableSnapshotText(candidates: PortfolioCandidateIdentity[]): string {
  return candidates.map(candidate => [
    candidate.code,
    candidate.labels.join(','),
    candidate.sources.map(source => [
      source.watchlistId,
      source.groupIds.join(','),
      source.labels.join(','),
    ].join(':')).join('|'),
  ].join('#')).join(';');
}

export function aggregateAllWatchlistCandidates(
  storage: Pick<Storage, 'getItem'> = globalThis.localStorage,
  now: () => string = () => new Date().toISOString(),
): PortfolioCandidateSnapshot {
  let parsed: unknown;
  try {
    const raw = storage.getItem(ALL_WATCHLISTS_STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    return {
      id: fnv1a(''),
      createdAt: now(),
      candidates: [],
      sourceWatchlists: [],
      warnings: ['自选股池数据损坏，已按空候选池处理'],
    };
  }

  if (!Array.isArray(parsed)) parsed = [];
  const watchlists: PersistedWatchlist[] = [];
  let malformedCount = 0;
  for (const value of parsed) {
    const watchlist = normalizeWatchlist(value);
    if (watchlist) watchlists.push(watchlist);
    else malformedCount += 1;
  }
  watchlists.sort((left, right) => left.id.localeCompare(right.id));

  const byCode = new Map<string, PortfolioCandidateIdentity>();
  for (const watchlist of watchlists) {
    const groupById = new Map(watchlist.groups.map(group => [group.id, group]));
    const seenCodes = new Set<string>();
    for (const rawCode of watchlist.codes) {
      const code = normalizeCode(rawCode);
      if (!code || seenCodes.has(code)) continue;
      seenCodes.add(code);
      const groupIds = [...new Set(watchlist.codeGroups[code] ?? [])]
        .filter(groupId => groupById.has(groupId))
        .sort();
      const labels = groupIds.map(groupId => groupById.get(groupId)!.name).sort((a, b) => a.localeCompare(b, 'zh-CN'));
      const source: PortfolioCandidateSource = {
        watchlistId: watchlist.id,
        watchlistName: watchlist.name,
        groupIds,
        labels,
      };
      const current = byCode.get(code);
      if (current) {
        current.sources.push(source);
        current.labels = [...new Set([...current.labels, ...labels])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      } else {
        byCode.set(code, { code, sources: [source], labels: [...labels] });
      }
    }
  }

  const candidates = [...byCode.values()]
    .map(candidate => ({
      ...candidate,
      sources: [...candidate.sources].sort((left, right) => left.watchlistId.localeCompare(right.watchlistId)),
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
  const warnings = malformedCount > 0 ? [`已忽略${malformedCount}个损坏的自选股池记录`] : [];

  return {
    id: fnv1a(stableSnapshotText(candidates)),
    createdAt: now(),
    candidates,
    sourceWatchlists: watchlists.map(({ id, name }) => ({ id, name })),
    warnings,
  };
}
