import { describe, expect, it } from 'vitest';
import { applyTTradeBuyback, openTTradeCycle } from './t-trading-cycle';
import { evaluateTTradeSell } from './t-trading-signal-engine';
import { DEFAULT_TRADING_FEE_PROFILE, type TTradeMarketStructure } from './t-trading-types';

const market: TTradeMarketStructure = {
  sampleDays: 120,
  atr20: 0.8,
  atrp20: 0.0667,
  annualizedVolatility20: 0.28,
  support: 11.2,
  resistance: 12.1,
  volumeRatio20: 1.3,
  obvSlope5: -120,
  flowBias: 'outflow',
  dataQuality: 'ok',
};

describe('actual-position T-trading integration', () => {
  it('creates a fee-positive sell, records execution, and completes a matched buyback', () => {
    const sell = evaluateTTradeSell({
      availableShares: 1_000,
      averageCost: 11.1,
      currentPrice: 12,
      marketStructure: market,
      averageDailyAmount: 20_000_000,
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      intradayRejection: true,
      calibratedBuybackAtr: 0.6,
      evaluatedAt: '2026-08-11T06:30:00.000Z',
      expiresAt: '2026-08-11T07:00:00.000Z',
      strategyVersion: 'actual-t-v1',
    });
    expect(sell.kind).toBe('sell');
    if (sell.kind !== 'sell') throw new Error('expected sell recommendation');

    const recommendation = sell.recommendation;
    const opened = openTTradeCycle({
      id: 'cycle-integration',
      positionId: 'position-integration',
      code: '000685',
      cycleType: recommendation.cycleType,
      preCycleAverageCost: 11.1,
      preCycleTotalShares: 1_000,
      sellExecution: {
        id: 'sell-integration',
        idempotencyKey: 'sell-alert-integration',
        side: 'sell',
        price: recommendation.triggerPrice,
        shares: recommendation.shares,
        totalFees: recommendation.expectedRoundTripFees.sell.total,
        executedAt: recommendation.evaluatedAt,
      },
    });
    const completed = applyTTradeBuyback(opened, {
      id: 'buyback-integration',
      idempotencyKey: 'buyback-alert-integration',
      side: 'buyback',
      price: recommendation.buybackRange[0],
      shares: opened.remainingBuybackShares,
      totalFees: recommendation.expectedRoundTripFees.buyback.total,
      executedAt: '2026-08-11T06:50:00.000Z',
    });

    expect(completed.status).toBe('completed');
    expect(completed.remainingBuybackShares).toBe(0);
    expect(completed.realizedTProfit).toBeGreaterThan(0);
  });
});