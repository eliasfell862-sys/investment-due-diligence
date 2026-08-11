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
