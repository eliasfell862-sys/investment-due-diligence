import { describe, expect, it, vi } from 'vitest';
import type { StockKLine } from '../../../infrastructure/market-data/stock-api';
import { buildDailyReviewSnapshot, type DailySnapshotInput } from './daily-snapshot-builder';
import { DEFAULT_TECHNICAL_STRATEGY_CONFIG } from './technical-strategy-config';

const bar = (date: string): StockKLine => ({
  date, open: 10, close: 10, high: 10.2, low: 9.8, volume: 1_000, amount: 10_000,
});

const input = (overrides: Partial<DailySnapshotInput> = {}): DailySnapshotInput => ({
  tradingDate: '2026-08-06',
  strategyConfig: DEFAULT_TECHNICAL_STRATEGY_CONFIG,
  watchlistCodes: ['000001'],
  actualPositions: [],
  virtualLedger: { positions: [], trades: [], cycles: [] },
  marketRegime: 'sideways',
  dataSources: ['fixture'],
  loadBars: vi.fn(async () => Array.from({ length: 60 }, (_, index) =>
    bar(`2026-07-${String(index + 1).padStart(2, '0')}`))),
  ...overrides,
});

describe('buildDailyReviewSnapshot', () => {
  it('removes bars after the review date and creates a stable content id', async () => {
    const loadBars = vi.fn(async (_code: string, _limit: number) => [
      bar('2026-08-05'), bar('2026-08-06'), bar('2026-08-07'),
    ]);
    const first = await buildDailyReviewSnapshot(input({ loadBars }));
    const second = await buildDailyReviewSnapshot(input({ loadBars }));

    expect(first.stocks['000001'].bars.map(item => item.date))
      .toEqual(['2026-08-05', '2026-08-06']);
    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^snapshot-2026-08-06-realtime-technical-1-[a-f0-9]{12}$/);
    expect(first.dataQuality.blockingIssues).toContain('000001可用K线少于60个交易日');
  });

  it('loads the stable union of watchlist and held stocks with 250 bars', async () => {
    const loadBars = vi.fn(async (_code: string, _limit: number) => [bar('2026-08-06')]);
    const result = await buildDailyReviewSnapshot(input({
      watchlistCodes: ['600519', '000001'],
      actualPositions: [{ code: '300750' }],
      virtualLedger: { positions: [{ code: '600519' }, { code: '002594' }] },
      loadBars,
    }));

    expect(Object.keys(result.stocks).sort()).toEqual(['000001', '002594', '300750', '600519']);
    expect(loadBars).toHaveBeenCalledTimes(4);
    expect(loadBars.mock.calls.every(([, limit]) => limit === 250)).toBe(true);
  });
});
