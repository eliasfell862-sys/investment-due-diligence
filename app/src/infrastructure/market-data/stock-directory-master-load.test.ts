import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStockDirectory } from './stock-api';

describe('loadStockDirectory security master projection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns stable security-master fields with the local directory snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        generatedAt: '2026-08-03',
        source: 'eastmoney',
        totalCount: 1,
        stocks: [{ code: '600519', name: '贵州茅台', industry: '白酒' }],
      }),
    }));

    const [stock] = await loadStockDirectory();

    expect(stock).toMatchObject({
      securityId: 'CN.SSE.600519',
      exchange: 'SSE',
      board: 'main',
      classificationStatus: 'official',
    });
  });
});
