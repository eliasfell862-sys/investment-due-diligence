import Decimal from 'decimal.js';

export const AnalysisDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
});

declare const decimalStringBrand: unique symbol;
declare const unitIntervalStringBrand: unique symbol;
declare const nonNegativeRateStringBrand: unique symbol;
declare const returnRateStringBrand: unique symbol;
declare const multipleStringBrand: unique symbol;

export type DecimalString = string & {
  readonly [decimalStringBrand]: 'DecimalString';
};
export type FractionString = UnitIntervalString;
export type UnitIntervalString = DecimalString & {
  readonly [unitIntervalStringBrand]: 'UnitIntervalString';
};
export type ProbabilityString = UnitIntervalString;
export type OwnershipString = UnitIntervalString;
export type TaxRateString = UnitIntervalString;
export type MitigationString = UnitIntervalString;
export type NonNegativeRateString = DecimalString & {
  readonly [nonNegativeRateStringBrand]: 'NonNegativeRateString';
};
export type SignedRateString = DecimalString;
export type ReturnRateString = DecimalString & {
  readonly [returnRateStringBrand]: 'ReturnRateString';
};
export type MultipleString = DecimalString & {
  readonly [multipleStringBrand]: 'MultipleString';
};

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

export function canonicalDecimal(value: Decimal): string {
  if (!value.isFinite()) {
    throw new DecimalBoundaryError('invalid_decimal', value);
  }

  return value.isZero() ? '0' : value.toFixed();
}

export function parseDecimalString(input: unknown): DecimalString {
  if (typeof input !== 'string' || !canonicalDecimalPattern.test(input)) {
    throw new DecimalBoundaryError('invalid_decimal', input);
  }

  const value = new AnalysisDecimal(input);
  if (canonicalDecimal(value) !== input) {
    throw new DecimalBoundaryError('invalid_decimal', input);
  }

  return input as DecimalString;
}

export function parseUnitInterval(input: unknown): UnitIntervalString {
  const decimal = parseDecimalString(input);
  const value = new AnalysisDecimal(decimal);

  if (value.isNegative() || value.greaterThan(1)) {
    throw new DecimalBoundaryError('invalid_unit_interval', input);
  }

  return decimal as UnitIntervalString;
}

export function parseNonNegativeRate(input: unknown): NonNegativeRateString {
  const decimal = parseDecimalString(input);

  if (new AnalysisDecimal(decimal).isNegative()) {
    throw new DecimalBoundaryError('invalid_non_negative_rate', input);
  }

  return decimal as NonNegativeRateString;
}

export function parseSignedRate(input: unknown): SignedRateString {
  return parseDecimalString(input);
}

export function parseReturnRate(input: unknown): ReturnRateString {
  const decimal = parseDecimalString(input);

  if (new AnalysisDecimal(decimal).lessThanOrEqualTo(-1)) {
    throw new DecimalBoundaryError('invalid_return_rate', input);
  }

  return decimal as ReturnRateString;
}

export function parseMultiple(input: unknown): MultipleString {
  const decimal = parseDecimalString(input);

  if (new AnalysisDecimal(decimal).isNegative()) {
    throw new DecimalBoundaryError('invalid_multiple', input);
  }

  return decimal as MultipleString;
}
