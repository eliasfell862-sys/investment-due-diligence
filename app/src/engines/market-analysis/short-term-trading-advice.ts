import type { StockKLine, StockQuote } from '../../infrastructure/market-data/stock-api';
import type { PatternResult } from './kline-patterns';
import type { StrategySignal } from './trading-strategies';

export type ShortTermAdviceAction =
  | 'strong_buy'
  | 'buy_on_dip'
  | 'hold_watch'
  | 'avoid'
  | 'reduce_sell'
  | 'insufficient_data';

export type ShortTermAdviceLabel =
  | '积极买入'
  | '逢低买入'
  | '持有观察'
  | '暂不介入'
  | '减仓/卖出'
  | '数据不足';

export interface ShortTermIndicatorKLine extends StockKLine {
  ma?: { ma5: number; ma10: number; ma20: number; ma60: number };
  macd?: { dif: number; dea: number; bar: number };
  kdj?: { k: number; d: number; j: number };
  rsi?: { rsi6: number; rsi12: number; rsi24: number };
  boll?: { upper: number; mid: number; lower: number };
  atr?: number;
}

export interface ShortTermAdviceBaseInput {
  quote: StockQuote;
  klines: ShortTermIndicatorKLine[];
  strategies: StrategySignal[];
  patterns: PatternResult[];
  dataAsOf: string;
  calculatedAt?: string;
  cacheStatus?: 'fresh' | 'cached';
}

export interface ShortTermTradingAdvice {
  code: string;
  horizon: '3_10_trading_days';
  action: ShortTermAdviceAction;
  label: ShortTermAdviceLabel;
  score: number;
  confidence: number;
  confidenceLabel: '高' | '中' | '低';
  entryRange: { low: number; high: number } | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  maxHoldingTradingDays: number | null;
  riskRewardRatio: number | null;
  reasons: string[];
  risks: string[];
  dataCompleteness: { quote: boolean; kline: boolean; indicators: boolean; strategies: boolean };
  dataAsOf: string;
  calculatedAt: string;
  cacheStatus: 'fresh' | 'cached';
}

interface PricePlan {
  entryRange: { low: number; high: number };
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskRewardRatio: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const roundPrice = (value: number) => Math.round(value * 100) / 100;
const uniqueThree = (items: string[]) => [...new Set(items)].slice(0, 3);

const actionLabels: Record<Exclude<ShortTermAdviceAction, 'insufficient_data'>, ShortTermAdviceLabel> = {
  strong_buy: '积极买入',
  buy_on_dip: '逢低买入',
  hold_watch: '持有观察',
  avoid: '暂不介入',
  reduce_sell: '减仓/卖出',
};

const actionRank: Record<Exclude<ShortTermAdviceAction, 'insufficient_data'>, number> = {
  reduce_sell: 0,
  avoid: 1,
  hold_watch: 2,
  buy_on_dip: 3,
  strong_buy: 4,
};

export function actionForShortTermScore(score: number): Exclude<ShortTermAdviceAction, 'insufficient_data'> {
  if (score >= 80) return 'strong_buy';
  if (score >= 70) return 'buy_on_dip';
  if (score >= 58) return 'hold_watch';
  if (score >= 45) return 'avoid';
  return 'reduce_sell';
}

function atMost(
  action: Exclude<ShortTermAdviceAction, 'insufficient_data'>,
  ceiling: Exclude<ShortTermAdviceAction, 'insufficient_data'>,
): Exclude<ShortTermAdviceAction, 'insufficient_data'> {
  return actionRank[action] > actionRank[ceiling] ? ceiling : action;
}

function hasValidIndicators(row: ShortTermIndicatorKLine | undefined): boolean {
  const values = row ? [
    row.ma?.ma5, row.ma?.ma10, row.ma?.ma20, row.ma?.ma60,
    row.macd?.dif, row.macd?.dea, row.kdj?.k, row.kdj?.d, row.kdj?.j,
    row.rsi?.rsi6, row.rsi?.rsi12, row.rsi?.rsi24,
    row.boll?.upper, row.boll?.mid, row.boll?.lower, row.atr,
  ] : [];
  return values.length > 0 && values.every(value => Number.isFinite(value));
}

function insufficient(input: ShortTermAdviceBaseInput, calculatedAt: string): ShortTermTradingAdvice {
  const quoteComplete = Number.isFinite(input.quote.price) && input.quote.price > 0;
  const klineComplete = input.klines.length >= 30;
  return {
    code: input.quote.code,
    horizon: '3_10_trading_days',
    action: 'insufficient_data',
    label: '数据不足',
    score: 0,
    confidence: 0,
    confidenceLabel: '低',
    entryRange: null,
    stopLoss: null,
    takeProfit1: null,
    takeProfit2: null,
    maxHoldingTradingDays: null,
    riskRewardRatio: null,
    reasons: [],
    risks: ['有效行情、K线或关键技术指标不足'],
    dataCompleteness: {
      quote: quoteComplete,
      kline: klineComplete,
      indicators: hasValidIndicators(input.klines.at(-1)),
      strategies: Array.isArray(input.strategies) && Array.isArray(input.patterns),
    },
    dataAsOf: input.dataAsOf,
    calculatedAt,
    cacheStatus: input.cacheStatus ?? 'fresh',
  };
}

function scoreTrend(last: ShortTermIndicatorKLine, reasons: string[], risks: string[]): number {
  let score = 0;
  const ma = last.ma!;
  if (last.close >= ma.ma5) score += 5;
  if (ma.ma5 >= ma.ma10) score += 5;
  if (ma.ma10 >= ma.ma20) score += 5;
  if (last.close >= ma.ma20) score += 3;
  if (ma.ma20 >= ma.ma60) score += 2;
  if (score >= 15) reasons.push('短期均线保持多头结构');
  if (last.close < ma.ma20) risks.push('价格跌破20日均线');
  return clamp(score, 0, 20);
}

function scoreMomentum(
  previous: ShortTermIndicatorKLine,
  last: ShortTermIndicatorKLine,
  reasons: string[],
  risks: string[],
): number {
  let score = 0;
  if (last.macd!.dif > last.macd!.dea) score += 6;
  if (previous.macd!.dif <= previous.macd!.dea && last.macd!.dif > last.macd!.dea) {
    score += 3;
    reasons.push('MACD形成短线金叉');
  }
  if (last.macd!.bar > 0) score += 2;
  if (last.rsi!.rsi6 >= 45 && last.rsi!.rsi6 <= 72) score += 5;
  else if (last.rsi!.rsi6 < 35) score += 2;
  if (last.kdj!.j >= 25 && last.kdj!.j <= 82) score += 4;
  if (last.rsi!.rsi6 >= 80) risks.push('RSI短线明显超买');
  if (last.kdj!.j >= 95) risks.push('KDJ处于高位钝化区');
  return clamp(score, 0, 20);
}

function scoreVolumePrice(input: ShortTermAdviceBaseInput, reasons: string[], risks: string[]): number {
  const rows = input.klines;
  const last = rows.at(-1)!;
  const previousVolumes = rows.slice(-6, -1).map(row => row.volume).filter(value => value > 0);
  const averageVolume = previousVolumes.length
    ? previousVolumes.reduce((sum, value) => sum + value, 0) / previousVolumes.length
    : 0;
  const volumeRatio = averageVolume > 0 ? last.volume / averageVolume : 0;
  let score = 4;
  if (input.quote.changePct > 0 && volumeRatio >= 1.2) {
    score += 8;
    reasons.push('上涨得到成交量配合');
  } else if (input.quote.changePct >= 0) score += 5;
  if (input.quote.turnover >= 0.5 && input.quote.turnover <= 12) score += 5;
  else if (input.quote.turnover <= 20) score += 2;
  if (input.quote.price >= input.quote.open) score += 3;
  if (input.quote.changePct < -2 && volumeRatio >= 1.5) risks.push('放量下跌显示抛压增强');
  return clamp(score, 0, 20);
}

function scoreSignals(input: ShortTermAdviceBaseInput, reasons: string[], risks: string[]): number {
  const strength = { 强: 5, 中: 3, 弱: 1 } as const;
  let score = 10;
  for (const signal of input.strategies) {
    if (signal.type === 'buy') {
      score += strength[signal.strength];
      reasons.push(signal.name);
    } else if (signal.type === 'sell') {
      score -= strength[signal.strength];
      risks.push(signal.name);
    }
  }
  for (const pattern of input.patterns) {
    if (pattern.type === 'bullish') {
      score += strength[pattern.strength];
      reasons.push(pattern.name);
    } else if (pattern.type === 'bearish') {
      score -= strength[pattern.strength];
      risks.push(pattern.name);
    }
  }
  return clamp(score, 0, 20);
}

function buildPricePlan(input: ShortTermAdviceBaseInput): PricePlan | null {
  const last = input.klines.at(-1)!;
  const atr = last.atr!;
  if (!(atr > 0) || !(input.quote.price > 0)) return null;

  const anchors = [last.ma!.ma5, last.ma!.ma10, last.boll!.mid]
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (anchors.length !== 3) return null;
  const center = Math.min(input.quote.price, anchors[1]);
  const entryLow = roundPrice(Math.max(0.01, center - atr * 0.35));
  const entryHigh = roundPrice(Math.max(entryLow, Math.min(input.quote.price, center + atr * 0.35)));
  const recentSupport = Math.min(...input.klines.slice(-10).map(row => row.low).filter(value => value > 0));
  const atrStop = entryLow - atr * 1.5;
  const technicalStop = Number.isFinite(recentSupport) ? recentSupport - atr * 0.1 : atrStop;
  const stopLoss = roundPrice(Math.max(0.01, Math.min(entryLow - 0.01, Math.max(atrStop, technicalStop))));
  const entryReference = (entryLow + entryHigh) / 2;
  const risk = entryReference - stopLoss;
  if (!(risk > 0)) return null;

  const minimumTarget1 = entryReference + risk * 1.5;
  const minimumTarget2 = entryReference + risk * 2;
  const recentHigh = Math.max(...input.klines.slice(-20).map(row => row.high));
  const takeProfit1 = roundPrice(Math.max(minimumTarget1, recentHigh, last.boll!.upper));
  const takeProfit2 = roundPrice(Math.max(minimumTarget2, takeProfit1 + Math.max(0.01, atr)));
  const riskRewardRatio = Math.round(((takeProfit1 - entryReference) / risk) * 100) / 100;
  if (![entryLow, entryHigh, stopLoss, takeProfit1, takeProfit2, riskRewardRatio].every(Number.isFinite)) return null;
  return { entryRange: { low: entryLow, high: entryHigh }, stopLoss, takeProfit1, takeProfit2, riskRewardRatio };
}

export function buildShortTermTradingAdvice(input: ShortTermAdviceBaseInput): ShortTermTradingAdvice {
  const calculatedAt = input.calculatedAt ?? new Date().toISOString();
  const previous = input.klines.at(-2);
  const last = input.klines.at(-1);
  const validQuote = Number.isFinite(input.quote.price) && input.quote.price > 0;
  if (!validQuote || input.klines.length < 30 || !hasValidIndicators(previous) || !hasValidIndicators(last)) {
    return insufficient(input, calculatedAt);
  }

  const reasons: string[] = [];
  const risks: string[] = [];
  const trend = scoreTrend(last!, reasons, risks);
  const momentum = scoreMomentum(previous!, last!, reasons, risks);
  const volumePrice = scoreVolumePrice(input, reasons, risks);
  const signals = scoreSignals(input, reasons, risks);
  const pricePlan = buildPricePlan(input);
  if (!pricePlan) return insufficient(input, calculatedAt);

  const atrPct = last!.atr! / input.quote.price * 100;
  let riskReward = pricePlan.riskRewardRatio >= 2 ? 20 : pricePlan.riskRewardRatio >= 1.5 ? 16 : 6;
  if (atrPct <= 4) riskReward += 2;
  if (atrPct > 7) {
    riskReward -= 5;
    risks.push('ATR显示短线波动过高');
  }
  riskReward = clamp(riskReward, 0, 20);

  const score = clamp(Math.round(trend + momentum + volumePrice + signals + riskReward), 0, 100);
  let action = actionForShortTermScore(score);
  if (pricePlan.riskRewardRatio < 1.5) action = atMost(action, 'hold_watch');

  const nearLimitUp = input.quote.preClose > 0 && input.quote.price / input.quote.preClose >= 1.095;
  const overbought = last!.rsi!.rsi6 >= 80 && last!.kdj!.j >= 95;
  if (nearLimitUp) {
    action = atMost(action, 'hold_watch');
    risks.unshift('接近涨停，不宜追高');
  }
  if (overbought) action = atMost(action, 'hold_watch');

  const strongSellCount = input.strategies.filter(item => item.type === 'sell' && item.strength === '强').length;
  const strongBearishCount = input.patterns.filter(item => item.type === 'bearish' && item.strength === '强').length;
  const volumeBreakdown = input.quote.changePct <= -2 && last!.close < last!.ma!.ma20;
  if (strongSellCount > 0 || strongBearishCount >= 2 || volumeBreakdown) action = atMost(action, 'avoid');
  if (volumeBreakdown && strongSellCount > 0) action = 'reduce_sell';

  const confidence = clamp(
    35 + (input.klines.length >= 60 ? 25 : 15) + (hasValidIndicators(last) ? 20 : 0)
      + (input.strategies.length + input.patterns.length > 0 ? 10 : 5)
      + (pricePlan.riskRewardRatio >= 1.5 ? 10 : 0),
    0,
    100,
  );

  return {
    code: input.quote.code,
    horizon: '3_10_trading_days',
    action,
    label: actionLabels[action],
    score,
    confidence,
    confidenceLabel: confidence >= 80 ? '高' : confidence >= 55 ? '中' : '低',
    ...pricePlan,
    maxHoldingTradingDays: score >= 80 ? 5 : score >= 70 ? 7 : 10,
    reasons: uniqueThree(reasons),
    risks: uniqueThree(risks),
    dataCompleteness: { quote: true, kline: true, indicators: true, strategies: true },
    dataAsOf: input.dataAsOf,
    calculatedAt,
    cacheStatus: input.cacheStatus ?? 'fresh',
  };
}
