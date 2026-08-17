import { describe, expect, it } from 'vitest';
import { DEFAULT_TRADING_FEE_PROFILE } from '../t-trading/trading-fee-engine';
import { SHADOW_LIVE_TRADING_PROFILE } from './live-trading-profile';
import {
  evaluateDailyCircuitBreaker,
  maximumTTradeShares,
  planLiveBuy,
  type PlanLiveBuyInput,
} from './live-trading-risk-engine';

function input(overrides: Partial<PlanLiveBuyInput> = {}): PlanLiveBuyInput {
  return {
    profile: SHADOW_LIVE_TRADING_PROFILE,
    feeProfile: DEFAULT_TRADING_FEE_PROFILE,
    limitPrice: 20,
    stopPrice: 19,
    availableCash: 7_000,
    currentInvested: 0,
    currentStockMarketValue: 0,
    currentPositionCount: 0,
    alreadyHoldsStock: false,
    reservedTBuybackCash: 0,
    realizedProfitToday: 0,
    paidFeesToday: 0,
    averageDailyAmount: 100_000_000,
    ...overrides,
  };
}

describe('live trading risk engine', () => {
  it('keeps CNY 1,400 reserved and sizes to one board lot', () => {
    const result = planLiveBuy(input());
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.shares).toBe(100);
    expect(result.projectedInvested).toBeLessThanOrEqual(5_600);
    expect(result.projectedAvailableCash).toBeGreaterThanOrEqual(1_400);
    expect(result.plannedLoss).toBeLessThanOrEqual(140);
  });

  it('rejects when one board lot exceeds the CNY 140 planned-loss limit after fees', () => {
    const result = planLiveBuy(input({ limitPrice: 30, stopPrice: 28.5 }));
    expect(result).toMatchObject({ allowed: false, reason: 'planned_loss_limit' });
  });

  it('blocks a new stock when two positions already exist', () => {
    expect(planLiveBuy(input({ currentPositionCount: 2 })))
      .toMatchObject({ allowed: false, reason: 'position_count_limit' });
  });

  it('does not let a core buy consume T-buyback reserved cash', () => {
    expect(planLiveBuy(input({ availableCash: 3_000, reservedTBuybackCash: 1_000 })))
      .toMatchObject({ allowed: false, reason: 'cash_or_reserve_limit' });
  });

  it('blocks new buys at CNY 210 daily realized loss plus fees', () => {
    expect(evaluateDailyCircuitBreaker({ realizedProfit: -190, paidFees: 20, limit: 210 }))
      .toEqual({ tripped: true, lossWithFees: 210 });
    expect(planLiveBuy(input({ realizedProfitToday: -190, paidFeesToday: 20 })))
      .toMatchObject({ allowed: false, reason: 'daily_circuit_breaker' });
  });

  it('caps T shares at 35 percent and rounds down to a board lot', () => {
    expect(maximumTTradeShares(1_000, SHADOW_LIVE_TRADING_PROFILE)).toBe(300);
    expect(maximumTTradeShares(200, SHADOW_LIVE_TRADING_PROFILE)).toBe(0);
  });
});
