export type FinancialPeriodCanonicalization =
  | { readonly status: 'empty' }
  | { readonly status: 'valid'; readonly canonicalValue: string }
  | { readonly status: 'invalid' };

const canonicalDatePattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const canonicalDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const annualPattern = /^\d{4}$/;
const quarterPattern = /^\d{4}-Q[1-4]$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const halfYearPattern = /^\d{4}-H[12]$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isRealCanonicalDate(value: string): boolean {
  if (!canonicalDatePattern.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysInMonth[month - 1]!;
}

function canonicalizeDateTime(value: string): string | undefined {
  const match = canonicalDateTimePattern.exec(value);
  if (!match || !isRealCanonicalDate(value.slice(0, 10))) {
    return undefined;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  const zone = match[4]!;
  if (hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }
  if (zone !== 'Z') {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 14 || zoneMinute > 59 || (zoneHour === 14 && zoneMinute !== 0)) {
      return undefined;
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? undefined
    : parsed.toISOString().slice(0, 10);
}

export function canonicalizeFinancialPeriod(
  value: unknown,
): FinancialPeriodCanonicalization {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? { status: 'invalid' }
      : { status: 'valid', canonicalValue: value.toISOString().slice(0, 10) };
  }

  const textValue = String(value).trim().normalize('NFC');
  if (textValue.length === 0) {
    return { status: 'empty' };
  }
  if (isRealCanonicalDate(textValue)) {
    return { status: 'valid', canonicalValue: textValue };
  }

  const dateTime = canonicalizeDateTime(textValue);
  if (dateTime !== undefined) {
    return { status: 'valid', canonicalValue: dateTime };
  }

  if (
    annualPattern.test(textValue) ||
    quarterPattern.test(textValue) ||
    monthPattern.test(textValue) ||
    halfYearPattern.test(textValue)
  ) {
    return { status: 'valid', canonicalValue: textValue };
  }

  return { status: 'invalid' };
}
