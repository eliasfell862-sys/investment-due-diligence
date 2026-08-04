export type StockMarketSessionStatus =
  | 'trading'
  | 'lunch_break'
  | 'closed'
  | 'weekend';

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

interface ShanghaiDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const shanghaiDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHANGHAI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function getShanghaiDateParts(date: Date): ShanghaiDateParts {
  const parts = Object.fromEntries(
    shanghaiDateTimeFormatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function getShanghaiWeekday(parts: Pick<ShanghaiDateParts, 'year' | 'month' | 'day'>): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function getSecondsSinceMidnight(parts: ShanghaiDateParts): number {
  return parts.hour * 60 * 60 + parts.minute * 60 + parts.second;
}

function shanghaiLocalTimeToTimestamp(
  parts: Pick<ShanghaiDateParts, 'year' | 'month' | 'day'>,
  hour: number,
  minute: number,
): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute)
    - SHANGHAI_UTC_OFFSET_MS;
}

function addShanghaiCalendarDays(
  parts: Pick<ShanghaiDateParts, 'year' | 'month' | 'day'>,
  days: number,
): Pick<ShanghaiDateParts, 'year' | 'month' | 'day'> {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function isWeekend(parts: Pick<ShanghaiDateParts, 'year' | 'month' | 'day'>): boolean {
  const weekday = getShanghaiWeekday(parts);
  return weekday === 0 || weekday === 6;
}

export function getStockMarketSessionStatus(now: Date): StockMarketSessionStatus {
  const parts = getShanghaiDateParts(now);
  if (isWeekend(parts)) return 'weekend';

  const seconds = getSecondsSinceMidnight(parts);
  const morningOpen = 9 * 60 * 60 + 25 * 60;
  const lunchStart = 11 * 60 * 60 + 35 * 60;
  const afternoonOpen = 12 * 60 * 60 + 55 * 60;
  const marketClose = 15 * 60 * 60 + 5 * 60;

  if (seconds >= morningOpen && seconds < lunchStart) return 'trading';
  if (seconds >= lunchStart && seconds < afternoonOpen) return 'lunch_break';
  if (seconds >= afternoonOpen && seconds < marketClose) return 'trading';
  return 'closed';
}

export function millisecondsUntilNextTradingWindow(now: Date): number {
  const parts = getShanghaiDateParts(now);
  const status = getStockMarketSessionStatus(now);

  if (status === 'trading') return 0;

  const seconds = getSecondsSinceMidnight(parts);
  const morningOpen = 9 * 60 * 60 + 25 * 60;
  if (!isWeekend(parts) && seconds < morningOpen) {
    return shanghaiLocalTimeToTimestamp(parts, 9, 25) - now.getTime();
  }

  if (status === 'lunch_break') {
    return shanghaiLocalTimeToTimestamp(parts, 12, 55) - now.getTime();
  }

  let nextDay = addShanghaiCalendarDays(parts, 1);
  while (isWeekend(nextDay)) {
    nextDay = addShanghaiCalendarDays(nextDay, 1);
  }

  return shanghaiLocalTimeToTimestamp(nextDay, 9, 25) - now.getTime();
}
