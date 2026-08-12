import type { StockKLine, StockQuote } from '../../../infrastructure/market-data/stock-api';
import { calibrateTTradeParameters } from './t-trading-calibration';
import { buildTTradeMarketStructure } from './t-trading-market-structure';
import { evaluateTTradeSell } from './t-trading-signal-engine';
import type {
  TTradeCalibrationResult,
  TTradeSellRecommendation,
  TradingFeeProfile,
} from './t-trading-types';

export type ActualPositionTPlan =
  | { status: 'loading' }
  | { status: 'no_quote' }
  | { status: 'stale' }
  | { status: 'sample_insufficient'; sampleDays: number }
  | { status: 'error'; message: string }
  | {
      status: 'not_triggered';
      reasons: string[];
      calibrationStatus: TTradeCalibrationResult['status'];
    }
  | {
      status: 'sell';
      recommendation: TTradeSellRecommendation;
      calibrationStatus: TTradeCalibrationResult['status'];
    };

export interface EvaluateActualPositionTPlanInput {
  klines: StockKLine[];
  quote: StockQuote | undefined;
  quoteAt: string | null;
  marketStatus: string;
  quoteStale: boolean;
  availableShares: number;
  averageCost: number;
  feeProfile: TradingFeeProfile;
}

function expiryFor(timestamp: string): string {
  return timestamp.slice(0, 10) + 'T07:00:00.000Z';
}

export function evaluateActualPositionTPlan(
  input: EvaluateActualPositionTPlanInput,
): ActualPositionTPlan {
  if (input.quoteStale) return { status: 'stale' };
  if (!input.quote || !Number.isFinite(input.quote.price) || input.quote.price <= 0) {
    return { status: 'no_quote' };
  }

  const sampleDays = input.klines.filter(bar => (
    Boolean(bar.date)
    && Number.isFinite(bar.close)
    && bar.close > 0
    && Number.isFinite(bar.high)
    && bar.high > 0
    && Number.isFinite(bar.low)
    && bar.low > 0
    && Number.isFinite(bar.volume)
    && bar.volume >= 0
  )).length;
  if (sampleDays < 20) return { status: 'sample_insufficient', sampleDays };

  const evaluatedAt = input.quoteAt ?? new Date().toISOString();
  const marketStructure = buildTTradeMarketStructure({
    klines: input.klines,
    quote: input.quote,
    quoteAt: evaluatedAt,
    evaluatedAt,
    marketStatus: input.marketStatus,
  });
  if (marketStructure.dataQuality === 'insufficient') {
    return { status: 'sample_insufficient', sampleDays: marketStructure.sampleDays };
  }
  if (marketStructure.dataQuality === 'stale') return { status: 'stale' };
  if (marketStructure.dataQuality !== 'ok') return { status: 'no_quote' };

  const calibration = calibrateTTradeParameters({
    klines: input.klines,
    feeProfile: input.feeProfile,
  });
  const decision = evaluateTTradeSell({
    availableShares: input.availableShares,
    averageCost: input.averageCost,
    currentPrice: input.quote.price,
    marketStructure,
    averageDailyAmount: Math.max(input.quote.amount, 1),
    feeProfile: input.feeProfile,
    intradayRejection: input.quote.high > input.quote.price
      && input.quote.price <= input.quote.high * 0.995,
    calibratedBuybackAtr: calibration.parameters.buybackAtrMultiple,
    evaluatedAt,
    expiresAt: expiryFor(evaluatedAt),
    strategyVersion: '1',
  });

  if (decision.kind === 'sell') {
    return {
      status: 'sell',
      recommendation: decision.recommendation,
      calibrationStatus: calibration.status,
    };
  }
  return {
    status: 'not_triggered',
    reasons: decision.reasons,
    calibrationStatus: calibration.status,
  };
}