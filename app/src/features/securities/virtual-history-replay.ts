import { sha256Hex } from '../../shared/crypto/sha256';
import {
  applyVirtualCashFlow,
  createVirtualCashAccount,
  VirtualCashError,
} from './virtual-cash-account';
import {
  DEFAULT_TRADING_FEE_PROFILE,
  estimateTradeFees,
  type TradingFeeProfile,
} from './t-trading/trading-fee-engine';
import type {
  VirtualPosition,
  VirtualTradeCycle,
  VirtualTransaction,
  VirtualTradingLedger,
} from './virtual-trading-ledger';

export interface VirtualCapitalCleanupPreview {
  snapshotHash: string;
  snapshotAt: string;
  originalTransactionCount: number;
  retainedTransactionIds: string[];
  removedTransactionIds: string[];
  removedCycleIds: string[];
  removedCodes: string[];
  rebuiltPositionCount: number;
  endingCash: number;
  investedCost: number;
  cumulativeFees: number;
  containsEstimatedFees: boolean;
  rebuiltLedger: VirtualTradingLedger;
}

interface ReplayLot {
  retained: boolean;
  remainingShares: number;
}

interface ResolvedTradeMoney {
  grossAmount: number;
  feeAmount: number;
  feeProfile: TradingFeeProfile;
  feeEstimated: boolean;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function orderedTransactions(input: VirtualTradingLedger): VirtualTransaction[] {
  return [...input.transactions].sort((left, right) => (
    left.tradedAt.localeCompare(right.tradedAt) || left.id.localeCompare(right.id)
  ));
}

function cloneFeeProfile(profile: TradingFeeProfile): TradingFeeProfile {
  return {
    commissionRate: profile.commissionRate,
    minimumCommission: profile.minimumCommission,
    sellStampDutyRate: profile.sellStampDutyRate,
    transferFeeRate: profile.transferFeeRate,
    slippageMode: profile.slippageMode,
    fixedSlippageRate: profile.fixedSlippageRate,
    updatedAt: profile.updatedAt,
  };
}

function resolveTradeMoney(transaction: VirtualTransaction): ResolvedTradeMoney {
  const grossAmount = money(transaction.grossAmount ?? transaction.amount
    ?? transaction.price * transaction.shares);
  const feeProfile = transaction.feeProfileSnapshot ?? DEFAULT_TRADING_FEE_PROFILE;
  if (Number.isFinite(transaction.feeAmount) && transaction.feeAmount! >= 0) {
    return {
      grossAmount,
      feeAmount: money(transaction.feeAmount!),
      feeProfile: cloneFeeProfile(feeProfile),
      feeEstimated: transaction.feeEstimated ?? false,
    };
  }
  const estimate = estimateTradeFees({
    side: transaction.type,
    price: transaction.price,
    shares: transaction.shares,
    profile: feeProfile,
    liquidity: {
      averageDailyAmount: Math.max(grossAmount * 1_000, 1),
      orderAmount: grossAmount,
    },
  });
  return {
    grossAmount,
    feeAmount: estimate.total,
    feeProfile: cloneFeeProfile(feeProfile),
    feeEstimated: true,
  };
}

function canonicalSnapshot(input: VirtualTradingLedger): string {
  const transactions = orderedTransactions(input).map(transaction => {
    const resolved = resolveTradeMoney(transaction);
    return {
      id: transaction.id,
      sourceSignalId: transaction.sourceSignalId,
      cycleId: transaction.cycleId,
      strategyId: transaction.strategyId,
      strategyVersion: transaction.strategyVersion,
      code: transaction.code,
      name: transaction.name,
      type: transaction.type,
      intent: transaction.intent,
      shares: transaction.shares,
      price: transaction.price,
      grossAmount: resolved.grossAmount,
      feeAmount: resolved.feeAmount,
      feeEstimated: resolved.feeEstimated,
      feeProfileSnapshot: resolved.feeProfile,
      tradedAt: transaction.tradedAt,
    };
  });
  return JSON.stringify({ initialCapital: 200_000, transactions });
}

function consumeOriginalLots(lots: ReplayLot[], shares: number): { complete: boolean; retained: boolean } {
  let remaining = shares;
  let retained = true;
  for (const lot of lots) {
    if (remaining <= 0) break;
    if (lot.remainingShares <= 0) continue;
    const consumed = Math.min(remaining, lot.remainingShares);
    lot.remainingShares -= consumed;
    remaining -= consumed;
    if (!lot.retained) retained = false;
  }
  return { complete: remaining === 0, retained };
}

function cloneTransaction(
  transaction: VirtualTransaction,
  moneySnapshot: ResolvedTradeMoney,
  cashDelta: number,
  cashBalanceAfter: number,
  positionSharesAfter: number,
  realizedProfit: number,
): VirtualTransaction {
  return {
    ...transaction,
    amount: moneySnapshot.grossAmount,
    grossAmount: moneySnapshot.grossAmount,
    feeAmount: moneySnapshot.feeAmount,
    cashDelta,
    cashBalanceAfter,
    feeProfileSnapshot: cloneFeeProfile(moneySnapshot.feeProfile),
    feeEstimated: moneySnapshot.feeEstimated,
    positionSharesAfter,
    availableSharesAfter: Math.min(transaction.availableSharesAfter, positionSharesAfter),
    realizedProfit,
    reasons: [...transaction.reasons],
  };
}

function updateBuyState(
  positions: Map<string, VirtualPosition>,
  cycles: Map<string, VirtualTradeCycle>,
  transaction: VirtualTransaction,
  cashCost: number,
): { position: VirtualPosition; cycle: VirtualTradeCycle } {
  const current = positions.get(transaction.cycleId);
  const shares = (current?.shares ?? 0) + transaction.shares;
  const totalCost = money((current?.totalCost ?? 0) + cashCost);
  const position: VirtualPosition = {
    id: current?.id ?? `position-${transaction.cycleId}`,
    cycleId: transaction.cycleId,
    strategyId: transaction.strategyId,
    strategyVersion: transaction.strategyVersion,
    code: transaction.code,
    name: transaction.name,
    shares,
    averageCost: money(totalCost / shares),
    totalCost,
    openedAt: current?.openedAt ?? transaction.tradedAt,
    updatedAt: transaction.tradedAt,
    sourceTradeIds: [...(current?.sourceTradeIds ?? []), transaction.id],
  };
  positions.set(transaction.cycleId, position);

  const currentCycle = cycles.get(transaction.cycleId);
  const cycle: VirtualTradeCycle = currentCycle
    ? {
        ...currentCycle,
        buyAmount: money(currentCycle.buyAmount + cashCost),
        transactionIds: [...currentCycle.transactionIds, transaction.id],
      }
    : {
        id: transaction.cycleId,
        strategyId: transaction.strategyId,
        strategyVersion: transaction.strategyVersion,
        code: transaction.code,
        name: transaction.name,
        status: 'open',
        openedAt: transaction.tradedAt,
        closedAt: null,
        buyAmount: cashCost,
        sellAmount: 0,
        realizedProfit: 0,
        returnPct: null,
        transactionIds: [transaction.id],
      };
  cycles.set(transaction.cycleId, cycle);
  return { position, cycle };
}

function updateSellState(
  positions: Map<string, VirtualPosition>,
  cycles: Map<string, VirtualTradeCycle>,
  transaction: VirtualTransaction,
  netProceeds: number,
): { positionSharesAfter: number; realizedProfit: number } | null {
  const current = positions.get(transaction.cycleId);
  const currentCycle = cycles.get(transaction.cycleId);
  if (!current || !currentCycle || current.shares < transaction.shares) return null;

  const remainingShares = current.shares - transaction.shares;
  const allocatedCost = money(current.averageCost * transaction.shares);
  const realizedProfit = money(netProceeds - allocatedCost);
  if (remainingShares > 0) {
    positions.set(transaction.cycleId, {
      ...current,
      shares: remainingShares,
      totalCost: money(current.averageCost * remainingShares),
      updatedAt: transaction.tradedAt,
    });
  } else {
    positions.delete(transaction.cycleId);
  }

  const cycleRealizedProfit = money(currentCycle.realizedProfit + realizedProfit);
  cycles.set(transaction.cycleId, {
    ...currentCycle,
    status: remainingShares > 0 ? 'open' : 'closed',
    closedAt: remainingShares > 0 ? null : transaction.tradedAt,
    sellAmount: money(currentCycle.sellAmount + netProceeds),
    realizedProfit: cycleRealizedProfit,
    returnPct: remainingShares > 0 || currentCycle.buyAmount <= 0
      ? null
      : money(cycleRealizedProfit / currentCycle.buyAmount * 100),
    transactionIds: [...currentCycle.transactionIds, transaction.id],
  });
  return { positionSharesAfter: remainingShares, realizedProfit };
}

export function previewVirtualCapitalCleanup(
  input: VirtualTradingLedger,
): VirtualCapitalCleanupPreview {
  const ordered = orderedTransactions(input);
  const snapshotAt = ordered.at(-1)?.tradedAt ?? input.cashAccount.updatedAt;
  let cashAccount = createVirtualCashAccount(ordered[0]?.tradedAt ?? snapshotAt);
  const lotsByCycle = new Map<string, ReplayLot[]>();
  const positions = new Map<string, VirtualPosition>();
  const cycles = new Map<string, VirtualTradeCycle>();
  const retainedTransactions: VirtualTransaction[] = [];
  const retainedTransactionIds: string[] = [];
  const removedTransactionIds: string[] = [];
  const removedCodes = new Set<string>();
  let cumulativeFees = 0;
  let containsEstimatedFees = false;

  for (const transaction of ordered) {
    const resolved = resolveTradeMoney(transaction);
    containsEstimatedFees ||= resolved.feeEstimated;
    const lots = lotsByCycle.get(transaction.cycleId) ?? [];
    lotsByCycle.set(transaction.cycleId, lots);

    if (transaction.type === 'buy') {
      let retained = true;
      let flow: ReturnType<typeof applyVirtualCashFlow> | null = null;
      try {
        flow = applyVirtualCashFlow(cashAccount, {
          side: 'buy',
          grossAmount: resolved.grossAmount,
          feeAmount: resolved.feeAmount,
          occurredAt: transaction.tradedAt,
        });
      } catch (error) {
        if (!(error instanceof VirtualCashError) || error.code !== 'virtual_cash_insufficient') throw error;
        retained = false;
      }
      lots.push({ retained, remainingShares: transaction.shares });
      if (!retained || !flow) {
        removedTransactionIds.push(transaction.id);
        removedCodes.add(transaction.code);
        continue;
      }

      cashAccount = flow.account;
      const cashCost = money(resolved.grossAmount + resolved.feeAmount);
      const { position } = updateBuyState(positions, cycles, transaction, cashCost);
      retainedTransactions.push(cloneTransaction(
        transaction, resolved, flow.cashDelta, cashAccount.cashBalance, position.shares, 0,
      ));
      retainedTransactionIds.push(transaction.id);
      cumulativeFees = money(cumulativeFees + resolved.feeAmount);
      continue;
    }

    const dependency = consumeOriginalLots(lots, transaction.shares);
    if (!dependency.complete || !dependency.retained) {
      removedTransactionIds.push(transaction.id);
      removedCodes.add(transaction.code);
      continue;
    }
    const netProceeds = money(resolved.grossAmount - resolved.feeAmount);
    const state = updateSellState(positions, cycles, transaction, netProceeds);
    if (!state) {
      removedTransactionIds.push(transaction.id);
      removedCodes.add(transaction.code);
      continue;
    }
    const flow = applyVirtualCashFlow(cashAccount, {
      side: 'sell',
      grossAmount: resolved.grossAmount,
      feeAmount: resolved.feeAmount,
      occurredAt: transaction.tradedAt,
    });
    cashAccount = flow.account;
    retainedTransactions.push(cloneTransaction(
      transaction,
      resolved,
      flow.cashDelta,
      cashAccount.cashBalance,
      state.positionSharesAfter,
      state.realizedProfit,
    ));
    retainedTransactionIds.push(transaction.id);
    cumulativeFees = money(cumulativeFees + resolved.feeAmount);
  }

  const retainedCycles = new Set(retainedTransactions.map(transaction => transaction.cycleId));
  const sourceCycles = new Set([
    ...input.cycles.map(cycle => cycle.id),
    ...ordered.map(transaction => transaction.cycleId),
  ]);
  const removedCycleIds = [...sourceCycles]
    .filter(cycleId => !retainedCycles.has(cycleId))
    .sort();
  const rebuiltPositions = [...positions.values()]
    .sort((left, right) => left.openedAt.localeCompare(right.openedAt) || left.id.localeCompare(right.id));
  const rebuiltCycles = [...cycles.values()]
    .sort((left, right) => left.openedAt.localeCompare(right.openedAt) || left.id.localeCompare(right.id));
  const investedCost = money(rebuiltPositions.reduce((sum, position) => sum + position.totalCost, 0));
  const rebuiltLedger: VirtualTradingLedger = {
    version: 2,
    cashAccount,
    positions: rebuiltPositions,
    transactions: retainedTransactions,
    cycles: rebuiltCycles,
    requiresCapitalCleanup: false,
  };

  return {
    snapshotHash: sha256Hex(canonicalSnapshot(input)),
    snapshotAt,
    originalTransactionCount: ordered.length,
    retainedTransactionIds,
    removedTransactionIds,
    removedCycleIds,
    removedCodes: [...removedCodes].sort(),
    rebuiltPositionCount: rebuiltPositions.length,
    endingCash: cashAccount.cashBalance,
    investedCost,
    cumulativeFees,
    containsEstimatedFees,
    rebuiltLedger,
  };
}
