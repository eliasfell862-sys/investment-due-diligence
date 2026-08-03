import { describe, expect, it } from 'vitest';
import { normalizeStockDirectoryData } from './stock-api';

describe('stock directory classification quality', () => {
  it('does not expose heuristic industries as authoritative classifications', () => {
    const stocks = normalizeStockDirectoryData({
      generatedAt: '2026-08-01',
      source: 'baostock+heuristic',
      totalCount: 2,
      stocks: [
        { code: '000428', name: '????', industry: '??' },
        { code: '000547', name: '????', industry: '???' },
      ],
    });

    expect(stocks.map((stock) => stock.industry)).toEqual(['???', '???']);
  });

  it('preserves classifications supplied by a non-heuristic source', () => {
    const stocks = normalizeStockDirectoryData({
      generatedAt: '2026-08-03',
      source: 'eastmoney',
      totalCount: 1,
      stocks: [
        { code: '000428', name: '????', industry: '????' },
      ],
    });

    expect(stocks[0]?.industry).toBe('????');
  });
});
