import { describe, expect, it } from 'vitest';
import {
  AnalysisDecimal,
  canonicalDecimal,
  DecimalBoundaryError,
  parseDecimalString,
  parseMultiple,
  parseNonNegativeRate,
  parseReturnRate,
  parseSignedRate,
  parseUnitInterval,
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
  it.each([
    [parseUnitInterval, '0'],
    [parseUnitInterval, '1'],
    [parseNonNegativeRate, '2.5'],
    [parseSignedRate, '-0.25'],
    [parseReturnRate, '-0.5'],
    [parseReturnRate, '3'],
    [parseMultiple, '12.5'],
  ] as const)('accepts %s in its domain', (parse, input) => {
    expect(parse(input)).toBe(input);
  });

  it.each([
    [parseUnitInterval, '-0.0001', 'invalid_unit_interval'],
    [parseUnitInterval, '1.0001', 'invalid_unit_interval'],
    [parseNonNegativeRate, '-0.01', 'invalid_non_negative_rate'],
    [parseReturnRate, '-1', 'invalid_return_rate'],
    [parseReturnRate, '-1.5', 'invalid_return_rate'],
    [parseMultiple, '-0.01', 'invalid_multiple'],
  ] as const)('rejects %s outside its domain', (parse, input, code) => {
    expectBoundaryError(() => parse(input), code, input);
  });
});
