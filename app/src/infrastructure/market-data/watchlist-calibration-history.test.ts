import { describe, expect, it, vi } from 'vitest';
import type { StockKLine } from './stock-api';
import {
  estimateProxyTurnover,
  fetchWatchlistCalibrationHistory,
  parseCalibrationHistoryResponse,
} from './watchlist-calibration-history';

describe('watchlist calibration history', () => {
  it('parses Eastmoney f51 through f61 fields', () => {
    expect(parseCalibrationHistoryResponse({ data: { klines: [
      '2026-08-01,10,10.5,10.8,9.9,1200,1260000,9,5,0.5,3.2',
    ] } })).toEqual([{
      date: '2026-08-01', open: 10, close: 10.5, high: 10.8, low: 9.9,
      volume: 1200, amount: 1260000, amplitude: 9, changePct: 5,
      change: 0.5, turnover: 3.2,
    }]);
  });

  it('preserves a missing historical turnover rate as null', () => {
    const row = parseCalibrationHistoryResponse({ data: { klines: [
      '2026-08-01,10,10.5,10.8,9.9,1200,1260000,9,5,0.5,-',
    ] } })[0];
    expect(row.turnover).toBeNull();
  });

  it('estimates proxy turnover from prior volume only', () => {
    const prior = Array.from({ length: 20 }, (_, index) => ({ volume: 100 + index }));
    expect(estimateProxyTurnover(240, prior)).toBeCloseTo(6.58, 2);
    expect(estimateProxyTurnover(240, [])).toBeNull();
  });

  it('uses host failover and returns direct history when turnover is complete', async () => {
    const requestJson = vi.fn()
      .mockRejectedValueOnce(new Error('primary down'))
      .mockResolvedValueOnce({ data: { klines: [
        '2026-08-01,10,10.5,10.8,9.9,1200,1260000,9,5,0.5,3.2',
      ] } });
    const fallbackKline = vi.fn();

    const result = await fetchWatchlistCalibrationHistory('600000', 500, {
      requestJson,
      fallbackKline,
    });

    expect(result.turnoverMode).toBe('direct');
    expect(result.source).toBe('东方财富校准专用历史日线');
    expect(result.rows[0]?.turnover).toBe(3.2);
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(requestJson.mock.calls[1]?.[0]).toContain('push2his.eastmoney.com');
    expect(requestJson.mock.calls[1]?.[0]).toContain('fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
    expect(fallbackKline).not.toHaveBeenCalled();
  });

  it('falls back to proxy turnover without mutating fallback K lines', async () => {
    const fallbackRows: StockKLine[] = Array.from({ length: 25 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, '0')}`,
      open: 10, close: 10, high: 10.2, low: 9.8,
      volume: 100 + index, amount: 1000 + index,
    }));
    const original = structuredClone(fallbackRows);

    const result = await fetchWatchlistCalibrationHistory('000001', 500, {
      requestJson: vi.fn().mockResolvedValue({ data: { klines: [
        '2026-08-01,10,10.5,10.8,9.9,1200,1260000,9,5,0.5,-',
      ] } }),
      fallbackKline: vi.fn().mockResolvedValue(fallbackRows),
    });

    expect(result.turnoverMode).toBe('proxy');
    expect(result.warnings).toContain('历史换手率不可完整获取，已使用校准专用代理口径');
    expect(result.rows[20]?.turnover).not.toBeNull();
    expect(fallbackRows).toEqual(original);
  });
});
