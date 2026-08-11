export type TradeSide = 'buy' | 'sell';

export interface TradingFeeProfile {
  commissionRate: number;
  minimumCommission: number;
  sellStampDutyRate: number;
  transferFeeRate: number;
  slippageMode: 'dynamic' | 'fixed';
  fixedSlippageRate: number;
  updatedAt: string | null;
}

export const DEFAULT_TRADING_FEE_PROFILE: TradingFeeProfile = {
  commissionRate: 0.0003,
  minimumCommission: 5,
  sellStampDutyRate: 0.0005,
  transferFeeRate: 0.00001,
  slippageMode: 'dynamic',
  fixedSlippageRate: 0.0005,
  updatedAt: null,
};

export interface TradeLiquidityInput {
  averageDailyAmount: number;
  orderAmount?: number;
}

export interface EstimatedTradeFeeInput {
  side: TradeSide;
  price: number;
  shares: number;
  profile: TradingFeeProfile;
  liquidity: TradeLiquidityInput;
}

export interface ActualTradeFeeInput {
  side: TradeSide;
  price: number;
  shares: number;
  profile: TradingFeeProfile;
  brokerActualTotalFee?: number | null;
}

export interface TradeFeeBreakdown {
  commission: number;
  stampDuty: number;
  transferFee: number;
  modeledSlippage: number;
  total: number;
  source: 'estimated' | 'broker_actual' | 'profile_calculated';
}

export interface RoundTripFeeInput {
  sellPrice: number;
  buybackPrice: number;
  shares: number;
  profile: TradingFeeProfile;
  liquidity: Pick<TradeLiquidityInput, 'averageDailyAmount'>;
}

export interface RoundTripFeeBreakdown {
  sell: TradeFeeBreakdown;
  buyback: TradeFeeBreakdown;
  total: number;
}

export type TTradeFlowBias = 'inflow' | 'neutral' | 'outflow' | 'unavailable';
export type TTradeDataQuality = 'ok' | 'insufficient' | 'stale' | 'invalid';

export interface TTradeMarketStructure {
  sampleDays: number;
  atr20: number;
  atrp20: number;
  annualizedVolatility20: number;
  support: number;
  resistance: number;
  volumeRatio20: number;
  obvSlope5: number;
  flowBias: TTradeFlowBias;
  dataQuality: TTradeDataQuality;
}

export type TTradeCycleType = 'profit_t' | 'cost_reduction_t';
export type TTradeSellConfirmation =
  | 'resistance_proximity'
  | 'intraday_rejection'
  | 'outflow'
  | 'high_volume';

export interface TTradeQuantityInput {
  availableShares: number;
  sellPrice: number;
  buybackPrice: number;
  atrp20: number;
  averageDailyAmount: number;
  feeProfile: TradingFeeProfile;
}

export interface TTradeQuantityCandidate {
  shares: number;
  expectedGrossProfit: number;
  expectedNetProfit: number;
  riskBuffer: number;
  modeledImpactCost: number;
  score: number;
  roundTripFees: RoundTripFeeBreakdown;
}

export type TTradeQuantityDecision =
  | ({ kind: 'quantity'; maxShares: number } & TTradeQuantityCandidate)
  | {
      kind: 'none';
      maxShares: number;
      reason: 'below_board_lot' | 'round_trip_not_profitable' | 'invalid_input';
    };

export interface TTradeSellEvaluationInput {
  availableShares: number;
  averageCost: number;
  currentPrice: number;
  marketStructure: TTradeMarketStructure;
  averageDailyAmount: number;
  feeProfile: TradingFeeProfile;
  intradayRejection: boolean;
  calibratedBuybackAtr: number;
  evaluatedAt: string;
  expiresAt: string;
  strategyVersion: string;
  isSuspended?: boolean;
}

export interface TTradeSellRecommendation {
  cycleType: TTradeCycleType;
  triggerPrice: number;
  shares: number;
  sellRange: [number, number];
  buybackRange: [number, number];
  expectedRoundTripFees: RoundTripFeeBreakdown;
  expectedGrossProfit: number;
  expectedNetProfit: number;
  expectedCostReduction: number;
  riskBuffer: number;
  confirmations: TTradeSellConfirmation[];
  reasons: string[];
  basis: {
    atr20: number;
    atrp20: number;
    support: number;
    resistance: number;
    volumeRatio20: number;
    flowBias: TTradeFlowBias;
    dataQuality: TTradeDataQuality;
  };
  evaluatedAt: string;
  expiresAt: string;
  strategyVersion: string;
}

export type TTradeSellDecision =
  | { kind: 'sell'; recommendation: TTradeSellRecommendation }
  | { kind: 'none'; reasons: string[] };

export type TTradeBuybackPriceCondition =
  | 'support_reached'
  | 'short_term_ma_reached'
  | 'atr_retracement_reached';

export type TTradeBuybackStabilityCondition =
  | 'downside_momentum_weakening'
  | 'flow_stabilized'
  | 'volume_price_not_deteriorating'
  | 'support_confirmed';

export interface TTradeBuybackEvaluationInput {
  remainingBuybackShares: number;
  actualSellPrice: number;
  currentPrice: number;
  shortTermMa: number;
  marketStructure: TTradeMarketStructure;
  calibratedBuybackAtr: number;
  downsideMomentumWeakening: boolean;
  flowStabilized: boolean;
  volumePriceNotDeteriorating: boolean;
  supportConfirmed: boolean;
}

export type TTradeBuybackDecision =
  | { kind: 'monitoring'; reasons: string[] }
  | {
      kind: 'buyback';
      shares: number;
      targetRange: [number, number];
      priceConditions: TTradeBuybackPriceCondition[];
      stabilityConditions: TTradeBuybackStabilityCondition[];
      reasons: string[];
    }
  | {
      kind: 'risk_review';
      nextStatus: 'buyback_paused_risk_review';
      reasons: string[];
    };

export interface TTradeExpiryEvaluationInput {
  evaluatedAt: string;
  expiryRiskSentAt: string | null;
}

export type TTradeExpiryDecision =
  | { kind: 'monitoring'; reasons: string[] }
  | { kind: 'send_expiry_risk'; reasons: string[] }
  | {
      kind: 'expire_cycle';
      nextStatus: 'expired_unfilled';
      reasons: string[];
    };
