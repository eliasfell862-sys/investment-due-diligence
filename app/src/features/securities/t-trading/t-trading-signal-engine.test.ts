import { describe, expect, it } from 'vitest';
import { DEFAULT_TRADING_FEE_PROFILE } from './trading-fee-engine';
import {
  evaluateTTradeBuyback,
  evaluateTTradeExpiry,
  evaluateTTradeSell,
  optimizeTTradeShares,
} from './t-trading-signal-engine';
import type { TTradeMarketStructure } from './t-trading-types';

function structure(overrides: Partial<TTradeMarketStructure> = {}): TTradeMarketStructure {
  return {
    sampleDays: 80,
    atr20: 0.8,
    atrp20: 0.0667,
    annualizedVolatility20: 0.28,
    support: 11.2,
    resistance: 12.1,
    volumeRatio20: 1.3,
    obvSlope5: -120,
    flowBias: 'outflow',
    dataQuality: 'ok',
    ...overrides,
  };
}

describe('T-trading sell quantity optimization', () => {
  it('never recommends more than 35% of 1,000 available shares', () => {
    const decision = optimizeTTradeShares({
      availableShares: 1_000,
      sellPrice: 12,
      buybackPrice: 11.2,
      atrp20: 0.0667,
      averageDailyAmount: 20_000_000,
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
    });

    expect(decision.kind).toBe('quantity');
    if (decision.kind !== 'quantity') throw new Error('expected executable quantity');
    expect(decision.shares).toBeGreaterThanOrEqual(100);
    expect(decision.shares).toBeLessThanOrEqual(300);
    expect(decision.shares % 100).toBe(0);
  });

  it('returns no executable quantity when 35% of availability is below one board lot', () => {
    const decision = optimizeTTradeShares({
      availableShares: 100,
      sellPrice: 12,
      buybackPrice: 11.2,
      atrp20: 0.0667,
      averageDailyAmount: 20_000_000,
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
    });

    expect(decision).toEqual({
      kind: 'none',
      maxShares: 0,
      reason: 'below_board_lot',
    });
  });

  it('rejects a low-price spread that cannot cover complete round-trip costs', () => {
    const decision = optimizeTTradeShares({
      availableShares: 1_000,
      sellPrice: 11.05,
      buybackPrice: 11,
      atrp20: 0.02,
      averageDailyAmount: 20_000_000,
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
    });

    expect(decision.kind).toBe('none');
    if (decision.kind !== 'none') throw new Error('expected fee rejection');
    expect(decision.reason).toBe('round_trip_not_profitable');
  });
});

describe('T-trading sell evaluation', () => {
  it('classifies a sell above broker-confirmed average cost as profit T', () => {
    const decision = evaluateTTradeSell({
      availableShares: 1_000,
      averageCost: 11.1,
      currentPrice: 12,
      marketStructure: structure(),
      averageDailyAmount: 20_000_000,
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      intradayRejection: false,
      calibratedBuybackAtr: 0.6,
      evaluatedAt: '2026-08-11T06:30:00.000Z',
      expiresAt: '2026-08-11T07:00:00.000Z',
      strategyVersion: 'actual-t-v1',
    });

    expect(decision.kind).toBe('sell');
    if (decision.kind !== 'sell') throw new Error('expected sell');
    expect(decision.recommendation.cycleType).toBe('profit_t');
  });

  it('requires two technical confirmations for cost-reduction T', () => {
    const weak = evaluateTTradeSell({
      availableShares: 1_000,
      averageCost: 13,
      currentPrice: 12,
      marketStructure: structure({ flowBias: 'neutral', volumeRatio20: 1 }),
      averageDailyAmount: 20_000_000,
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      intradayRejection: false,
      calibratedBuybackAtr: 0.6,
      evaluatedAt: '2026-08-11T06:30:00.000Z',
      expiresAt: '2026-08-11T07:00:00.000Z',
      strategyVersion: 'actual-t-v1',
    });
    expect(weak.kind).toBe('none');

    const confirmed = evaluateTTradeSell({
      availableShares: 1_000,
      averageCost: 13,
      currentPrice: 12,
      marketStructure: structure({ flowBias: 'outflow', volumeRatio20: 1.3 }),
      averageDailyAmount: 20_000_000,
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      intradayRejection: false,
      calibratedBuybackAtr: 0.6,
      evaluatedAt: '2026-08-11T06:30:00.000Z',
      expiresAt: '2026-08-11T07:00:00.000Z',
      strategyVersion: 'actual-t-v1',
    });

    expect(confirmed.kind).toBe('sell');
    if (confirmed.kind !== 'sell') throw new Error('expected confirmed sell');
    expect(confirmed.recommendation.cycleType).toBe('cost_reduction_t');
    expect(confirmed.recommendation.confirmations.length).toBeGreaterThanOrEqual(2);
  });

  it('returns a complete, auditable recommendation snapshot', () => {
    const decision = evaluateTTradeSell({
      availableShares: 1_000,
      averageCost: 11.1,
      currentPrice: 12,
      marketStructure: structure(),
      averageDailyAmount: 20_000_000,
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      intradayRejection: true,
      calibratedBuybackAtr: 0.6,
      evaluatedAt: '2026-08-11T06:30:00.000Z',
      expiresAt: '2026-08-11T07:00:00.000Z',
      strategyVersion: 'actual-t-v1',
    });

    expect(decision.kind).toBe('sell');
    if (decision.kind !== 'sell') throw new Error('expected sell');
    expect(decision.recommendation).toMatchObject({
      triggerPrice: 12,
      strategyVersion: 'actual-t-v1',
      evaluatedAt: '2026-08-11T06:30:00.000Z',
      expiresAt: '2026-08-11T07:00:00.000Z',
      basis: {
        atr20: 0.8,
        resistance: 12.1,
        flowBias: 'outflow',
      },
    });
    expect(decision.recommendation.sellRange[0]).toBeLessThanOrEqual(
      decision.recommendation.sellRange[1],
    );
    expect(decision.recommendation.buybackRange[0]).toBeLessThanOrEqual(
      decision.recommendation.buybackRange[1],
    );
    expect(decision.recommendation.expectedRoundTripFees.total).toBeGreaterThan(0);
    expect(decision.recommendation.expectedNetProfit).toBeGreaterThan(0);
  });
});

describe('T-trading buyback evaluation', () => {
  it('requires both a price condition and a stability confirmation', () => {
    const withoutStability = evaluateTTradeBuyback({
      remainingBuybackShares: 300,
      actualSellPrice: 12,
      currentPrice: 11.5,
      shortTermMa: 11.55,
      marketStructure: structure({ support: 11.45, flowBias: 'outflow' }),
      calibratedBuybackAtr: 0.6,
      downsideMomentumWeakening: false,
      flowStabilized: false,
      volumePriceNotDeteriorating: false,
      supportConfirmed: false,
    });
    expect(withoutStability.kind).toBe('monitoring');

    const confirmed = evaluateTTradeBuyback({
      remainingBuybackShares: 300,
      actualSellPrice: 12,
      currentPrice: 11.5,
      shortTermMa: 11.55,
      marketStructure: structure({ support: 11.45, flowBias: 'neutral' }),
      calibratedBuybackAtr: 0.6,
      downsideMomentumWeakening: true,
      flowStabilized: false,
      volumePriceNotDeteriorating: false,
      supportConfirmed: false,
    });

    expect(confirmed.kind).toBe('buyback');
    if (confirmed.kind !== 'buyback') throw new Error('expected buyback');
    expect(confirmed.shares).toBe(300);
    expect(confirmed.priceConditions.length).toBeGreaterThanOrEqual(1);
    expect(confirmed.stabilityConditions).toContain('downside_momentum_weakening');
  });

  it('pauses mechanical buyback after a material support break with outflow', () => {
    const decision = evaluateTTradeBuyback({
      remainingBuybackShares: 300,
      actualSellPrice: 12,
      currentPrice: 11.2,
      shortTermMa: 11.5,
      marketStructure: structure({ support: 11.5, flowBias: 'outflow' }),
      calibratedBuybackAtr: 0.6,
      downsideMomentumWeakening: false,
      flowStabilized: false,
      volumePriceNotDeteriorating: false,
      supportConfirmed: false,
    });

    expect(decision).toMatchObject({
      kind: 'risk_review',
      nextStatus: 'buyback_paused_risk_review',
    });
  });
});

describe('T-trading intraday expiry', () => {
  it('sends one expiry-risk reminder from 14:50 Asia/Shanghai', () => {
    const first = evaluateTTradeExpiry({
      evaluatedAt: '2026-08-11T06:50:00.000Z',
      expiryRiskSentAt: null,
    });
    expect(first.kind).toBe('send_expiry_risk');

    const repeated = evaluateTTradeExpiry({
      evaluatedAt: '2026-08-11T06:55:00.000Z',
      expiryRiskSentAt: '2026-08-11T06:50:00.000Z',
    });
    expect(repeated.kind).toBe('monitoring');
  });

  it('expires the intraday cycle at Shanghai close', () => {
    const decision = evaluateTTradeExpiry({
      evaluatedAt: '2026-08-11T07:00:00.000Z',
      expiryRiskSentAt: '2026-08-11T06:50:00.000Z',
    });

    expect(decision).toEqual({
      kind: 'expire_cycle',
      nextStatus: 'expired_unfilled',
      reasons: ['shanghai_market_closed'],
    });
  });
});
