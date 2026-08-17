import { describe, expect, it } from 'vitest';
import type { ShadowOrder } from './live-trading-types';
import { transitionShadowOrder } from './shadow-order-machine';

function order(overrides: Partial<ShadowOrder> = {}): ShadowOrder {
  return {
    id: 'o1', idempotencyKey: 'key-1', kind: 'core_buy', code: '000333', name: 'Midea',
    side: 'buy', limitPrice: 10, shares: 100, stopPrice: 9.5,
    createdAt: '2026-08-17T01:30:00.000Z', expiresAt: '2026-08-17T01:30:30.000Z',
    requiresUserConfirmation: false,
    feeProfile: {} as ShadowOrder['feeProfile'], reasons: [], status: 'submitted',
    submittedAt: '2026-08-17T01:30:01.000Z', filledShares: 0, averageFillPrice: null,
    brokerOrderId: null, failureKind: null, ...overrides,
  };
}

describe('shadow order machine', () => {
  it('expires an unfilled submitted order after its deadline', () => {
    expect(transitionShadowOrder(order(), { type: 'clock', at: '2026-08-17T01:30:31.000Z' }).status)
      .toBe('expired');
  });

  it('records a partial fill and then a completed fill', () => {
    const partial = transitionShadowOrder(order(), { type: 'fill', shares: 40, price: 10.02 });
    expect(partial).toMatchObject({ status: 'partially_filled', filledShares: 40, averageFillPrice: 10.02 });
    const filled = transitionShadowOrder(partial, { type: 'fill', shares: 60, price: 10.04 });
    expect(filled).toMatchObject({ status: 'filled', filledShares: 100, averageFillPrice: 10.032 });
  });

  it('rejects illegal transitions from a terminal order', () => {
    expect(() => transitionShadowOrder(order({ status: 'filled', filledShares: 100 }), { type: 'cancel' }))
      .toThrow('illegal_shadow_order_transition');
  });
});
