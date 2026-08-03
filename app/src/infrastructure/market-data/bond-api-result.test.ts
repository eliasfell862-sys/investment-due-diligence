import { describe, expect, it, vi } from 'vitest';
import { fetchConvertibleBondsResult } from './bond-api';

describe('fetchConvertibleBondsResult', () => {
  it('reports failed quote batches instead of silently returning an empty list', async () => {
    const result = await fetchConvertibleBondsResult({
      requestText: vi.fn().mockRejectedValue(new Error('bond service unavailable')),
    });
    expect(result.data).toEqual([]);
    expect(result.meta.status).toBe('error');
    expect(result.meta.error).toContain('bond service unavailable');
  });
});