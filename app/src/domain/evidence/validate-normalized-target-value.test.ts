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
  it.each(['0', '-12.50', '1e6'])(
    'accepts finite Decimal-compatible number %s',
    (value) => {
      expect(validateNormalizedTargetValue(target('revenue'), value)).toEqual({
        status: 'valid',
        canonicalValue: value,
      });
    },
  );

  it.each(['NaN', 'Infinity', '-Infinity', '1,000', 'not-a-number'])(
    'rejects non-finite or non-Decimal number %s',
    (value) => {
      expect(validateNormalizedTargetValue(target('revenue'), value)).toEqual({
        status: 'invalid',
        reason: 'invalid-number',
      });
    },
  );

  it.each(['2024-02-29', '2025-12-31'])(
    'accepts real canonical ISO date %s',
    (value) => {
      expect(validateNormalizedTargetValue(target('period_end'), value)).toEqual({
        status: 'valid',
        canonicalValue: value,
      });
    },
  );

  it.each([
    '2025',
    '2025-Q1',
    '2025-2-01',
    '2025-02-29',
    '2025-13-01',
    '2025-04-31',
    'not-a-date',
  ])('rejects non-canonical or impossible period %s', (value) => {
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
