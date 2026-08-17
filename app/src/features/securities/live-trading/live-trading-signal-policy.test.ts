import { describe, expect, it } from 'vitest';
import {
  evaluateLiveTradingSignal,
  type LiveTradingSignalInput,
} from './live-trading-signal-policy';

function signal(overrides: Partial<LiveTradingSignalInput> = {}): LiveTradingSignalInput {
  return {
    price: 10.4,
    dataFresh: true,
    shortAction: 'strong_buy',
    mediumAction: 'watch',
    shortEntryRange: { low: 10.3, high: 10.5 },
    formalBuyPrice: 10,
    formalSellPrice: 12,
    takeProfit1: 11.5,
    takeProfit2: 12.5,
    totalShares: 0,
    availableShares: 0,
    unrealizedProfit: 0,
    hardStopTriggered: false,
    fatalRisk: false,
    tSellEligible: false,
    tBuybackEligible: false,
    ...overrides,
  };
}

function positionSignal(overrides: Partial<LiveTradingSignalInput> = {}): LiveTradingSignalInput {
  return signal({
    price: 10,
    shortAction: 'hold_watch',
    mediumAction: 'watch',
    shortEntryRange: null,
    formalBuyPrice: null,
    formalSellPrice: 12,
    takeProfit1: 11.5,
    takeProfit2: 12.5,
    totalShares: 300,
    availableShares: 300,
    ...overrides,
  });
}

describe('live trading signal policy', () => {
  it('observes inside the short entry range but preauthorizes only at the formal buy price', () => {
    expect(evaluateLiveTradingSignal(signal()).kind).toBe('observe_buy');
    expect(evaluateLiveTradingSignal(signal({ price: 10 })).kind).toBe('core_buy');
  });

  it('requires both usable advice horizons for a buy', () => {
    expect(evaluateLiveTradingSignal(signal({ mediumAction: 'avoid_buying' })).kind).toBe('hold');
    expect(evaluateLiveTradingSignal(signal({ shortAction: 'hold_watch' })).kind).toBe('hold');
    expect(evaluateLiveTradingSignal(signal({ dataFresh: false })).kind).toBe('hold');
  });

  it('waits when ratings weaken while the position is losing', () => {
    expect(evaluateLiveTradingSignal(positionSignal({
      unrealizedProfit: -80,
      shortAction: 'reduce_sell',
      mediumAction: 'risk_avoidance',
      tSellEligible: true,
    }))).toMatchObject({ kind: 'loss_wait', requiresSell: false });
  });

  it('uses first take profit for a profitable single-rating downgrade', () => {
    expect(evaluateLiveTradingSignal(positionSignal({
      unrealizedProfit: 100,
      shortAction: 'reduce_sell',
      mediumAction: 'watch',
    }))).toMatchObject({
      kind: 'take_profit_1',
      suggestedShares: 100,
      requiresUserConfirmation: true,
    });
  });

  it('uses second take profit when both horizons weaken in profit', () => {
    expect(evaluateLiveTradingSignal(positionSignal({
      unrealizedProfit: 100,
      shortAction: 'reduce_sell',
      mediumAction: 'risk_avoidance',
    }))).toMatchObject({
      kind: 'take_profit_2',
      suggestedShares: 300,
      requiresUserConfirmation: true,
    });
  });

  it('hard stop overrides fatal exit, take profit, and T sell', () => {
    expect(evaluateLiveTradingSignal(positionSignal({
      price: 13,
      hardStopTriggered: true,
      fatalRisk: true,
      tSellEligible: true,
    }))).toMatchObject({
      kind: 'hard_stop',
      suggestedShares: 300,
      requiresUserConfirmation: false,
    });
  });

  it('requires user confirmation for T sell and buyback', () => {
    expect(evaluateLiveTradingSignal(positionSignal({ tSellEligible: true })))
      .toMatchObject({ kind: 't_sell', requiresUserConfirmation: true });
    expect(evaluateLiveTradingSignal(positionSignal({ tBuybackEligible: true })))
      .toMatchObject({ kind: 't_buyback', requiresUserConfirmation: true });
  });
});
