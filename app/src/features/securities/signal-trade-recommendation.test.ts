import { describe, expect, it } from 'vitest';
import {
  calculateTechnicalSellShares,
  selectSignalTrade,
} from './signal-trade-recommendation';

const hold = { action: 'hold' as const, reasons: [] };

describe('signal trade recommendation', () => {
  it.each([
    [1000, 200],
    [500, 100],
    [100, 100],
    [50, 0],
  ])('sizes a technical reduction for %i shares as %i shares', (held, expected) => {
    expect(calculateTechnicalSellShares(held)).toBe(expected);
  });

  it('prefers a complete stop-loss exit over a simultaneous add signal', () => {
    expect(selectSignalTrade({
      isBuyCandidate: true,
      isHeld: true,
      positionShares: 500,
      buyDecision: { action: 'buy', reasons: ['RSI超卖'] },
      sellDecision: { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' },
    })).toEqual({
      action: 'sell',
      intent: 'exit',
      suggestedShares: 500,
      decision: { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' },
    });
  });

  it('uses the complete board-lot position for a timeout exit', () => {
    expect(selectSignalTrade({
      isBuyCandidate: false,
      isHeld: true,
      positionShares: 300,
      buyDecision: hold,
      sellDecision: { action: 'sell', reasons: ['最长持仓期'], exitReason: 'timeout' },
    })).toMatchObject({ intent: 'exit', suggestedShares: 300 });
  });

  it('creates open and add recommendations with one board lot', () => {
    const buyDecision = { action: 'buy' as const, reasons: ['MACD金叉'] };
    expect(selectSignalTrade({
      isBuyCandidate: true,
      isHeld: false,
      positionShares: 0,
      buyDecision,
      sellDecision: hold,
    })).toMatchObject({ action: 'buy', intent: 'open', suggestedShares: 100 });
    expect(selectSignalTrade({
      isBuyCandidate: false,
      isHeld: true,
      positionShares: 300,
      buyDecision,
      sellDecision: hold,
    })).toMatchObject({ action: 'buy', intent: 'add', suggestedShares: 100 });
  });

  it('does not recommend an open for a stock outside the watchlist', () => {
    expect(selectSignalTrade({
      isBuyCandidate: false,
      isHeld: false,
      positionShares: 0,
      buyDecision: { action: 'buy', reasons: ['MACD金叉'] },
      sellDecision: hold,
    })).toBeNull();
  });

  it('does not create a sell recommendation without a complete board lot', () => {
    expect(selectSignalTrade({
      isBuyCandidate: false,
      isHeld: true,
      positionShares: 50,
      buyDecision: hold,
      sellDecision: { action: 'sell', reasons: ['KDJ超买'], exitReason: 'signal' },
    })).toBeNull();
  });
});
