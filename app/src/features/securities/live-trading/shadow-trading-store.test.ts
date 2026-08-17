import { describe, expect, it } from 'vitest';
import type { ShadowFill, ShadowOrder } from './live-trading-types';
import { createShadowTradingStore } from './shadow-trading-store';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

function order(overrides: Partial<ShadowOrder> = {}): ShadowOrder {
  return {
    id: 'o1', idempotencyKey: 'key-1', kind: 'core_buy', code: '000333', name: 'Midea',
    side: 'buy', limitPrice: 10, shares: 100, stopPrice: 9.5,
    createdAt: '2026-08-17T01:30:00.000Z', expiresAt: '2026-08-17T01:30:30.000Z',
    requiresUserConfirmation: false, feeProfile: {} as ShadowOrder['feeProfile'], reasons: [],
    status: 'eligible', submittedAt: null, filledShares: 0, averageFillPrice: null,
    brokerOrderId: null, failureKind: null, ...overrides,
  };
}

function tSellFill(): ShadowFill {
  return {
    id: 'f1', orderId: 'o1', code: '000333', side: 'sell', price: 12,
    shares: 100, fees: 5, filledAt: '2026-08-17T02:00:00.000Z',
  };
}

describe('shadow trading store', () => {
  it('does not append the same idempotency key twice', () => {
    const store = createShadowTradingStore(memoryStorage(), 'user-a');
    store.append(order());
    expect(() => store.append(order({ id: 'o2' }))).toThrow('duplicate_shadow_order');
  });

  it('persists data under an account-scoped key', () => {
    const storage = memoryStorage();
    createShadowTradingStore(storage, 'user-a').append(order());
    expect(createShadowTradingStore(storage, 'user-a').snapshot().orders).toHaveLength(1);
    expect(createShadowTradingStore(storage, 'user-b').snapshot().orders).toHaveLength(0);
  });

  it('reserves T-sale proceeds and expected buyback fees from core-buy cash', () => {
    const store = createShadowTradingStore(memoryStorage(), 'user-a');
    store.recordTSellFill(tSellFill(), 5.2);
    expect(store.snapshot().reservedTBuybackCash).toBe(1_205.2);
    expect(store.availableCashFor('core_buy', 7_000)).toBe(5_794.8);
    expect(store.availableCashFor('t_buyback', 7_000)).toBe(7_000);
  });

  it('releases a T reserve only after buyback or reduction resolution', () => {
    const store = createShadowTradingStore(memoryStorage(), 'user-a');
    store.recordTSellFill(tSellFill(), 5.2);
    store.resolveTReserve('f1');
    expect(store.snapshot().reservedTBuybackCash).toBe(0);
  });
});
