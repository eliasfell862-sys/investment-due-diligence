import { describe, expect, it } from 'vitest';
import { parseEvidenceCandidate } from './evidence-candidate.schema';

function validPendingCandidate() {
  return {
    id: 'candidate-1',
    projectId: 'project-1',
    documentId: 'document-1',
    fieldId: 'revenue',
    normalizedValue: ' 1,234.50 ',
    displayValue: '$1,234.50',
    periodIdentity: 'FY2025',
    dimensionIdentity: 'consolidated',
    sourceFragmentIds: ['fragment-1'],
    recognitionMethod: 'rule',
    sourceTypeHint: 'document_fact',
    confidence: 0.92,
    reviewStatus: 'pending',
    candidateFingerprint: 'revenue-fy2025-consolidated',
    createdAt: '2026-07-23T09:30:00+08:00',
    updatedAt: '2026-07-23T09:30:00+08:00',
  };
}

describe('parseEvidenceCandidate', () => {
  it('accepts a pending revenue candidate with a document fact source hint', () => {
    const candidate = parseEvidenceCandidate(validPendingCandidate());

    expect(candidate.normalizedValue).toBe('1234.5');
    expect(candidate.sourceTypeHint).toBe('document_fact');
    expect(candidate.createdAt).toBe('2026-07-23T01:30:00.000Z');
    expect(candidate.updatedAt).toBe('2026-07-23T01:30:00.000Z');
  });

  it('rejects a corrected candidate without a review reason', () => {
    expect(() =>
      parseEvidenceCandidate({
        ...validPendingCandidate(),
        reviewStatus: 'corrected',
        correctedValue: '1300',
        reviewedAt: '2026-07-23T10:00:00+08:00',
      }),
    ).toThrow();
  });

  it('rejects an unknown target field', () => {
    expect(() =>
      parseEvidenceCandidate({
        ...validPendingCandidate(),
        fieldId: 'unknown_metric',
      }),
    ).toThrow('Unknown target field: unknown_metric');
  });

  it('rejects duplicate source fragment ids', () => {
    expect(() =>
      parseEvidenceCandidate({
        ...validPendingCandidate(),
        sourceFragmentIds: ['fragment-1', 'fragment-1'],
      }),
    ).toThrow();
  });

  it('accepts a management forecast source hint', () => {
    const candidate = parseEvidenceCandidate({
      ...validPendingCandidate(),
      sourceTypeHint: 'management_forecast',
    });

    expect(candidate.sourceTypeHint).toBe('management_forecast');
  });

  it('rejects an invalid corrected numeric value', () => {
    expect(() =>
      parseEvidenceCandidate({
        ...validPendingCandidate(),
        reviewStatus: 'corrected',
        correctedValue: 'not a number',
        reviewReason: 'Corrected after checking the source table',
        reviewedAt: '2026-07-23T10:00:00+08:00',
      }),
    ).toThrow('Invalid corrected target value: revenue');
  });

  it('canonicalizes a valid corrected value and review timestamp', () => {
    const candidate = parseEvidenceCandidate({
      ...validPendingCandidate(),
      reviewStatus: 'corrected',
      correctedValue: ' 1,300.00 ',
      reviewReason: 'Corrected after checking the source table',
      reviewedAt: '2026-07-23T10:00:00+08:00',
    });

    expect(candidate.correctedValue).toBe('1300');
    expect(candidate.reviewedAt).toBe('2026-07-23T02:00:00.000Z');
  });

  it('requires a reason and timestamp for rejected candidates', () => {
    expect(() =>
      parseEvidenceCandidate({
        ...validPendingCandidate(),
        reviewStatus: 'rejected',
      }),
    ).toThrow();
  });

  it('accepts confirmed candidates only with a review timestamp', () => {
    expect(() =>
      parseEvidenceCandidate({
        ...validPendingCandidate(),
        reviewStatus: 'confirmed',
      }),
    ).toThrow();

    expect(
      parseEvidenceCandidate({
        ...validPendingCandidate(),
        reviewStatus: 'confirmed',
        reviewedAt: '2026-07-23T10:00:00+08:00',
      }).reviewStatus,
    ).toBe('confirmed');
  });

  it.each(['pending', 'conflicted'] as const)(
    'rejects review fields for the %s machine state',
    (reviewStatus) => {
      expect(() =>
        parseEvidenceCandidate({
          ...validPendingCandidate(),
          reviewStatus,
          reviewReason: 'Should not be present',
        }),
      ).toThrow();
    },
  );

  it('rejects unknown storage fields', () => {
    expect(() =>
      parseEvidenceCandidate({ ...validPendingCandidate(), ignored: true }),
    ).toThrow();
  });
});
