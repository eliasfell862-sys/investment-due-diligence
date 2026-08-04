export const PORTFOLIO_GROUPS_KEY = 'sec_portfolio_groups_v1';

export type PortfolioRiskLevel = 'conservative' | 'balanced' | 'aggressive';

export interface PortfolioPositionSnapshot {
  code: string;
  name: string;
  groupName: string;
  groupColor: string;
  score: number;
  allocation: number;
  amount: number;
  shares: number;
  price: number;
  rationale: string;
  targetAllocation?: number;
  actualAllocation?: number;
  riskContribution?: number;
  industry?: string | null;
  sourceWatchlistIds?: string[];
  tags?: string[];
  confidence?: number;
  risks?: string[];
}

export interface PortfolioVersion {
  id: string;
  createdAt: string;
  capital: number;
  riskLevel: PortfolioRiskLevel;
  sourceWatchlistId?: string;
  sourceWatchlistName?: string;
  aiSummary?: string;
  algorithmVersion?: string;
  candidateSnapshotId?: string;
  sourceWatchlists?: Array<{ id: string; name: string }>;
  parameters?: Record<string, number | string | boolean>;
  dataAsOf?: string;
  cashBreakdown?: {
    minimumCashAmount: number;
    constraintCashAmount: number;
    boardLotCashAmount: number;
    totalCashAmount: number;
  };
  portfolioMetrics?: { annualizedVolatility: number; concentration: number; maximumPairCorrelation: number | null };
  excludedSummary?: Array<{ code: string; reasonCode: string; reason: string }>;
  positions: PortfolioPositionSnapshot[];
}

export interface PortfolioGroup {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentVersionId: string;
  versions: PortfolioVersion[];
}

export interface PortfolioVersionDraft extends Omit<PortfolioVersion, 'id' | 'createdAt'> {}

export interface PortfolioStorageOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => string;
  createId?: (prefix: 'pg' | 'pv') => string;
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  return localStorage;
}

function createDefaultId(prefix: 'pg' | 'pv'): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function isPortfolioGroup(value: unknown): value is PortfolioGroup {
  if (!value || typeof value !== 'object') return false;
  const group = value as Partial<PortfolioGroup>;
  return typeof group.id === 'string'
    && typeof group.name === 'string'
    && typeof group.createdAt === 'string'
    && typeof group.updatedAt === 'string'
    && typeof group.currentVersionId === 'string'
    && Array.isArray(group.versions);
}

export function loadPortfolioGroups(storage: Pick<Storage, 'getItem'> = defaultStorage()): PortfolioGroup[] {
  try {
    const raw = storage.getItem(PORTFOLIO_GROUPS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isPortfolioGroup) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePortfolioVersion(
  target: { groupId: string } | { newGroupName: string },
  draft: PortfolioVersionDraft,
  options: PortfolioStorageOptions = {},
): { groups: PortfolioGroup[]; group: PortfolioGroup; version: PortfolioVersion } {
  const storage = options.storage ?? defaultStorage();
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? createDefaultId;
  const groups = loadPortfolioGroups(storage);
  const name = 'newGroupName' in target ? target.newGroupName.trim() : '';

  if (draft.positions.length === 0) throw new Error('当前没有可保存的持仓');
  if (!Number.isFinite(draft.capital) || draft.capital <= 0) throw new Error('可用资金必须大于0');
  if ('newGroupName' in target && !name) throw new Error('请输入持仓组名称');
  if ('newGroupName' in target && groups.some(group => group.name === name)) {
    throw new Error('持仓组名称已存在');
  }

  const timestamp = now();
  const version: PortfolioVersion = {
    ...draft,
    id: createId('pv'),
    createdAt: timestamp,
    positions: draft.positions.map(position => ({
      ...position,
      sourceWatchlistIds: position.sourceWatchlistIds ? [...position.sourceWatchlistIds] : undefined,
      tags: position.tags ? [...position.tags] : undefined,
      risks: position.risks ? [...position.risks] : undefined,
    })),
    sourceWatchlists: draft.sourceWatchlists?.map(item => ({ ...item })),
    parameters: draft.parameters ? { ...draft.parameters } : undefined,
    cashBreakdown: draft.cashBreakdown ? { ...draft.cashBreakdown } : undefined,
    portfolioMetrics: draft.portfolioMetrics ? { ...draft.portfolioMetrics } : undefined,
    excludedSummary: draft.excludedSummary?.map(item => ({ ...item })),
  };

  let group: PortfolioGroup;
  let nextGroups: PortfolioGroup[];

  if ('newGroupName' in target) {
    group = {
      id: createId('pg'),
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
      currentVersionId: version.id,
      versions: [version],
    };
    nextGroups = [...groups, group];
  } else {
    const groupIndex = groups.findIndex(item => item.id === target.groupId);
    if (groupIndex < 0) throw new Error('持仓组不存在');

    group = {
      ...groups[groupIndex],
      updatedAt: timestamp,
      currentVersionId: version.id,
      versions: [...groups[groupIndex].versions, version],
    };
    nextGroups = groups.map((item, index) => index === groupIndex ? group : item);
  }

  storage.setItem(PORTFOLIO_GROUPS_KEY, JSON.stringify(nextGroups));
  return { groups: nextGroups, group, version };
}

export function deletePortfolioGroup(
  groupId: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> = defaultStorage(),
): PortfolioGroup[] {
  const groups = loadPortfolioGroups(storage).filter(group => group.id !== groupId);
  storage.setItem(PORTFOLIO_GROUPS_KEY, JSON.stringify(groups));
  return groups;
}

export function findPortfolioVersion(
  groups: PortfolioGroup[],
  groupId: string,
  versionId: string,
): PortfolioVersion | null {
  return groups.find(group => group.id === groupId)
    ?.versions.find(version => version.id === versionId) ?? null;
}
