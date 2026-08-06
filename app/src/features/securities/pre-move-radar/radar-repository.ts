import type { PreMoveRadarDb } from './radar-db';
import type { CalibrationSample, MarketRegime, PredictionOutcome, PreMovePrediction } from './types';

export interface PreMoveScanRecord {
  id: string;
  tradingDate: string;
  createdAt: string;
  modelVersion: string;
  formal: boolean;
  marketRegime: MarketRegime;
  dataSources: string[];
}

export interface PreMovePredictionRecord extends PreMovePrediction {
  id: string;
  scanId: string;
  tradingDate: string;
  modelVersion: string;
  marketRegime: MarketRegime;
  signalClose: number;
  benchmarkSignalClose: number;
}

export interface PreMoveForwardObservation {
  id: string;
  predictionId: string;
  horizon: 3 | 5 | 10 | 15;
  observedTradingDate: string;
  returnPct: number;
  excessReturnPct: number;
  drawdownPct: number;
}

export interface PreMoveOutcomeRecord extends PredictionOutcome {
  id: string;
  predictionId: string;
  completedAt: string;
}

export class PreMoveRadarRepository {
  readonly db: PreMoveRadarDb;

  constructor(db: PreMoveRadarDb) {
    this.db = db;
  }

  async saveFormalScan(scan: PreMoveScanRecord, predictions: PreMovePredictionRecord[]): Promise<void> {
    await this.db.transaction('rw', this.db.scans, this.db.predictions, async () => {
      await this.db.scans.put(scan);
      await this.db.predictions.bulkPut(predictions);
    });
  }

  async getLatestScan(): Promise<{ scan: PreMoveScanRecord; predictions: PreMovePredictionRecord[] } | null> {
    const scan = await this.db.scans.orderBy('createdAt').last();
    if (!scan) return null;
    return { scan, predictions: await this.db.predictions.where('scanId').equals(scan.id).toArray() };
  }

  async listDuePredictions(asOfTradingDate: string): Promise<PreMovePredictionRecord[]> {
    const predictions = await this.db.predictions.where('tradingDate').below(asOfTradingDate).toArray();
    const completed = new Set((await this.db.outcomes.toArray()).map(item => item.predictionId));
    return predictions.filter(item => !completed.has(item.id));
  }

  async listObservationHorizons(predictionId: string): Promise<Array<3 | 5 | 10 | 15>> {
    return (await this.db.observations.where('predictionId').equals(predictionId).toArray()).map(item => item.horizon);
  }

  async saveForwardObservation(value: PreMoveForwardObservation): Promise<void> {
    await this.db.observations.put(value);
  }

  async saveCompletedOutcome(outcome: PreMoveOutcomeRecord, sample: CalibrationSample): Promise<void> {
    await this.db.transaction('rw', this.db.outcomes, this.db.calibrationSamples, async () => {
      await this.db.outcomes.put(outcome);
      await this.db.calibrationSamples.put(sample);
    });
  }

  async saveCalibrationSamples(samples: CalibrationSample[]): Promise<void> {
    if (samples.length) await this.db.calibrationSamples.bulkPut(samples);
  }

  listCalibrationSamples(modelVersion: string): Promise<CalibrationSample[]> {
    return this.db.calibrationSamples.where('modelVersion').equals(modelVersion).toArray();
  }
}