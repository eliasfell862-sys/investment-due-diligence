import { describe, expect, it } from 'vitest';
import {
  isAStockTradingDay,
  nextAStockTradingDay,
  shanghaiDateKey,
} from './a-share-trading-calendar';

describe('A-share trading calendar', () => {
  it.each([
    ['2026-08-05', true],
    ['2026-08-08', false],
    ['2026-10-01', false],
    ['2026-10-08', true],
  ])('classifies %s as trading=%s', (date, expected) => {
    expect(isAStockTradingDay(date)).toBe(expected);
  });

  it('moves Friday purchases to the next Monday', () => {
    expect(nextAStockTradingDay('2026-08-07')).toBe('2026-08-10');
  });

  it('moves a pre-National-Day purchase to the first post-holiday session', () => {
    expect(nextAStockTradingDay('2026-09-30')).toBe('2026-10-08');
  });

  it('uses the Shanghai date at the UTC day boundary', () => {
    expect(shanghaiDateKey('2026-08-04T16:30:00.000Z')).toBe('2026-08-05');
  });

  it('fails closed outside the supported calendar coverage', () => {
    expect(() => isAStockTradingDay('2031-01-02'))
      .toThrow('A股交易日历暂不支持2031年');
  });
});
