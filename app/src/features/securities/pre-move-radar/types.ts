import type { StockKLine } from '../../../infrastructure/market-data/stock-api';

export type PreMoveStatus = 'layout_ready' | 'await_confirmation' | 'avoid_layout';
export type PreMoveCandidateSource = 'watchlist' | 'rotation' | 'watchlist_and_rotation';
export type MarketRegime = 'strong' | 'sideways' | 'weak';

export interface PreMoveFeatureScores {
  industryRotation: number;
  capitalFlow: number;
  accumulation: number;
  relativeStrength: number;
  upsideRoom: number;
  total: number;
}

export interface IndustryRotationView {
  industry: string;
  rank: number;
  compositeScore: number;
  returnPct1d: number;
  returnPct5d: number | null;
  returnPct10d: number | null;
  mainNet1d: number;
  mainNet5d: number | null;
  mainNet10d: number | null;
  stage: 'watch' | 'accumulating' | 'starting' | 'overheated' | 'weakening';
}

export interface PreMovePrediction {
  code: string;
  name: string;
  industry: string | null;
  source: PreMoveCandidateSource;
  currentPrice: number;
  signalScore: number;
  scores: PreMoveFeatureScores;
  rawFeatures: Record<string, number | null>;
  featureCoverage: string[];
  probability: number;
  confidence: number;
  formalProbability: boolean;
  sampleSize: number;
  similarSampleSize: number;
  status: PreMoveStatus;
  expectedWindow: '3_5' | '5_10' | '10_15';
  positiveEvidence: string[];
  risks: string[];
  invalidationConditions: string[];
  dataCompleteness: number;
  dataSources: string[];
  dataAsOf: string;
}

export interface PredictionOutcomeInput {
  signalDate: string;
  signalClose: number;
  benchmarkSignalClose: number;
  stockBars: StockKLine[];
  benchmarkBars: StockKLine[];
}

export interface PredictionObservation {
  tradingDay: number;
  date: string;
  returnPct: number;
  excessReturnPct: number;
  drawdownPct: number;
}

export interface PredictionOutcome {
  evaluated: boolean;
  success: boolean | null;
  firstSuccessTradingDay: number | null;
  maxReturnPct: number | null;
  maxExcessReturnPct: number | null;
  maxDrawdownPct: number | null;
  observations: PredictionObservation[];
}

export interface CalibrationSample {
  id: string;
  code: string;
  modelVersion: string;
  featureCoverage: string[];
  signalDate: string;
  score: number;
  dataCompleteness: number;
  marketRegime: MarketRegime;
  success: boolean;
  excessReturnPct: number;
}