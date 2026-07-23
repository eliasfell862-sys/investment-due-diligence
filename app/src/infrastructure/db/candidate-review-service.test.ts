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

  it('rolls back evidence and candidate when the atomic review commit fails', async () => {
    await seed(candidate('write-retry'));
    const commitFailure = new Error('document status write failed');
    vi.spyOn(db.documents, 'put').mockRejectedValueOnce(commitFailure);
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
    expect(error).toMatchObject({ code: 'write-failure', cause: commitFailure });
    expect(await db.evidence.count()).toBe(0);
    expect(await documentRepository.getCandidate('project-1', 'write-retry')).toMatchObject({
      reviewStatus: 'pending',
    });

    await service.confirm('project-1', 'write-retry');

    expect(await db.evidence.count()).toBe(1);
    expect((await evidenceRepository.listByProject('project-1'))[0]?.updatedAt).toBe(
      '2026-07-23T03:00:00.000Z',
    );
    expect(await documentRepository.getCandidate('project-1', 'write-retry')).toMatchObject({
      reviewStatus: 'confirmed',
      reviewedAt: '2026-07-23T03:00:00.000Z',
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

  it('classifies an OCR page locator as PDF provenance', async () => {
    await seed(candidate('ocr-page'), [fragment('fragment-1', {
      sourceKind: 'ocr',
      locator: { pageNumber: 7 },
      extractionMethod: 'tesseract',
    })]);

    await service.confirm('project-1', 'ocr-page');

    expect(await evidenceRepository.listByProject('project-1')).toContainEqual(
      expect.objectContaining({ sourceSheet: 'PDF', sourceRow: 7 }),
    );
  });

  it('classifies consistent slide locators as PPTX regardless of source kind', async () => {
    const pending = candidate('locator-ppt', {
      sourceFragmentIds: ['slide-chart', 'slide-text'],
    });
    await seed(pending, [
      fragment('slide-chart', {
        sourceKind: 'embedded_chart_data',
        locator: { slideNumber: 5, objectName: 'Forecast' },
      }),
      fragment('slide-text', {
        sourceKind: 'pdf_text',
        locator: { slideNumber: 3 },
      }),
    ]);

    await service.confirm('project-1', 'locator-ppt');

    expect(await evidenceRepository.listByProject('project-1')).toContainEqual(
      expect.objectContaining({ sourceSheet: 'PPTX', sourceRow: 3 }),
    );
  });

  it('rejects mixed page and slide provenance before committing', async () => {
    const pending = candidate('mixed-provenance', {
      sourceFragmentIds: ['page-source', 'slide-source'],
    });
    await seed(pending, [
      fragment('page-source', { locator: { pageNumber: 1 } }),
      fragment('slide-source', {
        sourceKind: 'ppt_text',
        locator: { slideNumber: 2 },
      }),
    ]);

    await expect(service.confirm('project-1', 'mixed-provenance')).rejects.toMatchObject({
      code: 'invalid-source',
    });
    expect(await db.evidence.count()).toBe(0);
    expect(await documentRepository.getCandidate('project-1', 'mixed-provenance')).toEqual(
      pending,
    );
  });

  it('allows exactly one concurrent confirm-versus-correct decision', async () => {
    await seed(candidate('concurrent-decision'));

    const results = await Promise.allSettled([
      service.confirm('project-1', 'concurrent-decision'),
      service.correct('project-1', 'concurrent-decision', {
        normalizedValue: '1200',
        reason: 'corrected concurrently',
      }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const finalCandidate = await documentRepository.getCandidate(
      'project-1',
      'concurrent-decision',
    );
    const [formalEvidence] = await evidenceRepository.listByProject('project-1');
    expect(formalEvidence).toBeDefined();
    if (finalCandidate?.reviewStatus === 'confirmed') {
      expect(formalEvidence).toMatchObject({
        normalizedValue: '1000',
        reviewAudit: { reviewedValue: '1000' },
      });
    } else {
      expect(finalCandidate).toMatchObject({
        reviewStatus: 'corrected',
        correctedValue: '1200',
        reviewReason: 'corrected concurrently',
      });
      expect(formalEvidence).toMatchObject({
        normalizedValue: '1200',
        reviewAudit: {
          reviewedValue: '1200',
          reason: 'corrected concurrently',
        },
      });
    }
  });

  it('allows exactly one of two different concurrent corrections', async () => {
    await seed(candidate('concurrent-corrections'));

    const results = await Promise.allSettled([
      service.correct('project-1', 'concurrent-corrections', {
        normalizedValue: '1200',
        reason: 'first correction',
      }),
      service.correct('project-1', 'concurrent-corrections', {
        normalizedValue: '1300',
        reason: 'second correction',
      }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const finalCandidate = await documentRepository.getCandidate(
      'project-1',
      'concurrent-corrections',
    );
    const [formalEvidence] = await evidenceRepository.listByProject('project-1');
    expect(finalCandidate).toMatchObject({ reviewStatus: 'corrected' });
    expect(formalEvidence?.normalizedValue).toBe(finalCandidate?.correctedValue);
    expect(formalEvidence?.reviewAudit?.reason).toBe(finalCandidate?.reviewReason);
  });

  it('does not overwrite legacy deterministic evidence when pending provenance changed', async () => {
    const pending = candidate('legacy-pending');
    await seed(pending);
    await service.confirm('project-1', 'legacy-pending');
    const [originalEvidence] = await evidenceRepository.listByProject('project-1');
    await db.evidenceCandidates.put(pending);
    await db.sourceFragments.put(fragment('fragment-1', {
      locator: { pageNumber: 2 },
      rawText: 'Changed source text',
      normalizedText: 'Changed normalized text',
      contentHash: 'changed-source-hash',
    }));

    await expect(service.confirm('project-1', 'legacy-pending')).rejects.toMatchObject({
      code: 'invalid-transition',
    });

    expect(await evidenceRepository.listByProject('project-1')).toEqual([originalEvidence]);
    expect(await documentRepository.getCandidate('project-1', 'legacy-pending')).toEqual(
      pending,
    );
  });

  it('completes a pending candidate when identical deterministic evidence already exists', async () => {
    const pending = candidate('legacy-identical');
    await seed(pending);
    await service.confirm('project-1', 'legacy-identical');
    const [originalEvidence] = await evidenceRepository.listByProject('project-1');
    await db.evidenceCandidates.put(pending);

    await service.confirm('project-1', 'legacy-identical');

    expect(await evidenceRepository.listByProject('project-1')).toEqual([originalEvidence]);
    expect(await documentRepository.getCandidate('project-1', 'legacy-identical')).toMatchObject({
      reviewStatus: 'confirmed',
      reviewedAt: REVIEWED_AT,
    });
  });

  it('rejects an idempotent retry when the reviewed source snapshot changed', async () => {
    await seed(candidate('changed-retry-source'));
    await service.confirm('project-1', 'changed-retry-source');
    const [originalEvidence] = await evidenceRepository.listByProject('project-1');
    const originalCandidate = await documentRepository.getCandidate(
      'project-1',
      'changed-retry-source',
    );
    await db.sourceFragments.put(fragment('fragment-1', {
      locator: { pageNumber: 3 },
      rawText: 'Changed after review',
      normalizedText: 'Changed after review',
      contentHash: 'changed-after-review',
    }));

    await expect(service.confirm('project-1', 'changed-retry-source')).rejects.toMatchObject({
      code: 'invalid-transition',
    });

    expect(await evidenceRepository.listByProject('project-1')).toEqual([originalEvidence]);
    expect(await documentRepository.getCandidate('project-1', 'changed-retry-source')).toEqual(
      originalCandidate,
    );
  });

  it.each([
    ['overlong', 'x'.repeat(257)],
    ['lone-high-surrogate', '\uD800'],
    ['lone-low-surrogate', '\uDC00'],
  ])('rejects %s candidate identifiers before repository access', async (_name, candidateId) => {
    await expect(service.confirm('project-1', candidateId)).rejects.toMatchObject({
      code: 'invalid-candidate',
    });
  });

  it('rejects overlong project and document identifiers with typed errors', async () => {
    await expect(service.confirm('p'.repeat(257), 'candidate-1')).rejects.toMatchObject({
      code: 'invalid-project',
    });

    const longDocumentId = 'd'.repeat(257);
    await seed(candidate('long-document', { documentId: longDocumentId }), [
      fragment('fragment-1', { documentId: longDocumentId }),
    ]);
    await expect(service.confirm('project-1', 'long-document')).rejects.toMatchObject({
      code: 'invalid-source',
    });
    expect(await db.evidence.count()).toBe(0);
  });

  it('rolls back atomic promotion when an affected stored evidence row is malformed', async () => {
    const pending = candidate('malformed-conflict-group');
    await seed(pending);
    const malformed = {
      ...priorEvidence({ id: 'malformed-prior' }),
      normalizedValue: 'not-a-number',
    } as EvidenceItem;
    await db.evidence.put(malformed);

    await expect(
      service.confirm('project-1', 'malformed-conflict-group'),
    ).rejects.toMatchObject({ code: 'write-failure' });

    expect(await db.evidence.count()).toBe(1);
    expect(await db.evidence.get('malformed-prior')).toEqual(malformed);
    expect(
      await documentRepository.getCandidate('project-1', 'malformed-conflict-group'),
    ).toEqual(pending);
  });

  it('allows concurrent identical confirmations after conflict status is derived', async () => {
    await evidenceRepository.saveMany([priorEvidence()]);
    await seed(candidate('concurrent-identical'));

    const results = await Promise.allSettled([
      service.confirm('project-1', 'concurrent-identical'),
      service.confirm('project-1', 'concurrent-identical'),
    ]);

    expect(results.every(({ status }) => status === 'fulfilled')).toBe(true);
    expect(await documentRepository.getCandidate('project-1', 'concurrent-identical')).toMatchObject({
      reviewStatus: 'confirmed',
      reviewedAt: REVIEWED_AT,
    });
    expect(
      (await evidenceRepository.listByProject('project-1')).map(
        ({ id, conflictStatus }) => ({ id, conflictStatus }),
      ),
    ).toEqual([
      { id: 'candidate-evidence:concurrent-identical', conflictStatus: 'unresolved' },
      { id: 'prior-evidence', conflictStatus: 'unresolved' },
    ]);
  });

  it('allows rejecting a candidate with mixed page and slide sources', async () => {
    const pending = candidate('mixed-reject', {
      sourceFragmentIds: ['page-source', 'slide-source'],
    });
    await seed(pending, [
      fragment('page-source', { locator: { pageNumber: 1 } }),
      fragment('slide-source', {
        sourceKind: 'ppt_text',
        locator: { slideNumber: 2 },
      }),
    ]);

    await service.reject('project-1', 'mixed-reject', 'not promotable');

    expect(await db.evidence.count()).toBe(0);
    expect(await documentRepository.getCandidate('project-1', 'mixed-reject')).toMatchObject({
      reviewStatus: 'rejected',
      reviewReason: 'not promotable',
      reviewedAt: REVIEWED_AT,
    });
    expect(await db.documents.get('document-1')).toMatchObject({
      parseStatus: 'complete',
    });
  });
});
