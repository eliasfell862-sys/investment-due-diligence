import type { LiveTradingProfile } from './live-trading-types';

function positive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name}必须大于0`);
}

export function validateLiveTradingProfile<T extends LiveTradingProfile>(profile: T): T {
  positive('资金池', profile.capitalPool);
  positive('最大投入', profile.maximumInvested);
  positive('预留现金', profile.reservedCash);
  positive('最大持仓数', profile.maximumPositions);
  positive('单股上限', profile.maximumPerStock);
  positive('单笔最大计划损失', profile.maximumPlannedLoss);
  positive('每日熔断上限', profile.dailyCircuitBreaker);
  positive('订单有效期', profile.orderTtlSeconds);
  if (!Number.isInteger(profile.maximumPositions)) throw new Error('最大持仓数必须是整数');
  if (profile.boardLot !== 100) throw new Error('A股整手股数必须为100股');
  if (profile.maximumTTradeAvailableRatio !== 0.35) throw new Error('做T数量上限必须为可用股数的35%');
  if (profile.maximumInvested + profile.reservedCash > profile.capitalPool) {
    throw new Error('最大投入与预留现金不能超过资金池');
  }
  if (profile.maximumPerStock > profile.maximumInvested) throw new Error('单股上限不能超过最大投入');
  return profile;
}

export const SHADOW_LIVE_TRADING_PROFILE = Object.freeze(validateLiveTradingProfile({
  mode: 'shadow',
  capitalPool: 7_000,
  maximumInvested: 5_600,
  reservedCash: 1_400,
  maximumPositions: 2,
  maximumPerStock: 3_500,
  maximumPlannedLoss: 140,
  dailyCircuitBreaker: 210,
  boardLot: 100,
  maximumTTradeAvailableRatio: 0.35,
  orderTtlSeconds: 30,
} satisfies LiveTradingProfile));

export type { LiveTradingProfile } from './live-trading-types';
