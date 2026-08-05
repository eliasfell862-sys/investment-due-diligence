import type { BacktestBarDecision } from '../../engines/market-analysis/backtest-strategy';

export type SignalIntent = 'open' | 'add' | 'reduce' | 'exit';

export interface SignalTradeRecommendation {
  action: 'buy' | 'sell';
  intent: SignalIntent;
  decision: BacktestBarDecision;
  suggestedShares: number;
}

export interface SelectSignalTradeInput {
  isBuyCandidate: boolean;
  isHeld: boolean;
  positionShares: number;
  buyDecision: BacktestBarDecision;
  sellDecision: BacktestBarDecision;
}

export function calculateTechnicalSellShares(positionShares: number): number {
  if (!Number.isInteger(positionShares) || positionShares < 100) return 0;
  const quarterLot = Math.floor(positionShares * 0.25 / 100) * 100;
  return Math.min(positionShares, Math.max(100, quarterLot));
}

export function selectSignalTrade(input: SelectSignalTradeInput): SignalTradeRecommendation | null {
  if (input.isHeld && input.sellDecision.action === 'sell') {
    const exit = input.sellDecision.exitReason === 'stop_loss'
      || input.sellDecision.exitReason === 'timeout';
    const suggestedShares = exit
      ? Math.floor(input.positionShares / 100) * 100
      : calculateTechnicalSellShares(input.positionShares);
    return suggestedShares > 0 ? {
      action: 'sell',
      intent: exit ? 'exit' : 'reduce',
      decision: input.sellDecision,
      suggestedShares,
    } : null;
  }

  if ((input.isHeld || input.isBuyCandidate) && input.buyDecision.action === 'buy') {
    return {
      action: 'buy',
      intent: input.isHeld ? 'add' : 'open',
      decision: input.buyDecision,
      suggestedShares: 100,
    };
  }

  return null;
}
