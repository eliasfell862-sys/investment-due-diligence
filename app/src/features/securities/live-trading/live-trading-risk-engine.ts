import { estimateTradeFees } from '../t-trading/trading-fee-engine';
import type { TradingFeeProfile } from '../t-trading/t-trading-types';
import type { LiveTradingProfile } from './live-trading-types';

export type LiveBuyBlockReason =
  | 'daily_circuit_breaker'
  | 'position_count_limit'
  | 'invalid_price_or_stop'
  | 'cash_or_reserve_limit'
  | 'stock_cap_limit'
  | 'planned_loss_limit';

export interface PlanLiveBuyInput {
  profile: LiveTradingProfile;
  feeProfile: TradingFeeProfile;
  limitPrice: number;
  stopPrice: number;
  availableCash: number;
  currentInvested: number;
  currentStockMarketValue: number;
  currentPositionCount: number;
  alreadyHoldsStock: boolean;
  reservedTBuybackCash: number;
  realizedProfitToday: number;
  paidFeesToday: number;
  averageDailyAmount: number;
  requestedShares?: number;
}

export interface AllowedLiveBuyDecision {
  allowed: true;
  shares: number;
  entryFees: number;
  estimatedExitFees: number;
  plannedLoss: number;
  projectedInvested: number;
  projectedStockMarketValue: number;
  projectedAvailableCash: number;
}

export interface BlockedLiveBuyDecision {
  allowed: false;
  reason: LiveBuyBlockReason;
}

export type LiveBuyRiskDecision = AllowedLiveBuyDecision | BlockedLiveBuyDecision;

export interface CircuitBreakerDecision {
  tripped: boolean;
  lossWithFees: number;
}

const money = (value: number) => Math.round(value * 100) / 100;

function floorLot(value: number, boardLot: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value / boardLot) * boardLot;
}

export function evaluateDailyCircuitBreaker(input: {
  realizedProfit: number;
  paidFees: number;
  limit: number;
}): CircuitBreakerDecision {
  const realizedLoss = Math.max(0, -input.realizedProfit);
  const lossWithFees = money(realizedLoss + Math.max(0, input.paidFees));
  return { tripped: lossWithFees >= input.limit, lossWithFees };
}

export function maximumTTradeShares(
  availableShares: number,
  profile: Pick<LiveTradingProfile, 'boardLot' | 'maximumTTradeAvailableRatio'>,
): number {
  if (!Number.isInteger(availableShares) || availableShares <= 0) return 0;
  return floorLot(
    availableShares * profile.maximumTTradeAvailableRatio,
    profile.boardLot,
  );
}

function feesFor(
  input: PlanLiveBuyInput,
  side: 'buy' | 'sell',
  price: number,
  shares: number,
): number {
  return estimateTradeFees({
    side,
    price,
    shares,
    profile: input.feeProfile,
    liquidity: {
      averageDailyAmount: input.averageDailyAmount,
      orderAmount: price * shares,
    },
  }).total;
}

function plannedLossFor(input: PlanLiveBuyInput, shares: number): {
  entryFees: number;
  estimatedExitFees: number;
  plannedLoss: number;
} {
  const entryFees = feesFor(input, 'buy', input.limitPrice, shares);
  const estimatedExitFees = feesFor(input, 'sell', input.stopPrice, shares);
  const plannedLoss = money(
    (input.limitPrice - input.stopPrice) * shares + entryFees + estimatedExitFees,
  );
  return { entryFees, estimatedExitFees, plannedLoss };
}

export function planLiveBuy(input: PlanLiveBuyInput): LiveBuyRiskDecision {
  const { profile } = input;
  if (evaluateDailyCircuitBreaker({
    realizedProfit: input.realizedProfitToday,
    paidFees: input.paidFeesToday,
    limit: profile.dailyCircuitBreaker,
  }).tripped) return { allowed: false, reason: 'daily_circuit_breaker' };

  if (!input.alreadyHoldsStock && input.currentPositionCount >= profile.maximumPositions) {
    return { allowed: false, reason: 'position_count_limit' };
  }
  if (
    !Number.isFinite(input.limitPrice)
    || !Number.isFinite(input.stopPrice)
    || input.limitPrice <= 0
    || input.stopPrice <= 0
    || input.stopPrice >= input.limitPrice
  ) return { allowed: false, reason: 'invalid_price_or_stop' };

  const cashCapacity = Math.min(
    input.availableCash - input.reservedTBuybackCash - profile.reservedCash,
    profile.maximumInvested - input.currentInvested,
  );
  const stockCapacity = profile.maximumPerStock - input.currentStockMarketValue;
  const requestedCapacity = input.requestedShares === undefined
    ? Number.POSITIVE_INFINITY
    : floorLot(input.requestedShares, profile.boardLot);
  const maximumShares = Math.min(
    floorLot(cashCapacity / input.limitPrice, profile.boardLot),
    floorLot(stockCapacity / input.limitPrice, profile.boardLot),
    requestedCapacity,
  );

  if (maximumShares < profile.boardLot) {
    if (stockCapacity < input.limitPrice * profile.boardLot) {
      return { allowed: false, reason: 'stock_cap_limit' };
    }
    return { allowed: false, reason: 'cash_or_reserve_limit' };
  }

  for (let shares = maximumShares; shares >= profile.boardLot; shares -= profile.boardLot) {
    const risk = plannedLossFor(input, shares);
    if (risk.plannedLoss > profile.maximumPlannedLoss) continue;
    const entryCost = money(input.limitPrice * shares + risk.entryFees);
    const projectedAvailableCash = money(
      input.availableCash - input.reservedTBuybackCash - entryCost,
    );
    const projectedInvested = money(input.currentInvested + entryCost);
    const projectedStockMarketValue = money(
      input.currentStockMarketValue + input.limitPrice * shares,
    );
    if (projectedAvailableCash < profile.reservedCash) continue;
    if (projectedInvested > profile.maximumInvested) continue;
    if (projectedStockMarketValue > profile.maximumPerStock) continue;
    return {
      allowed: true,
      shares,
      entryFees: risk.entryFees,
      estimatedExitFees: risk.estimatedExitFees,
      plannedLoss: risk.plannedLoss,
      projectedInvested,
      projectedStockMarketValue,
      projectedAvailableCash,
    };
  }

  return { allowed: false, reason: 'planned_loss_limit' };
}
