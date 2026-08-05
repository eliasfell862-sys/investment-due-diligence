export const STOCK_POSITION_LEDGER_KEY = 'sec_stock_position_ledger_v1';
export const STOCK_POSITION_LEDGER_CHANGED_EVENT = 'sec-stock-position-ledger-changed';

export interface StockPositionGroup {
  id: string;
  name: string;
}

export interface StockPosition {
  id: string;
  groupId: string;
  code: string;
  name: string;
  shares: number;
  averageCost: number;
  totalCost: number;
  openedAt: string;
  updatedAt: string;
  sourceAlertIds: string[];
}

export interface StockTransaction {
  id: string;
  groupId: string;
  code: string;
  name: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  amount: number;
  tradedAt: string;
  sourceAlertId: string;
  realizedProfit: number;
}

export interface StockPositionLedger {
  version: 1;
  groups: StockPositionGroup[];
  positions: StockPosition[];
  transactions: StockTransaction[];
}

interface StorageAccess {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StockPositionLedgerOptions {
  storage?: StorageAccess;
  createId?: (kind: 'position' | 'transaction') => string;
}

export interface BuyStockPositionInput {
  code: string;
  name: string;
  shares: number;
  price: number;
  groupId: string;
  groupName: string;
  sourceAlertId: string;
  tradedAt: string;
}

export interface SellStockPositionInput {
  code: string;
  shares: number;
  price: number;
  sourceAlertId: string;
  tradedAt: string;
}
export interface UpdateStockPositionGroupInput {
  code: string;
  groupId: string;
  groupName: string;
  updatedAt: string;
}

function defaultStorage(): StorageAccess {
  return localStorage;
}

function defaultCreateId(kind: 'position' | 'transaction'): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${suffix}`;
}

function emptyLedger(): StockPositionLedger {
  return { version: 1, groups: [], positions: [], transactions: [] };
}

function isLedger(value: unknown): value is StockPositionLedger {
  if (!value || typeof value !== 'object') return false;
  const ledger = value as Partial<StockPositionLedger>;
  return ledger.version === 1
    && Array.isArray(ledger.groups)
    && Array.isArray(ledger.positions)
    && Array.isArray(ledger.transactions);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveOptions(options: StockPositionLedgerOptions) {
  return {
    storage: options.storage ?? defaultStorage(),
    createId: options.createId ?? defaultCreateId,
  };
}

function assertTradeBase(code: string, shares: number, price: number, sourceAlertId: string) {
  if (!code.trim()) throw new Error('股票代码不能为空');
  if (!Number.isInteger(shares) || shares <= 0) throw new Error('交易股数必须是正整数');
  if (!Number.isFinite(price) || price <= 0) throw new Error('成交价格必须大于0');
  if (!sourceAlertId.trim()) throw new Error('信号消息不能为空');
}

function assertUnusedAlert(ledger: StockPositionLedger, sourceAlertId: string) {
  if (ledger.transactions.some(transaction => transaction.sourceAlertId === sourceAlertId)) {
    throw new Error('该信号已经执行过交易');
  }
}

function persist(storage: StorageAccess, ledger: StockPositionLedger) {
  storage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify(ledger));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(STOCK_POSITION_LEDGER_CHANGED_EVENT));
  }
}

export function loadStockLedger(
  storage: Pick<StorageAccess, 'getItem'> = defaultStorage(),
): StockPositionLedger {
  const raw = storage.getItem(STOCK_POSITION_LEDGER_KEY);
  if (!raw) return emptyLedger();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isLedger(parsed)) throw new Error('invalid ledger');
    return parsed;
  } catch {
    throw new Error('实际持仓数据损坏');
  }
}

export function findStockPosition(
  ledger: StockPositionLedger,
  code: string,
): StockPosition | null {
  return ledger.positions.find(position => position.code === code) ?? null;
}

export function buyStockPosition(
  input: BuyStockPositionInput,
  options: StockPositionLedgerOptions = {},
): { ledger: StockPositionLedger; position: StockPosition; transaction: StockTransaction } {
  assertTradeBase(input.code, input.shares, input.price, input.sourceAlertId);
  if (input.shares % 100 !== 0) throw new Error('买入股数必须是100股的整数倍');
  if (!input.name.trim()) throw new Error('股票名称不能为空');
  if (!input.groupId.trim() || !input.groupName.trim()) throw new Error('持仓组不能为空');

  const dependencies = resolveOptions(options);
  const current = loadStockLedger(dependencies.storage);
  assertUnusedAlert(current, input.sourceAlertId);

  const groups = current.groups.some(group => group.id === input.groupId)
    ? current.groups.map(group => ({ ...group }))
    : [...current.groups.map(group => ({ ...group })), { id: input.groupId, name: input.groupName.trim() }];
  const existing = findStockPosition(current, input.code);
  const amount = roundMoney(input.shares * input.price);
  let position: StockPosition;
  let positions: StockPosition[];

  if (existing) {
    const totalShares = existing.shares + input.shares;
    const totalCost = roundMoney(existing.totalCost + amount);
    position = {
      ...existing,
      name: input.name,
      shares: totalShares,
      totalCost,
      averageCost: roundMoney(totalCost / totalShares),
      updatedAt: input.tradedAt,
      sourceAlertIds: [...existing.sourceAlertIds, input.sourceAlertId],
    };
    positions = current.positions.map(item => item.id === existing.id ? position : { ...item });
  } else {
    position = {
      id: dependencies.createId('position'),
      groupId: input.groupId,
      code: input.code,
      name: input.name,
      shares: input.shares,
      averageCost: input.price,
      totalCost: amount,
      openedAt: input.tradedAt,
      updatedAt: input.tradedAt,
      sourceAlertIds: [input.sourceAlertId],
    };
    positions = [...current.positions.map(item => ({ ...item })), position];
  }

  const transaction: StockTransaction = {
    id: dependencies.createId('transaction'),
    groupId: position.groupId,
    code: input.code,
    name: input.name,
    type: 'buy',
    shares: input.shares,
    price: input.price,
    amount,
    tradedAt: input.tradedAt,
    sourceAlertId: input.sourceAlertId,
    realizedProfit: 0,
  };
  const ledger: StockPositionLedger = {
    version: 1,
    groups,
    positions,
    transactions: [...current.transactions.map(item => ({ ...item })), transaction],
  };
  persist(dependencies.storage, ledger);
  return { ledger, position, transaction };
}

export function updateStockPositionGroup(
  input: UpdateStockPositionGroupInput,
  options: StockPositionLedgerOptions = {},
): { ledger: StockPositionLedger; position: StockPosition } {
  if (!input.code.trim()) throw new Error('股票代码不能为空');
  if (!input.groupId.trim() || !input.groupName.trim()) throw new Error('持仓组不能为空');

  const dependencies = resolveOptions(options);
  const current = loadStockLedger(dependencies.storage);
  const existing = findStockPosition(current, input.code);
  if (!existing) throw new Error('当前没有该股票持仓');

  const groups = current.groups.some(group => group.id === input.groupId)
    ? current.groups.map(group => ({ ...group }))
    : [...current.groups.map(group => ({ ...group })), { id: input.groupId, name: input.groupName.trim() }];
  const position: StockPosition = {
    ...existing,
    groupId: input.groupId,
    updatedAt: input.updatedAt,
  };
  const ledger: StockPositionLedger = {
    version: 1,
    groups,
    positions: current.positions.map(item => item.id === existing.id ? position : { ...item }),
    transactions: current.transactions.map(item => ({ ...item })),
  };
  persist(dependencies.storage, ledger);
  return { ledger, position };
}
export function sellStockPosition(
  input: SellStockPositionInput,
  options: StockPositionLedgerOptions = {},
): { ledger: StockPositionLedger; position: StockPosition | null; transaction: StockTransaction } {
  assertTradeBase(input.code, input.shares, input.price, input.sourceAlertId);
  if (input.shares % 100 !== 0) throw new Error('卖出股数必须是100股的整数倍');
  const dependencies = resolveOptions(options);
  const current = loadStockLedger(dependencies.storage);
  assertUnusedAlert(current, input.sourceAlertId);
  const existing = findStockPosition(current, input.code);
  if (!existing) throw new Error('当前没有该股票持仓');
  if (input.shares > existing.shares) throw new Error('卖出股数不能超过当前持仓');

  const amount = roundMoney(input.shares * input.price);
  const realizedProfit = roundMoney((input.price - existing.averageCost) * input.shares);
  const remainingShares = existing.shares - input.shares;
  const position = remainingShares === 0
    ? null
    : {
        ...existing,
        shares: remainingShares,
        totalCost: roundMoney(existing.averageCost * remainingShares),
        updatedAt: input.tradedAt,
        sourceAlertIds: [...existing.sourceAlertIds, input.sourceAlertId],
      };
  const positions = position
    ? current.positions.map(item => item.id === existing.id ? position : { ...item })
    : current.positions.filter(item => item.id !== existing.id).map(item => ({ ...item }));
  const transaction: StockTransaction = {
    id: dependencies.createId('transaction'),
    groupId: existing.groupId,
    code: existing.code,
    name: existing.name,
    type: 'sell',
    shares: input.shares,
    price: input.price,
    amount,
    tradedAt: input.tradedAt,
    sourceAlertId: input.sourceAlertId,
    realizedProfit,
  };
  const ledger: StockPositionLedger = {
    version: 1,
    groups: current.groups.map(group => ({ ...group })),
    positions,
    transactions: [...current.transactions.map(item => ({ ...item })), transaction],
  };
  persist(dependencies.storage, ledger);
  return { ledger, position, transaction };
}
