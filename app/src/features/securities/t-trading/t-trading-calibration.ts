import type { StockKLine } from '../../../infrastructure/market-data/stock-api';
import { DEFAULT_TRADING_FEE_PROFILE, estimateRoundTripFees } from './trading-fee-engine';
import type {
  TTradeCalibrationMetrics,
  TTradeCalibrationParameters,
  TTradeCalibrationResult,
  TradingFeeProfile,
} from './t-trading-types';

export interface TTradeCalibrationInput {
  klines: StockKLine[];
  asOfIndex?: number;
  feeProfile?: TradingFeeProfile;
}

const CONSERVATIVE_PARAMETERS: TTradeCalibrationParameters = {
  sellAtrMultiple: 0.8,
  buybackAtrMultiple: 0.6,
  resistanceTolerance: 0.02,
  maxPositionRatio: 0.15,
};

const SELL_ATR_MULTIPLES = [0.6, 0.8, 1] as const;
const BUYBACK_ATR_MULTIPLES = [0.4, 0.6, 0.8] as const;
const RESISTANCE_TOLERANCES = [0.01, 0.02, 0.03] as const;
const MAX_POSITION_RATIOS = [0.15, 0.25, 0.35] as const;

function finiteBar(bar: StockKLine): boolean {
  return [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
    && bar.high > 0
    && bar.low > 0
    && bar.close > 0;
}

function averageTrueRange(bars: StockKLine[], endIndex: number, period = 20): number {
  const start = Math.max(1, endIndex - period + 1);
  let total = 0;
  let count = 0;
  for (let index = start; index <= endIndex; index += 1) {
    const bar = bars[index];
    const previousClose = bars[index - 1]?.close ?? bar.close;
    total += Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    );
    count += 1;
  }
  return count > 0 ? total / count : 0;
}

function rounded(value: number, places = 6): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parameterKey(parameters: TTradeCalibrationParameters): string {
  return [
    parameters.sellAtrMultiple,
    parameters.buybackAtrMultiple,
    parameters.resistanceTolerance,
    parameters.maxPositionRatio,
  ].join(':');
}

function scoreParameters(
  bars: StockKLine[],
  parameters: TTradeCalibrationParameters,
  feeProfile: TradingFeeProfile,
): TTradeCalibrationMetrics {
  let opportunities = 0;
  let completed = 0;
  let wins = 0;
  let totalNetProfit = 0;
  let unfilled = 0;
  let totalMissedUpside = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;

  for (let index = 20; index < bars.length - 1; index += 1) {
    opportunities += 1;
    const atr20 = averageTrueRange(bars, index);
    if (!Number.isFinite(atr20) || atr20 <= 0) {
      unfilled += 1;
      continue;
    }

    const windowStart = Math.max(0, index - 19);
    const resistance = Math.max(...bars.slice(windowStart, index + 1).map((bar) => bar.high));
    const sellTarget = Math.max(
      bars[index].close + atr20 * parameters.sellAtrMultiple,
      resistance * (1 - parameters.resistanceTolerance),
    );
    const lookaheadEnd = Math.min(bars.length - 1, index + 5);
    let sellIndex = -1;
    for (let future = index + 1; future <= lookaheadEnd; future += 1) {
      if (bars[future].high >= sellTarget) {
        sellIndex = future;
        break;
      }
    }
    if (sellIndex < 0) {
      unfilled += 1;
      continue;
    }

    const buybackTarget = sellTarget - atr20 * parameters.buybackAtrMultiple;
    let buybackIndex = -1;
    for (let future = sellIndex; future <= lookaheadEnd; future += 1) {
      if (bars[future].low <= buybackTarget) {
        buybackIndex = future;
        break;
      }
    }
    if (buybackIndex < 0) {
      unfilled += 1;
      continue;
    }

    const shares = Math.max(100, Math.floor((1_000 * parameters.maxPositionRatio) / 100) * 100);
    const fees = estimateRoundTripFees({
      sellPrice: sellTarget,
      buybackPrice: buybackTarget,
      shares,
      profile: feeProfile,
      liquidity: {
        averageDailyAmount: Math.max(
          1,
          bars[index].amount || bars[index].close * bars[index].volume,
        ),
      },
    });
    const netProfit = (sellTarget - buybackTarget) * shares - fees.total;
    completed += 1;
    totalNetProfit += netProfit;
    if (netProfit > 0) {
      wins += 1;
      consecutiveLosses = 0;
    } else {
      consecutiveLosses += 1;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
    }

    const futureHigh = Math.max(
      ...bars.slice(sellIndex, lookaheadEnd + 1).map((bar) => bar.high),
    );
    totalMissedUpside += Math.max(0, futureHigh - sellTarget) / sellTarget;
  }

  const winRate = completed > 0 ? wins / completed : 0;
  const averageNetProfit = completed > 0 ? totalNetProfit / completed : 0;
  const unfilledProbability = opportunities > 0 ? unfilled / opportunities : 1;
  const missedUpside = completed > 0 ? totalMissedUpside / completed : 0;
  const frequency = opportunities > 0 ? completed / opportunities : 0;
  const excessiveFrequency = Math.max(0, frequency - 0.35);
  const score = winRate * 100
    + averageNetProfit / 10
    - maxConsecutiveLosses * 3
    - unfilledProbability * 20
    - missedUpside * 5
    - excessiveFrequency * 20;

  return {
    winRate: rounded(winRate),
    averageNetProfit: rounded(averageNetProfit),
    maxConsecutiveLosses,
    unfilledProbability: rounded(unfilledProbability),
    missedUpside: rounded(missedUpside),
    frequency: rounded(frequency),
    score: rounded(score),
  };
}

function isBetter(
  candidate: { parameters: TTradeCalibrationParameters; metrics: TTradeCalibrationMetrics },
  incumbent: { parameters: TTradeCalibrationParameters; metrics: TTradeCalibrationMetrics } | null,
): boolean {
  if (!incumbent) return true;
  if (candidate.metrics.score !== incumbent.metrics.score) {
    return candidate.metrics.score > incumbent.metrics.score;
  }
  if (candidate.metrics.unfilledProbability !== incumbent.metrics.unfilledProbability) {
    return candidate.metrics.unfilledProbability < incumbent.metrics.unfilledProbability;
  }
  if (candidate.parameters.maxPositionRatio !== incumbent.parameters.maxPositionRatio) {
    return candidate.parameters.maxPositionRatio < incumbent.parameters.maxPositionRatio;
  }
  if (candidate.metrics.frequency !== incumbent.metrics.frequency) {
    return candidate.metrics.frequency < incumbent.metrics.frequency;
  }
  return parameterKey(candidate.parameters) < parameterKey(incumbent.parameters);
}

export function calibrateTTradeParameters(
  input: TTradeCalibrationInput,
): TTradeCalibrationResult {
  const lastIndex = input.asOfIndex === undefined
    ? input.klines.length - 1
    : Math.min(Math.max(Math.floor(input.asOfIndex), -1), input.klines.length - 1);
  const bars = input.klines
    .slice(0, lastIndex + 1)
    .filter(finiteBar)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (bars.length < 60) {
    return {
      status: 'sample_insufficient',
      sampleDays: bars.length,
      parameters: CONSERVATIVE_PARAMETERS,
      metrics: null,
    };
  }

  let best: {
    parameters: TTradeCalibrationParameters;
    metrics: TTradeCalibrationMetrics;
  } | null = null;
  const feeProfile = input.feeProfile ?? DEFAULT_TRADING_FEE_PROFILE;
  for (const sellAtrMultiple of SELL_ATR_MULTIPLES) {
    for (const buybackAtrMultiple of BUYBACK_ATR_MULTIPLES) {
      for (const resistanceTolerance of RESISTANCE_TOLERANCES) {
        for (const maxPositionRatio of MAX_POSITION_RATIOS) {
          const parameters: TTradeCalibrationParameters = {
            sellAtrMultiple,
            buybackAtrMultiple,
            resistanceTolerance,
            maxPositionRatio,
          };
          const candidate = {
            parameters,
            metrics: scoreParameters(bars, parameters, feeProfile),
          };
          if (isBetter(candidate, best)) best = candidate;
        }
      }
    }
  }

  if (!best) throw new Error('T-trading calibration grid is empty');
  return {
    status: 'calibrated',
    sampleDays: bars.length,
    parameters: best.parameters,
    metrics: best.metrics,
  };
}
