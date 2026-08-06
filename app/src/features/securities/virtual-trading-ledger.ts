import { nextAStockTradingDay, shanghaiDateKey } from './a-share-trading-calendar';

export type VirtualTradeIntent = 'open' | 'add' | 'reduce' | 'exit';
export type VirtualCycleStatus = 'open' | 'closed';

export interface VirtualPosition {
  id: string;
  cycleId: string;
  strategyId: string;
  strategyVersion: string;
  code: string;
  name: string;
  shares: number;
  averageCost: number;
  totalCost: number;
  openedAt: string;
  updatedAt: string;
  sourceTradeIds: string[];
}

export interface VirtualTransaction {
  id: string;
  sourceSignalId: string;
  cycleId: string;
  strategyId: string;
  strategyVersion: string;
  code: string;
  name: string;
  type: 'buy' | 'sell';
  intent: VirtualTradeIntent;
  shares: number;
  price: number;
  amount: number;
  tradedAt: string;
  positionSharesAfter: number;
  availableSharesAfter: number;
  realizedProfit: number;
  reasons: string[];
}

export interface VirtualTradeCycle {
  id: string;
  strategyId: string;
  strategyVersion: string;
  code: string;
  name: string;
  status: VirtualCycleStatus;
  openedAt: string;
  closedAt: string | null;
  buyAmount: number;
  sellAmount: number;
  realizedProfit: number;
  returnPct: number | null;
  transactionIds: string[];
}

export interface VirtualTradingLedger {
  version: 1;
  positions: VirtualPosition[];
  transactions: VirtualTransaction[];
  cycles: VirtualTradeCycle[];
}

export interface VirtualAvailability {
  totalShares: number;
  availableShares: number;
  frozenShares: number;
  nextAvailableDate: string | null;
}

export interface BuyVirtualPositionInput {
  sourceSignalId: string;
  strategyId: string;
  strategyVersion: string;
  code: string;
  name: string;
  shares: number;
  price: number;
  tradedAt: string;
  reasons: string[];
}

export interface SellVirtualPositionInput extends BuyVirtualPositionInput {}

export interface VirtualLedgerOptions {
  createId?: (kind: 'position' | 'transaction' | 'cycle') => string;
}

export interface VirtualLedgerMutation {
  ledger: VirtualTradingLedger;
  position: VirtualPosition | null;
  transaction: VirtualTransaction;
  cycle: VirtualTradeCycle;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function defaultCreateId(kind: 'position' | 'transaction' | 'cycle'): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${suffix}`;
}

function cloneLedger(ledger: VirtualTradingLedger): VirtualTradingLedger {
  return {
    version: 1,
    positions: ledger.positions.map(position => ({
      ...position,
      sourceTradeIds: [...position.sourceTradeIds],
    })),
    transactions: ledger.transactions.map(transaction => ({
      ...transaction,
      reasons: [...transaction.reasons],
    })),
    cycles: ledger.cycles.map(cycle => ({
      ...cycle,
      transactionIds: [...cycle.transactionIds],
    })),
  };
}

function assertTradeInput(input: BuyVirtualPositionInput, side: 'buy' | 'sell'): void {
  if (!Number.isFinite(input.price) || input.price <= 0) throw new Error('成交价格必须大于0');
  if (!Number.isInteger(input.shares) || input.shares <= 0) throw new Error('成交股数必须为正整数');
  if (input.shares % 100 !== 0) {
    throw new Error(side === 'buy' ? '买入股数必须为100股的整数倍' : '卖出股数必须为100股的整数倍');
  }
  shanghaiDateKey(input.tradedAt);
}

function assertUniqueSignal(ledger: VirtualTradingLedger, sourceSignalId: string): void {
  if (ledger.transactions.some(item => item.sourceSignalId === sourceSignalId)) {
    throw new Error('该虚拟信号已经成交');
  }
}

export function createEmptyVirtualTradingLedger(): VirtualTradingLedger {
  return { version: 1, positions: [], transactions: [], cycles: [] };
}

export function findVirtualPosition(
  ledger: VirtualTradingLedger,
  code: string,
  strategyId: string,
): VirtualPosition | null {
  return ledger.positions.find(item => item.code === code && item.strategyId === strategyId) ?? null;
}

export function calculateVirtualAvailability(
  ledger: VirtualTradingLedger,
  code: string,
  strategyId: string,
  asOf: Date | string,
): VirtualAvailability {
  const position = findVirtualPosition(ledger, code, strategyId);
  if (!position) {
    return { totalShares: 0, availableShares: 0, frozenShares: 0, nextAvailableDate: null };
  }

  const dateKey = shanghaiDateKey(asOf);
  const cycleTransactions = ledger.transactions.filter(item => item.cycleId === position.cycleId);
  const buyTransactions = cycleTransactions.filter(item => item.type === 'buy');
  const soldShares = cycleTransactions
    .filter(item => item.type === 'sell')
    .reduce((sum, item) => sum + item.shares, 0);
  let maturedBuyShares = 0;
  const pendingDates: string[] = [];

  for (const transaction of buyTransactions) {
    const availableDate = nextAStockTradingDay(shanghaiDateKey(transaction.tradedAt));
    if (availableDate <= dateKey) maturedBuyShares += transaction.shares;
    else pendingDates.push(availableDate);
  }

  const availableShares = Math.max(0, Math.min(position.shares, maturedBuyShares - soldShares));
  return {
    totalShares: position.shares,
    availableShares,
    frozenShares: position.shares - availableShares,
    nextAvailableDate: pendingDates.sort()[0] ?? null,
  };
}

export function buyVirtualPosition(
  inputLedger: VirtualTradingLedger,
  input: BuyVirtualPositionInput,
  options: VirtualLedgerOptions = {},
): VirtualLedgerMutation {
  assertTradeInput(input, 'buy');
  assertUniqueSignal(inputLedger, input.sourceSignalId);
  const ledger = cloneLedger(inputLedger);
  const createId = options.createId ?? defaultCreateId;
  const current = findVirtualPosition(ledger, input.code, input.strategyId);
  const transactionId = createId('transaction');
  const cycleId = current?.cycleId ?? createId('cycle');
  const positionId = current?.id ?? createId('position');
  const amount = roundMoney(input.shares * input.price);
  const totalShares = (current?.shares ?? 0) + input.shares;
  const totalCost = roundMoney((current?.totalCost ?? 0) + amount);
  const position: VirtualPosition = {
    id: positionId,
    cycleId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    code: input.code,
    name: input.name,
    shares: totalShares,
    averageCost: roundMoney(totalCost / totalShares),
    totalCost,
    openedAt: current?.openedAt ?? input.tradedAt,
    updatedAt: input.tradedAt,
    sourceTradeIds: [...(current?.sourceTradeIds ?? []), transactionId],
  };

  if (current) ledger.positions = ledger.positions.map(item => item.id === current.id ? position : item);
  else ledger.positions.push(position);

  const existingCycle = ledger.cycles.find(item => item.id === cycleId);
  const cycle: VirtualTradeCycle = existingCycle
    ? {
        ...existingCycle,
        buyAmount: roundMoney(existingCycle.buyAmount + amount),
        transactionIds: [...existingCycle.transactionIds, transactionId],
      }
    : {
        id: cycleId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        code: input.code,
        name: input.name,
        status: 'open',
        openedAt: input.tradedAt,
        closedAt: null,
        buyAmount: amount,
        sellAmount: 0,
        realizedProfit: 0,
        returnPct: null,
        transactionIds: [transactionId],
      };
  if (existingCycle) ledger.cycles = ledger.cycles.map(item => item.id === cycleId ? cycle : item);
  else ledger.cycles.push(cycle);

  const transaction: VirtualTransaction = {
    id: transactionId,
    sourceSignalId: input.sourceSignalId,
    cycleId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    code: input.code,
    name: input.name,
    type: 'buy',
    intent: current ? 'add' : 'open',
    shares: input.shares,
    price: input.price,
    amount,
    tradedAt: input.tradedAt,
    positionSharesAfter: position.shares,
    availableSharesAfter: 0,
    realizedProfit: 0,
    reasons: [...input.reasons],
  };
  ledger.transactions.push(transaction);
  transaction.availableSharesAfter = calculateVirtualAvailability(
    ledger,
    input.code,
    input.strategyId,
    input.tradedAt,
  ).availableShares;

  return { ledger, position, transaction, cycle };
}

export function sellVirtualPosition(
  inputLedger: VirtualTradingLedger,
  input: SellVirtualPositionInput,
  options: VirtualLedgerOptions = {},
): VirtualLedgerMutation {
  assertTradeInput(input, 'sell');
  assertUniqueSignal(inputLedger, input.sourceSignalId);
  const current = findVirtualPosition(inputLedger, input.code, input.strategyId);
  if (!current) throw new Error('虚拟持仓不存在');
  const availability = calculateVirtualAvailability(
    inputLedger,
    input.code,
    input.strategyId,
    input.tradedAt,
  );
  if (input.shares > availability.availableShares) throw new Error('卖出股数超过可用虚拟持仓');

  const ledger = cloneLedger(inputLedger);
  const createId = options.createId ?? defaultCreateId;
  const transactionId = createId('transaction');
  const remainingShares = current.shares - input.shares;
  const amount = roundMoney(input.shares * input.price);
  const realizedProfit = roundMoney((input.price - current.averageCost) * input.shares);
  const position: VirtualPosition | null = remainingShares > 0
    ? {
        ...current,
        shares: remainingShares,
        totalCost: roundMoney(current.averageCost * remainingShares),
        updatedAt: input.tradedAt,
        sourceTradeIds: [...current.sourceTradeIds],
      }
    : null;

  ledger.positions = position
    ? ledger.positions.map(item => item.id === current.id ? position : item)
    : ledger.positions.filter(item => item.id !== current.id);

  const existingCycle = ledger.cycles.find(item => item.id === current.cycleId);
  if (!existingCycle) throw new Error('虚拟交易周期不存在');
  const cycleRealizedProfit = roundMoney(existingCycle.realizedProfit + realizedProfit);
  const cycle: VirtualTradeCycle = {
    ...existingCycle,
    status: position ? 'open' : 'closed',
    closedAt: position ? null : input.tradedAt,
    sellAmount: roundMoney(existingCycle.sellAmount + amount),
    realizedProfit: cycleRealizedProfit,
    returnPct: position || existingCycle.buyAmount <= 0
      ? null
      : roundMoney(cycleRealizedProfit / existingCycle.buyAmount * 100),
    transactionIds: [...existingCycle.transactionIds, transactionId],
  };
  ledger.cycles = ledger.cycles.map(item => item.id === cycle.id ? cycle : item);

  const transaction: VirtualTransaction = {
    id: transactionId,
    sourceSignalId: input.sourceSignalId,
    cycleId: current.cycleId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    code: input.code,
    name: input.name,
    type: 'sell',
    intent: position ? 'reduce' : 'exit',
    shares: input.shares,
    price: input.price,
    amount,
    tradedAt: input.tradedAt,
    positionSharesAfter: remainingShares,
    availableSharesAfter: 0,
    realizedProfit,
    reasons: [...input.reasons],
  };
  ledger.transactions.push(transaction);
  transaction.availableSharesAfter = calculateVirtualAvailability(
    ledger,
    input.code,
    input.strategyId,
    input.tradedAt,
  ).availableShares;

  return { ledger, position, transaction, cycle };
}
