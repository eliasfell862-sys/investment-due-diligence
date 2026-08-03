import { describe, expect, it, vi } from 'vitest';
import { loadStockDirectoryResult } from './stock-api';

describe('loadStockDirectoryResult', () => {
  it('returns a partial result when the complete local directory survives an official-provider failure', async () => {
    const result = await loadStockDirectoryResult({
      loadLocal: vi.fn().mockResolvedValue({
        generatedAt: '2026-08-01', source: 'baostock+heuristic', totalCount: 1,
        stocks: [{ code: '000001', name: '平安银行', industry: '银行' }],
      }),
      loadProvider: vi.fn().mockResolvedValue({
        data: [],
        meta: { source: 'Eastmoney A-share directory', mode: 'realtime', status: 'error', error: 'network blocked' },
      }),
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ classificationStatus: 'inferred' });
    expect(result.meta).toMatchObject({ status: 'partial' });
    expect(result.meta.error).toContain('network blocked');
  });
});