import { describe, expect, it } from 'vitest';
import {
  calculateReadiness,
  ReadinessValidationError,
  type EvidenceSummary,
} from './calculate-readiness';

function evidence(
  overrides: Partial<EvidenceSummary> = {},
): EvidenceSummary {
  return {
    projectId: 'project-1',
    fieldId: 'revenue',
    periodIdentity: '2025',
    dimensionIdentity: 'consolidated',
    normalizedValue: '1200000',
    conflictStatus: 'none',
    ...overrides,
  };
}

describe('calculateReadiness', () => {
  it('treats an empty required field list as fully complete', () => {
    expect(calculateReadiness([], [])).toEqual({
      missingFieldIds: [],
      presentFieldIds: [],
      completenessPct: 100,
      unresolvedConflictCount: 0,
      canExport: true,
    });
  });

  it('reports zero completeness when no required field has a canonical value', () => {
    expect(
      calculateReadiness(
        ['company_name', 'revenue'],
        [evidence({ fieldId: 'company_name', normalizedValue: '   ' })],
      ),
    ).toMatchObject({
      missingFieldIds: ['company_name', 'revenue'],
      presentFieldIds: [],
      completenessPct: 0,
      canExport: false,
    });
  });

  it('reports partial completeness and preserves required-field order', () => {
    expect(
      calculateReadiness(
        ['company_name', 'revenue', 'gross_margin'],
        [evidence({ fieldId: 'revenue' })],
      ),
    ).toMatchObject({
      missingFieldIds: ['company_name', 'gross_margin'],
      presentFieldIds: ['revenue'],
      completenessPct: 33,
      canExport: false,
    });
  });

  it('reports complete data as exportable when there are no unresolved conflicts', () => {
    expect(
      calculateReadiness(
        ['company_name', 'revenue'],
        [
          evidence({ fieldId: 'revenue' }),
          evidence({ fieldId: 'company_name', normalizedValue: '示例公司' }),
        ],
      ),
    ).toEqual({
      missingFieldIds: [],
      presentFieldIds: ['company_name', 'revenue'],
      completenessPct: 100,
      unresolvedConflictCount: 0,
      canExport: true,
    });
  });

  it('stably deduplicates trimmed required field IDs', () => {
    expect(
      calculateReadiness(
        [' revenue ', 'company_name', 'revenue', ' company_name '],
        [evidence({ fieldId: 'revenue' })],
      ),
    ).toMatchObject({
      missingFieldIds: ['company_name'],
      presentFieldIds: ['revenue'],
      completenessPct: 50,
    });
  });

  it.each([
    ['', 'invalid-required-field'],
    ['   ', 'invalid-required-field'],
    ['not_registered', 'unknown-required-field'],
  ] as const)('rejects invalid required field ID %j', (fieldId, expectedCode) => {
    try {
      calculateReadiness([fieldId], []);
      throw new Error('Expected calculateReadiness to reject the field ID');
    } catch (error) {
      expect(error).toBeInstanceOf(ReadinessValidationError);
      expect(error).toMatchObject({ code: expectedCode, fieldId });
    }
  });

  it('counts a required field once across duplicate periods and dimensions', () => {
    expect(
      calculateReadiness(
        ['revenue'],
        [
          evidence(),
          evidence({ periodIdentity: '2024' }),
          evidence({ dimensionIdentity: 'subsidiary-a' }),
        ],
      ),
    ).toMatchObject({
      missingFieldIds: [],
      presentFieldIds: ['revenue'],
      completenessPct: 100,
    });
  });

  it('counts duplicate unresolved rows in the same identity group once', () => {
    const duplicate = evidence({ conflictStatus: 'unresolved' });

    expect(
      calculateReadiness(['revenue'], [duplicate, { ...duplicate, normalizedValue: '1300000' }]),
    ).toMatchObject({
      unresolvedConflictCount: 1,
      canExport: false,
    });
  });

  it('counts different project, period, and dimension conflict groups separately', () => {
    expect(
      calculateReadiness(
        ['revenue'],
        [
          evidence({ conflictStatus: 'unresolved' }),
          evidence({ conflictStatus: 'unresolved', projectId: 'project-2' }),
          evidence({ conflictStatus: 'unresolved', periodIdentity: '2024' }),
          evidence({ conflictStatus: 'unresolved', dimensionIdentity: 'subsidiary-a' }),
          evidence({ conflictStatus: 'resolved', dimensionIdentity: 'subsidiary-b' }),
        ],
      ),
    ).toMatchObject({
      unresolvedConflictCount: 4,
      canExport: false,
    });
  });

  it('keeps complete data non-exportable while any conflict remains unresolved', () => {
    expect(
      calculateReadiness(
        ['revenue'],
        [evidence({ conflictStatus: 'unresolved' })],
      ),
    ).toMatchObject({
      completenessPct: 100,
      unresolvedConflictCount: 1,
      canExport: false,
    });
  });

  it('does not mutate required IDs or evidence records', () => {
    const requiredFieldIds = Object.freeze([' revenue ', 'company_name']);
    const evidenceItems = Object.freeze([
      Object.freeze(evidence()),
      Object.freeze(evidence({ fieldId: 'company_name', normalizedValue: '示例公司' })),
    ]);
    const requiredSnapshot = [...requiredFieldIds];
    const evidenceSnapshot = evidenceItems.map((item) => ({ ...item }));

    calculateReadiness(requiredFieldIds, evidenceItems);

    expect(requiredFieldIds).toEqual(requiredSnapshot);
    expect(evidenceItems).toEqual(evidenceSnapshot);
  });
});
