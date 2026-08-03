import { describe, expect, it, vi } from 'vitest';
import { fetchFundValuationsResult } from './fund-api';

describe('fetchFundValuationsResult', () => {
  it('reports missing requested funds as partial data', async () => {
    const result = await fetchFundValuationsResult(['000001', '000002'], {
      requestText: vi.fn().mockResolvedValue('v_jj000001="000001~Test~0~0~~1.23~1.50~0.5~2026-08-03~";'),
    });
    expect(result.data).toHaveLength(1);
    expect(result.meta.status).toBe('partial');
  });

  it('reports transport failure instead of an empty successful list', async () => {
    const result = await fetchFundValuationsResult(['000001'], {
      requestText: vi.fn().mockRejectedValue(new Error('fund timeout')),
    });
    expect(result.data).toEqual([]);
    expect(result.meta).toMatchObject({ status: 'error', error: 'fund timeout' });
  });
});