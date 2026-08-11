import { describe, expect, it, vi } from 'vitest';
import { fetchEastmoneyKLine } from './stock-api';

describe('fetchEastmoneyKLine same-origin proxy', () => {
  it('uses the same-origin market proxy before cross-origin providers', async () => {
    const requestText = vi.fn().mockResolvedValue(JSON.stringify({ result: { status: { code: 0 }, data: [
      { day: '2026-08-01', open: '10', close: '11', high: '12', low: '9', volume: '1000' },
    ] } }));

    const result = await fetchEastmoneyKLine('000001', 250, { requestText });

    expect(requestText).toHaveBeenCalledWith('/api/securities/history?symbol=sz000001&scale=240&ma=no&datalen=250', 12000);
    expect(result).toHaveLength(1);
  });
});
