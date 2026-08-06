import { describe, expect, it, vi } from 'vitest';
import type { StockKLine } from '../../../infrastructure/market-data/stock-api';
import { generateHistoricalCalibrationSamples } from './historical-calibration';
import type { PreMoveSignalInput, PreMoveSignalResult } from './signal-engine';

function bars(count = 120, growth = 0.006): StockKLine[] {
  let close = 10;
  return Array.from({ length: count }, (_, index) => {
    close *= 1 + growth;
    return { date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`,
      open: close * 0.995, close, high: close * 1.01, low: close * 0.99,
      volume: 1000 + index, amount: 100000000 };
  });
}

function input() {
  const stockBars = bars();
  return { code: '000001', stockBars, benchmarkBars: bars(120, 0.001),
    flowHistory: stockBars.map((bar, index) => ({ date: bar.date, mainNet: 100 + index,
      mainRatio: 3, superLargeNet: 60, largeNet: 40 })), modelVersion: 'v1' };
}

describe('historical pre-move calibration', () => {
  it('passes only point-in-time data to the signal engine', () => {
    const calculateSignal = vi.fn((_: PreMoveSignalInput): PreMoveSignalResult => ({
      scores: { industryRotation: 0, capitalFlow: 20, accumulation: 15, relativeStrength: 8, upsideRoom: 8, total: 51 },
      hardRisks: [], positiveEvidence: [], risks: [], invalidationConditions: [], dataCompleteness: 0.8,
      rawFeatures: {}, featureCoverage: ['capital_flow', 'kline', 'benchmark', 'indicators'],
    }));
    generateHistoricalCalibrationSamples(input(), { calculateSignal });
    for (const [call] of calculateSignal.mock.calls) {
      expect(call.klines.every((bar: StockKLine) => bar.date <= call.asOfDate)).toBe(true);
      expect(call.flowHistory.every((row: { date: string }) => row.date <= call.asOfDate)).toBe(true);
    }
  });

  it('creates labeled samples with deterministic ids and model versions', () => {
    const result = generateHistoricalCalibrationSamples(input());
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatchObject({ code: '000001', modelVersion: 'v1' });
    expect(result[0].id).toBe(`v1-000001-${result[0].signalDate}`);
  });

  it('does not claim unavailable historical industry features', () => {
    const result = generateHistoricalCalibrationSamples({ ...input(), industryHistory: [] });
    expect(result[0].featureCoverage).not.toContain('industry');
  });
});