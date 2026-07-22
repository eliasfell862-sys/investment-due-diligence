import { describe, expect, it } from 'vitest';
import { findTargetFieldDefinition } from './target-fields';

describe('target field directions', () => {
  it.each(['company_name', 'business_description', 'period_end'])(
    'marks %s as neutral',
    (fieldId) => {
      expect(findTargetFieldDefinition(fieldId)?.direction).toBe('neutral');
    },
  );

  it.each([
    'revenue',
    'gross_margin',
    'net_profit',
    'operating_cash_flow',
    'arr',
    'nrr',
  ])('marks %s as higher-is-better', (fieldId) => {
    expect(findTargetFieldDefinition(fieldId)?.direction).toBe('higher_is_better');
  });
});
