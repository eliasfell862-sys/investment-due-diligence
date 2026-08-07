import { describe, expect, it } from 'vitest';
import { sumF10TrailingDividendPerShare } from './stock-api';

describe('sumF10TrailingDividendPerShare', () => {
  const today = '2026-08-08';

  it('sums per-share dividends for implemented plans within the trailing 12 months', () => {
    const rows = [
      { ASSIGN_PROGRESS: '实施方案', EX_DIVIDEND_DATE: '2026-06-26 00:00:00', IMPL_PLAN_PROFILE: '10派280.2423元' },
      { ASSIGN_PROGRESS: '实施方案', EX_DIVIDEND_DATE: '2025-12-19 00:00:00', IMPL_PLAN_PROFILE: '10派239.57元' },
      // 超 12 个月，不计入
      { ASSIGN_PROGRESS: '实施方案', EX_DIVIDEND_DATE: '2025-06-26 00:00:00', IMPL_PLAN_PROFILE: '10派276.73元' },
      // 预案/预披露，不派发，不计入
      { ASSIGN_PROGRESS: '预披露', EX_DIVIDEND_DATE: null, IMPL_PLAN_PROFILE: '分红金额上限不超过2026年上半年净利润' },
      { ASSIGN_PROGRESS: '董事会预案', EX_DIVIDEND_DATE: null, IMPL_PLAN_PROFILE: '不分配不转增' },
    ];

    expect(sumF10TrailingDividendPerShare(rows, today)).toBeCloseTo(28.02423 + 23.957, 5);
  });

  it('ignores non-cash plans, missing dates, and future-dated rows', () => {
    const rows = [
      { ASSIGN_PROGRESS: '实施方案', EX_DIVIDEND_DATE: '2026-09-01 00:00:00', IMPL_PLAN_PROFILE: '10派10元' },  // 未来
      { ASSIGN_PROGRESS: '实施方案', EX_DIVIDEND_DATE: '2026-03-15 00:00:00', IMPL_PLAN_PROFILE: '不分配不转增' }, // 无派息
      { ASSIGN_PROGRESS: '实施方案', EX_DIVIDEND_DATE: null, IMPL_PLAN_PROFILE: '10派5元' }, // 无除息日
      { ASSIGN_PROGRESS: '实施分配', EX_DIVIDEND_DATE: '2026-01-10 00:00:00', IMPL_PLAN_PROFILE: '10派8元' }, // 进度名不匹配
    ];

    expect(sumF10TrailingDividendPerShare(rows, today)).toBe(0);
  });
});
