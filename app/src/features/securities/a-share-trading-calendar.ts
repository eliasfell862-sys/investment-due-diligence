export const A_SHARE_CALENDAR_COVERAGE = { firstYear: 2025, lastYear: 2026 } as const;

const SUPPORTED_YEARS = new Set([2025, 2026]);
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const MARKET_CLOSURES = new Set([
  '2025-01-01',
  '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31',
  '2025-02-03', '2025-02-04',
  '2025-04-04',
  '2025-05-01', '2025-05-02', '2025-05-05',
  '2025-06-02',
  '2025-10-01', '2025-10-02', '2025-10-03',
  '2025-10-06', '2025-10-07', '2025-10-08',
  '2026-01-01', '2026-01-02',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-23',
  '2026-04-06',
  '2026-05-01', '2026-05-04', '2026-05-05',
  '2026-06-19',
  '2026-09-25',
  '2026-10-01', '2026-10-02', '2026-10-05',
  '2026-10-06', '2026-10-07',
]);

const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export class UnsupportedTradingCalendarYearError extends Error {
  constructor(year: number) {
    super(`A股交易日历暂不支持${year}年`);
    this.name = 'UnsupportedTradingCalendarYearError';
  }
}

function parseDateKey(date: string): { year: number; month: number; day: number } {
  const match = DATE_KEY_PATTERN.exec(date);
  if (!match) throw new Error('交易日期必须使用YYYY-MM-DD格式');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error('交易日期无效');
  }
  return { year, month, day };
}

function assertSupportedYear(year: number): void {
  if (!SUPPORTED_YEARS.has(year)) throw new UnsupportedTradingCalendarYearError(year);
}

function addCalendarDays(date: string, days: number): string {
  const { year, month, day } = parseDateKey(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function shanghaiDateKey(value: Date | string): string {
  if (typeof value === 'string' && DATE_KEY_PATTERN.test(value)) {
    parseDateKey(value);
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('交易时间无效');
  return shanghaiDateFormatter.format(date);
}

export function isAStockTradingDay(date: string): boolean {
  const { year, month, day } = parseDateKey(date);
  assertSupportedYear(year);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !MARKET_CLOSURES.has(date);
}

export function nextAStockTradingDay(date: string): string {
  parseDateKey(date);
  let candidate = addCalendarDays(date, 1);
  while (!isAStockTradingDay(candidate)) candidate = addCalendarDays(candidate, 1);
  return candidate;
}
