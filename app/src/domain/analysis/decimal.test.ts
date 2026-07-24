import { describe, expect, it } from 'vitest';
import {
  AnalysisDecimal,
  canonicalDecimal,
  DecimalBoundaryError,
  parseDecimalString,
  parseMultipleString,
  parseNonNegativeRateString,
  parseReturnRateString,
  parseSignedRateString,
  parseUnitIntervalString,
} from './decimal';
import type {
  DecimalString,
  FractionString,
  MitigationString,
  MultipleString,
  NonNegativeRateString,
  OwnershipString,
  ProbabilityString,
  ReturnRateString,
  SignedRateString,
  TaxRateString,
  UnitIntervalString,
} from './decimal';

function expectBoundaryError(
  parse: () => unknown,
  code:
    | 'invalid_decimal'
    | 'invalid_unit_interval'
    | 'invalid_non_negative_rate'
    | 'invalid_return_rate'
    | 'invalid_multiple',
  input: unknown,
): void {
  try {
    parse();
    throw new Error('Expected DecimalBoundaryError');
  } catch (error) {
    expect(error).toBeInstanceOf(DecimalBoundaryError);
    expect(error).toMatchObject({ code, input });
  }
}

describe('AnalysisDecimal', () => {
  it.each([
    ['0', '0'],
    ['-12.500', '-12.5'],
    [
      '0.0000000000000000000000000000000000000001',
      '0.0000000000000000000000000000000000000001',
    ],
    [
      '1234567890123456789012345678901234567890',
      '1234567890123456789012345678901234567890',
    ],
  ] as const)(
    'canonicalizes %s without exponential notation',
    (input, expected) => {
      expect(canonicalDecimal(new AnalysisDecimal(input))).toBe(expected);
    },
  );

  it('rejects non-finite decimals while retaining the input', () => {
    const input = new AnalysisDecimal(Infinity);

    expectBoundaryError(
      () => canonicalDecimal(input),
      'invalid_decimal',
      input,
    );
  });

  it('uses 40 significant digits with round-half-even', () => {
    const value = new AnalysisDecimal(
      '1.2345678901234567890123456789012345678955',
    ).plus(0);

    expect(AnalysisDecimal.precision).toBe(40);
    expect(AnalysisDecimal.rounding).toBe(AnalysisDecimal.ROUND_HALF_EVEN);
    expect(canonicalDecimal(value)).toBe(
      '1.234567890123456789012345678901234567896',
    );
  });
});

describe('parseDecimalString', () => {
  it.each([
    '',
    ' ',
    '01',
    '+1',
    '1.',
    '.5',
    '1e3',
    '0x10',
    '1,000',
    'NaN',
    'Infinity',
    '-0',
  ])('rejects non-canonical decimal %j', (input) => {
    expectBoundaryError(
      () => parseDecimalString(input),
      'invalid_decimal',
      input,
    );
  });
});

describe('decimal domains', () => {
  it('exposes numeric-domain values as plain string aliases', () => {
    const values: readonly [
      DecimalString,
      FractionString,
      UnitIntervalString,
      ProbabilityString,
      OwnershipString,
      TaxRateString,
      MitigationString,
      NonNegativeRateString,
      SignedRateString,
      ReturnRateString,
      MultipleString,
    ] = ['0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'];

    expect(values).toHaveLength(11);
  });

  it.each([
    [parseDecimalString, '-12.5'],
    [parseUnitIntervalString, '0'],
    [parseUnitIntervalString, '1'],
    [parseNonNegativeRateString, '2.5'],
    [parseSignedRateString, '-0.25'],
    [parseReturnRateString, '-0.5'],
    [parseReturnRateString, '3'],
    [parseMultipleString, '12.5'],
  ] as const)('accepts %s in its domain', (parse, input) => {
    expect(canonicalDecimal(parse(input))).toBe(input);
  });

  it.each([
    [parseUnitIntervalString, '-0.0001', 'invalid_unit_interval'],
    [parseUnitIntervalString, '1.0001', 'invalid_unit_interval'],
    [parseNonNegativeRateString, '-0.01', 'invalid_non_negative_rate'],
    [parseReturnRateString, '-1', 'invalid_return_rate'],
    [parseReturnRateString, '-1.5', 'invalid_return_rate'],
    [parseMultipleString, '-0.01', 'invalid_multiple'],
  ] as const)('rejects %s outside its domain', (parse, input, code) => {
    expectBoundaryError(() => parse(input), code, input);
  });
});
