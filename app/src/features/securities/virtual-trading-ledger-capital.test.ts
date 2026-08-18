import { describe, expect, it } from 'vitest';
import type { TradingFeeProfile } from './t-trading/trading-fee-engine';
import {
  buyVirtualPosition,
  createEmptyVirtualTradingLedger,
  migrateVirtualTradingLedger,
  sellVirtualPosition,
  type BuyVirtualPositionInput,
  type VirtualLedgerOptions,
} from './virtual-trading-ledger';

const ZERO_FEE_PROFILE: TradingFeeProfile = {
  commissionRate: 0,
  minimumCommission: 0,
  sellStampDutyRate: 0,
  transferFeeRate: 0,
  slippageMode: 'fixed',
  fixedSlippageRate: 0,
  updatedAt: null,
};

const MIN_FEE_PROFILE: TradingFeeProfile = {
  ...ZERO_FEE_PROFILE,
  minimumCommission: 5,
};

let idSequence = 0;
const ids = (): VirtualLedgerOptions => ({ createId: kind => `${kind}-${++idSequence}` });

function buyInput(overrides: Partial<BuyVirtualPositionInput> = {}): BuyVirtualPositionInput {
  return {
    sourceSignalId: 'signal-buy-1',
    strategyId: 'realtime-technical',
    strategyVersion: '1',
    code: '000001',
    name: '股票A',
    shares: 100,
    price: 10,
    tradedAt: '2026-08-06T02:00:00.000Z',
    reasons: ['测试买入'],
    feeProfile: ZERO_FEE_PROFILE,
    averageDailyAmount: 100_000_000,
    ...overrides,
  };
}

describe('virtual trading ledger shared capital', () => {
  it('shares CNY 200000 across different stock positions', () => {
    const first = buyVirtualPosition(
      createEmptyVirtualTradingLedger(),
      buyInput({ price: 1500 }),
      ids(),
    );

    expect(() => buyVirtualPosition(first.ledger, buyInput({
      sourceSignalId: 'signal-buy-2',
      code: '000002',
      name: '股票B',
      price: 501,
    }), ids())).toThrowError(/virtual_cash_insufficient/);
    expect(first.ledger.cashAccount.cashBalance).toBe(50000);
  });

  it('stores fee and post-trade cash snapshots', () => {
    const result = buyVirtualPosition(createEmptyVirtualTradingLedger(), buyInput({
      feeProfile: MIN_FEE_PROFILE,
    }), ids());

    expect(result.transaction).toMatchObject({
      grossAmount: 1000,
      feeAmount: 5,
      cashDelta: -1005,
      cashBalanceAfter: 198995,
      feeEstimated: false,
    });
    expect(result.ledger.cashAccount.cashBalance).toBe(198995);
  });

  it('credits only net sell proceeds and reports fee-adjusted profit', () => {
    const opened = buyVirtualPosition(
      createEmptyVirtualTradingLedger(),
      buyInput({ tradedAt: '2026-08-05T02:00:00.000Z', feeProfile: MIN_FEE_PROFILE }),
      ids(),
    );
    const result = sellVirtualPosition(opened.ledger, {
      ...buyInput({ feeProfile: MIN_FEE_PROFILE }),
      sourceSignalId: 'signal-sell-1',
      price: 12,
      tradedAt: '2026-08-07T02:00:00.000Z',
      reasons: ['测试卖出'],
    }, ids());

    expect(result.transaction).toMatchObject({
      grossAmount: 1200,
      feeAmount: 5,
      cashDelta: 1195,
      cashBalanceAfter: 200190,
      realizedProfit: 190,
    });
  });

  it('migrates an over-cap V1 ledger without silently deleting history', () => {
    const opened = buyVirtualPosition(
      createEmptyVirtualTradingLedger(),
      buyInput({ price: 1500 }),
      ids(),
    );
    const first = opened.ledger.transactions[0];
    const v1 = {
      version: 1 as const,
      positions: opened.ledger.positions,
      transactions: [
        { ...first, amount: 150000 },
        {
          ...first,
          id: 'legacy-trade-2',
          sourceSignalId: 'legacy-signal-2',
          cycleId: 'legacy-cycle-2',
          code: '000002',
          name: '股票B',
          price: 600,
          amount: 60000,
          tradedAt: '2026-08-06T03:00:00.000Z',
        },
      ].map(({ grossAmount: _gross, feeAmount: _fee, cashDelta: _delta,
        cashBalanceAfter: _balance, feeProfileSnapshot: _profile,
        feeEstimated: _estimated, ...transaction }) => transaction),
      cycles: opened.ledger.cycles,
    };

    const migrated = migrateVirtualTradingLedger(v1, ZERO_FEE_PROFILE);

    expect(migrated.version).toBe(2);
    expect(migrated.transactions).toHaveLength(2);
    expect(migrated.requiresCapitalCleanup).toBe(true);
    expect(migrated.cashAccount.cashBalance).toBe(50000);
  });
});
