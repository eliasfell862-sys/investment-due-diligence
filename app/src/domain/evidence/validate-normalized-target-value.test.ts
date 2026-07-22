import { describe, expect, it } from 'vitest';
import {
  findTargetFieldDefinition,
  type TargetFieldDefinition,
} from './target-fields';
import { validateNormalizedTargetValue } from './validate-normalized-target-value';

function target(fieldId: string): TargetFieldDefinition {
  const definition = findTargetFieldDefinition(fieldId);
  if (!definition) {
    throw new Error(`Missing test target field: ${fieldId}`);
  }
  return definition;
}

describe('validateNormalizedTargetValue', () => {
  it.each([
    ['0', '0'],
    ['-12.50', '-12.5'],
    ['.5', '0.5'],
    ['1e6', '1000000'],
    ['1.20E-3', '0.0012'],
    ['1,234.50', '1234.5'],
    ['+12,345,678.900', '12345678.9'],
  ] as const)(
    'accepts and canonicalizes strict en-US number %s',
    (value, canonicalValue) => {
      expect(validateNormalizedTargetValue(target('revenue'), value)).toEqual({
        status: 'valid',
        canonicalValue,
      });
    },
  );

  it.each([
    '0x10',
    '0b10',
    '0o10',
    '1_000',
    '1.',
    '12,34',
    '1234,567',
    '1,23,456',
    '1,234e2',
    'NaN',
    'Infinity',
    '-Infinity',
    'not-a-number',
  ])(
    'rejects number outside the strict en-US grammar %s',
    (value) => {
      expect(validateNormalizedTargetValue(target('revenue'), value)).toEqual({
        status: 'invalid',
        reason: 'invalid-number',
      });
    },
  );

  it.each([
    ['2024-02-29', '2024-02-29'],
    ['2025-12-31T00:00:00.000Z', '2025-12-31'],
    ['2025', '2025'],
    ['2025-Q1', '2025-Q1'],
    ['2025-Q4', '2025-Q4'],
    ['2025-01', '2025-01'],
    ['2025-12', '2025-12'],
    ['2025-H1', '2025-H1'],
    ['2025-H2', '2025-H2'],
  ] as const)(
    'accepts supported financial period %s',
    (value, canonicalValue) => {
      expect(validateNormalizedTargetValue(target('period_end'), value)).toEqual({
        status: 'valid',
        canonicalValue,
      });
    },
  );

  it.each([
    'FY2025',
    '2025 Q1',
    '2025-Q0',
    '2025-Q5',
    '2025-H0',
    '2025-H3',
    '2025-00',
    '2025-13',
    '2025-2-01',
    '2025-02-29',
    '2025-04-31',
    '2025-12-31Tnot-a-time',
    'not-a-date',
  ])('rejects unsupported or impossible financial period %s', (value) => {
    expect(validateNormalizedTargetValue(target('period_end'), value)).toEqual({
      status: 'invalid',
      reason: 'invalid-date',
    });
  });

  it.each(['company_name', 'business_description', 'revenue', 'period_end'])(
    'treats a blank %s value as absent',
    (fieldId) => {
      expect(validateNormalizedTargetValue(target(fieldId), ' \n ')).toEqual({
        status: 'empty',
      });
    },
  );

  it.each(['company_name', 'business_description'])(
    'normalizes and trims canonical text for %s',
    (fieldId) => {
      expect(validateNormalizedTargetValue(target(fieldId), ' Cafe\u0301 ')).toEqual({
        status: 'valid',
        canonicalValue: 'Café',
      });
    },
  );
});
