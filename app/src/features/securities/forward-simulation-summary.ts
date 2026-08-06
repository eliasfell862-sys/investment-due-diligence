import type { VirtualPosition, VirtualTradingLedger } from './virtual-trading-ledger';

export interface ForwardPositionSummary {
  position: VirtualPosition;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedProfit: number | null;
  unrealizedReturnPct: number | null;
}

export interface ForwardSimulationSummary {
  closedCycles: number;
  winningCycles: number;
  winRate: number;
  realizedProfit: number;
  unrealizedProfit: number;
  totalProfit: number;
  openPositions: ForwardPositionSummary[];
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function summarizePosition(
  position: VirtualPosition,
  currentPrice: number | undefined,
): ForwardPositionSummary {
  if (!Number.isFinite(currentPrice) || (currentPrice ?? 0) <= 0) {
    return {
      position: { ...position, sourceTradeIds: [...position.sourceTradeIds] },
      currentPrice: null,
      marketValue: null,
      unrealizedProfit: null,
      unrealizedReturnPct: null,
    };
  }

  const price = currentPrice as number;
  const marketValue = roundMoney(position.shares * price);
  const unrealizedProfit = roundMoney(marketValue - position.totalCost);
  return {
    position: { ...position, sourceTradeIds: [...position.sourceTradeIds] },
    currentPrice: price,
    marketValue,
    unrealizedProfit,
    unrealizedReturnPct: position.totalCost > 0
      ? roundMoney(unrealizedProfit / position.totalCost * 100)
      : null,
  };
}

export function summarizeForwardSimulation(
  ledger: VirtualTradingLedger,
  prices: Record<string, number>,
): ForwardSimulationSummary {
  const closed = ledger.cycles.filter(cycle => cycle.status === 'closed');
  const winningCycles = closed.filter(cycle => cycle.realizedProfit > 0).length;
  const openPositions = ledger.positions.map(position => summarizePosition(position, prices[position.code]));
  const realizedProfit = roundMoney(ledger.transactions
    .filter(transaction => transaction.type === 'sell')
    .reduce((sum, transaction) => sum + transaction.realizedProfit, 0));
  const unrealizedProfit = roundMoney(openPositions.reduce(
    (sum, item) => sum + (item.unrealizedProfit ?? 0),
    0,
  ));

  return {
    closedCycles: closed.length,
    winningCycles,
    winRate: closed.length > 0 ? roundMoney(winningCycles / closed.length * 100) : 0,
    realizedProfit,
    unrealizedProfit,
    totalProfit: roundMoney(realizedProfit + unrealizedProfit),
    openPositions,
  };
}
