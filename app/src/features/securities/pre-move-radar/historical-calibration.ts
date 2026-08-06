import { calcAllIndicators } from '../../../engines/market-analysis/technical-indicators';
import type { StockKLine, StockQuote } from '../../../infrastructure/market-data/stock-api';
import type { HistoricalCapitalFlowPoint, MultiDayCapitalFlow } from '../../../infrastructure/market-data/pre-move-market-data-api';
import { evaluatePredictionOutcome } from './prediction-outcome';
import { calculatePreMoveSignal, type PreMoveSignalInput, type PreMoveSignalResult } from './signal-engine';
import type { CalibrationSample, IndustryRotationView, MarketRegime } from './types';

export interface HistoricalIndustryPoint {
  date: string;
  returnPercentile: number;
  flowPercentile: number;
  breadthPercentile: number;
  relativeStrengthSlopePercentile: number;
  stage: IndustryRotationView['stage'];
}

export interface HistoricalCalibrationInput {
  code: string;
  stockBars: StockKLine[];
  benchmarkBars: StockKLine[];
  flowHistory: HistoricalCapitalFlowPoint[];
  industryHistory?: HistoricalIndustryPoint[];
  startAfterTradingDays?: number;
  strideTradingDays?: number;
  modelVersion: string;
}

export interface HistoricalCalibrationDependencies {
  calculateSignal?: (input: PreMoveSignalInput) => PreMoveSignalResult;
}

function pct(end: number, start: number): number | null {
  return start > 0 ? (end / start - 1) * 100 : null;
}

function periodReturn(bars: StockKLine[], days: number): number | null {
  if (bars.length <= days) return null;
  return pct(bars.at(-1)!.close, bars[bars.length - days - 1].close);
}

function capitalFlowAt(code: string, bars: StockKLine[], rows: HistoricalCapitalFlowPoint[]): MultiDayCapitalFlow | null {
  if (!rows.length) return null;
  const sum = (days: number) => rows.slice(-days).reduce((value, row) => value + row.mainNet, 0);
  const ratio = (days: number) => {
    const window = rows.slice(-days);
    return window.length ? window.reduce((value, row) => value + row.mainRatio, 0) / window.length : null;
  };
  return {
    code, changePct3d: periodReturn(bars, 3), changePct5d: periodReturn(bars, 5), changePct10d: periodReturn(bars, 10),
    mainNet3d: sum(3), mainRatio3d: ratio(3), mainNet5d: sum(5), mainRatio5d: ratio(5),
    mainNet10d: sum(10), mainRatio10d: ratio(10),
  };
}

function marketRegimeAt(benchmark: StockKLine[]): MarketRegime {
  const change = periodReturn(benchmark, 20) ?? 0;
  return change >= 2 ? 'strong' : change <= -2 ? 'weak' : 'sideways';
}

function quoteAt(code: string, bar: StockKLine): StockQuote {
  const preClose = bar.open || bar.close;
  return { code, name: code, market: code.startsWith('6') ? 'sh' : 'sz', price: bar.close,
    change: bar.close - preClose, changePct: preClose > 0 ? (bar.close / preClose - 1) * 100 : 0,
    open: bar.open, high: bar.high, low: bar.low, volume: bar.volume, amount: bar.amount / 10000,
    preClose, turnover: 1, pe: 0, pb: 0, totalShares: 0, floatShares: 0, totalCap: 0, floatCap: 0 };
}

export function generateHistoricalCalibrationSamples(
  input: HistoricalCalibrationInput,
  dependencies: HistoricalCalibrationDependencies = {},
): CalibrationSample[] {
  const calculateSignal = dependencies.calculateSignal ?? calculatePreMoveSignal;
  const benchmarkByDate = new Map(input.benchmarkBars.map(bar => [bar.date, bar]));
  const commonStock = input.stockBars.filter(bar => benchmarkByDate.has(bar.date)).sort((a, b) => a.date.localeCompare(b.date));
  const commonBenchmark = commonStock.map(bar => benchmarkByDate.get(bar.date)!);
  const start = Math.max(60, input.startAfterTradingDays ?? 60) - 1;
  const stride = Math.max(1, input.strideTradingDays ?? 5);
  const samples: CalibrationSample[] = [];

  for (let index = start; index <= commonStock.length - 16; index += stride) {
    const signalDate = commonStock[index].date;
    const stockHistory = commonStock.slice(0, index + 1).map(bar => ({ ...bar }));
    const benchmarkHistory = commonBenchmark.slice(0, index + 1).map(bar => ({ ...bar }));
    calcAllIndicators(stockHistory);
    const pointFlows = input.flowHistory.filter(row => row.date <= signalDate);
    const industryPoint = input.industryHistory
      ?.filter(row => row.date <= signalDate).sort((a, b) => b.date.localeCompare(a.date))[0];
    const signal = calculateSignal({
      asOfDate: signalDate, formal: true, quote: quoteAt(input.code, stockHistory.at(-1)!),
      industry: industryPoint ? { returnPercentile: industryPoint.returnPercentile,
        flowPercentile: industryPoint.flowPercentile, breadthPercentile: industryPoint.breadthPercentile,
        relativeStrengthSlopePercentile: industryPoint.relativeStrengthSlopePercentile, stage: industryPoint.stage }
        : { returnPercentile: null, flowPercentile: null, breadthPercentile: null,
          relativeStrengthSlopePercentile: null, stage: null },
      capitalFlow: capitalFlowAt(input.code, stockHistory, pointFlows), flowHistory: pointFlows,
      klines: stockHistory, benchmarkKlines: benchmarkHistory, strategySignals: [], patterns: [],
      specialTreatment: false, suspended: false,
    });
    const outcome = evaluatePredictionOutcome({ signalDate, signalClose: commonStock[index].close,
      benchmarkSignalClose: commonBenchmark[index].close, stockBars: commonStock.slice(index + 1),
      benchmarkBars: commonBenchmark.slice(index + 1) });
    if (!outcome.evaluated || outcome.success == null) continue;
    samples.push({ id: `${input.modelVersion}-${input.code}-${signalDate}`, code: input.code,
      modelVersion: input.modelVersion, featureCoverage: signal.featureCoverage, signalDate,
      score: signal.scores.total, dataCompleteness: signal.dataCompleteness,
      marketRegime: marketRegimeAt(benchmarkHistory), success: outcome.success,
      excessReturnPct: outcome.maxExcessReturnPct ?? 0 });
  }
  return samples;
}