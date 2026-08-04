import type { StockKLine, StockQuote } from '../../infrastructure/market-data/stock-api';
import type { FundamentalScore } from './fundamental-scorer';
import type { PatternResult } from './kline-patterns';
import type { StrategySignal } from './trading-strategies';

export type MediumTermAdviceAction =
  | 'accumulate'
  | 'cautious_buy'
  | 'watch'
  | 'avoid_buying'
  | 'risk_avoidance'
  | 'insufficient_data';

export interface MediumTermBuyAdviceInput {
  quote: StockQuote;
  klines: StockKLine[];
  fundamental: FundamentalScore | null;
  hasFinancialData: boolean;
  strategies: StrategySignal[];
  patterns: PatternResult[];
  calculatedAt?: string;
}

export interface MediumTermBuyAdvice {
  code: string;
  horizon: '1_3_months';
  action: MediumTermAdviceAction;
  label: '分批买入' | '谨慎买入' | '观察等待' | '暂不买入' | '风险回避' | '数据不足';
  score: number;
  confidence: number;
  confidenceLabel: '高' | '中' | '低';
  reasons: string[];
  risks: string[];
  dataCompleteness: { quote: boolean; kline: boolean; fundamental: boolean };
  calculatedAt: string;
}

type IndicatorKLine = StockKLine & {
  macd?: { dif: number; dea: number; bar: number };
  kdj?: { k: number; d: number; j: number };
  rsi?: { rsi6: number; rsi12: number; rsi24: number };
  ma?: { ma5: number; ma10: number; ma20: number; ma60: number };
  boll?: { upper: number; mid: number; lower: number };
  atr?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const uniqueThree = (items: string[]) => [...new Set(items)].slice(0, 3);

function actionForScore(score: number): Pick<MediumTermBuyAdvice, 'action' | 'label'> {
  if (score >= 78) return { action: 'accumulate', label: '分批买入' };
  if (score >= 68) return { action: 'cautious_buy', label: '谨慎买入' };
  if (score >= 55) return { action: 'watch', label: '观察等待' };
  if (score >= 40) return { action: 'avoid_buying', label: '暂不买入' };
  return { action: 'risk_avoidance', label: '风险回避' };
}

function insufficient(input: MediumTermBuyAdviceInput, calculatedAt: string): MediumTermBuyAdvice {
  return {
    code: input.quote.code,
    horizon: '1_3_months',
    action: 'insufficient_data',
    label: '数据不足',
    score: 0,
    confidence: 0,
    confidenceLabel: '低',
    reasons: [],
    risks: ['有效行情或K线数据不足'],
    dataCompleteness: {
      quote: Number.isFinite(input.quote.price) && input.quote.price > 0,
      kline: input.klines.length >= 60,
      fundamental: input.hasFinancialData,
    },
    calculatedAt,
  };
}

export function buildMediumTermBuyAdvice(input: MediumTermBuyAdviceInput): MediumTermBuyAdvice {
  const calculatedAt = input.calculatedAt ?? new Date().toISOString();
  const rows = input.klines as IndicatorKLine[];
  const previous = rows.at(-2);
  const last = rows.at(-1);
  const hasIndicators = Boolean(previous?.macd && last?.macd && last.kdj && last.rsi && last.ma && last.boll && Number.isFinite(last.atr));

  if (!Number.isFinite(input.quote.price) || input.quote.price <= 0 || rows.length < 60 || !hasIndicators) {
    return insufficient(input, calculatedAt);
  }

  const reasons: string[] = [];
  const risks: string[] = [];
  let technical = 0;
  if (last!.close >= last!.ma!.ma20) { technical += 7; reasons.push('价格站上20日均线'); }
  if (last!.ma!.ma20 >= last!.ma!.ma60) { technical += 5; reasons.push('中期均线保持多头结构'); }
  if (last!.macd!.dif > last!.macd!.dea) { technical += 6; reasons.push('MACD处于多头区间'); }
  if (previous!.macd!.dif <= previous!.macd!.dea && last!.macd!.dif > last!.macd!.dea) { technical += 3; reasons.unshift('MACD形成金叉'); }
  if (last!.rsi!.rsi6 >= 40 && last!.rsi!.rsi6 <= 70) technical += 4;
  else if (last!.rsi!.rsi6 < 30) technical += 2;
  else risks.push('短期动量处于过热区间');
  if (last!.kdj!.j >= 20 && last!.kdj!.j <= 80) technical += 3;
  if (last!.close >= last!.boll!.mid && last!.close <= last!.boll!.upper) technical += 3;
  else if (last!.close >= last!.boll!.lower) technical += 1;
  else risks.push('价格跌破布林带下轨');
  if (input.quote.turnover >= 0.5 && input.quote.turnover <= 12) technical += 4;
  else risks.push('换手率偏离中期健康区间');
  technical = clamp(technical, 0, 35);

  const fundamentalScore = clamp(input.fundamental ? Math.round(input.fundamental.totalScore * 0.3) : 0, 0, 30);
  if (input.fundamental && input.fundamental.totalScore >= 70) reasons.push('基本面综合评分较强');
  if (!input.hasFinancialData) risks.unshift('基本面数据缺失');

  const strengthPoints: Record<StrategySignal['strength'], number> = { 强: 4, 中: 3, 弱: 2 };
  let strategy = 10;
  for (const signal of input.strategies) {
    if (signal.type === 'buy') { strategy += strengthPoints[signal.strength]; reasons.push(signal.name); }
    if (signal.type === 'sell') { strategy -= strengthPoints[signal.strength]; risks.push(signal.name); }
  }
  for (const pattern of input.patterns) {
    const points = pattern.strength === '强' ? 3 : pattern.strength === '中' ? 2 : 1;
    if (pattern.type === 'bullish') { strategy += points; reasons.push(pattern.name); }
    if (pattern.type === 'bearish') { strategy -= points; risks.push(pattern.name); }
  }
  strategy = clamp(strategy, 0, 20);

  const strongSellCount = input.strategies.filter(signal => signal.type === 'sell' && signal.strength === '强').length;
  const strongBearishCount = input.patterns.filter(pattern => pattern.type === 'bearish' && pattern.strength === '强').length;
  let risk = input.quote.totalCap >= 500 ? 5 : input.quote.totalCap >= 100 ? 4 : 2;
  risk += input.quote.turnover >= 0.5 && input.quote.turnover <= 12 ? 4 : input.quote.turnover <= 20 ? 2 : 0;
  const atrPct = last!.atr! > 0 ? last!.atr! / last!.close * 100 : Infinity;
  risk += atrPct <= 3 ? 4 : atrPct <= 6 ? 3 : 1;
  risk += strongSellCount === 0 && strongBearishCount === 0 ? 2 : 0;
  risk = clamp(risk, 0, 15);
  if (atrPct > 6) risks.unshift('价格波动率偏高');

  let score = clamp(technical + fundamentalScore + strategy + risk, 0, 100);
  if (!input.hasFinancialData) score = Math.min(score, 77);
  if (strongSellCount >= 1 || strongBearishCount >= 2) score = Math.min(score, 67);

  const dimensions = [technical / 35, fundamentalScore / 30, strategy / 20, risk / 15];
  const spread = Math.max(...dimensions) - Math.min(...dimensions);
  let confidence = 20 + (rows.length >= 120 ? 40 : 30) + (input.hasFinancialData ? 25 : 0);
  confidence += spread <= 0.25 ? 15 : spread <= 0.45 ? 8 : 3;
  confidence = Math.min(input.hasFinancialData ? 100 : 70, confidence);
  const confidenceLabel: MediumTermBuyAdvice['confidenceLabel'] = confidence >= 80 ? '高' : confidence >= 55 ? '中' : '低';

  return {
    code: input.quote.code,
    horizon: '1_3_months',
    ...actionForScore(score),
    score,
    confidence,
    confidenceLabel,
    reasons: uniqueThree(reasons),
    risks: uniqueThree(risks),
    dataCompleteness: { quote: true, kline: true, fundamental: input.hasFinancialData },
    calculatedAt,
  };
}
