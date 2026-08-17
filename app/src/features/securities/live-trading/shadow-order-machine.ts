import type { ShadowOrder, ShadowOrderStatus } from './live-trading-types';

export type ShadowOrderEvent =
  | { type: 'preauthorize' }
  | { type: 'request_confirmation' }
  | { type: 'begin_submit'; at: string }
  | { type: 'submitted'; at: string }
  | { type: 'fill'; shares: number; price: number }
  | { type: 'cancel' }
  | { type: 'reject'; failureKind: string }
  | { type: 'block'; failureKind: string }
  | { type: 'clock'; at: string };

const terminal = new Set<ShadowOrderStatus>(['filled', 'cancelled', 'rejected', 'expired', 'blocked_by_risk']);

function fail(): never {
  throw new Error('illegal_shadow_order_transition');
}

export function transitionShadowOrder(order: ShadowOrder, event: ShadowOrderEvent): ShadowOrder {
  if (terminal.has(order.status)) return fail();
  if (event.type === 'clock') {
    if (Date.parse(event.at) < Date.parse(order.expiresAt)) return order;
    return { ...order, status: 'expired' };
  }
  if (event.type === 'preauthorize' && order.status === 'eligible') return { ...order, status: 'preauthorized' };
  if (event.type === 'request_confirmation' && order.status === 'eligible') {
    return { ...order, status: 'awaiting_user_confirmation' };
  }
  if (event.type === 'begin_submit' && ['preauthorized', 'awaiting_user_confirmation'].includes(order.status)) {
    return { ...order, status: 'submitting', submittedAt: event.at };
  }
  if (event.type === 'submitted' && order.status === 'submitting') {
    return { ...order, status: 'submitted', submittedAt: order.submittedAt ?? event.at };
  }
  if (event.type === 'cancel' && ['preauthorized', 'awaiting_user_confirmation', 'submitting', 'submitted', 'partially_filled'].includes(order.status)) {
    return { ...order, status: 'cancelled' };
  }
  if (event.type === 'reject' && ['submitting', 'submitted', 'partially_filled'].includes(order.status)) {
    return { ...order, status: 'rejected', failureKind: event.failureKind };
  }
  if (event.type === 'block' && ['eligible', 'preauthorized'].includes(order.status)) {
    return { ...order, status: 'blocked_by_risk', failureKind: event.failureKind };
  }
  if (event.type === 'fill' && ['submitted', 'partially_filled'].includes(order.status)) {
    if (!Number.isFinite(event.shares) || event.shares <= 0 || !Number.isFinite(event.price) || event.price <= 0) return fail();
    const filledShares = order.filledShares + event.shares;
    if (filledShares > order.shares) return fail();
    const previousAmount = (order.averageFillPrice ?? 0) * order.filledShares;
    const averageFillPrice = (previousAmount + event.price * event.shares) / filledShares;
    return {
      ...order,
      status: filledShares === order.shares ? 'filled' : 'partially_filled',
      filledShares,
      averageFillPrice,
    };
  }
  return fail();
}
