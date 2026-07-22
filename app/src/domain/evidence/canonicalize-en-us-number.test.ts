import { describe, expect, it } from 'vitest';
import { canonicalizeEnUsNumber } from './canonicalize-en-us-number';

describe('canonicalizeEnUsNumber', () => {
  it.each([
    ['0', '0'],
    ['-12.50', '-12.5'],
    ['.5', '0.5'],
    ['+1e3', '1000'],
    ['1.20E-3', '0.0012'],
    ['1,234.50', '1234.5'],
    ['+12,345,678.900', '12345678.9'],
    [1200.5, '1200.5'],
  ] as const)('canonicalizes strict en-US number %j', (value, canonicalValue) => {
    expect(canonicalizeEnUsNumber(value)).toEqual({
      status: 'valid',
      canonicalValue,
    });
  });

  it.each([
    '0x10',
    '0b10',
    '0o10',
    '1_000',
    '1.',
    '12,34',
    '1234,567',
    '1,23,456',
    '1,234,56',
    '1,234e2',
    'NaN',
    'Infinity',
    '-Infinity',
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects non-grammar number %j', (value) => {
    expect(canonicalizeEnUsNumber(value)).toEqual({ status: 'invalid' });
  });
});
