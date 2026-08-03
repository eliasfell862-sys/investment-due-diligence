import { describe, expect, it, vi } from 'vitest';
import { fetchAllAStocks, fetchAllAStocksResult } from './stock-api';

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

  it('reports a later provider failure as partial instead of success', async () => {
    const request = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('pn'));
      if (page === 2) throw new Error('rate limited');
      return { data: { total: 200, diff: [{ f12: '000001', f14: 'Stock', f100: 'Bank' }] } };
    });

    const result = await fetchAllAStocksResult({
      pageSize: 1, request,
      fallbackRequest: vi.fn().mockRejectedValue(new Error('fallback blocked')),
    });

    expect(result.data).toHaveLength(1);
    expect(result.meta).toMatchObject({ status: 'partial' });
    expect(result.meta.error).toContain('fallback blocked');
  });
});
