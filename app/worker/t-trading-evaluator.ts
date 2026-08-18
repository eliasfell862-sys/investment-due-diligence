import { calibrateTTradeParameters } from '../src/features/securities/t-trading/t-trading-calibration';
import { buildTTradeMarketStructure } from '../src/features/securities/t-trading/t-trading-market-structure';
import { estimateTradeFees } from '../src/features/securities/t-trading/trading-fee-engine';
import {
  evaluateTTradeBuyback,
  evaluateTTradeExpiry,
  evaluateTTradeSell,
} from '../src/features/securities/t-trading/t-trading-signal-engine';
import type { StockQuote } from '../src/infrastructure/market-data/stock-api';
import type { NodeMarketDataProvider } from './market-data-provider';
import type {
  CompleteMonitoringAssignment,
  WorkerTTradePositionSnapshot,
  WorkerTTradeCycleSnapshot,
} from './supabase-repository';

export interface WorkerTTradingEvaluationInput {
  assignment: CompleteMonitoringAssignment;
  position: WorkerTTradePositionSnapshot;
  cycle: WorkerTTradeCycleSnapshot | null;
  quote: StockQuote;
  quoteAt: string;
}

export interface WorkerTTradingDecision {
  signalKind: 'actual_t_sell' | 'actual_t_buyback'
    | 'actual_t_expiry_risk' | 'actual_t_risk_review'
    | 'virtual_t_sell' | 'virtual_t_buyback'
    | 'virtual_t_cash_blocked' | 'virtual_t_expiry_risk';
  payload: Record<string, unknown>;
}

export interface WorkerTTradingEvaluatorOptions {
  marketData: Pick<NodeMarketDataProvider, 'fetchHistory'>;
}

function shortTermMa(closes: number[]): number {
  const sample = closes.slice(-5);
  return sample.length > 0 ? sample.reduce((sum, value) => sum + value, 0) / sample.length : 0;
}

function expiresAtFor(quoteAt: string): string {
  return quoteAt.slice(0, 10) + 'T07:00:00.000Z';
}

function roundedMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function commonPayload(
  input: WorkerTTradingEvaluationInput,
  signalKind: WorkerTTradingDecision['signalKind'],
  suggestedShares: number,
  signalMetadata: Record<string, unknown>,
): Record<string, unknown> {
  const isVirtual = input.position.scope === 'virtual';
  return {
    user_id: input.assignment.userId,
    position_scope: input.position.scope,
    position_id: isVirtual ? null : input.position.id,
    virtual_position_id: isVirtual ? input.position.id : null,
    code: input.position.code,
    name: input.position.name,
    price: input.quote.price,
    signal_kind: signalKind,
    suggested_shares: suggestedShares,
    position_shares: input.position.shares,
    available_shares: input.position.availableShares,
    strategy_id: isVirtual ? input.position.strategyId ?? 'virtual-t' : 'actual-t',
    strategy_version: input.cycle?.strategyVersion ?? '1',
    trading_date: input.quoteAt.slice(0, 10),
    signal_at: input.quoteAt,
    expires_at: input.cycle?.expiresAt ?? expiresAtFor(input.quoteAt),
    t_trade_cycle_id: input.cycle?.id ?? null,
    fee_profile: input.assignment.feeProfile,
    average_daily_amount: Math.max(input.quote.amount, 1),
    signal_metadata: signalMetadata,
  };
}

export function createWorkerTTradingEvaluator(options: WorkerTTradingEvaluatorOptions) {
  const historyCache = new Map<string, ReturnType<NodeMarketDataProvider['fetchHistory']>>();

  return async (
    input: WorkerTTradingEvaluationInput,
  ): Promise<WorkerTTradingDecision | null> => {
    const cacheKey = input.position.code + ':' + input.quoteAt.slice(0, 10);
    let historyPromise = historyCache.get(cacheKey);
    if (!historyPromise) {
      historyPromise = options.marketData.fetchHistory(input.position.code, 250);
      historyCache.set(cacheKey, historyPromise);
    }
    const klines = await historyPromise;
    if (klines.length < 20) return null;

    const market = buildTTradeMarketStructure({
      klines,
      quote: input.quote,
      quoteAt: input.quoteAt,
      evaluatedAt: input.quoteAt,
      marketStatus: 'trading',
    });
    if (market.dataQuality !== 'ok') return null;

    const calibration = calibrateTTradeParameters({ klines });
    const closes = klines.map(bar => bar.close);

    if (input.cycle) {
      const expiry = evaluateTTradeExpiry({
        evaluatedAt: input.quoteAt,
        expiryRiskSentAt: input.cycle.expiryRiskSentAt,
      });
      if (expiry.kind === 'send_expiry_risk') {
        const expirySignalKind = input.position.scope === 'virtual'
          ? 'virtual_t_expiry_risk' : 'actual_t_expiry_risk';
        return {
          signalKind: expirySignalKind,
          payload: commonPayload(input, expirySignalKind, input.cycle.remainingBuybackShares, {
            cycle_type: input.cycle.cycleType,
            actual_sell_price: input.cycle.actualSellPrice,
            remaining_buyback_shares: input.cycle.remainingBuybackShares,
            reasons: expiry.reasons,
          }),
        };
      }
      if (expiry.kind === 'expire_cycle' || input.cycle.status === 'expired_unfilled') return null;

      const buyback = evaluateTTradeBuyback({
        remainingBuybackShares: input.cycle.remainingBuybackShares,
        actualSellPrice: input.cycle.actualSellPrice,
        currentPrice: input.quote.price,
        shortTermMa: shortTermMa(closes),
        marketStructure: market,
        calibratedBuybackAtr: calibration.parameters.buybackAtrMultiple,
        downsideMomentumWeakening: input.quote.change >= 0
          || input.quote.price > input.quote.low * 1.005,
        flowStabilized: market.flowBias !== 'outflow',
        volumePriceNotDeteriorating: market.volumeRatio20 <= 1.5 || input.quote.change >= 0,
        supportConfirmed: input.quote.price >= market.support * 0.995,
      });
      if (buyback.kind === 'risk_review') {
        if (input.position.scope === 'virtual') return null;
        return {
          signalKind: 'actual_t_risk_review',
          payload: commonPayload(input, 'actual_t_risk_review', 0, {
            cycle_type: input.cycle.cycleType,
            support: market.support,
            flow_bias: market.flowBias,
            reasons: buyback.reasons,
          }),
        };
      }
      if (buyback.kind !== 'buyback') return null;
      if (input.position.scope === 'virtual') {
        const fees = estimateTradeFees({
          side: 'buy', price: input.quote.price, shares: buyback.shares,
          profile: input.assignment.feeProfile,
          liquidity: {
            averageDailyAmount: Math.max(input.quote.amount, 1),
            orderAmount: input.quote.price * buyback.shares,
          },
        });
        const requiredCash = roundedMoney(input.quote.price * buyback.shares + fees.total);
        if (requiredCash > input.assignment.virtualCashBalance) {
          return {
            signalKind: 'virtual_t_cash_blocked',
            payload: commonPayload(input, 'virtual_t_cash_blocked', buyback.shares, {
              cycle_type: input.cycle.cycleType,
              actual_sell_price: input.cycle.actualSellPrice,
              remaining_buyback_shares: input.cycle.remainingBuybackShares,
              required_cash: requiredCash,
              available_cash: input.assignment.virtualCashBalance,
              cash_gap: roundedMoney(requiredCash - input.assignment.virtualCashBalance),
              expected_buy_fees: fees,
              reasons: ['virtual_cash_insufficient'],
            }),
          };
        }
      }
      const buybackSignalKind = input.position.scope === 'virtual'
        ? 'virtual_t_buyback' : 'actual_t_buyback';
      return {
        signalKind: buybackSignalKind,
        payload: commonPayload(input, buybackSignalKind, buyback.shares, {
          cycle_type: input.cycle.cycleType,
          actual_sell_price: input.cycle.actualSellPrice,
          target_range: buyback.targetRange,
          price_conditions: buyback.priceConditions,
          stability_conditions: buyback.stabilityConditions,
          atr20: market.atr20,
          support: market.support,
          flow_bias: market.flowBias,
          sample_status: calibration.status,
        }),
      };
    }

    const sell = evaluateTTradeSell({
      availableShares: input.position.availableShares,
      averageCost: input.position.averageCost,
      currentPrice: input.quote.price,
      marketStructure: market,
      averageDailyAmount: Math.max(input.quote.amount, 1),
      feeProfile: input.assignment.feeProfile,
      intradayRejection: input.quote.high > input.quote.price
        && input.quote.price <= input.quote.high * 0.995,
      calibratedBuybackAtr: calibration.parameters.buybackAtrMultiple,
      evaluatedAt: input.quoteAt,
      expiresAt: expiresAtFor(input.quoteAt),
      strategyVersion: '1',
    });
    if (sell.kind !== 'sell') return null;

    const recommendation = sell.recommendation;
    const sellSignalKind = input.position.scope === 'virtual' ? 'virtual_t_sell' : 'actual_t_sell';
    return {
      signalKind: sellSignalKind,
      payload: commonPayload(input, sellSignalKind, recommendation.shares, {
        cycle_type: recommendation.cycleType,
        sell_low: recommendation.sellRange[0],
        sell_high: recommendation.sellRange[1],
        buyback_low: recommendation.buybackRange[0],
        buyback_high: recommendation.buybackRange[1],
        expected_net_profit: recommendation.expectedNetProfit,
        expected_round_trip_fees: recommendation.expectedRoundTripFees,
        risk_buffer: recommendation.riskBuffer,
        confirmations: recommendation.confirmations,
        atr20: recommendation.basis.atr20,
        atrp20: recommendation.basis.atrp20,
        support: recommendation.basis.support,
        resistance: recommendation.basis.resistance,
        volume_ratio20: recommendation.basis.volumeRatio20,
        flow_bias: recommendation.basis.flowBias,
        sample_status: calibration.status,
        expires_at: recommendation.expiresAt,
      }),
    };
  };
}
