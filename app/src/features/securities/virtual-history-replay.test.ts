import { describe, expect, it } from 'vitest';
import type {
  VirtualTransaction,
  VirtualTradingLedger,
} from './virtual-trading-ledger';
import { previewVirtualCapitalCleanup } from './virtual-history-replay';

const ZERO_FEE_PROFILE = {
  commissionRate: 0,
  minimumCommission: 0,
  sellStampDutyRate: 0,
  transferFeeRate: 0,
  slippageMode: 'fixed' as const,
  fixedSlippageRate: 0,
  updatedAt: null,
};

function transaction(overrides: Partial<VirtualTransaction> & Pick<VirtualTransaction, 'id' | 'type'>): VirtualTransaction {
  const { id, type, ...rest } = overrides;
  const shares = rest.shares ?? 100;
  const price = rest.price ?? 10;
  const grossAmount = shares * price;
  return {
    id,
    sourceSignalId: `signal-${id}`,
    cycleId: rest.cycleId ?? `cycle-${id}`,
    strategyId: rest.strategyId ?? 'realtime-technical',
    strategyVersion: '1',
    code: rest.code ?? '000001',
    name: rest.name ?? '测试股票',
    type,
    intent: type === 'buy' ? 'open' : 'exit',
    shares,
    price,
    amount: grossAmount,
    grossAmount,
    feeAmount: 0,
    cashDelta: type === 'buy' ? -grossAmount : grossAmount,
    cashBalanceAfter: 0,
    feeProfileSnapshot: ZERO_FEE_PROFILE,
    feeEstimated: false,
    tradedAt: rest.tradedAt ?? '2026-08-18T02:00:00.000Z',
    positionSharesAfter: 0,
    availableSharesAfter: 0,
    realizedProfit: 0,
    reasons: [],
    ...rest,
  };
}

function history(transactions: VirtualTransaction[]): VirtualTradingLedger {
  return {
    version: 2,
    cashAccount: {
      initialCapital: 200_000,
      cashBalance: 0,
      reservedCash: 0,
      version: transactions.length,
      updatedAt: transactions.at(-1)?.tradedAt ?? '2026-08-18T00:00:00.000Z',
    },
    positions: [],
    transactions,
    cycles: [],
    requiresCapitalCleanup: true,
  };
}

describe('virtual capital cleanup preview', () => {
  it('keeps ordered trades until cash is insufficient and removes dependent sells', () => {
    const firstBuy = transaction({
      id: 'a', type: 'buy', cycleId: 'cycle-a', code: '000001', price: 1200,
      tradedAt: '2026-08-18T01:00:00.000Z',
    });
    const rejectedBuy = transaction({
      id: 'b', type: 'buy', cycleId: 'cycle-b', code: '000002', price: 900,
      tradedAt: '2026-08-18T02:00:00.000Z',
    });
    const dependentSell = transaction({
      id: 'c', type: 'sell', cycleId: 'cycle-b', code: '000002', price: 100,
      tradedAt: '2026-08-19T02:00:00.000Z',
    });

    const preview = previewVirtualCapitalCleanup(history([firstBuy, rejectedBuy, dependentSell]));

    expect(preview.retainedTransactionIds).toEqual(['a']);
    expect(preview.removedTransactionIds).toEqual(['b', 'c']);
    expect(preview.removedCycleIds).toEqual(['cycle-b']);
    expect(preview.removedCodes).toEqual(['000002']);
    expect(preview.endingCash).toBe(80_000);
    expect(preview.rebuiltLedger.cashAccount.cashBalance).toBeGreaterThanOrEqual(0);
  });

  it('allows a later buy after a retained sell releases net cash', () => {
    const transactions = [
      transaction({
        id: 'a', type: 'buy', cycleId: 'cycle-a', price: 1500,
        tradedAt: '2026-08-18T01:00:00.000Z',
      }),
      transaction({
        id: 'b', type: 'sell', cycleId: 'cycle-a', price: 1000,
        tradedAt: '2026-08-19T01:00:00.000Z',
      }),
      transaction({
        id: 'c', type: 'buy', cycleId: 'cycle-c', code: '000003', price: 1000,
        tradedAt: '2026-08-20T01:00:00.000Z',
      }),
    ];

    const preview = previewVirtualCapitalCleanup(history(transactions));

    expect(preview.removedTransactionIds).toEqual([]);
    expect(preview.retainedTransactionIds).toEqual(['a', 'b', 'c']);
    expect(preview.endingCash).toBe(50_000);
  });

  it('uses tradedAt then id ordering and produces a stable canonical hash', () => {
    const transactions = [
      transaction({ id: 'b', type: 'buy', tradedAt: '2026-08-18T01:00:00.000Z' }),
      transaction({ id: 'a', type: 'buy', code: '000002', tradedAt: '2026-08-18T01:00:00.000Z' }),
    ];
    const reorderedFeeProfile = {
      updatedAt: null,
      fixedSlippageRate: 0,
      slippageMode: 'fixed' as const,
      transferFeeRate: 0,
      sellStampDutyRate: 0,
      minimumCommission: 0,
      commissionRate: 0,
    };
    const reorderedTransactions = [...transactions].reverse().map(item => ({
      ...item,
      feeProfileSnapshot: reorderedFeeProfile,
    }));

    const first = previewVirtualCapitalCleanup(history(transactions));
    const second = previewVirtualCapitalCleanup(history(reorderedTransactions));

    expect(first.retainedTransactionIds).toEqual(['a', 'b']);
    expect(first.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.snapshotHash).toBe(first.snapshotHash);
  });
});
