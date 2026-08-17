import { describe, expect, it } from 'vitest';
import {
  SHADOW_LIVE_TRADING_PROFILE,
  validateLiveTradingProfile,
} from './live-trading-profile';

describe('live trading profile', () => {
  it('freezes the approved capital and risk limits', () => {
    expect(SHADOW_LIVE_TRADING_PROFILE).toMatchObject({
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
    });
    expect(Object.isFrozen(SHADOW_LIVE_TRADING_PROFILE)).toBe(true);
  });

  it('accepts the approved profile', () => {
    expect(validateLiveTradingProfile(SHADOW_LIVE_TRADING_PROFILE))
      .toBe(SHADOW_LIVE_TRADING_PROFILE);
  });

  it('rejects a profile whose invested plus reserved cash exceeds the pool', () => {
    expect(() => validateLiveTradingProfile({
      ...SHADOW_LIVE_TRADING_PROFILE,
      maximumInvested: 6_000,
    })).toThrow('最大投入与预留现金不能超过资金池');
  });

  it('rejects unsupported board lots and T ratios', () => {
    expect(() => validateLiveTradingProfile({
      ...SHADOW_LIVE_TRADING_PROFILE,
      boardLot: 200 as 100,
    })).toThrow('A股整手股数必须为100股');
    expect(() => validateLiveTradingProfile({
      ...SHADOW_LIVE_TRADING_PROFILE,
      maximumTTradeAvailableRatio: 0.5 as 0.35,
    })).toThrow('做T数量上限必须为可用股数的35%');
  });
});
