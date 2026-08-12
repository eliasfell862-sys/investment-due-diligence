import { describe, expect, it, vi } from 'vitest';
import type { StockKLine } from '../../../infrastructure/market-data/stock-api';
import { evaluateDuePredictions } from './forward-evaluator';
import type { PreMovePredictionRecord, PreMoveRadarRepository } from './radar-repository';

function bars(count: number, start: number, daily = 0.005): StockKLine[] {
  let close = start;
  return Array.from({ length: count }, (_, index) => { close *= 1 + daily; return {
    date: `2026-08-${String(index + 6).padStart(2, '0')}`, open: close, close, high: close * 1.01,
    low: close * 0.995, volume: 1000, amount: 100000000 } });
}
function prediction(): PreMovePredictionRecord {
  return { id: 'prediction-due', scanId: 'scan-1', tradingDate: '2026-08-05', modelVersion: 'v1', marketRegime: 'strong',
    signalClose: 10, benchmarkSignalClose: 100, code: '000001', name: '平安银行', industry: '银行', source: 'watchlist',
    currentPrice: 10, signalScore: 70, scores: { industryRotation: 25, capitalFlow: 20, accumulation: 15, relativeStrength: 5, upsideRoom: 5, total: 70 },
    rawFeatures: {}, featureCoverage: ['kline'], probability: 65, confidence: 70, formalProbability: true,
    sampleSize: 220, similarSampleSize: 40, status: 'layout_ready', expectedWindow: '5_10', positiveEvidence: [], risks: [],
    invalidationConditions: [], dataCompleteness: 1, dataSources: ['test'], dataAsOf: '2026-08-05T07:10:00Z' };
}
function repository() {
  return { listDuePredictions: vi.fn(async () => [prediction()]), listObservationHorizons: vi.fn(async () => []),
    saveForwardObservation: vi.fn(async () => undefined), saveCompletedOutcome: vi.fn(async () => undefined) } as unknown as PreMoveRadarRepository;
}

describe('forward prediction evaluation', () => {
  it('saves observations at three five ten and fifteen days and completes the outcome', async () => {
    const repo = repository();
    const result = await evaluateDuePredictions({ asOfTradingDate: '2026-08-31', repository: repo,
      loadStockBars: vi.fn(async () => bars(15, 10, 0.006)), loadBenchmarkBars: vi.fn(async () => bars(15, 100, 0.001)) });
    expect(result.savedHorizons).toEqual([3, 5, 10, 15]);
    expect(result.completedPredictionIds).toEqual(['prediction-due']);
    expect(repo.saveCompletedOutcome).toHaveBeenCalledWith(expect.any(Object),
      expect.objectContaining({ id: 'v1-000001-2026-08-05', modelVersion: 'v1' }));
  });

  it('keeps final success pending before fifteen trading days', async () => {
    const repo = repository();
    const result = await evaluateDuePredictions({ asOfTradingDate: '2026-08-20', repository: repo,
      loadStockBars: vi.fn(async () => bars(10, 10)), loadBenchmarkBars: vi.fn(async () => bars(10, 100, 0.001)) });
    expect(result.savedHorizons).toEqual([3, 5, 10]);
    expect(result.completedPredictionIds).toEqual([]);
  });

  it('passes the evaluation as-of date to every market data load', async () => {
    const loadStockBars = vi.fn(async () => bars(3, 10));
    const loadBenchmarkBars = vi.fn(async () => bars(3, 100));
    await evaluateDuePredictions({ asOfTradingDate: '2026-08-20', repository: repository(), loadStockBars, loadBenchmarkBars });
    expect(loadStockBars).toHaveBeenCalledWith('000001', '2026-08-20');
    expect(loadBenchmarkBars).toHaveBeenCalledWith('2026-08-20');
  });
});