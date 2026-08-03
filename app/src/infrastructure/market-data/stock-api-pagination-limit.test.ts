import { describe, expect, it, vi } from 'vitest';
import { fetchAllAStocks } from './stock-api';

describe('fetchAllAStocks provider page limits', () => {
  it('continues beyond 20 provider pages when the provider clamps each page to 100 rows', async () => {
    const total = 2101;
    const request = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('pn'));
      const start = (page - 1) * 100;
      const count = Math.max(0, Math.min(100, total - start));
      const diff = Array.from({ length: count }, (_, offset) => {
        const code = String(start + offset).padStart(6, '0');
        return { f12: code, f14: `Stock ${code}`, f100: 'Industry' };
      });
      return { data: { total, diff } };
    });

    const stocks = await fetchAllAStocks({ request, fallbackRequest: request });

    expect(stocks).toHaveLength(total);
    expect(request).toHaveBeenCalledTimes(22);
  });
});
