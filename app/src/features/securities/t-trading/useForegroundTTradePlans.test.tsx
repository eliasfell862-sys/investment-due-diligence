import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockKLine, StockQuote } from '../../../infrastructure/market-data/stock-api';
import { DEFAULT_TRADING_FEE_PROFILE } from './t-trading-types';
import { useForegroundTTradePlans } from './useForegroundTTradePlans';

const mocks = vi.hoisted(() => ({ fetchKLine: vi.fn() }));

vi.mock('../../../infrastructure/market-data/stock-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../infrastructure/market-data/stock-api')>()),
  fetchEastmoneyKLine: mocks.fetchKLine,
}));

function bars(count = 80): StockKLine[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 10 + index * 0.025 + Math.sin(index / 4) * 0.1;
    return {
      date: `2026-01-${String(index + 1).padStart(3, '0')}`,
      open: close - 0.03, high: close + 0.18, low: close - 0.18, close,
      volume: 1_000_000 + index * 1_000, amount: close * (1_000_000 + index * 1_000),
    };
  });
}

const quote: StockQuote = {
  code: '000001', name: '平安银行', market: 'sz', price: 12, change: -0.05, changePct: -0.4,
  open: 11.9, high: 12.2, low: 11.8, volume: 2_000_000, amount: 24_000_000,
  preClose: 12.05, turnover: 1, pe: 10, pb: 1,
  totalShares: 0, floatShares: 0, totalCap: 0, floatCap: 0,
};

describe('useForegroundTTradePlans', () => {
  beforeEach(() => mocks.fetchKLine.mockReset());

  it('loads the existing K-line source and returns a computed foreground state', async () => {
    mocks.fetchKLine.mockResolvedValue(bars());
    const { result } = renderHook(() => useForegroundTTradePlans({
      positions: [{ code: '000001', availableShares: 1000, averageCost: 11 }],
      quotes: { '000001': quote }, quoteAt: '2026-08-12T02:00:00.000Z',
      marketStatus: 'trading', feeProfile: DEFAULT_TRADING_FEE_PROFILE,
    }));

    await waitFor(() => expect(result.current['000001']?.status).not.toBe('loading'));
    expect(mocks.fetchKLine).toHaveBeenCalledWith('000001', 250);
    expect(['ready', 'waiting']).toContain(result.current['000001']?.status);
    expect(result.current['000001']?.error).toBe('');
  });

  it('reuses the same trading-day K-line history when live quotes change', async () => {
    mocks.fetchKLine.mockResolvedValue(bars());
    const baseInput = {
      positions: [{ code: '000001', availableShares: 1000, averageCost: 11 }],
      quoteAt: '2026-08-12T02:00:00.000Z', marketStatus: 'trading',
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
    };
    const { result, rerender } = renderHook(
      ({ price }) => useForegroundTTradePlans({
        ...baseInput, quotes: { '000001': { ...quote, price } },
      }),
      { initialProps: { price: 12 } },
    );
    await waitFor(() => expect(result.current['000001']?.status).not.toBe('loading'));

    rerender({ price: 12.01 });
    await waitFor(() => expect(result.current['000001']?.status).not.toBe('loading'));
    expect(mocks.fetchKLine).toHaveBeenCalledTimes(1);
  });
  it('distinguishes missing history from stale market data', async () => {
    mocks.fetchKLine.mockResolvedValue([]);
    const { result } = renderHook(() => useForegroundTTradePlans({
      positions: [{ code: '000001', availableShares: 1000, averageCost: 11 }],
      quotes: { '000001': quote }, quoteAt: '2026-08-12T02:00:00.000Z',
      marketStatus: 'trading', feeProfile: DEFAULT_TRADING_FEE_PROFILE,
    }));

    await waitFor(() => expect(result.current['000001']?.status).toBe('error'));
    expect(result.current['000001']?.error).toBe('未获取到历史 K 线');
  });
});
