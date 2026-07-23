import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceFragment } from '../../domain/documents/source-fragment';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import { AppDb, type StoredDocument } from './app-db';
import {
  CandidateReviewService,
  CandidateReviewServiceError,
} from './candidate-review-service';
import { DocumentEvidenceRepository } from './document-evidence-repository';
import { EvidenceRepository } from './evidence-repository';

const REVIEWED_AT = '2026-07-23T02:00:00.000Z';

function document(
  id = 'document-1',
  projectId = 'project-1',
  overrides: Partial<StoredDocument> = {},
): StoredDocument {
  return {
    id,
    projectId,
    name: `${id}.pdf`,
    mimeType: 'application/pdf',
    size: 10,
    uploadedAt: '2026-07-23T00:00:00.000Z',
    parseStatus: 'unparsed',
    blob: new Blob(['document']),
    ...overrides,
  };
}

function fragment(
  id = 'fragment-1',
  overrides: Partial<SourceFragment> = {},
): SourceFragment {
  return {
    id,
    projectId: 'project-1',
    documentId: 'document-1',
    documentVersionId: 'version-1',
    sourceKind: 'pdf_text',
    locator: { pageNumber: 1 },
    rawText: `Raw ${id}`,
    normalizedText: `Normalized ${id}`,
    extractionMethod: 'pdfjs',
    extractionVersion: '1',
    contentHash: `hash-${id}`,
    createdAt: '2026-07-23T00:00:00.000Z',
    ...overrides,
  };
}

function candidate(
  id = 'candidate-1',
  overrides: Partial<EvidenceCandidate> = {},
): EvidenceCandidate {
  return {
    id,
    projectId: 'project-1',
    documentId: 'document-1',
    fieldId: 'revenue',
    normalizedValue: '1000',
    periodIdentity: '2025',
    dimensionIdentity: 'company=acme',
    sourceFragmentIds: ['fragment-1'],
    recognitionMethod: 'rule',
    sourceTypeHint: 'document_fact',
    confidence: 0.8,
    reviewStatus: 'pending',
    candidateFingerprint: `fingerprint-${id}`,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
    ...overrides,
  };
}

function priorEvidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: 'prior-evidence',
    projectId: 'project-1',
    fieldId: 'revenue',
    periodIdentity: '2025',
    dimensionIdentity: 'company=acme',
    normalizedValue: '900',
    importBatchId: 'excel-batch',
    sourceSheet: 'Financials',
    sourceRow: 2,
    sourceLocator: 'Financials!B2',
    rawValue: '900',
    confidence: 1,
    conflictStatus: 'none',
    updatedAt: '2026-07-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('CandidateReviewService', () => {
  let db: AppDb;
  let documentRepository: DocumentEvidenceRepository;
  let evidenceRepository: EvidenceRepository;
  let service: CandidateReviewService;

  beforeEach(() => {
    db = new AppDb(`candidate-review-${crypto.randomUUID()}`);
    documentRepository = new DocumentEvidenceRepository(db);
    evidenceRepository = new EvidenceRepository(db);
    service = new CandidateReviewService(
      documentRepository,
      evidenceRepository,
      () => new Date(REVIEWED_AT),
    );
  });

  afterEach(async () => {
    await db.delete();
  });

  async function seed(
    value: EvidenceCandidate = candidate(),
    sources: readonly SourceFragment[] = [fragment()],
  ): Promise<void> {
    await db.documents.put(document(value.documentId, value.projectId));
    await documentRepository.saveExtraction(
      value.projectId,
      value.documentId,
      sources,
      [value],
    );
  }

  it('confirms PDF evidence with deterministic provenance and candidate state', async () => {
    const sources = [
      fragment('fragment-1', {
        locator: { pageNumber: 4, objectName: 'Summary' },
        rawText: 'Revenue source one',
      }),
      fragment('fragment-2', {
        sourceKind: 'pdf_table',
        locator: { pageNumber: 2, tableIndex: 1, tableRow: 3, tableColumn: 2 },
        rawText: 'Revenue source two',
      }),
    ];
    const pending = candidate('candidate/1', {
      sourceFragmentIds: ['fragment-2', 'fragment-1'],
      displayValue: 'Revenue display value',
    });
    await seed(pending, sources);

    await service.confirm(' project-1 ', ' candidate/1 ');

    expect(await evidenceRepository.listByProject('project-1')).toEqual([{
      id: 'candidate-evidence:candidate%2F1',
      projectId: 'project-1',
      fieldId: 'revenue',
      periodIdentity: '2025',
      dimensionIdentity: 'company=acme',
      normalizedValue: '1000',
      importBatchId: 'document-candidate:document-1',
      sourceDocumentId: 'document-1',
      sourceFragmentIds: ['fragment-2', 'fragment-1'],
      sourceType: 'document_fact',
      candidateId: 'candidate/1',
      sourceSheet: 'PDF',
      sourceRow: 2,
      sourceLocator: '第 2 页 / 表格 1 / 第 3 行第 2 列；第 4 页 / 对象 Summary',
      rawValue: 'Revenue display value',
      confidence: 0.8,
      conflictStatus: 'none',
      updatedAt: REVIEWED_AT,
      reviewAudit: {
        originalCandidateValue: '1000',
        reviewedValue: '1000',
        reviewedAt: REVIEWED_AT,
      },
    }]);
    expect(await documentRepository.getCandidate('project-1', 'candidate/1')).toEqual({
      ...pending,
      reviewStatus: 'confirmed',
      reviewedAt: REVIEWED_AT,
      updatedAt: REVIEWED_AT,
    });
  });

  it('confirms PPTX evidence from ordered slide sources', async () => {
    const pending = candidate('candidate-ppt', {
      documentId: 'document/ppt',
      sourceFragmentIds: ['slide-3', 'slide-2'],
      sourceTypeHint: 'management_forecast',
    });
    const sources = [
      fragment('slide-2', {
        documentId: 'document/ppt',
        sourceKind: 'embedded_chart_data',
        locator: { slideNumber: 2, objectName: 'Forecast chart' },
      }),
      fragment('slide-3', {
        documentId: 'document/ppt',
        sourceKind: 'ppt_text',
        locator: { slideNumber: 3 },
      }),
    ];
    await seed(pending, sources);

    await service.confirm('project-1', 'candidate-ppt');

    expect(await evidenceRepository.listByProject('project-1')).toContainEqual(
      expect.objectContaining({
        importBatchId: 'document-candidate:document%2Fppt',
        sourceSheet: 'PPTX',
        sourceRow: 2,
        sourceLocator: '第 3 页；第 2 页 / 对象 Forecast chart',
        sourceType: 'management_forecast',
      }),
    );
  });

  it('corrects to a canonical value while retaining original and raw source values', async () => {
    const pending = candidate('candidate-correct', {
      displayValue: '   ',
      sourceFragmentIds: ['fragment-2', 'fragment-1'],
    });
    await seed(pending, [
      fragment('fragment-1', { rawText: 'Original source one' }),
      fragment('fragment-2', { rawText: 'Original source two', locator: { pageNumber: 2 } }),
    ]);

    await service.correct('project-1', 'candidate-correct', {
      normalizedValue: ' 1,250.00 ',
      reason: ' adjusted against audited table ',
    });

    expect(await evidenceRepository.listByProject('project-1')).toEqual([
      expect.objectContaining({
        normalizedValue: '1250',
        rawValue: 'Original source two；Original source one',
        reviewAudit: {
          originalCandidateValue: '1000',
          reviewedValue: '1250',
          reason: 'adjusted against audited table',
          reviewedAt: REVIEWED_AT,
        },
      }),
    ]);
    expect(await documentRepository.getCandidate('project-1', 'candidate-correct')).toEqual({
      ...pending,
      reviewStatus: 'corrected',
      correctedValue: '1250',
      reviewReason: 'adjusted against audited table',
      reviewedAt: REVIEWED_AT,
      updatedAt: REVIEWED_AT,
    });
  });

  it('rejects without creating formal evidence', async () => {
    const pending = candidate('candidate-reject');
    await seed(pending);

    await service.reject('project-1', 'candidate-reject', ' not relevant ');

    expect(await evidenceRepository.listByProject('project-1')).toEqual([]);
    expect(await documentRepository.getCandidate('project-1', 'candidate-reject')).toEqual({
      ...pending,
      reviewStatus: 'rejected',
      reviewReason: 'not relevant',
      reviewedAt: REVIEWED_AT,
      updatedAt: REVIEWED_AT,
    });
  });

  it.each([
    ['project-2', 'candidate-1'],
    ['project-1', 'missing-candidate'],
  ])('maps a missing or wrong-project candidate to candidate-not-found', async (projectId, candidateId) => {
    await seed();

    await expect(service.confirm(projectId, candidateId)).rejects.toMatchObject({
      code: 'candidate-not-found',
    });
  });

  it('rejects a candidate whose referenced source fragment is missing', async () => {
    const pending = candidate('missing-source', { sourceFragmentIds: ['not-stored'] });
    await db.documents.put(document());
    await db.evidenceCandidates.put(pending);

    await expect(service.confirm('project-1', 'missing-source')).rejects.toMatchObject({
      code: 'missing-source',
    });
  });

  it('does not allow a rejected candidate to be confirmed', async () => {
    await seed(candidate('terminal-rejected'));
    await service.reject('project-1', 'terminal-rejected', 'duplicate');

    await expect(service.confirm('project-1', 'terminal-rejected')).rejects.toMatchObject({
      code: 'invalid-transition',
    });
  });

  it('retries confirm idempotently without duplicating evidence or rewriting the candidate', async () => {
    await seed(candidate('confirm-retry'));
    await service.confirm('project-1', 'confirm-retry');
    const setCandidate = vi.spyOn(documentRepository, 'setCandidate');

    await service.confirm('project-1', 'confirm-retry');

    expect(await db.evidence.count()).toBe(1);
    expect(setCandidate).not.toHaveBeenCalled();
  });

  it('retries the same correction and rejection idempotently', async () => {
    await seed(candidate('correct-retry'));
    await service.correct('project-1', 'correct-retry', {
      normalizedValue: '1,200',
      reason: 'fix',
    });
    await service.correct('project-1', 'correct-retry', {
      normalizedValue: '1200.00',
      reason: ' fix ',
    });
    await db.documents.put(document('document-2'));
    await documentRepository.saveExtraction(
      'project-1',
      'document-2',
      [fragment('fragment-2', { documentId: 'document-2' })],
      [candidate('reject-retry', {
        documentId: 'document-2',
        sourceFragmentIds: ['fragment-2'],
      })],
    );
    await service.reject('project-1', 'reject-retry', 'duplicate');
    const setCandidate = vi.spyOn(documentRepository, 'setCandidate');
    await service.reject('project-1', 'reject-retry', ' duplicate ');

    expect(await db.evidence.count()).toBe(1);
    expect(setCandidate).not.toHaveBeenCalled();
  });

  it('rejects a different second correction', async () => {
    await seed(candidate('different-correction'));
    await service.correct('project-1', 'different-correction', {
      normalizedValue: '1200',
      reason: 'first reason',
    });

    await expect(service.correct('project-1', 'different-correction', {
      normalizedValue: '1300',
      reason: 'second reason',
    })).rejects.toMatchObject({ code: 'invalid-transition' });
  });

  it('recovers safely when candidate persistence fails after evidence persistence', async () => {
    await seed(candidate('write-retry'));
    const writeFailure = new Error('candidate write failed');
    vi.spyOn(documentRepository, 'setCandidate').mockRejectedValueOnce(writeFailure);
    let attempt = 0;
    service = new CandidateReviewService(
      documentRepository,
      evidenceRepository,
      () => new Date(attempt++ === 0 ? REVIEWED_AT : '2026-07-23T03:00:00.000Z'),
    );

    const error = await service.confirm('project-1', 'write-retry').then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(CandidateReviewServiceError);
    expect(error).toMatchObject({ code: 'write-failure', cause: writeFailure });
    expect(await db.evidence.count()).toBe(1);
    expect(await documentRepository.getCandidate('project-1', 'write-retry')).toMatchObject({
      reviewStatus: 'pending',
    });

    await service.confirm('project-1', 'write-retry');

    expect(await db.evidence.count()).toBe(1);
    expect((await evidenceRepository.listByProject('project-1'))[0]?.updatedAt).toBe(REVIEWED_AT);
    expect(await documentRepository.getCandidate('project-1', 'write-retry')).toMatchObject({
      reviewStatus: 'confirmed',
      reviewedAt: REVIEWED_AT,
    });
  });

  it('recomputes conflicts when candidate evidence is promoted', async () => {
    await evidenceRepository.saveMany([priorEvidence()]);
    await seed(candidate('conflicting-candidate'));

    await service.confirm('project-1', 'conflicting-candidate');

    expect(
      (await evidenceRepository.listByProject('project-1')).map(({ conflictStatus }) => conflictStatus),
    ).toEqual(['unresolved', 'unresolved']);
  });

  it.each([
    ['confirm', () => service.confirm(' ', 'candidate-1'), 'invalid-project'],
    ['confirm', () => service.confirm('project-1', ' '), 'invalid-candidate'],
    ['correct-value', () => service.correct('project-1', 'candidate-1', {
      normalizedValue: 'bad',
      reason: 'fix',
    }), 'invalid-value'],
    ['correct-reason', () => service.correct('project-1', 'candidate-1', {
      normalizedValue: '1000',
      reason: ' ',
    }), 'invalid-reason'],
    ['reject-reason', () => service.reject('project-1', 'candidate-1', ' '), 'invalid-reason'],
  ])('validates %s input', async (_name, operation, code) => {
    await seed();
    await expect(operation()).rejects.toMatchObject({ code });
  });
});
