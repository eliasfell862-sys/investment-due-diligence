import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAStockETFs } from './etf-api';

describe('fetchAStockETFs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('represents unavailable market fields as null instead of zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        etfs: [{ code: '510300', name: '沪深300ETF', size: 1800 }],
      }),
    }));

    const [etf] = await fetchAStockETFs();

    expect(etf).toMatchObject({
      price: null,
      changePct: null,
      volume: null,
      expenseRatio: null,
      premium: null,
    });
  });
});
