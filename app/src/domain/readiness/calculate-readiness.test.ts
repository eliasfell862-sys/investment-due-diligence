import { describe, expect, it } from 'vitest';
import {
  calculateReadiness as calculateProjectReadiness,
  ReadinessInputError,
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

function uncheckedEvidence(
  overrides: Record<string, unknown>,
): EvidenceSummary {
  return { ...evidence(), ...overrides } as unknown as EvidenceSummary;
}

function calculateReadiness(
  requiredFieldIds: readonly string[],
  evidenceItems: readonly EvidenceSummary[],
) {
  return calculateProjectReadiness('project-1', requiredFieldIds, evidenceItems);
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
    [null, 'invalid-required-field'],
    [42, 'invalid-required-field'],
    [{}, 'invalid-required-field'],
    ['not_registered', 'unknown-required-field'],
  ] as const)('rejects invalid required field ID %j', (fieldId, expectedCode) => {
    try {
      calculateReadiness([fieldId as unknown as string], []);
      throw new Error('Expected calculateReadiness to reject the field ID');
    } catch (error) {
      expect(error).toBeInstanceOf(ReadinessValidationError);
      expect(error).toMatchObject({ code: expectedCode, fieldId });
    }
  });

  it.each([
    ['', 'invalid-project-id'],
    ['   ', 'invalid-project-id'],
    [null, 'invalid-project-id'],
  ] as const)('rejects invalid target project ID %j', (projectId, expectedCode) => {
    try {
      calculateProjectReadiness(projectId as string, [], []);
      throw new Error('Expected calculateReadiness to reject the project ID');
    } catch (error) {
      expect(error).toBeInstanceOf(ReadinessValidationError);
      expect(error).toMatchObject({ code: expectedCode, projectId });
    }
  });

  it('trims the target project ID before matching evidence', () => {
    expect(
      calculateProjectReadiness(
        ' project-1 ',
        ['revenue'],
        [evidence()],
      ),
    ).toMatchObject({
      presentFieldIds: ['revenue'],
      completenessPct: 100,
    });
  });

  it.each([
    null,
    [],
    'not-an-object',
  ])('rejects a non-record evidence item %#', (item) => {
    try {
      calculateReadiness(['revenue'], [item as unknown as EvidenceSummary]);
      throw new Error('Expected calculateReadiness to reject the evidence item');
    } catch (error) {
      expect(error).toBeInstanceOf(ReadinessInputError);
      expect(error).toMatchObject({ code: 'invalid-evidence-record', evidenceIndex: 0 });
    }
  });

  it.each([
    ['projectId', null, 'invalid-evidence-project-id'],
    ['projectId', '   ', 'invalid-evidence-project-id'],
    ['fieldId', 42, 'invalid-evidence-field-id'],
    ['fieldId', '   ', 'invalid-evidence-field-id'],
    ['fieldId', 'not_registered', 'unknown-evidence-field'],
    ['periodIdentity', undefined, 'invalid-evidence-period-identity'],
    ['periodIdentity', '   ', 'invalid-evidence-period-identity'],
    ['dimensionIdentity', {}, 'invalid-evidence-dimension-identity'],
    ['dimensionIdentity', '   ', 'invalid-evidence-dimension-identity'],
    ['normalizedValue', null, 'invalid-evidence-normalized-value'],
    ['normalizedValue', 1200, 'invalid-evidence-normalized-value'],
    ['conflictStatus', 'pending', 'invalid-evidence-conflict-status'],
    ['conflictStatus', null, 'invalid-evidence-conflict-status'],
  ] as const)(
    'rejects invalid evidence property %s=%j with a stable code',
    (property, value, expectedCode) => {
      try {
        calculateReadiness(['revenue'], [uncheckedEvidence({ [property]: value })]);
        throw new Error('Expected calculateReadiness to reject the evidence property');
      } catch (error) {
        expect(error).toBeInstanceOf(ReadinessInputError);
        expect(error).toMatchObject({ code: expectedCode, evidenceIndex: 0 });
      }
    },
  );

  it('reports the index of the invalid evidence item', () => {
    try {
      calculateReadiness(
        ['revenue'],
        [evidence(), uncheckedEvidence({ normalizedValue: Symbol('invalid') })],
      );
      throw new Error('Expected calculateReadiness to reject the second item');
    } catch (error) {
      expect(error).toBeInstanceOf(ReadinessInputError);
      expect(error).toMatchObject({
        code: 'invalid-evidence-normalized-value',
        evidenceIndex: 1,
      });
    }
  });

  it.each([
    ['revenue', 'NaN'],
    ['revenue', 'Infinity'],
    ['revenue', 'not-a-number'],
    ['period_end', '2025-Q5'],
    ['period_end', '2025-13'],
    ['period_end', '2025-02-29'],
  ] as const)('rejects invalid canonical value %s=%s with an indexed error', (fieldId, value) => {
    try {
      calculateReadiness(
        [fieldId],
        [evidence({ fieldId, normalizedValue: value })],
      );
      throw new Error('Expected calculateReadiness to reject the canonical value');
    } catch (error) {
      expect(error).toBeInstanceOf(ReadinessInputError);
      expect(error).toMatchObject({
        code: 'invalid-evidence-target-value',
        evidenceIndex: 0,
      });
    }
  });

  it('ignores valid foreign-project evidence for presence and conflicts', () => {
    expect(
      calculateReadiness(
        ['revenue'],
        [
          evidence({
            projectId: 'project-2',
            conflictStatus: 'unresolved',
          }),
        ],
      ),
    ).toEqual({
      missingFieldIds: ['revenue'],
      presentFieldIds: [],
      completenessPct: 0,
      unresolvedConflictCount: 0,
      canExport: false,
    });
  });

  it('ignores foreign-project fields after validating its record and project ID', () => {
    expect(
      calculateReadiness(
        ['revenue'],
        [
          {
            projectId: 'project-2',
            fieldId: null,
            periodIdentity: null,
            dimensionIdentity: null,
            normalizedValue: Symbol('invalid'),
            conflictStatus: 'pending',
          } as unknown as EvidenceSummary,
        ],
      ),
    ).toMatchObject({
      missingFieldIds: ['revenue'],
      unresolvedConflictCount: 0,
      canExport: false,
    });
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

  it('counts different period and dimension conflict groups separately', () => {
    expect(
      calculateReadiness(
        ['revenue'],
        [
          evidence({ conflictStatus: 'unresolved' }),
          evidence({ conflictStatus: 'unresolved', periodIdentity: '2024' }),
          evidence({ conflictStatus: 'unresolved', dimensionIdentity: 'subsidiary-a' }),
          evidence({ conflictStatus: 'resolved', dimensionIdentity: 'subsidiary-b' }),
        ],
      ),
    ).toMatchObject({
      unresolvedConflictCount: 3,
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

  it('uses trimmed evidence identities without mutating the inputs', () => {
    const requiredFieldIds = Object.freeze([' revenue ', 'company_name']);
    const evidenceItems = Object.freeze([
      Object.freeze(evidence({
        projectId: ' project-1 ',
        fieldId: ' revenue ',
        periodIdentity: ' 2025 ',
        dimensionIdentity: ' consolidated ',
      })),
      Object.freeze(evidence({ fieldId: 'company_name', normalizedValue: '示例公司' })),
    ]);
    const requiredSnapshot = [...requiredFieldIds];
    const evidenceSnapshot = evidenceItems.map((item) => ({ ...item }));

    const result = calculateReadiness(requiredFieldIds, evidenceItems);

    expect(result.presentFieldIds).toEqual(['revenue', 'company_name']);
    expect(requiredFieldIds).toEqual(requiredSnapshot);
    expect(evidenceItems).toEqual(evidenceSnapshot);
  });
});
