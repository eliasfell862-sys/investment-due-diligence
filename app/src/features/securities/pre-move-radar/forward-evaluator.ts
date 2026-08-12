import type { StockKLine } from '../../../infrastructure/market-data/stock-api';
import { evaluatePredictionOutcome } from './prediction-outcome';
import type { PreMoveRadarRepository, PreMoveForwardObservation, PreMoveOutcomeRecord } from './radar-repository';

export interface ForwardEvaluationInput {
  asOfTradingDate: string;
  repository: PreMoveRadarRepository;
  loadStockBars: (code: string, endDate: string) => Promise<StockKLine[]>;
  loadBenchmarkBars: (endDate: string) => Promise<StockKLine[]>;
  now?: () => string;
}

export interface ForwardEvaluationResult {
  savedHorizons: Array<3 | 5 | 10 | 15>;
  completedPredictionIds: string[];
  pendingPredictionIds: string[];
  errors: Array<{ predictionId: string; message: string }>;
}

const HORIZONS = [3, 5, 10, 15] as const;
const pct = (value: number, base: number) => base > 0 ? (value / base - 1) * 100 : 0;

export async function evaluateDuePredictions(input: ForwardEvaluationInput): Promise<ForwardEvaluationResult> {
  const predictions = await input.repository.listDuePredictions(input.asOfTradingDate);
  const result: ForwardEvaluationResult = { savedHorizons: [], completedPredictionIds: [], pendingPredictionIds: [], errors: [] };
  const saved = new Set<3 | 5 | 10 | 15>();
  let benchmarkPromise: Promise<StockKLine[]> | null = null;
  const loadBenchmarkOnce = () => {
    benchmarkPromise ??= input.loadBenchmarkBars(input.asOfTradingDate);
    return benchmarkPromise;
  };

  for (const prediction of predictions) {
    try {
      const [stockBars, benchmarkBars, existing] = await Promise.all([
        input.loadStockBars(prediction.code, input.asOfTradingDate), loadBenchmarkOnce(),
        input.repository.listObservationHorizons(prediction.id),
      ]);
      const benchmarkByDate = new Map(benchmarkBars.filter(bar => bar.date > prediction.tradingDate).map(bar => [bar.date, bar]));
      const common = stockBars.filter(bar => bar.date > prediction.tradingDate && benchmarkByDate.has(bar.date))
        .sort((a, b) => a.date.localeCompare(b.date));
      const existingSet = new Set(existing);
      for (const horizon of HORIZONS) {
        if (common.length < horizon || existingSet.has(horizon)) continue;
        const stock = common[horizon - 1];
        const benchmark = benchmarkByDate.get(stock.date)!;
        const minimumLow = Math.min(prediction.signalClose, ...common.slice(0, horizon).map(bar => bar.low));
        const observation: PreMoveForwardObservation = {
          id: `${prediction.id}-${horizon}`, predictionId: prediction.id, horizon,
          observedTradingDate: stock.date, returnPct: pct(stock.close, prediction.signalClose),
          excessReturnPct: pct(stock.close, prediction.signalClose) - pct(benchmark.close, prediction.benchmarkSignalClose),
          drawdownPct: pct(minimumLow, prediction.signalClose),
        };
        await input.repository.saveForwardObservation(observation);
        saved.add(horizon);
      }
      if (common.length >= 15) {
        const outcome = evaluatePredictionOutcome({ signalDate: prediction.tradingDate,
          signalClose: prediction.signalClose, benchmarkSignalClose: prediction.benchmarkSignalClose,
          stockBars: common, benchmarkBars });
        const record: PreMoveOutcomeRecord = { ...outcome, id: `outcome-${prediction.id}`,
          predictionId: prediction.id, completedAt: input.now?.() ?? new Date().toISOString() };
        await input.repository.saveCompletedOutcome(record, {
          id: `${prediction.modelVersion}-${prediction.code}-${prediction.tradingDate}`,
          code: prediction.code, modelVersion: prediction.modelVersion,
          featureCoverage: prediction.featureCoverage, signalDate: prediction.tradingDate,
          score: prediction.signalScore, dataCompleteness: prediction.dataCompleteness,
          marketRegime: prediction.marketRegime, success: outcome.success === true,
          excessReturnPct: outcome.maxExcessReturnPct ?? 0,
        });
        result.completedPredictionIds.push(prediction.id);
      } else result.pendingPredictionIds.push(prediction.id);
    } catch (error) {
      result.errors.push({ predictionId: prediction.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  result.savedHorizons = HORIZONS.filter(value => saved.has(value));
  return result;
}