import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { PreMoveRadarDb } from './radar-db';
import { PreMoveRadarRepository, type PreMovePredictionRecord, type PreMoveScanRecord } from './radar-repository';

const databases: string[] = [];
function scan(): PreMoveScanRecord { return { id: 'scan-1', tradingDate: '2026-08-05', createdAt: '2026-08-05T07:10:00Z',
  modelVersion: 'v1', formal: true, marketRegime: 'strong', dataSources: ['test'] }; }
function prediction(): PreMovePredictionRecord {
  return { id: 'prediction-1', scanId: 'scan-1', tradingDate: '2026-08-05', modelVersion: 'v1', marketRegime: 'strong',
    signalClose: 10, benchmarkSignalClose: 100, code: '000001', name: '平安银行', industry: '银行', source: 'watchlist',
    currentPrice: 10, signalScore: 70, scores: { industryRotation: 25, capitalFlow: 20, accumulation: 15, relativeStrength: 5, upsideRoom: 5, total: 70 },
    rawFeatures: {}, featureCoverage: ['kline'], probability: 65, confidence: 70, formalProbability: true,
    sampleSize: 220, similarSampleSize: 40, status: 'layout_ready', expectedWindow: '5_10', positiveEvidence: [], risks: [],
    invalidationConditions: [], dataCompleteness: 1, dataSources: ['test'], dataAsOf: '2026-08-05T07:10:00Z' };
}

afterEach(async () => { await Promise.all(databases.splice(0).map(name => Dexie.delete(name))); });

describe('PreMoveRadarRepository', () => {
  it('stores one formal scan per date and model version', async () => {
    const name = `radar-${crypto.randomUUID()}`; databases.push(name);
    const db = new PreMoveRadarDb(name); const repository = new PreMoveRadarRepository(db);
    await repository.saveFormalScan(scan(), [prediction()]);
    await repository.saveFormalScan(scan(), [prediction()]);
    expect(await db.scans.count()).toBe(1);
    expect(await db.predictions.count()).toBe(1);
  });

  it('stores calibration samples idempotently by sample id', async () => {
    const name = `radar-${crypto.randomUUID()}`; databases.push(name);
    const db = new PreMoveRadarDb(name); const repository = new PreMoveRadarRepository(db);
    const sample = { id: 'v1-000001-2026-01-01', code: '000001', modelVersion: 'v1', featureCoverage: ['kline'],
      signalDate: '2026-01-01', score: 70, dataCompleteness: 1, marketRegime: 'strong' as const, success: true, excessReturnPct: 4 };
    await repository.saveCalibrationSamples([sample]); await repository.saveCalibrationSamples([sample]);
    expect(await db.calibrationSamples.count()).toBe(1);
    expect(await repository.listCalibrationSamples('v1')).toHaveLength(1);
  });
});