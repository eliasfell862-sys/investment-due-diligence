import { describe, expect, it } from 'vitest';
import {
  applyVirtualCashFlow,
  createVirtualCashAccount,
  VirtualCashError,
  VIRTUAL_INITIAL_CAPITAL,
} from './virtual-cash-account';

const AT = '2026-08-18T01:00:00.000Z';

describe('virtual cash account', () => {
  it('starts with one shared CNY 200000 account', () => {
    expect(createVirtualCashAccount(AT)).toEqual({
      initialCapital: VIRTUAL_INITIAL_CAPITAL,
      cashBalance: 200000,
      reservedCash: 0,
      version: 0,
      updatedAt: AT,
    });
  });

  it('rejects a second stock when combined gross amount and fees exceed shared cash', () => {
    const first = applyVirtualCashFlow(createVirtualCashAccount(AT), {
      side: 'buy',
      grossAmount: 150000,
      feeAmount: 10,
      occurredAt: '2026-08-18T01:01:00.000Z',
    });

    expect(() => applyVirtualCashFlow(first.account, {
      side: 'buy',
      grossAmount: 50000,
      feeAmount: 0.01,
      occurredAt: '2026-08-18T01:02:00.000Z',
    })).toThrowError(VirtualCashError);
    expect(first.account.cashBalance).toBe(49990);
  });

  it('does not let ordinary buys consume cash reserved for T buybacks', () => {
    const account = {
      ...createVirtualCashAccount(AT),
      cashBalance: 1000,
      reservedCash: 500,
    };

    expect(() => applyVirtualCashFlow(account, {
      side: 'buy',
      grossAmount: 600,
      feeAmount: 0,
      occurredAt: '2026-08-18T01:01:00.000Z',
    })).toThrowError(new VirtualCashError('virtual_cash_insufficient', 600, 500));
  });
  it('allows a buy that exactly consumes the remaining cash', () => {
    const result = applyVirtualCashFlow(createVirtualCashAccount(AT), {
      side: 'buy',
      grossAmount: 199995,
      feeAmount: 5,
      occurredAt: '2026-08-18T01:01:00.000Z',
    });

    expect(result.account.cashBalance).toBe(0);
    expect(result.cashDelta).toBe(-200000);
  });

  it('reuses only net sell proceeds', () => {
    const bought = applyVirtualCashFlow(createVirtualCashAccount(AT), {
      side: 'buy',
      grossAmount: 100000,
      feeAmount: 8,
      occurredAt: '2026-08-18T01:01:00.000Z',
    });
    const sold = applyVirtualCashFlow(bought.account, {
      side: 'sell',
      grossAmount: 20000,
      feeAmount: 25,
      occurredAt: '2026-08-19T01:01:00.000Z',
    });

    expect(sold.cashDelta).toBe(19975);
    expect(sold.account.cashBalance).toBe(119967);
  });

  it.each([
    { side: 'buy' as const, grossAmount: -1, feeAmount: 0 },
    { side: 'sell' as const, grossAmount: 1, feeAmount: -0.01 },
    { side: 'buy' as const, grossAmount: Number.NaN, feeAmount: 0 },
  ])('rejects invalid cash flow %#', input => {
    expect(() => applyVirtualCashFlow(createVirtualCashAccount(AT), {
      ...input,
      occurredAt: AT,
    })).toThrowError(new VirtualCashError('virtual_cash_invalid', 0, 200000));
  });
});
