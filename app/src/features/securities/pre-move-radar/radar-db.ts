import Dexie, { type EntityTable } from 'dexie';
import type { CalibrationSample } from './types';
import type { PreMoveForwardObservation, PreMoveOutcomeRecord, PreMovePredictionRecord, PreMoveScanRecord } from './radar-repository';

export interface CalibrationRunRecord { id: string; modelVersion: string; createdAt: string; sampleSize: number; }

export class PreMoveRadarDb extends Dexie {
  scans!: EntityTable<PreMoveScanRecord, 'id'>;
  predictions!: EntityTable<PreMovePredictionRecord, 'id'>;
  observations!: EntityTable<PreMoveForwardObservation, 'id'>;
  outcomes!: EntityTable<PreMoveOutcomeRecord, 'id'>;
  calibrationSamples!: EntityTable<CalibrationSample, 'id'>;
  calibrationRuns!: EntityTable<CalibrationRunRecord, 'id'>;

  constructor(name = 'securities-pre-move-radar') {
    super(name);
    this.version(1).stores({
      scans: 'id, &[tradingDate+modelVersion], tradingDate, createdAt, formal',
      predictions: 'id, scanId, code, tradingDate, status',
      observations: 'id, &[predictionId+horizon], predictionId, horizon',
      outcomes: 'id, &predictionId, completedAt',
      calibrationSamples: 'id, modelVersion, code, signalDate, score, marketRegime',
      calibrationRuns: 'id, modelVersion, createdAt',
    });
  }
}

export const preMoveRadarDb = new PreMoveRadarDb();