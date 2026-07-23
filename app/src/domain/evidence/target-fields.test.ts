import { describe, expect, it } from 'vitest';
import {
  findTargetFieldDefinition,
  targetFieldDefinitions,
} from './target-fields';

describe('manual quick-look target fields', () => {
  it.each([
    ['team_summary', '团队概览'],
    ['product_summary', '产品概览'],
    ['market_summary', '市场概览'],
  ] as const)('registers %s with its exact definition', (id, label) => {
    expect(findTargetFieldDefinition(id)).toEqual({
      id,
      label,
      importable: false,
      identityKind: 'measure',
      valueKind: 'text',
      unit: 'text',
      locale: 'en-US',
      direction: 'neutral',
    });
  });

  it('adds only the three manual quick-look fields to the registry', () => {
    expect(targetFieldDefinitions.map(({ id }) => id)).toEqual([
      'company_name',
      'business_description',
      'period_end',
      'revenue',
      'gross_margin',
      'net_profit',
      'operating_cash_flow',
      'arr',
      'nrr',
      'team_summary',
      'product_summary',
      'market_summary',
    ]);
  });
});

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
