import { DomainContractError } from './value';

export { DomainContractError } from './value';

export interface FlowPeriod {
  readonly kind: 'flow';
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly durationMonths: number;
  readonly granularity: 'month' | 'year';
}

export interface AsOfPeriod {
  readonly kind: 'as-of';
  readonly id: string;
  readonly date: string;
}

export type AnalysisPeriod = FlowPeriod | AsOfPeriod;

export type PeriodValueValidation =
  | { readonly status: 'valid'; readonly period: AnalysisPeriod }
  | { readonly status: 'invalid' };

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function invalidDto(): never {
  throw new DomainContractError('invalid_dto');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseString(value: unknown): string {
  return typeof value === 'string' ? value : invalidDto();
}

export function parseAnalysisPeriodStructure(input: unknown): AnalysisPeriod {
  try {
    if (!isRecord(input)) {
      return invalidDto();
    }

    const kind = parseString(input.kind);
    const id = parseString(input.id);

    if (kind === 'as-of') {
      return { kind, id, date: parseString(input.date) };
    }

    if (kind === 'flow') {
      if (typeof input.durationMonths !== 'number') {
        return invalidDto();
      }

      const granularity = parseString(input.granularity);
      if (granularity !== 'month' && granularity !== 'year') {
        return invalidDto();
      }

      return {
        kind,
        id,
        startDate: parseString(input.startDate),
        endDate: parseString(input.endDate),
        durationMonths: input.durationMonths,
        granularity,
      };
    }

    return invalidDto();
  } catch (error: unknown) {
    if (error instanceof DomainContractError) {
      throw error;
    }
    return invalidDto();
  }
}

function parseIsoDate(value: string): Date | undefined {
  const match = isoDatePattern.exec(value);
  if (match === null) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return date;
}

function isMonthEnd(date: Date): boolean {
  const followingDay = new Date(date.getTime());
  followingDay.setUTCDate(followingDay.getUTCDate() + 1);
  return followingDay.getUTCDate() === 1;
}

function inclusiveMonthDifference(startDate: Date, endDate: Date): number {
  return (
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    endDate.getUTCMonth() -
    startDate.getUTCMonth() +
    1
  );
}

export function validateAnalysisPeriodValue(period: AnalysisPeriod): PeriodValueValidation {
  if (period.id.length === 0) {
    return { status: 'invalid' };
  }

  if (period.kind === 'as-of') {
    return parseIsoDate(period.date) === undefined
      ? { status: 'invalid' }
      : { status: 'valid', period };
  }

  const startDate = parseIsoDate(period.startDate);
  const endDate = parseIsoDate(period.endDate);
  if (startDate === undefined || endDate === undefined) {
    return { status: 'invalid' };
  }

  if (
    startDate.getTime() > endDate.getTime() ||
    startDate.getUTCDate() !== 1 ||
    !isMonthEnd(endDate) ||
    !Number.isInteger(period.durationMonths) ||
    period.durationMonths <= 0 ||
    period.durationMonths !== inclusiveMonthDifference(startDate, endDate)
  ) {
    return { status: 'invalid' };
  }

  if (period.granularity === 'month' && period.durationMonths !== 1) {
    return { status: 'invalid' };
  }

  if (period.granularity === 'year' && period.durationMonths !== 12) {
    return { status: 'invalid' };
  }

  return { status: 'valid', period };
}
