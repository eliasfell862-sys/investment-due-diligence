import { describe, expect, it } from 'vitest';
import type { EvidenceSourceType } from '../evidence/evidence';
import type { EvidenceSummary } from './calculate-readiness';
import { calculateReportReadiness } from './calculate-report-readiness';

type ReportEvidence = EvidenceSummary & { readonly sourceType?: EvidenceSourceType };

const formalRequiredFieldIds = [
  'company_name',
  'business_description',
  'revenue',
  'gross_margin',
] as const;

function evidence(
  fieldId: string,
  normalizedValue: string,
  overrides: Partial<ReportEvidence> = {},
): ReportEvidence {
  return {
    projectId: 'project-1',
    fieldId,
    periodIdentity: 'source-document:document-1:undated',
    dimensionIdentity: 'project:project-1:default',
    normalizedValue,
    conflictStatus: 'none',
    sourceType: 'document_fact',
    ...overrides,
  };
}

function calculate(
  evidenceItems: readonly ReportEvidence[],
  overrides: Partial<{
    documentCount: number;
    pendingCandidateCount: number;
  }> = {},
) {
  return calculateReportReadiness({
    projectId: 'project-1',
    documentCount: 1,
    pendingCandidateCount: 0,
    evidence: evidenceItems,
    formalRequiredFieldIds,
    ...overrides,
  });
}

function quickLookEvidence(summaryFieldId = 'team_summary'): ReportEvidence[] {
  return [
    evidence('company_name', 'ACME'),
    evidence('business_description', 'Subscription software'),
    evidence(summaryFieldId, 'Experienced operating team'),
  ];
}

describe('calculateReportReadiness', () => {
  it('allows quick-look but blocks formal export when historical fields are missing', () => {
    expect(calculate(quickLookEvidence(), { pendingCandidateCount: 2 })).toEqual({
      quickLook: {
        canExport: true,
        missingFieldIds: [],
        blockingReasons: [],
      },
      formal: {
        canExport: false,
        missingFieldIds: ['revenue', 'gross_margin'],
        blockingReasons: ['missing-required-fields'],
      },
      pendingCandidateCount: 2,
      unresolvedConflictCount: 0,
      decisionState: 'insufficient-data',
    });
  });

  it('requires a stored source document for quick-look export', () => {
    expect(calculate(quickLookEvidence(), { documentCount: 0 }).quickLook).toMatchObject({
      canExport: false,
      blockingReasons: ['missing-source-document'],
    });
  });

  it.each(['company_name', 'business_description'] as const)(
    'blocks quick-look export when %s is missing',
    (missingFieldId) => {
      const result = calculate(
        quickLookEvidence().filter(({ fieldId }) => fieldId !== missingFieldId),
      );

      expect(result.quickLook.canExport).toBe(false);
      expect(result.quickLook.missingFieldIds).toContain(missingFieldId);
    },
  );

  it.each(['team_summary', 'product_summary', 'market_summary'] as const)(
    'accepts %s as the third quick-look fact',
    (summaryFieldId) => {
      expect(calculate(quickLookEvidence(summaryFieldId)).quickLook.canExport).toBe(true);
    },
  );

  it('does not count pending candidates as evidence', () => {
    const result = calculate([], { pendingCandidateCount: 3 });

    expect(result.pendingCandidateCount).toBe(3);
    expect(result.quickLook.canExport).toBe(false);
    expect(result.formal.canExport).toBe(false);
  });

  it('lets unresolved conflicts block formal but not quick-look export', () => {
    const result = calculate([
      ...quickLookEvidence(),
      evidence('revenue', '1200', { conflictStatus: 'unresolved' }),
      evidence('gross_margin', '0.4'),
    ]);

    expect(result.quickLook.canExport).toBe(true);
    expect(result.formal).toMatchObject({
      canExport: false,
      missingFieldIds: [],
      blockingReasons: ['unresolved-conflicts'],
    });
    expect(result.unresolvedConflictCount).toBe(1);
    expect(result.decisionState).toBe('conflicted');
  });

  it('allows formal export when required fields are complete without conflicts', () => {
    const result = calculate([
      ...quickLookEvidence(),
      evidence('revenue', '1200'),
      evidence('gross_margin', '0.4'),
    ]);

    expect(result.formal).toEqual({
      canExport: true,
      missingFieldIds: [],
      blockingReasons: [],
    });
    expect(result.decisionState).toBe('ready');
  });

  it('does not let investor assumptions satisfy historical formal fields', () => {
    const result = calculate([
      ...quickLookEvidence(),
      evidence('revenue', '1200', { sourceType: 'investor_assumption' }),
      evidence('gross_margin', '0.4', { sourceType: 'investor_assumption' }),
    ]);

    expect(result.formal).toMatchObject({
      canExport: false,
      missingFieldIds: ['revenue', 'gross_margin'],
    });
  });
});
