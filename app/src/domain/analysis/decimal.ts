import Decimal from 'decimal.js';

export const AnalysisDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
});

export type DecimalString = string;
export type FractionString = DecimalString;
export type UnitIntervalString = FractionString;
export type ProbabilityString = UnitIntervalString;
export type OwnershipString = UnitIntervalString;
export type TaxRateString = UnitIntervalString;
export type MitigationString = UnitIntervalString;
export type NonNegativeRateString = FractionString;
export type SignedRateString = FractionString;
export type ReturnRateString = FractionString;
export type MultipleString = DecimalString;

export type DecimalBoundaryErrorCode =
  | 'invalid_decimal'
  | 'invalid_unit_interval'
  | 'invalid_non_negative_rate'
  | 'invalid_return_rate'
  | 'invalid_multiple';

export class DecimalBoundaryError extends Error {
  readonly code: DecimalBoundaryErrorCode;
  readonly input: unknown;

  constructor(code: DecimalBoundaryErrorCode, input: unknown) {
    super(`${code}: ${String(input)}`);
    this.name = 'DecimalBoundaryError';
    this.code = code;
    this.input = input;
  }
}

const canonicalDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;

export function canonicalDecimal(value: Decimal): DecimalString {
  if (!value.isFinite()) {
    throw new DecimalBoundaryError('invalid_decimal', value);
  }

  return value.isZero() ? '0' : value.toFixed();
}

export function parseDecimalString(input: unknown): Decimal {
  if (typeof input !== 'string' || !canonicalDecimalPattern.test(input)) {
    throw new DecimalBoundaryError('invalid_decimal', input);
  }

  const value = new AnalysisDecimal(input);
  if (canonicalDecimal(value) !== input) {
    throw new DecimalBoundaryError('invalid_decimal', input);
  }

  return value;
}

export function parseUnitIntervalString(input: unknown): Decimal {
  const value = parseDecimalString(input);

  if (value.isNegative() || value.greaterThan(1)) {
    throw new DecimalBoundaryError('invalid_unit_interval', input);
  }

  return value;
}

export function parseNonNegativeRateString(input: unknown): Decimal {
  const value = parseDecimalString(input);

  if (value.isNegative()) {
    throw new DecimalBoundaryError('invalid_non_negative_rate', input);
  }

  return value;
}

export function parseSignedRateString(input: unknown): Decimal {
  return parseDecimalString(input);
}

export function parseReturnRateString(input: unknown): Decimal {
  const value = parseDecimalString(input);

  if (value.lessThanOrEqualTo(-1)) {
    throw new DecimalBoundaryError('invalid_return_rate', input);
  }

  return value;
}

export function parseMultipleString(input: unknown): Decimal {
  const value = parseDecimalString(input);

  if (value.isNegative()) {
    throw new DecimalBoundaryError('invalid_multiple', input);
  }

  return value;
}
