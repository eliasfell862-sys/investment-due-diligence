import { describe, expect, it } from 'vitest';
import { getOfficialIndustries, normalizeStockDirectoryData, type AStockDirectoryItem } from './stock-api';

describe('stock directory classification quality', () => {
  it('retains heuristic industries but labels them as inferred rather than authoritative', () => {
    const stocks = normalizeStockDirectoryData({
      generatedAt: '2026-08-01',
      source: 'baostock+heuristic',
      totalCount: 2,
      stocks: [
        { code: '000428', name: 'hotel', industry: 'liquor' },
        { code: '000547', name: 'aerospace', industry: 'property' },
      ],
    });

    expect(stocks).toEqual([
      expect.objectContaining({ industry: 'liquor', classificationStatus: 'inferred' }),
      expect.objectContaining({ industry: 'property', classificationStatus: 'inferred' }),
    ]);
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

    expect(stocks[0]).toEqual(expect.objectContaining({ industry: '\u793e\u4f1a\u670d\u52a1', classificationStatus: 'official' }));
  });

  it('treats provider placeholder labels as unclassified', () => {
    const [stock] = normalizeStockDirectoryData({
      generatedAt: '2026-08-03', source: 'eastmoney', totalCount: 1,
      stocks: [{ code: '000001', name: 'test', industry: '-' }],
    });

    expect(stock).toMatchObject({ industry: '未分类', classificationStatus: 'unclassified' });
  });

  it('includes inferred labels in the industry filter so the dropdown is not empty', () => {
    const stocks: AStockDirectoryItem[] = Array.from({ length: 31 }, (_, index) => ({
      code: String(index).padStart(6, '0'), name: `stock-${index}`,
      industry: `industry-${index}`, classificationStatus: 'official' as const,
    }));
    stocks.push({ code: '999999', name: 'guess', industry: 'guessed', classificationStatus: 'inferred' as const });

    expect(getOfficialIndustries(stocks)).toHaveLength(32);
    expect(getOfficialIndustries(stocks)).toContain('guessed');
  });
});
