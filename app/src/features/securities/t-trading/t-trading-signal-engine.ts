import Decimal from 'decimal.js';
import { estimateRoundTripFees } from './trading-fee-engine';
import type {
  TTradeBuybackDecision,
  TTradeBuybackEvaluationInput,
  TTradeBuybackPriceCondition,
  TTradeBuybackStabilityCondition,
  TTradeExpiryDecision,
  TTradeExpiryEvaluationInput,
  TTradeQuantityCandidate,
  TTradeQuantityDecision,
  TTradeQuantityInput,
  TTradeSellConfirmation,
  TTradeSellDecision,
  TTradeSellEvaluationInput,
} from './t-trading-types';

function rounded(value: Decimal.Value, places = 2): number {
  return new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toNumber();
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function maximumTTradeShares(availableShares: number): number {
  if (!Number.isFinite(availableShares) || availableShares <= 0) return 0;
  return Math.floor((Math.floor(availableShares) * 0.35) / 100) * 100;
}

export function optimizeTTradeShares(input: TTradeQuantityInput): TTradeQuantityDecision {
  const maxShares = maximumTTradeShares(input.availableShares);
  if (maxShares < 100) return { kind: 'none', maxShares, reason: 'below_board_lot' };
  if (
    !isPositiveFinite(input.sellPrice)
    || !isPositiveFinite(input.buybackPrice)
    || !isPositiveFinite(input.averageDailyAmount)
    || !Number.isFinite(input.atrp20)
    || input.atrp20 < 0
  ) {
    return { kind: 'none', maxShares, reason: 'invalid_input' };
  }

  const candidates: TTradeQuantityCandidate[] = [];
  for (let shares = 100; shares <= maxShares; shares += 100) {
    const roundTripFees = estimateRoundTripFees({
      sellPrice: input.sellPrice,
      buybackPrice: input.buybackPrice,
      shares,
      profile: input.feeProfile,
      liquidity: { averageDailyAmount: input.averageDailyAmount },
    });
    const expectedGrossProfit = rounded(
      new Decimal(input.sellPrice).minus(input.buybackPrice).times(shares),
    );
    const expectedNetProfit = rounded(
      new Decimal(expectedGrossProfit).minus(roundTripFees.total),
    );
    const sellAmount = new Decimal(input.sellPrice).times(shares);
    const riskBuffer = rounded(Decimal.max(
      new Decimal(roundTripFees.total).times(0.25),
      sellAmount.times(0.001),
    ));
    if (expectedNetProfit <= riskBuffer) continue;

    const modeledImpactCost = rounded(
      new Decimal(roundTripFees.sell.modeledSlippage)
        .plus(roundTripFees.buyback.modeledSlippage),
    );
    const score = rounded(
      new Decimal(expectedNetProfit)
        .minus(modeledImpactCost)
        .minus(sellAmount.times(input.atrp20).times(0.15)),
      6,
    );
    candidates.push({
      shares,
      expectedGrossProfit,
      expectedNetProfit,
      riskBuffer,
      modeledImpactCost,
      score,
      roundTripFees,
    });
  }

  const best = candidates.sort((left, right) => (
    right.score - left.score || left.shares - right.shares
  ))[0];
  if (!best) return { kind: 'none', maxShares, reason: 'round_trip_not_profitable' };
  return { kind: 'quantity', maxShares, ...best };
}

function sellConfirmations(input: TTradeSellEvaluationInput): TTradeSellConfirmation[] {
  const { marketStructure: market, currentPrice } = input;
  const proximity = Math.max(market.atr20 * 0.25, market.resistance * 0.01);
  const confirmations: TTradeSellConfirmation[] = [];
  if (currentPrice >= market.resistance - proximity) confirmations.push('resistance_proximity');
  if (input.intradayRejection) confirmations.push('intraday_rejection');
  if (market.flowBias === 'outflow') confirmations.push('outflow');
  if (market.volumeRatio20 >= 1.2) confirmations.push('high_volume');
  return confirmations;
}

export function evaluateTTradeSell(input: TTradeSellEvaluationInput): TTradeSellDecision {
  const market = input.marketStructure;
  const invalidReasons: string[] = [];
  if (market.dataQuality !== 'ok') invalidReasons.push(`data_quality:${market.dataQuality}`);
  if (input.isSuspended) invalidReasons.push('suspended');
  if (!isPositiveFinite(input.currentPrice) || !isPositiveFinite(input.averageCost)) {
    invalidReasons.push('invalid_price_or_cost');
  }
  if (!isPositiveFinite(market.atr20) || !isPositiveFinite(market.support)
    || !isPositiveFinite(market.resistance)) {
    invalidReasons.push('invalid_market_structure');
  }
  if (invalidReasons.length > 0) return { kind: 'none', reasons: invalidReasons };

  const sellLow = Math.max(input.currentPrice, market.resistance - market.atr20 * 0.25);
  const sellHigh = Math.max(sellLow, market.resistance + market.atr20 * 0.15);
  const buybackTarget = Math.max(
    market.support,
    input.currentPrice - market.atr20 * input.calibratedBuybackAtr,
  );
  const buybackRange: [number, number] = [
    rounded(Math.max(0.01, buybackTarget - market.atr20 * 0.1)),
    rounded(buybackTarget + market.atr20 * 0.1),
  ];
  const sellRange: [number, number] = [rounded(sellLow), rounded(sellHigh)];

  if (input.currentPrice < sellRange[0]) return { kind: 'none', reasons: ['sell_range_not_reached'] };

  const confirmations = sellConfirmations(input);
  const cycleType = input.currentPrice >= input.averageCost ? 'profit_t' : 'cost_reduction_t';
  const requiredConfirmations = cycleType === 'cost_reduction_t' ? 2 : 1;
  if (confirmations.length < requiredConfirmations) {
    return {
      kind: 'none',
      reasons: [cycleType === 'cost_reduction_t'
        ? 'cost_reduction_requires_two_confirmations'
        : 'technical_confirmation_missing'],
    };
  }

  const quantity = optimizeTTradeShares({
    availableShares: input.availableShares,
    sellPrice: input.currentPrice,
    buybackPrice: buybackTarget,
    atrp20: market.atrp20,
    averageDailyAmount: input.averageDailyAmount,
    feeProfile: input.feeProfile,
  });
  if (quantity.kind === 'none') return { kind: 'none', reasons: [quantity.reason] };

  return {
    kind: 'sell',
    recommendation: {
      cycleType,
      triggerPrice: rounded(input.currentPrice),
      shares: quantity.shares,
      sellRange,
      buybackRange,
      expectedRoundTripFees: quantity.roundTripFees,
      expectedGrossProfit: quantity.expectedGrossProfit,
      expectedNetProfit: quantity.expectedNetProfit,
      expectedCostReduction: quantity.expectedNetProfit,
      riskBuffer: quantity.riskBuffer,
      confirmations,
      reasons: confirmations.map((confirmation) => `confirmation:${confirmation}`),
      basis: {
        atr20: market.atr20,
        atrp20: market.atrp20,
        support: market.support,
        resistance: market.resistance,
        volumeRatio20: market.volumeRatio20,
        flowBias: market.flowBias,
        dataQuality: market.dataQuality,
      },
      evaluatedAt: input.evaluatedAt,
      expiresAt: input.expiresAt,
      strategyVersion: input.strategyVersion,
    },
  };
}

function buildBuybackPriceConditions(
  input: TTradeBuybackEvaluationInput,
): TTradeBuybackPriceCondition[] {
  const conditions: TTradeBuybackPriceCondition[] = [];
  const { marketStructure: market } = input;
  if (input.currentPrice <= market.support * 1.01) conditions.push('support_reached');
  if (isPositiveFinite(input.shortTermMa) && input.currentPrice <= input.shortTermMa * 1.005) {
    conditions.push('short_term_ma_reached');
  }
  const atrTarget = input.actualSellPrice - market.atr20 * input.calibratedBuybackAtr;
  if (input.currentPrice <= atrTarget) conditions.push('atr_retracement_reached');
  return conditions;
}

function buildBuybackStabilityConditions(
  input: TTradeBuybackEvaluationInput,
): TTradeBuybackStabilityCondition[] {
  const conditions: TTradeBuybackStabilityCondition[] = [];
  if (input.downsideMomentumWeakening) conditions.push('downside_momentum_weakening');
  if (input.flowStabilized || input.marketStructure.flowBias !== 'outflow') {
    conditions.push('flow_stabilized');
  }
  if (input.volumePriceNotDeteriorating) conditions.push('volume_price_not_deteriorating');
  if (input.supportConfirmed) conditions.push('support_confirmed');
  return conditions;
}

export function evaluateTTradeBuyback(
  input: TTradeBuybackEvaluationInput,
): TTradeBuybackDecision {
  const market = input.marketStructure;
  if (market.dataQuality !== 'ok') {
    return { kind: 'monitoring', reasons: [`data_quality:${market.dataQuality}`] };
  }
  if (!Number.isInteger(input.remainingBuybackShares) || input.remainingBuybackShares < 100) {
    return { kind: 'monitoring', reasons: ['no_executable_remaining_shares'] };
  }
  if (
    input.currentPrice < market.support * 0.985
    && market.flowBias === 'outflow'
  ) {
    return {
      kind: 'risk_review',
      nextStatus: 'buyback_paused_risk_review',
      reasons: ['material_support_break', 'capital_outflow'],
    };
  }

  const priceConditions = buildBuybackPriceConditions(input);
  const stabilityConditions = buildBuybackStabilityConditions(input);
  if (priceConditions.length === 0 || stabilityConditions.length === 0) {
    return {
      kind: 'monitoring',
      reasons: [
        ...(priceConditions.length === 0 ? ['buyback_price_condition_missing'] : []),
        ...(stabilityConditions.length === 0 ? ['buyback_stability_condition_missing'] : []),
      ],
    };
  }

  const target = Math.max(
    market.support,
    input.actualSellPrice - market.atr20 * input.calibratedBuybackAtr,
  );
  return {
    kind: 'buyback',
    shares: input.remainingBuybackShares,
    targetRange: [
      rounded(Math.max(0.01, target - market.atr20 * 0.1)),
      rounded(target + market.atr20 * 0.1),
    ],
    priceConditions,
    stabilityConditions,
    reasons: [
      ...priceConditions.map((condition) => `price:${condition}`),
      ...stabilityConditions.map((condition) => `stability:${condition}`),
    ],
  };
}

function shanghaiMinuteOfDay(isoTimestamp: string): number | null {
  const date = new Date(isoTimestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

export function evaluateTTradeExpiry(
  input: TTradeExpiryEvaluationInput,
): TTradeExpiryDecision {
  const minuteOfDay = shanghaiMinuteOfDay(input.evaluatedAt);
  if (minuteOfDay === null) return { kind: 'monitoring', reasons: ['invalid_evaluated_at'] };
  if (minuteOfDay >= 15 * 60) {
    return {
      kind: 'expire_cycle',
      nextStatus: 'expired_unfilled',
      reasons: ['shanghai_market_closed'],
    };
  }
  if (minuteOfDay >= 14 * 60 + 50 && input.expiryRiskSentAt === null) {
    return { kind: 'send_expiry_risk', reasons: ['intraday_cycle_near_close'] };
  }
  return {
    kind: 'monitoring',
    reasons: [input.expiryRiskSentAt ? 'expiry_risk_already_sent' : 'before_expiry_window'],
  };
}
