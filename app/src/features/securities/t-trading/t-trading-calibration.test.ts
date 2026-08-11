import { describe, expect, it } from 'vitest';
import type { StockKLine } from '../../../infrastructure/market-data/stock-api';
import { calibrateTTradeParameters } from './t-trading-calibration';

function bars(count: number): StockKLine[] {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index / 4) * 0.35;
    const trend = index * 0.015;
    const close = 10 + trend + wave;
    return {
      date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
      open: close - 0.05,
      close,
      high: close + 0.28,
      low: close - 0.28,
      volume: 1_000_000 + index * 1_000,
      amount: close * (1_000_000 + index * 1_000),
    };
  });
}

describe('T-trading walk-forward calibration', () => {
  it('uses conservative defaults when fewer than 60 bars are available', () => {
    const result = calibrateTTradeParameters({ klines: bars(59) });

    expect(result).toEqual({
      status: 'sample_insufficient',
      sampleDays: 59,
      parameters: {
        sellAtrMultiple: 0.8,
        buybackAtrMultiple: 0.6,
        resistanceTolerance: 0.02,
        maxPositionRatio: 0.15,
      },
      metrics: null,
    });
  });

  it('never reads bars after the requested as-of index', () => {
    const history = bars(140);
    const baseline = calibrateTTradeParameters({ klines: history, asOfIndex: 119 });
    const shocked = history.map((bar, index) => (
      index <= 119
        ? bar
        : { ...bar, open: 100, close: 120, high: 150, low: 80, volume: 999_000_000 }
    ));

    expect(calibrateTTradeParameters({ klines: shocked, asOfIndex: 119 })).toEqual(baseline);
    expect(baseline.status).toBe('calibrated');
    expect(baseline.sampleDays).toBe(120);
  });

  it('returns parameters from the approved bounded grid', () => {
    const result = calibrateTTradeParameters({ klines: bars(120) });

    expect(result.status).toBe('calibrated');
    expect([0.6, 0.8, 1]).toContain(result.parameters.sellAtrMultiple);
    expect([0.4, 0.6, 0.8]).toContain(result.parameters.buybackAtrMultiple);
    expect([0.01, 0.02, 0.03]).toContain(result.parameters.resistanceTolerance);
    expect([0.15, 0.25, 0.35]).toContain(result.parameters.maxPositionRatio);
    expect(result.metrics).not.toBeNull();
  });
});
