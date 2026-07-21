import { describe, expect, it } from 'vitest';
import { resolveEvidenceConflict } from './resolve-conflict';

const item = (id: string, value: string) => ({
  id,
  projectId: 'p1',
  fieldId: 'monthly_active_users',
  rawValue: value,
  normalizedValue: value,
  confidence: 0.8,
  conflictStatus: 'unresolved' as const,
  updatedAt: '2026-07-21T00:00:00.000Z',
});

describe('resolveEvidenceConflict', () => {
  it('uses the lower value for positive metrics', () => {
    const result = resolveEvidenceConflict(
      [item('bp', '5000000'), item('backend', '2000000')],
      'higher_is_better',
    );

    expect(result.analysisValue).toBe('2000000');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('uses the higher value for risk or cost metrics', () => {
    const result = resolveEvidenceConflict(
      [item('bp', '8'), item('crm', '15')],
      'lower_is_better',
    );

    expect(result.analysisValue).toBe('15');
  });

  it('blocks non-orderable conflicts', () => {
    const result = resolveEvidenceConflict(
      [item('a', 'licensed'), item('b', 'unlicensed')],
      'neutral',
    );

    expect(result.analysisValue).toBeNull();
    expect(result.blocksConclusion).toBe(true);
  });
});
