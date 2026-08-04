import { describe, expect, it } from 'vitest';
import { getStockMarketSessionStatus, millisecondsUntilNextTradingWindow } from './stock-market-session';

describe('stock market session', () => {
  it.each([
    ['2026-08-03T09:24:59+08:00', 'closed'],
    ['2026-08-03T09:25:00+08:00', 'trading'],
    ['2026-08-03T11:34:59+08:00', 'trading'],
    ['2026-08-03T11:35:00+08:00', 'lunch_break'],
    ['2026-08-03T12:54:59+08:00', 'lunch_break'],
    ['2026-08-03T12:55:00+08:00', 'trading'],
    ['2026-08-03T15:04:59+08:00', 'trading'],
    ['2026-08-03T15:05:00+08:00', 'closed'],
    ['2026-08-08T10:00:00+08:00', 'weekend'],
  ] as const)('maps %s to %s', (iso, expected) => {
    expect(getStockMarketSessionStatus(new Date(iso))).toBe(expected);
  });

  it('wakes at the afternoon session during lunch', () => {
    expect(millisecondsUntilNextTradingWindow(new Date('2026-08-03T11:35:00+08:00')))
      .toBe(80 * 60 * 1000);
  });

  it('wakes at the morning session before opening', () => {
    expect(millisecondsUntilNextTradingWindow(new Date('2026-08-03T09:00:00+08:00')))
      .toBe(25 * 60 * 1000);
  });

  it('skips the weekend when calculating the next opening', () => {
    const now = new Date('2026-08-07T15:05:00+08:00');
    const monday = new Date('2026-08-10T09:25:00+08:00');
    expect(millisecondsUntilNextTradingWindow(now)).toBe(monday.getTime() - now.getTime());
  });
});
