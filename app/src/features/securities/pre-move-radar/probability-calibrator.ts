import type { CalibrationSample, MarketRegime, PreMoveStatus } from './types';
import type { PreMoveHardRisk } from './signal-engine';

export interface CalibratedPrediction {
  probability: number;
  confidence: number;
  formal: boolean;
  sampleSize: number;
  similarSampleSize: number;
  threshold: number;
  status: PreMoveStatus;
  calibrationLabel: 'formal' | 'calibrating';
}

export interface CalibrationInput {
  score: number;
  marketRegime: MarketRegime;
  featureCoverage: string[];
  dataCompleteness: number;
  hardRisks: PreMoveHardRisk[];
  samples: CalibrationSample[];
}

const round = (value: number) => Math.round(value * 10) / 10;

function coverageSimilarity(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / union.size;
}

function qualifyingThreshold(samples: CalibrationSample[]): number | null {
  if (!samples.length) return null;
  const ordered = [...samples].sort((a, b) => a.signalDate.localeCompare(b.signalDate));
  const validation = ordered.slice(Math.max(0, Math.floor(ordered.length * 0.7)));
  for (let threshold = 55; threshold <= 80; threshold += 1) {
    const selected = validation.filter(sample => sample.score >= threshold);
    if (selected.length < 10) continue;
    const successRate = selected.filter(sample => sample.success).length / selected.length;
    const averageExcess = selected.reduce((sum, sample) => sum + sample.excessReturnPct, 0) / selected.length;
    if (successRate >= 0.6 && averageExcess > 0) return threshold;
  }
  return null;
}

export function selectLayoutThreshold(samples: CalibrationSample[]): number {
  return qualifyingThreshold(samples) ?? 80;
}

export function calibrateProbability(input: CalibrationInput): CalibratedPrediction {
  const similar = input.samples.filter(sample =>
    sample.marketRegime === input.marketRegime
    && Math.abs(sample.score - input.score) <= 10
    && coverageSimilarity(sample.featureCoverage, input.featureCoverage) >= 0.6,
  );
  const observedBaseRate = input.samples.length
    ? input.samples.filter(sample => sample.success).length / input.samples.length
    : 0.5;
  const baseRate = input.samples.length >= 30 ? observedBaseRate : 0.5;
  const successes = similar.filter(sample => sample.success).length;
  const probability = round(((successes + baseRate * 20) / (similar.length + 20)) * 100);
  const confidence = round(Math.min(100,
    Math.max(0, input.dataCompleteness) * 60 + Math.min(1, similar.length / 30) * 40,
  ));
  const formal = input.samples.length >= 200 && similar.length >= 30;
  const thresholdCandidate = qualifyingThreshold(input.samples);
  const threshold = thresholdCandidate ?? 80;

  let status: PreMoveStatus;
  if (input.hardRisks.length > 0 || input.dataCompleteness < 0.8) status = 'avoid_layout';
  else if (!formal || confidence < 60) status = probability >= baseRate * 100 ? 'await_confirmation' : 'avoid_layout';
  else if (thresholdCandidate !== null && probability >= threshold) status = 'layout_ready';
  else if (probability >= baseRate * 100) status = 'await_confirmation';
  else status = 'avoid_layout';

  return {
    probability, confidence, formal, sampleSize: input.samples.length,
    similarSampleSize: similar.length, threshold, status,
    calibrationLabel: formal ? 'formal' : 'calibrating',
  };
}