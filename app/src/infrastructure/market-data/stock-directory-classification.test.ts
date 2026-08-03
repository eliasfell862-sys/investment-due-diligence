import { describe, expect, it } from 'vitest';
import { normalizeStockDirectoryData } from './stock-api';

describe('stock directory classification quality', () => {
  it('does not expose heuristic industries as authoritative classifications', () => {
    const stocks = normalizeStockDirectoryData({
      generatedAt: '2026-08-01',
      source: 'baostock+heuristic',
      totalCount: 2,
      stocks: [
        { code: '000428', name: 'hotel', industry: 'liquor' },
        { code: '000547', name: 'aerospace', industry: 'property' },
      ],
    });

    expect(stocks.map((stock) => stock.industry)).toEqual(['\u672a\u5206\u7c7b', '\u672a\u5206\u7c7b']);
  });

  it('preserves classifications supplied by a non-heuristic source', () => {
    const stocks = normalizeStockDirectoryData({
      generatedAt: '2026-08-03',
      source: 'eastmoney',
      totalCount: 1,
      stocks: [
        { code: '000428', name: 'hotel', industry: '\u793e\u4f1a\u670d\u52a1' },
      ],
    });

    expect(stocks[0]?.industry).toBe('\u793e\u4f1a\u670d\u52a1');
  });
});
