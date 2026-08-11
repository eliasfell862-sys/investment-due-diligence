import Decimal from 'decimal.js';
import {
  DEFAULT_TRADING_FEE_PROFILE,
  type ActualTradeFeeInput,
  type EstimatedTradeFeeInput,
  type RoundTripFeeBreakdown,
  type RoundTripFeeInput,
  type TradeFeeBreakdown,
  type TradingFeeProfile,
} from './t-trading-types';

export { DEFAULT_TRADING_FEE_PROFILE };
export type {
  ActualTradeFeeInput,
  EstimatedTradeFeeInput,
  RoundTripFeeBreakdown,
  RoundTripFeeInput,
  TradeFeeBreakdown,
  TradingFeeProfile,
};

function money(value: Decimal.Value): number {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function validateTrade(price: number, shares: number): void {
  if (!Number.isFinite(price) || price <= 0) throw new Error('成交价格必须大于0');
  if (!Number.isInteger(shares) || shares <= 0) throw new Error('交易股数必须是正整数');
}

function modeledSlippageRate(input: EstimatedTradeFeeInput, amount: Decimal): Decimal {
  if (input.profile.slippageMode === 'fixed') {
    return new Decimal(Math.max(0, input.profile.fixedSlippageRate));
  }
  const averageDailyAmount = new Decimal(Math.max(0, input.liquidity.averageDailyAmount));
  if (averageDailyAmount.isZero()) {
    return new Decimal(Math.max(0, input.profile.fixedSlippageRate));
  }
  const participation = Decimal.min(amount.dividedBy(averageDailyAmount), 1);
  return Decimal.min(new Decimal(0.0002).plus(participation.times(0.0025)), 0.003);
}

function baseFees(
  side: 'buy' | 'sell',
  price: number,
  shares: number,
  profile: TradingFeeProfile,
): Omit<TradeFeeBreakdown, 'modeledSlippage' | 'total' | 'source'> & { amount: Decimal } {
  validateTrade(price, shares);
  const amount = new Decimal(price).times(shares);
  const commission = Decimal.max(
    new Decimal(Math.max(0, profile.minimumCommission)),
    amount.times(Math.max(0, profile.commissionRate)),
  );
  const stampDuty = side === 'sell'
    ? amount.times(Math.max(0, profile.sellStampDutyRate))
    : new Decimal(0);
  const transferFee = amount.times(Math.max(0, profile.transferFeeRate));
  return {
    amount,
    commission: money(commission),
    stampDuty: money(stampDuty),
    transferFee: money(transferFee),
  };
}

export function estimateTradeFees(input: EstimatedTradeFeeInput): TradeFeeBreakdown {
  const base = baseFees(input.side, input.price, input.shares, input.profile);
  const modeledSlippage = money(base.amount.times(modeledSlippageRate(input, base.amount)));
  const total = money(
    new Decimal(base.commission)
      .plus(base.stampDuty)
      .plus(base.transferFee)
      .plus(modeledSlippage),
  );
  return {
    commission: base.commission,
    stampDuty: base.stampDuty,
    transferFee: base.transferFee,
    modeledSlippage,
    total,
    source: 'estimated',
  };
}

export function calculateActualTradeFees(input: ActualTradeFeeInput): TradeFeeBreakdown {
  const base = baseFees(input.side, input.price, input.shares, input.profile);
  const brokerFee = input.brokerActualTotalFee;
  if (brokerFee !== undefined && brokerFee !== null) {
    if (!Number.isFinite(brokerFee) || brokerFee < 0) throw new Error('券商实际手续费不能小于0');
    return {
      commission: base.commission,
      stampDuty: base.stampDuty,
      transferFee: base.transferFee,
      modeledSlippage: 0,
      total: money(brokerFee),
      source: 'broker_actual',
    };
  }
  return {
    commission: base.commission,
    stampDuty: base.stampDuty,
    transferFee: base.transferFee,
    modeledSlippage: 0,
    total: money(new Decimal(base.commission).plus(base.stampDuty).plus(base.transferFee)),
    source: 'profile_calculated',
  };
}

export function estimateRoundTripFees(input: RoundTripFeeInput): RoundTripFeeBreakdown {
  const sell = estimateTradeFees({
    side: 'sell',
    price: input.sellPrice,
    shares: input.shares,
    profile: input.profile,
    liquidity: {
      averageDailyAmount: input.liquidity.averageDailyAmount,
      orderAmount: input.sellPrice * input.shares,
    },
  });
  const buyback = estimateTradeFees({
    side: 'buy',
    price: input.buybackPrice,
    shares: input.shares,
    profile: input.profile,
    liquidity: {
      averageDailyAmount: input.liquidity.averageDailyAmount,
      orderAmount: input.buybackPrice * input.shares,
    },
  });
  return { sell, buyback, total: money(new Decimal(sell.total).plus(buyback.total)) };
}
