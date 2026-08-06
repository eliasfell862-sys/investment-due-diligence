import { describe, expect, it } from 'vitest';
import type { CalibrationSample } from './types';
import { calibrateProbability, selectLayoutThreshold } from './probability-calibrator';

function samples(count: number, wins: number, score = 70): CalibrationSample[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `v1-000001-${index}`, code: '000001', modelVersion: 'v1',
    featureCoverage: ['industry', 'capital_flow', 'kline', 'benchmark', 'indicators'],
    signalDate: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`,
    score, dataCompleteness: 1, marketRegime: 'strong' as const,
    success: Math.floor((index + 1) * wins / count) > Math.floor(index * wins / count),
    excessReturnPct: Math.floor((index + 1) * wins / count) > Math.floor(index * wins / count) ? 4 : -1,
  }));
}

function input(sampleRows: CalibrationSample[], overrides: Record<string, unknown> = {}) {
  return { score: 72, marketRegime: 'strong' as const,
    featureCoverage: ['industry', 'capital_flow', 'kline', 'benchmark', 'indicators'],
    dataCompleteness: 1, hardRisks: [], samples: sampleRows, ...overrides };
}

describe('pre-move probability calibration', () => {
  it('shrinks a small perfect sample toward the market base rate', () => {
    const result = calibrateProbability(input(samples(5, 5)));
    expect(result.probability).toBeLessThan(100);
    expect(result.formal).toBe(false);
    expect(result.status).toBe('await_confirmation');
  });

  it('never emits layout ready before global two hundred and similar thirty labels', () => {
    const result = calibrateProbability(input(samples(199, 150)));
    expect(result.status).not.toBe('layout_ready');
  });

  it('emits avoid layout whenever a hard risk exists', () => {
    expect(calibrateProbability(input(samples(220, 170), { hardRisks: ['overheated'] })).status)
      .toBe('avoid_layout');
  });

  it('selects no layout probability threshold below fifty-five percent', () => {
    expect(selectLayoutThreshold(samples(220, 150))).toBeGreaterThanOrEqual(55);
  });

  it('can emit a formal layout state with sufficient successful similar samples', () => {
    const result = calibrateProbability(input(samples(240, 180, 72)));
    expect(result.formal).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(60);
    expect(result.status).toBe('layout_ready');
  });
});