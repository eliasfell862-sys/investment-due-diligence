import { describe, expect, it } from 'vitest';
import { analyzeNewsSentiment, labelOf } from './sentiment-engine';
import type { StockNewsItem } from '../../infrastructure/news/news-api';

function news(title: string, overrides: Partial<StockNewsItem> = {}): StockNewsItem {
  return {
    id: `t-${title}`,
    title,
    columnName: '',
    noticeDate: '2026-08-10',
    stockCode: '600519',
    stockName: '贵州茅台',
    ...overrides,
  };
}

describe('analyzeNewsSentiment', () => {
  it('rates 业绩预增 as bullish with matched evidence', () => {
    const result = analyzeNewsSentiment([news('贵州茅台:2026年半年度业绩预增公告')]);
    expect(result.items[0].label).toBe('bullish');
    expect(result.items[0].score).toBeGreaterThan(0);
    expect(result.items[0].matchedKeywords.some(k => k.keyword.includes('业绩预增'))).toBe(true);
  });

  it('rates 立案调查 as bearish with matched evidence', () => {
    const result = analyzeNewsSentiment([news('XX药业:关于收到中国证监会立案告知书的公告')]);
    expect(result.items[0].label).toBe('bearish');
    expect(result.items[0].score).toBeLessThan(0);
    expect(result.items[0].matchedKeywords.some(k => k.keyword.includes('立案'))).toBe(true);
  });

  it('rates 股东减持 as bearish', () => {
    const result = analyzeNewsSentiment([news('XX股份:关于股东减持股份计划的公告')]);
    expect(result.items[0].label).toBe('bearish');
    expect(result.items[0].score).toBeLessThan(0);
  });

  it('rates 权益分派 (分红) as bullish', () => {
    const result = analyzeNewsSentiment([news('XX:2025年年度权益分派实施公告')]);
    expect(result.items[0].label).toBe('bullish');
    expect(result.items[0].score).toBeGreaterThan(0);
  });

  it('rates a neutral announcement (重大事项) as neutral', () => {
    const result = analyzeNewsSentiment([news('XX:重大事项公告')]);
    expect(result.items[0].label).toBe('neutral');
    expect(result.items[0].score).toBeCloseTo(0, 5);
    expect(result.items[0].matchedKeywords).toHaveLength(0);
  });

  it('aggregates a mixed batch into a mean score and per-label counts', () => {
    const items = [
      news('XX:2026年半年度业绩预增公告'),
      news('XX:关于收到立案告知书的公告'),
      news('XX:重大事项公告'),
      news('XX:2025年年度权益分派实施公告'),
    ];
    const result = analyzeNewsSentiment(items);
    expect(result.bullishCount).toBe(2);
    expect(result.bearishCount).toBe(1);
    expect(result.neutralCount).toBe(1);
    const expected = (result.items[0].score + result.items[1].score + result.items[2].score + result.items[3].score) / 4;
    expect(result.overallScore).toBeCloseTo(expected, 5);
    expect(result.overallLabel).toBe(result.overallScore > 0.15 ? 'bullish' : result.overallScore < -0.15 ? 'bearish' : 'neutral');
  });

  it('returns neutral zeroed result for an empty batch', () => {
    const result = analyzeNewsSentiment([]);
    expect(result.items).toHaveLength(0);
    expect(result.overallScore).toBe(0);
    expect(result.overallLabel).toBe('neutral');
    expect(result.bullishCount).toBe(0);
    expect(result.bearishCount).toBe(0);
    expect(result.neutralCount).toBe(0);
  });

  it('keeps item scores clamped to [-1, 1]', () => {
    const result = analyzeNewsSentiment([
      news('XX:业绩预增净利润大幅增长回购股份并签订重大合同'), /* 强利好叠加 */
    ]);
    expect(result.items[0].score).toBeLessThanOrEqual(1);
    expect(result.items[0].score).toBeGreaterThan(0);
  });

  it('treats 解除质押 as releasing risk (not bearish via 质押)', () => {
    const result = analyzeNewsSentiment([news('XX:关于解除控股股东股份质押的公告')]);
    expect(result.items[0].label).not.toBe('bearish');
    expect(result.items[0].score).toBeGreaterThanOrEqual(0);
  });

  it('treats 终止减持 as neutral (减持 cancelled, not bearish)', () => {
    const result = analyzeNewsSentiment([news('XX:关于终止减持计划的公告')]);
    expect(result.items[0].label).not.toBe('bearish');
    expect(result.items[0].score).toBeGreaterThanOrEqual(0);
  });

  it('does not double-count overlapping keywords (longest match wins)', () => {
    // 控股股东减持 命中的同时不应再叠加 减持
    const result = analyzeNewsSentiment([news('XX:控股股东减持股份的公告')]);
    expect(result.items[0].label).toBe('bearish');
    expect(result.items[0].score).toBeGreaterThan(-0.7); // 单次权重，非叠加到 -1
  });

  it('handles reversed word order 减持计划终止 (still suppresses the bearish)', () => {
    for (const title of [
      'XX:关于控股股东减持计划终止的公告',
      'XX:关于终止实施减持计划的公告',
      'XX:股东减持股份计划提前终止的公告',
    ]) {
      const result = analyzeNewsSentiment([news(title)]);
      expect(result.items[0].label, title).not.toBe('bearish');
      expect(result.items[0].score, title).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not treat 解除劳动合同 / 解除合作协议 as bullish (no 质押 involved)', () => {
    for (const title of [
      'XX:关于解除劳动合同的公告',
      'XX:关于解除与XX合作协议的公告',
    ]) {
      const result = analyzeNewsSentiment([news(title)]);
      expect(result.items[0].label, title).not.toBe('bullish');
      expect(result.items[0].score, title).toBeLessThanOrEqual(0.15);
    }
  });

  it('does not swallow newly-added risk in 解除质押并补充质押', () => {
    const result = analyzeNewsSentiment([news('XX:关于控股股东部分股份解除质押及补充质押的公告')]);
    // 新增质押的利空不应被 解除质押 的加分吞掉
    expect(result.items[0].label).not.toBe('bullish');
  });

  it('supports 取消减持 the same as 终止减持', () => {
    const result = analyzeNewsSentiment([news('XX:关于取消减持计划的公告')]);
    expect(result.items[0].label).not.toBe('bearish');
    expect(result.items[0].score).toBeGreaterThanOrEqual(0);
  });

  it('handles an empty custom lexicon (score 0, no matches)', () => {
    const result = analyzeNewsSentiment([news('XX:业绩预增公告')], { bullish: [], bearish: [] });
    expect(result.items[0].score).toBe(0);
    expect(result.items[0].label).toBe('neutral');
    expect(result.items[0].matchedKeywords).toHaveLength(0);
  });

  it('sums multiple same-direction keywords and clamps', () => {
    const result = analyzeNewsSentiment([news('XX:业绩预增并回购股份公告')]);
    expect(result.items[0].score).toBeGreaterThan(0.9); // 业绩预增0.8 + 回购股份0.5 → clamp 1
    expect(result.items[0].label).toBe('bullish');
  });

  it('treats the 0.15 boundary as neutral, not bullish (float tolerance)', () => {
    expect(labelOf(0.15000000000000002)).toBe('neutral');
    expect(labelOf(0.15)).toBe('neutral');
    expect(labelOf(0.16)).toBe('bullish');
    expect(labelOf(-0.15)).toBe('neutral');
    expect(labelOf(-0.16)).toBe('bearish');
  });
});
