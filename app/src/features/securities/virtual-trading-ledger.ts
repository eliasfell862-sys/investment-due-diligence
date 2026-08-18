import { nextAStockTradingDay, shanghaiDateKey } from './a-share-trading-calendar';
import {
  DEFAULT_TRADING_FEE_PROFILE,
  estimateTradeFees,
  type TradingFeeProfile,
} from './t-trading/trading-fee-engine';
import {
  applyVirtualCashFlow,
  createVirtualCashAccount,
  VirtualCashError,
  type VirtualCashAccount,
} from './virtual-cash-account';

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
  grossAmount?: number;
  feeAmount?: number;
  cashDelta?: number;
  cashBalanceAfter?: number;
  feeProfileSnapshot?: TradingFeeProfile;
  feeEstimated?: boolean;
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
  version: 2;
  cashAccount: VirtualCashAccount;
  positions: VirtualPosition[];
  transactions: VirtualTransaction[];
  cycles: VirtualTradeCycle[];
  requiresCapitalCleanup: boolean;
}

export type LegacyVirtualTransaction = Omit<VirtualTransaction,
  'grossAmount' | 'feeAmount' | 'cashDelta' | 'cashBalanceAfter'
  | 'feeProfileSnapshot' | 'feeEstimated'>;

export interface LegacyVirtualTradingLedger {
  version: 1;
  positions: VirtualPosition[];
  transactions: LegacyVirtualTransaction[];
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
  feeProfile?: TradingFeeProfile;
  averageDailyAmount?: number;
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

const EMPTY_LEDGER_AT = '1970-01-01T00:00:00.000Z';
const LEGACY_ZERO_FEE_PROFILE: TradingFeeProfile = {
  ...DEFAULT_TRADING_FEE_PROFILE,
  commissionRate: 0,
  minimumCommission: 0,
  sellStampDutyRate: 0,
  transferFeeRate: 0,
  slippageMode: 'fixed',
  fixedSlippageRate: 0,
  updatedAt: null,
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function defaultCreateId(kind: 'position' | 'transaction' | 'cycle'): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${suffix}`;
}

function cloneFeeProfile(profile: TradingFeeProfile): TradingFeeProfile {
  return { ...profile };
}

function cloneLedger(ledger: VirtualTradingLedger): VirtualTradingLedger {
  return {
    version: 2,
    cashAccount: { ...ledger.cashAccount },
    requiresCapitalCleanup: ledger.requiresCapitalCleanup,
    positions: ledger.positions.map(position => ({
      ...position,
      sourceTradeIds: [...position.sourceTradeIds],
    })),
    transactions: ledger.transactions.map(transaction => ({
      ...transaction,
      reasons: [...transaction.reasons],
      feeProfileSnapshot: transaction.feeProfileSnapshot
        ? cloneFeeProfile(transaction.feeProfileSnapshot) : undefined,
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

function resolveFeeProfile(input: BuyVirtualPositionInput): TradingFeeProfile {
  return input.feeProfile ?? LEGACY_ZERO_FEE_PROFILE;
}

function estimateFees(input: BuyVirtualPositionInput, side: 'buy' | 'sell') {
  const grossAmount = roundMoney(input.shares * input.price);
  const profile = resolveFeeProfile(input);
  const fees = estimateTradeFees({
    side,
    price: input.price,
    shares: input.shares,
    profile,
    liquidity: {
      averageDailyAmount: input.averageDailyAmount ?? Math.max(grossAmount * 1_000, 1),
      orderAmount: grossAmount,
    },
  });
  return { grossAmount, feeAmount: fees.total, profile };
}

export function createEmptyVirtualTradingLedger(
  updatedAt = EMPTY_LEDGER_AT,
): VirtualTradingLedger {
  return {
    version: 2,
    cashAccount: createVirtualCashAccount(updatedAt),
    positions: [],
    transactions: [],
    cycles: [],
    requiresCapitalCleanup: false,
  };
}

export function migrateVirtualTradingLedger(
  input: LegacyVirtualTradingLedger | VirtualTradingLedger,
  feeProfile: TradingFeeProfile = LEGACY_ZERO_FEE_PROFILE,
): VirtualTradingLedger {
  if (input.version === 2) return cloneLedger(input);
  const ordered = [...input.transactions].sort((left, right) => (
    left.tradedAt.localeCompare(right.tradedAt) || left.id.localeCompare(right.id)
  ));
  let cashAccount = createVirtualCashAccount(ordered[0]?.tradedAt ?? EMPTY_LEDGER_AT);
  let requiresCapitalCleanup = false;
  const rejectedCycles = new Set<string>();
  const transactions: VirtualTransaction[] = [];

  for (const transaction of ordered) {
    const grossAmount = roundMoney(transaction.price * transaction.shares);
    const fees = estimateTradeFees({
      side: transaction.type,
      price: transaction.price,
      shares: transaction.shares,
      profile: feeProfile,
      liquidity: { averageDailyAmount: Math.max(grossAmount * 1_000, 1), orderAmount: grossAmount },
    });
    let cashDelta = transaction.type === 'buy'
      ? -roundMoney(grossAmount + fees.total)
      : roundMoney(grossAmount - fees.total);
    if (rejectedCycles.has(transaction.cycleId)) {
      requiresCapitalCleanup = true;
      cashDelta = 0;
    } else {
      try {
        cashAccount = applyVirtualCashFlow(cashAccount, {
          side: transaction.type,
          grossAmount,
          feeAmount: fees.total,
          occurredAt: transaction.tradedAt,
        }).account;
      } catch (error) {
        if (!(error instanceof VirtualCashError) || error.code !== 'virtual_cash_insufficient') throw error;
        requiresCapitalCleanup = true;
        rejectedCycles.add(transaction.cycleId);
        cashDelta = 0;
      }
    }
    transactions.push({
      ...transaction,
      amount: grossAmount,
      grossAmount,
      feeAmount: fees.total,
      cashDelta,
      cashBalanceAfter: cashAccount.cashBalance,
      feeProfileSnapshot: cloneFeeProfile(feeProfile),
      feeEstimated: true,
      reasons: [...transaction.reasons],
    });
  }

  return {
    version: 2,
    cashAccount,
    requiresCapitalCleanup,
    positions: input.positions.map(position => ({
      ...position,
      sourceTradeIds: [...position.sourceTradeIds],
    })),
    transactions,
    cycles: input.cycles.map(cycle => ({
      ...cycle,
      transactionIds: [...cycle.transactionIds],
    })),
  };
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
  const { grossAmount, feeAmount, profile } = estimateFees(input, 'buy');
  const cashFlow = applyVirtualCashFlow(inputLedger.cashAccount, {
    side: 'buy', grossAmount, feeAmount, occurredAt: input.tradedAt,
  });
  const ledger = cloneLedger(inputLedger);
  ledger.cashAccount = cashFlow.account;
  const createId = options.createId ?? defaultCreateId;
  const current = findVirtualPosition(ledger, input.code, input.strategyId);
  const transactionId = createId('transaction');
  const cycleId = current?.cycleId ?? createId('cycle');
  const positionId = current?.id ?? createId('position');
  const cashCost = roundMoney(grossAmount + feeAmount);
  const totalShares = (current?.shares ?? 0) + input.shares;
  const totalCost = roundMoney((current?.totalCost ?? 0) + cashCost);
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
        buyAmount: roundMoney(existingCycle.buyAmount + cashCost),
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
        buyAmount: cashCost,
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
    amount: grossAmount,
    grossAmount,
    feeAmount,
    cashDelta: cashFlow.cashDelta,
    cashBalanceAfter: cashFlow.account.cashBalance,
    feeProfileSnapshot: cloneFeeProfile(profile),
    feeEstimated: false,
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

  const { grossAmount, feeAmount, profile } = estimateFees(input, 'sell');
  const cashFlow = applyVirtualCashFlow(inputLedger.cashAccount, {
    side: 'sell', grossAmount, feeAmount, occurredAt: input.tradedAt,
  });
  const ledger = cloneLedger(inputLedger);
  ledger.cashAccount = cashFlow.account;
  const createId = options.createId ?? defaultCreateId;
  const transactionId = createId('transaction');
  const remainingShares = current.shares - input.shares;
  const allocatedCost = roundMoney(current.averageCost * input.shares);
  const netProceeds = roundMoney(grossAmount - feeAmount);
  const realizedProfit = roundMoney(netProceeds - allocatedCost);
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
    sellAmount: roundMoney(existingCycle.sellAmount + netProceeds),
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
    amount: grossAmount,
    grossAmount,
    feeAmount,
    cashDelta: cashFlow.cashDelta,
    cashBalanceAfter: cashFlow.account.cashBalance,
    feeProfileSnapshot: cloneFeeProfile(profile),
    feeEstimated: false,
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
