import type { PatternResult } from '../../../engines/market-analysis/kline-patterns';
import type { StrategySignal } from '../../../engines/market-analysis/trading-strategies';
import type { StockKLine, StockQuote } from '../../../infrastructure/market-data/stock-api';
import type { HistoricalCapitalFlowPoint, MultiDayCapitalFlow } from '../../../infrastructure/market-data/pre-move-market-data-api';
import type { IndustryRotationView, PreMoveFeatureScores } from './types';

export interface PreMoveIndicatorKLine extends StockKLine {
  ma?: { ma5: number; ma10: number; ma20: number; ma60: number };
  macd?: { dif: number; dea: number; bar: number };
  kdj?: { k: number; d: number; j: number };
  rsi?: { rsi6: number; rsi12: number; rsi24: number };
  boll?: { upper: number; mid: number; lower: number };
  atr?: number;
  obv?: number;
}

export type PreMoveHardRisk =
  | 'special_treatment' | 'suspended' | 'illiquid' | 'overheated'
  | 'core_data_missing' | 'capital_outflow_conflict';

export interface PreMoveSignalResult {
  scores: PreMoveFeatureScores;
  hardRisks: PreMoveHardRisk[];
  positiveEvidence: string[];
  risks: string[];
  invalidationConditions: string[];
  dataCompleteness: number;
  rawFeatures: Record<string, number | null>;
  featureCoverage: string[];
}

export interface PreMoveSignalInput {
  asOfDate: string;
  formal: boolean;
  quote: StockQuote;
  industry: {
    returnPercentile: number | null;
    flowPercentile: number | null;
    breadthPercentile: number | null;
    relativeStrengthSlopePercentile: number | null;
    stage: IndustryRotationView['stage'] | null;
  };
  capitalFlow: MultiDayCapitalFlow | null;
  flowHistory: HistoricalCapitalFlowPoint[];
  klines: PreMoveIndicatorKLine[];
  benchmarkKlines: StockKLine[];
  strategySignals: StrategySignal[];
  patterns: PatternResult[];
  specialTreatment: boolean;
  suspended: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 100) / 100;
const percentilePoints = (value: number | null, max: number) => value == null ? 0 : clamp(value / 100, 0, 1) * max;

function returnPct(lines: StockKLine[], days: number): number | null {
  if (lines.length <= days) return null;
  const end = lines.at(-1)!.close;
  const start = lines[lines.length - days - 1].close;
  return start > 0 ? (end / start - 1) * 100 : null;
}

function scoreIndustry(input: PreMoveSignalInput): number {
  const stagePoints = input.industry.stage === 'starting' || input.industry.stage === 'accumulating' ? 4 : 0;
  return round(
    percentilePoints(input.industry.returnPercentile, 8)
    + percentilePoints(input.industry.flowPercentile, 8)
    + percentilePoints(input.industry.breadthPercentile, 6)
    + percentilePoints(input.industry.relativeStrengthSlopePercentile, 4)
    + stagePoints,
  );
}

function scoreCapital(input: PreMoveSignalInput): number {
  const flow = input.capitalFlow;
  if (!flow) return 0;
  const ratios = [flow.mainRatio5d, flow.mainRatio10d].filter((value): value is number => value != null);
  const ratioScore = ratios.length ? clamp(ratios.reduce((a, b) => a + b, 0) / ratios.length / 5, 0, 1) * 8 : 0;
  const recent = input.flowHistory.slice(-5);
  const continuity = recent.length >= 3 ? recent.filter(item => item.mainNet > 0).length / recent.length * 5 : 0;
  const largeOrder = recent.length && recent.reduce((sum, item) => sum + item.superLargeNet + item.largeNet, 0) > 0 ? 5 : 0;
  const validObv = input.klines.filter(line => line.obv != null).slice(-10);
  const obvScore = validObv.length >= 2 && validObv.at(-1)!.obv! > validObv[0].obv! ? 4 : 0;
  const price5d = returnPct(input.klines, 5);
  const divergence = (flow.mainNet5d ?? 0) > 0 && price5d != null && price5d < 5 ? 3 : 0;
  return round(clamp(ratioScore + continuity + largeOrder + obvScore + divergence, 0, 25));
}

function scoreAccumulation(input: PreMoveSignalInput): number {
  const last = input.klines.at(-1);
  if (!last?.ma || !last.boll || last.atr == null) return 0;
  let score = 0;
  const maSpread = (Math.max(last.ma.ma5, last.ma.ma10, last.ma.ma20) - Math.min(last.ma.ma5, last.ma.ma10, last.ma.ma20)) / last.close * 100;
  if (maSpread <= 2) score += 5;
  const olderAtr = input.klines.slice(-30, -10).map(line => line.atr).filter((value): value is number => value != null);
  if (olderAtr.length && last.atr < olderAtr.reduce((a, b) => a + b, 0) / olderAtr.length) score += 5;
  const bandwidth = (last.boll.upper - last.boll.lower) / Math.max(last.boll.mid, 0.01) * 100;
  if (bandwidth <= 10) score += 5;
  const recentVolume = input.klines.slice(-3).reduce((sum, line) => sum + line.volume, 0) / 3;
  const baseVolume = input.klines.slice(-20, -3).reduce((sum, line) => sum + line.volume, 0) / 17;
  if (recentVolume > baseVolume * 1.15) score += 5;
  if (input.strategySignals.some(item => item.type === 'buy') || input.patterns.some(item => item.type === 'bullish')) score += 5;
  return clamp(score, 0, 25);
}

function scoreRelativeStrength(input: PreMoveSignalInput): number {
  const windows = [5, 10, 20];
  const excess = windows.map(days => {
    const stock = returnPct(input.klines, days);
    const benchmark = returnPct(input.benchmarkKlines, days);
    return stock == null || benchmark == null ? null : stock - benchmark;
  }).filter((value): value is number => value != null);
  if (!excess.length) return 0;
  const average = excess.reduce((a, b) => a + b, 0) / excess.length;
  const improving = excess.length === 3 && excess[0] >= excess[1] && excess[1] >= excess[2] ? 2 : 0;
  return round(clamp(5 + average + improving, 0, 10));
}

function scoreUpsideRoom(input: PreMoveSignalInput): number {
  const last = input.klines.at(-1);
  if (!last) return 0;
  let score = 10;
  const rise10d = returnPct(input.klines, 10) ?? 0;
  if (rise10d > 12) score -= 4;
  if (last.ma && Math.abs(last.close / Math.max(last.ma.ma20, 0.01) - 1) * 100 > 8) score -= 2;
  if ((last.rsi?.rsi6 ?? 0) > 80 || (last.kdj?.j ?? 0) > 90) score -= 3;
  if (input.quote.changePct >= 9) score -= 4;
  return clamp(score, 0, 10);
}

export function calculatePreMoveSignal(input: PreMoveSignalInput): PreMoveSignalResult {
  const scores: PreMoveFeatureScores = {
    industryRotation: scoreIndustry(input), capitalFlow: scoreCapital(input),
    accumulation: scoreAccumulation(input), relativeStrength: scoreRelativeStrength(input),
    upsideRoom: scoreUpsideRoom(input), total: 0,
  };
  scores.total = round(scores.industryRotation + scores.capitalFlow + scores.accumulation + scores.relativeStrength + scores.upsideRoom);

  const hardRisks: PreMoveHardRisk[] = [];
  const positiveEvidence: string[] = [];
  const risks: string[] = [];
  const invalidationConditions: string[] = [];
  const last = input.klines.at(-1);
  const rise10d = returnPct(input.klines, 10) ?? 0;

  if (input.specialTreatment || /ST/i.test(input.quote.name)) hardRisks.push('special_treatment');
  if (input.suspended || input.quote.price <= 0) hardRisks.push('suspended');
  if (input.formal ? input.quote.amount < 5000 : input.quote.turnover < 0.3) hardRisks.push('illiquid');
  if (input.quote.changePct >= 9 || rise10d > 18 || (last?.rsi?.rsi6 ?? 0) >= 85 || (last?.kdj?.j ?? 0) >= 95) hardRisks.push('overheated');
  if (input.klines.length < 60 || input.benchmarkKlines.length < 20 || !input.capitalFlow) hardRisks.push('core_data_missing');
  if ((input.capitalFlow?.mainNet5d ?? 0) < 0 && (input.capitalFlow?.mainNet10d ?? 0) < 0) hardRisks.push('capital_outflow_conflict');

  if (scores.industryRotation >= 22) positiveEvidence.push('行业资金与相对强度同步改善');
  if (scores.capitalFlow >= 18 && (returnPct(input.klines, 5) ?? 99) < 5) positiveEvidence.push('资金先行流入，价格尚未充分启动');
  if (scores.accumulation >= 15) positiveEvidence.push('量价结构呈现蓄势特征');
  if (hardRisks.includes('overheated')) risks.push('短期涨幅或动量指标过热');
  if (hardRisks.includes('illiquid')) risks.push(input.formal ? '收盘成交额低于5000万元' : '盘中换手率低于0.3%，流动性门槛暂定');
  if ((input.capitalFlow?.mainNet5d ?? 0) <= 0) invalidationConditions.push('5日主力资金转为净流出');
  invalidationConditions.push('跌破MA20或板块相对强度转弱');

  const coverageFlags = {
    industry: input.industry.returnPercentile != null && input.industry.flowPercentile != null,
    capital_flow: input.capitalFlow != null && input.flowHistory.length > 0,
    kline: input.klines.length >= 60,
    benchmark: input.benchmarkKlines.length >= 20,
    indicators: Boolean(last?.ma && last.macd && last.kdj && last.rsi && last.boll && last.atr != null),
  };
  const featureCoverage = Object.entries(coverageFlags).filter(([, available]) => available).map(([name]) => name);
  const dataCompleteness = featureCoverage.length / Object.keys(coverageFlags).length;

  return {
    scores, hardRisks: [...new Set(hardRisks)], positiveEvidence, risks, invalidationConditions,
    dataCompleteness,
    rawFeatures: {
      industryReturnPercentile: input.industry.returnPercentile,
      industryFlowPercentile: input.industry.flowPercentile,
      mainRatio5d: input.capitalFlow?.mainRatio5d ?? null,
      mainRatio10d: input.capitalFlow?.mainRatio10d ?? null,
      return5d: returnPct(input.klines, 5), return10d: rise10d,
      relativeStrengthScore: scores.relativeStrength,
    },
    featureCoverage,
  };
}