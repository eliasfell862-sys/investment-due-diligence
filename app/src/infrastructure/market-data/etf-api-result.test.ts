import { describe, expect, it, vi } from 'vitest';
import { fetchAStockETFsResult } from './etf-api';

describe('fetchAStockETFsResult', () => {
  it('reports a local directory read failure instead of an empty successful list', async () => {
    const result = await fetchAStockETFsResult({
      request: vi.fn().mockRejectedValue(new Error('ETF file unavailable')),
    });
    expect(result.data).toEqual([]);
    expect(result.meta).toMatchObject({ status: 'error', error: 'ETF file unavailable' });
  });
});