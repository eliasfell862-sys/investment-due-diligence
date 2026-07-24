import type { DecimalString } from './decimal';

export type CurrencyCode = string;

export type CountKind = 'customer' | 'user' | 'unit' | 'share' | 'order';

export type AnalysisUnit =
  | { readonly kind: 'currency'; readonly currency: CurrencyCode }
  | {
      readonly kind: 'ratio';
      readonly rateKind:
        | 'unit-interval'
        | 'non-negative-rate'
        | 'signed-rate'
        | 'return-rate';
    }
  | { readonly kind: 'multiple' }
  | { readonly kind: 'duration'; readonly durationUnit: 'months' | 'days' | 'years' }
  | { readonly kind: 'count'; readonly countKind: CountKind }
  | {
      readonly kind: 'currency-per-count';
      readonly currency: CurrencyCode;
      readonly countKind: CountKind;
      readonly perPeriod?: 'month' | 'year';
    };

export interface MoneyValue {
  readonly amount: DecimalString;
  readonly currency: CurrencyCode;
}

export interface MetricValue {
  readonly value: DecimalString;
  readonly unit: AnalysisUnit;
}

export type DomainContractErrorCode =
  | 'invalid_dto'
  | 'unknown_formula'
  | 'invalid_formula_definition';

export class DomainContractError extends Error {
  readonly code: DomainContractErrorCode;

  constructor(code: DomainContractErrorCode, message?: string) {
    super(typeof message === 'string' ? message : code);
    this.name = 'DomainContractError';
    this.code = code;
  }
}

const currencyCodePattern = /^[A-Z]{3}$/;
const countKinds: readonly CountKind[] = ['customer', 'user', 'unit', 'share', 'order'];
const rateKinds = [
  'unit-interval',
  'non-negative-rate',
  'signed-rate',
  'return-rate',
] as const;
const durationUnits = ['months', 'days', 'years'] as const;
const perPeriods = ['month', 'year'] as const;

function invalidDto(): never {
  throw new DomainContractError('invalid_dto');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseString(value: unknown): string {
  return typeof value === 'string' ? value : invalidDto();
}

function parseCurrencyCode(value: unknown): CurrencyCode {
  const currency = parseString(value);
  return currencyCodePattern.test(currency) ? currency : invalidDto();
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.some((candidate) => candidate === value);
}

function parseCountKind(value: unknown): CountKind {
  const countKind = parseString(value);
  return isOneOf(countKind, countKinds) ? countKind : invalidDto();
}

function parseAnalysisUnit(value: unknown): AnalysisUnit {
  if (!isRecord(value)) {
    return invalidDto();
  }

  const kind = parseString(value.kind);
  switch (kind) {
    case 'currency':
      return { kind, currency: parseCurrencyCode(value.currency) };
    case 'ratio': {
      const rateKind = parseString(value.rateKind);
      return isOneOf(rateKind, rateKinds) ? { kind, rateKind } : invalidDto();
    }
    case 'multiple':
      return { kind };
    case 'duration': {
      const durationUnit = parseString(value.durationUnit);
      return isOneOf(durationUnit, durationUnits) ? { kind, durationUnit } : invalidDto();
    }
    case 'count':
      return { kind, countKind: parseCountKind(value.countKind) };
    case 'currency-per-count': {
      const currency = parseCurrencyCode(value.currency);
      const countKind = parseCountKind(value.countKind);
      if (value.perPeriod === undefined) {
        return { kind, currency, countKind };
      }

      const perPeriod = parseString(value.perPeriod);
      return isOneOf(perPeriod, perPeriods)
        ? { kind, currency, countKind, perPeriod }
        : invalidDto();
    }
    default:
      return invalidDto();
  }
}

export function parseMoneyValueStructure(input: unknown): MoneyValue {
  try {
    if (!isRecord(input)) {
      return invalidDto();
    }

    return {
      amount: parseString(input.amount),
      currency: parseCurrencyCode(input.currency),
    };
  } catch (error: unknown) {
    if (error instanceof DomainContractError) {
      throw error;
    }
    return invalidDto();
  }
}

export function parseMetricValueStructure(input: unknown): MetricValue {
  try {
    if (!isRecord(input)) {
      return invalidDto();
    }

    return {
      value: parseString(input.value),
      unit: parseAnalysisUnit(input.unit),
    };
  } catch (error: unknown) {
    if (error instanceof DomainContractError) {
      throw error;
    }
    return invalidDto();
  }
}
