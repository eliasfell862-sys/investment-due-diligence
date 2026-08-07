import { describe, expect, it } from 'vitest';
import { parseTencentKLineResponse } from './stock-api';

describe('Tencent K-line response parsing', () => {
  it('uses qfqday when the day array exists but is empty', () => {
    const payload = JSON.stringify({
      data: {
        sh688981: {
          day: [],
          qfqday: [
            ['2026-08-01', '50.00', '51.00', '52.00', '49.50', '100000'],
          ],
        },
      },
    });

    expect(parseTencentKLineResponse(payload, 'sh688981')).toEqual([
      {
        date: '2026-08-01',
        open: 50,
        close: 51,
        high: 52,
        low: 49.5,
        volume: 100000,
        amount: 0,
      },
    ]);
  });

  it('parses the seventh column as turnover amount when present', () => {
    const payload = JSON.stringify({
      data: {
        sh600519: {
          day: [],
          qfqday: [
            ['2026-08-01', '50.00', '51.00', '52.00', '49.50', '100000', '51000000'],
          ],
        },
      },
    });

    expect(parseTencentKLineResponse(payload, 'sh600519')).toEqual([
      {
        date: '2026-08-01',
        open: 50,
        close: 51,
        high: 52,
        low: 49.5,
        volume: 100000,
        amount: 51000000,
      },
    ]);
  });
});
