import { describe, expect, it, vi } from 'vitest';
import { fetchAllAStocks } from './stock-api';

describe('fetchAllAStocks partial provider failures', () => {
  it('preserves successfully fetched classifications when a later page fails', async () => {
    const request = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('pn'));
      if (page === 3) throw new Error('rate limited');
      const start = (page - 1) * 100;
      return {
        data: {
          total: 300,
          diff: Array.from({ length: 100 }, (_, offset) => {
            const code = String(start + offset).padStart(6, '0');
            return { f12: code, f14: `Stock ${code}`, f100: 'Industry' };
          }),
        },
      };
    });
    const fallbackRequest = vi.fn().mockRejectedValue(new Error('fallback blocked'));

    const stocks = await fetchAllAStocks({
      pageSize: 100,
      maxPages: 10,
      request,
      fallbackRequest,
    });

    expect(stocks).toHaveLength(200);
    expect(stocks.every((stock) => stock.industry === 'Industry')).toBe(true);
  });
});
