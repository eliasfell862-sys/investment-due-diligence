import {
  BACKTEST_SIGNAL_RUNTIME_KEY,
  loadSignalRuntime,
  type BacktestSignalAlertV3,
  type BacktestSignalRuntimeState,
} from '../backtest-signal-inbox-store';
import {
  loadStockLedger,
  STOCK_POSITION_LEDGER_KEY,
  type StockPositionLedger,
  type StockTransaction,
} from '../stock-position-ledger';

export const LOCAL_WATCHLISTS_KEY = 'sec_watchlists_v2';

type StorageReader = Pick<Storage, 'getItem'>;

export interface CloudMigrationWatchlist {
  sourceId: string;
  name: string;
  createdAt: string;
}

export interface CloudMigrationWatchlistItem {
  sourceId: string;
  watchlistSourceId: string;
  code: string;
}

export interface CloudMigrationPositionGroup {
  sourceId: string;
  name: string;
}

export interface CloudMigrationPosition {
  sourceId: string;
  groupSourceId: string;
  code: string;
  name: string;
  shares: number;
  averageCost: number;
  totalCost: number;
  openedAt: string;
  updatedAt: string;
}

export interface CloudMigrationPositionLot {
  positionSourceId: string;
  sourceTransactionId: string;
  shares: number;
  remainingShares: number;
  price: number;
  boughtAt: string;
}

export interface CloudMigrationPositionTransaction {
  sourceId: string;
  groupSourceId: string;
  positionSourceId: string | null;
  sourceAlertSourceId: string | null;
  code: string;
  name: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  amount: number;
  realizedProfit: number;
  tradedAt: string;
}

export interface CloudMigrationPayload {
  migrationId: string;
  sourceVersions: { watchlists: 2; positionLedger: 1; signalRuntime: 3 };
  watchlists: CloudMigrationWatchlist[];
  watchlistItems: CloudMigrationWatchlistItem[];
  positionGroups: CloudMigrationPositionGroup[];
  positions: CloudMigrationPosition[];
  positionLots: CloudMigrationPositionLot[];
  positionTransactions: CloudMigrationPositionTransaction[];
  signalStates: Array<{ code: string; state: BacktestSignalRuntimeState['stocks'][string] }>;
  signalAlerts: BacktestSignalAlertV3[];
  virtualLedger: BacktestSignalRuntimeState['virtualLedger'];
}

interface LocalWatchlist {
  id: string;
  name: string;
  createdAt: string;
  codes: string[];
}

export class LocalMigrationDataError extends Error {
  readonly code = 'local_migration_data_invalid';

  constructor(message: string) {
    super(message);
    this.name = 'LocalMigrationDataError';
  }
}

function isSixDigitCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/.test(value.trim());
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new LocalMigrationDataError(`${label}缺失`);
  return value.trim();
}

function requireIsoDate(value: unknown, label: string): string {
  const text = requireText(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new LocalMigrationDataError(`${label}无效`);
  return text;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new LocalMigrationDataError(`${label}无效`);
  return Number(value);
}

function requireNonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new LocalMigrationDataError(`${label}无效`);
  return Number(value);
}

function requireNonnegativeNumber(value: unknown, label: string): number {
  if (!Number.isFinite(value) || Number(value) < 0) throw new LocalMigrationDataError(`${label}无效`);
  return Number(value);
}

function parseWatchlists(storage: StorageReader): LocalWatchlist[] {
  const raw = storage.getItem(LOCAL_WATCHLISTS_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LocalMigrationDataError('自选股数据损坏');
  }
  if (!Array.isArray(parsed)) throw new LocalMigrationDataError('自选股数据格式无效');
  const seen = new Set<string>();
  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object') throw new LocalMigrationDataError(`第${index + 1}个自选股池无效`);
    const record = value as Record<string, unknown>;
    const id = requireText(record.id, '自选股池ID');
    if (seen.has(id)) throw new LocalMigrationDataError(`自选股池ID重复：${id}`);
    seen.add(id);
    if (!Array.isArray(record.codes)) throw new LocalMigrationDataError(`自选股池${id}的股票列表无效`);
    const codes = [...new Set(record.codes.map(code => {
      if (!isSixDigitCode(code)) throw new LocalMigrationDataError(`自选股池${id}包含无效股票代码`);
      return code.trim();
    }))].sort();
    return {
      id,
      name: requireText(record.name, '自选股池名称'),
      createdAt: requireIsoDate(record.createdAt, '自选股池创建时间'),
      codes,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function validateTransaction(transaction: StockTransaction): void {
  if (!isSixDigitCode(transaction.code)) throw new LocalMigrationDataError('实际持仓交易包含无效股票代码');
  const shares = requirePositiveInteger(transaction.shares, '实际持仓交易股数');
  if (shares % 100 !== 0) throw new LocalMigrationDataError('实际持仓交易股数必须是100股的整数倍');
  if (!Number.isFinite(transaction.price) || transaction.price <= 0) {
    throw new LocalMigrationDataError('实际持仓交易价格无效');
  }
  requireIsoDate(transaction.tradedAt, '实际持仓交易时间');
}

function rebuildPositionLots(ledger: StockPositionLedger): CloudMigrationPositionLot[] {
  const positionByCode = new Map(ledger.positions.map(position => [position.code, position]));
  const lotsByCode = new Map<string, CloudMigrationPositionLot[]>();
  const transactions = ledger.transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort((left, right) => Date.parse(left.transaction.tradedAt) - Date.parse(right.transaction.tradedAt)
      || left.index - right.index);

  for (const { transaction } of transactions) {
    validateTransaction(transaction);
    const lots = lotsByCode.get(transaction.code) ?? [];
    if (transaction.type === 'buy') {
      const position = positionByCode.get(transaction.code);
      lots.push({
        positionSourceId: position?.id ?? `closed-${transaction.code}`,
        sourceTransactionId: requireText(transaction.id, '实际持仓交易ID'),
        shares: transaction.shares,
        remainingShares: transaction.shares,
        price: transaction.price,
        boughtAt: transaction.tradedAt,
      });
    } else {
      let remainingSell = transaction.shares;
      for (const lot of lots) {
        if (remainingSell === 0) break;
        const consumed = Math.min(lot.remainingShares, remainingSell);
        lot.remainingShares -= consumed;
        remainingSell -= consumed;
      }
      if (remainingSell > 0) throw new LocalMigrationDataError(`股票${transaction.code}的卖出数量超过历史买入数量`);
    }
    lotsByCode.set(transaction.code, lots);
  }

  const result: CloudMigrationPositionLot[] = [];
  for (const [code, lots] of lotsByCode) {
    const reconstructedShares = lots.reduce((sum, lot) => sum + lot.remainingShares, 0);
    const position = positionByCode.get(code);
    const recordedShares = position?.shares ?? 0;
    if (reconstructedShares !== recordedShares) {
      throw new LocalMigrationDataError(`股票${code}的交易流水与当前持仓数量不一致`);
    }
    if (position) result.push(...lots.map(lot => ({ ...lot, positionSourceId: position.id })));
  }
  for (const position of ledger.positions) {
    if (!lotsByCode.has(position.code) && position.shares !== 0) {
      throw new LocalMigrationDataError(`股票${position.code}缺少可重建持仓的交易流水`);
    }
  }
  return result.sort((left, right) => left.boughtAt.localeCompare(right.boughtAt)
    || left.sourceTransactionId.localeCompare(right.sourceTransactionId));
}

function normalizeLedger(ledger: StockPositionLedger) {
  const groupIds = new Set<string>();
  const positionIds = new Set<string>();
  const positionGroups = ledger.groups.map(group => {
    const sourceId = requireText(group.id, '持仓组ID');
    if (groupIds.has(sourceId)) throw new LocalMigrationDataError(`持仓组ID重复：${sourceId}`);
    groupIds.add(sourceId);
    return { sourceId, name: requireText(group.name, '持仓组名称') };
  }).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const positions = ledger.positions.map(position => {
    if (!isSixDigitCode(position.code)) throw new LocalMigrationDataError('实际持仓包含无效股票代码');
    if (!groupIds.has(position.groupId)) throw new LocalMigrationDataError(`股票${position.code}引用了不存在的持仓组`);
    const sourceId = requireText(position.id, '实际持仓ID');
    if (positionIds.has(sourceId)) throw new LocalMigrationDataError(`实际持仓ID重复：${sourceId}`);
    positionIds.add(sourceId);
    return {
      sourceId,
      groupSourceId: position.groupId,
      code: position.code,
      name: requireText(position.name, '股票名称'),
      shares: requireNonnegativeInteger(position.shares, '实际持仓股数'),
      averageCost: requireNonnegativeNumber(position.averageCost, '实际持仓均价'),
      totalCost: requireNonnegativeNumber(position.totalCost, '实际持仓成本'),
      openedAt: requireIsoDate(position.openedAt, '实际持仓建仓时间'),
      updatedAt: requireIsoDate(position.updatedAt, '实际持仓更新时间'),
    };
  }).sort((left, right) => left.code.localeCompare(right.code));
  const positionIdByCode = new Map(positions.map(position => [position.code, position.sourceId]));
  const positionTransactions = ledger.transactions.map(transaction => {
    validateTransaction(transaction);
    if (!groupIds.has(transaction.groupId)) throw new LocalMigrationDataError(`交易${transaction.id}引用了不存在的持仓组`);
    return {
      sourceId: requireText(transaction.id, '实际持仓交易ID'),
      groupSourceId: transaction.groupId,
      positionSourceId: positionIdByCode.get(transaction.code) ?? null,
      sourceAlertSourceId: transaction.sourceAlertId?.trim() || null,
      code: transaction.code,
      name: requireText(transaction.name, '交易股票名称'),
      type: transaction.type,
      shares: transaction.shares,
      price: transaction.price,
      amount: requireNonnegativeNumber(transaction.amount, '实际持仓交易金额'),
      realizedProfit: Number.isFinite(transaction.realizedProfit) ? transaction.realizedProfit : 0,
      tradedAt: transaction.tradedAt,
    };
  }).sort((left, right) => left.tradedAt.localeCompare(right.tradedAt) || left.sourceId.localeCompare(right.sourceId));
  return { positionGroups, positions, positionTransactions, positionLots: rebuildPositionLots(ledger) };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  const primes: number[] = [];
  for (let candidate = 2; primes.length < 64; candidate += 1) {
    if (primes.every(prime => candidate % prime !== 0)) primes.push(candidate);
  }
  const constants = primes.map(prime => Math.floor((Math.cbrt(prime) % 1) * 0x100000000) >>> 0);
  const hash = primes.slice(0, 8).map(prime => Math.floor((Math.sqrt(prime) % 1) * 0x100000000) >>> 0);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(words[index - 15]!, 7) ^ rightRotate(words[index - 15]!, 18) ^ (words[index - 15]! >>> 3);
      const s1 = rightRotate(words[index - 2]!, 17) ^ rightRotate(words[index - 2]!, 19) ^ (words[index - 2]! >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e!, 6) ^ rightRotate(e!, 11) ^ rightRotate(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + s1 + choice + constants[index]! + words[index]!) >>> 0;
      const s0 = rightRotate(a!, 2) ^ rightRotate(a!, 13) ^ rightRotate(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d! + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0; hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0; hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0; hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0; hash[7] = (hash[7]! + h!) >>> 0;
  }
  return hash.map(value => value.toString(16).padStart(8, '0')).join('');
}

export function buildLocalMigration(storage: StorageReader, userId: string): CloudMigrationPayload {
  const normalizedUserId = requireText(userId, '用户ID');
  const watchlists = parseWatchlists(storage);
  let ledger: StockPositionLedger;
  let runtime: BacktestSignalRuntimeState;
  try {
    ledger = loadStockLedger(storage);
  } catch {
    throw new LocalMigrationDataError(`${STOCK_POSITION_LEDGER_KEY}数据损坏`);
  }
  try {
    runtime = loadSignalRuntime(storage);
  } catch {
    throw new LocalMigrationDataError(`${BACKTEST_SIGNAL_RUNTIME_KEY}数据损坏`);
  }
  const normalizedLedger = normalizeLedger(ledger);
  const payloadWithoutId = {
    sourceVersions: { watchlists: 2 as const, positionLedger: 1 as const, signalRuntime: 3 as const },
    watchlists: watchlists.map(item => ({ sourceId: item.id, name: item.name, createdAt: item.createdAt })),
    watchlistItems: watchlists.flatMap(item => item.codes.map(code => ({
      sourceId: `${item.id}:${code}`,
      watchlistSourceId: item.id,
      code,
    }))).sort((left, right) => left.code.localeCompare(right.code)
      || left.watchlistSourceId.localeCompare(right.watchlistSourceId)),
    ...normalizedLedger,
    signalStates: Object.entries(runtime.stocks).sort(([left], [right]) => left.localeCompare(right))
      .map(([code, state]) => ({ code, state })),
    signalAlerts: [...runtime.alerts].sort((left, right) => left.id.localeCompare(right.id)),
    virtualLedger: runtime.virtualLedger,
  };
  return {
    migrationId: sha256(`${normalizedUserId}:${canonicalize(payloadWithoutId)}`),
    ...payloadWithoutId,
  };
}
