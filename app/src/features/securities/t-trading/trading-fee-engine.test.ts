import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRADING_FEE_PROFILE,
  calculateActualTradeFees,
  estimateRoundTripFees,
  estimateTradeFees,
} from './trading-fee-engine';

describe('T-trading fee engine', () => {
  it('charges the CNY 5 minimum commission and sell-only stamp duty', () => {
    const fee = estimateTradeFees({
      side: 'sell',
      price: 11.05,
      shares: 100,
      profile: { ...DEFAULT_TRADING_FEE_PROFILE, slippageMode: 'fixed', fixedSlippageRate: 0 },
      liquidity: { averageDailyAmount: 10_000_000, orderAmount: 1_105 },
    });

    expect(fee).toEqual({
      commission: 5,
      stampDuty: 0.55,
      transferFee: 0.01,
      modeledSlippage: 0,
      total: 5.56,
      source: 'estimated',
    });
  });

  it('does not charge stamp duty on a buy', () => {
    const fee = estimateTradeFees({
      side: 'buy',
      price: 11,
      shares: 100,
      profile: { ...DEFAULT_TRADING_FEE_PROFILE, slippageMode: 'fixed', fixedSlippageRate: 0 },
      liquidity: { averageDailyAmount: 10_000_000, orderAmount: 1_100 },
    });

    expect(fee.stampDuty).toBe(0);
    expect(fee.total).toBe(5.01);
  });

  it('uses proportional commission above the minimum', () => {
    const fee = estimateTradeFees({
      side: 'buy',
      price: 10,
      shares: 100_000,
      profile: { ...DEFAULT_TRADING_FEE_PROFILE, slippageMode: 'fixed', fixedSlippageRate: 0 },
      liquidity: { averageDailyAmount: 100_000_000, orderAmount: 1_000_000 },
    });

    expect(fee.commission).toBe(300);
    expect(fee.transferFee).toBe(10);
  });

  it('does not deduct modeled slippage after the user confirms the execution price', () => {
    const fee = calculateActualTradeFees({
      side: 'sell',
      price: 11.05,
      shares: 100,
      profile: DEFAULT_TRADING_FEE_PROFILE,
    });

    expect(fee.modeledSlippage).toBe(0);
    expect(fee.source).toBe('profile_calculated');
    expect(fee.total).toBe(5.56);
  });

  it('uses the broker actual total fee when the user supplies it', () => {
    const fee = calculateActualTradeFees({
      side: 'sell',
      price: 11.05,
      shares: 100,
      profile: DEFAULT_TRADING_FEE_PROFILE,
      brokerActualTotalFee: 6.18,
    });

    expect(fee).toMatchObject({
      modeledSlippage: 0,
      total: 6.18,
      source: 'broker_actual',
    });
  });

  it('estimates both legs and applies stamp duty only to the sell leg', () => {
    const result = estimateRoundTripFees({
      sellPrice: 12,
      buybackPrice: 11,
      shares: 300,
      profile: { ...DEFAULT_TRADING_FEE_PROFILE, slippageMode: 'fixed', fixedSlippageRate: 0 },
      liquidity: { averageDailyAmount: 20_000_000 },
    });

    expect(result.sell.stampDuty).toBe(1.8);
    expect(result.buyback.stampDuty).toBe(0);
    expect(result.total).toBeCloseTo(result.sell.total + result.buyback.total, 2);
  });
});
