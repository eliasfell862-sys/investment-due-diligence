import { calcATR, calcMA, calcOBV } from '../../../engines/market-analysis/technical-indicators';
import type { StockKLine, StockQuote } from '../../../infrastructure/market-data/stock-api';
import type {
  TTradeDataQuality,
  TTradeFlowBias,
  TTradeMarketStructure,
} from './t-trading-types';

export interface TTradeMarketStructureInput {
  klines: StockKLine[];
  quote: StockQuote;
  quoteAt: string;
  evaluatedAt: string;
  marketStatus: string;
}

type EnrichedKLine = StockKLine & {
  atr?: number;
  obv?: number;
  ma?: { ma5?: number; ma10?: number; ma20?: number };
};

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0)
    / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function nearestSupport(values: number[], currentPrice: number): number {
  const candidates = values.filter(value => finitePositive(value) && value <= currentPrice);
  return candidates.length === 0 ? currentPrice : Math.max(...candidates);
}

function nearestResistance(values: number[], currentPrice: number): number {
  const candidates = values.filter(value => finitePositive(value) && value >= currentPrice);
  return candidates.length === 0 ? currentPrice : Math.min(...candidates);
}

function flowBias(
  volumeRatio20: number,
  obvSlope5: number,
  quote: StockQuote,
): TTradeFlowBias {
  if (!Number.isFinite(volumeRatio20) || !Number.isFinite(obvSlope5)) return 'unavailable';
  if (volumeRatio20 >= 1.2 && obvSlope5 > 0 && quote.change >= 0) return 'inflow';
  if (volumeRatio20 >= 1.2 && obvSlope5 < 0 && quote.change <= 0) return 'outflow';
  return 'neutral';
}

function dataQuality(input: TTradeMarketStructureInput, sampleDays: number): TTradeDataQuality {
  if (!finitePositive(input.quote.price) || sampleDays === 0) return 'invalid';
  if (sampleDays < 20) return 'insufficient';
  const quoteAt = Date.parse(input.quoteAt);
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (
    input.marketStatus === 'trading'
    && Number.isFinite(quoteAt)
    && Number.isFinite(evaluatedAt)
    && evaluatedAt - quoteAt > 15_000
  ) return 'stale';
  return 'ok';
}

export function buildTTradeMarketStructure(
  input: TTradeMarketStructureInput,
): TTradeMarketStructure {
  const history = input.klines
    .filter(bar => bar.date && finitePositive(bar.close) && finitePositive(bar.high)
      && finitePositive(bar.low) && Number.isFinite(bar.volume) && bar.volume >= 0)
    .map(bar => ({ ...bar }))
    .sort((left, right) => left.date.localeCompare(right.date)) as EnrichedKLine[];

  calcMA(history, [5, 10, 20]);
  calcOBV(history);
  calcATR(history, 20);

  const latest = history.at(-1);
  const last20 = history.slice(-20);
  const atr20 = latest?.atr ?? 0;
  const returns = last20.slice(1).map((bar, index) => (
    Math.log(bar.close / last20[index].close)
  )).filter(Number.isFinite);
  const annualizedVolatility20 = sampleStdDev(returns) * Math.sqrt(252);
  const previous20Volumes = history.slice(-21, -1).map(bar => bar.volume);
  const volumeRatio20 = mean(previous20Volumes) > 0
    ? input.quote.volume / mean(previous20Volumes)
    : 0;
  const obvFiveBarsAgo = history.at(-6)?.obv ?? latest?.obv ?? 0;
  const obvSlope5 = ((latest?.obv ?? 0) - obvFiveBarsAgo) / 5;
  const recentLow = last20.length > 0 ? Math.min(...last20.map(bar => bar.low)) : input.quote.price;
  const recentHigh = last20.length > 0 ? Math.max(...last20.map(bar => bar.high)) : input.quote.price;
  const ma = latest?.ma ?? {};
  const support = nearestSupport(
    [ma.ma5 ?? 0, ma.ma10 ?? 0, ma.ma20 ?? 0, recentLow],
    input.quote.price,
  );
  const resistance = nearestResistance([recentHigh, input.quote.high], input.quote.price);

  return {
    sampleDays: history.length,
    atr20,
    atrp20: input.quote.price > 0 ? atr20 / input.quote.price : 0,
    annualizedVolatility20,
    support,
    resistance,
    volumeRatio20,
    obvSlope5,
    flowBias: flowBias(volumeRatio20, obvSlope5, input.quote),
    dataQuality: dataQuality(input, history.length),
  };
}
