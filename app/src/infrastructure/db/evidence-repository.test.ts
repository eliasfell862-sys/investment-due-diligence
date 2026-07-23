import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceFragment } from '../../domain/documents/source-fragment';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import { parseEvidenceItem } from '../../domain/evidence/evidence.schema';
import { resolveEvidenceConflict } from '../../domain/evidence/resolve-conflict';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
import { AppDb, type StoredDocument } from './app-db';
import {
  type CandidateReviewCommit,
  EvidenceRepository,
} from './evidence-repository';

function evidence(
  id: string,
  normalizedValue: string,
  overrides: Partial<EvidenceItem> = {},
): EvidenceItem {
  return {
    id,
    projectId: 'project-1',
    fieldId: 'revenue',
    periodIdentity: '2025',
    dimensionIdentity: 'company=acme',
    normalizedValue,
    importBatchId: 'batch-1',
    sourceDocumentId: 'document-1',
    sourceSheet: 'Financials',
    sourceRow: 2,
    sourceLocator: 'Financials!B2',
    rawValue: normalizedValue,
    confidence: 0.8,
    conflictStatus: 'none',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}


const REVIEWED_AT = '2026-07-23T02:00:00.000Z';

function storedDocument(): StoredDocument {
  return {
    id: 'document-1',
    projectId: 'project-1',
    name: 'document.pdf',
    mimeType: 'application/pdf',
    size: 10,
    uploadedAt: '2026-07-23T00:00:00.000Z',
    parseStatus: 'review',
    blob: new Blob(['document']),
  };
}

function sourceFragment(): SourceFragment {
  return {
    id: 'fragment-1',
    projectId: 'project-1',
    documentId: 'document-1',
    documentVersionId: 'version-1',
    sourceKind: 'pdf_text',
    locator: { pageNumber: 1 },
    rawText: 'Raw fragment-1',
    normalizedText: 'Normalized fragment-1',
    extractionMethod: 'pdfjs',
    extractionVersion: '1',
    contentHash: 'hash-fragment-1',
    createdAt: '2026-07-23T00:00:00.000Z',
  };
}

function pendingCandidate(): EvidenceCandidate {
  return {
    id: 'candidate-1',
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
    candidateFingerprint: 'fingerprint-candidate-1',
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
}

function confirmedCandidate(
  expected: EvidenceCandidate = pendingCandidate(),
): EvidenceCandidate {
  return {
    ...expected,
    reviewStatus: 'confirmed',
    reviewedAt: REVIEWED_AT,
    updatedAt: REVIEWED_AT,
  };
}

function candidateEvidence(
  expected: EvidenceCandidate = pendingCandidate(),
): EvidenceItem {
  return {
    id: 'candidate-evidence:candidate-1',
    projectId: expected.projectId,
    fieldId: expected.fieldId,
    periodIdentity: expected.periodIdentity,
    dimensionIdentity: expected.dimensionIdentity,
    normalizedValue: expected.normalizedValue,
    importBatchId: 'document-candidate:document-1',
    sourceDocumentId: expected.documentId,
    sourceFragmentIds: expected.sourceFragmentIds,
    sourceType: expected.sourceTypeHint,
    candidateId: expected.id,
    sourceSheet: 'PDF',
    sourceRow: 1,
    sourceLocator: '第 1 页',
    rawValue: 'Raw fragment-1',
    confidence: expected.confidence,
    conflictStatus: 'none',
    updatedAt: REVIEWED_AT,
    reviewAudit: {
      originalCandidateValue: expected.normalizedValue,
      reviewedValue: expected.normalizedValue,
      reviewedAt: REVIEWED_AT,
    },
  };
}

function validReviewCommit(): CandidateReviewCommit {
  const expectedCandidate = pendingCandidate();
  return {
    expectedCandidate,
    nextCandidate: confirmedCandidate(expectedCandidate),
    sourceFragments: [sourceFragment()],
    evidence: candidateEvidence(expectedCandidate),
  };
}
describe('parseEvidenceItem', () => {
  it('keeps legacy Excel evidence valid without adding absent optional properties', () => {
    const parsed = parseEvidenceItem(evidence('legacy', ' 1,200.00 ', {
      sourceDocumentId: undefined,
      sourceLocator: undefined,
    }));

    expect(parsed.normalizedValue).toBe('1200');
    expect(parsed.updatedAt).toBe('2026-07-22T00:00:00.000Z');
    expect(parsed).not.toHaveProperty('sourceDocumentId');
    expect(parsed).not.toHaveProperty('sourceLocator');
    expect(parsed).not.toHaveProperty('sourceFragmentIds');
    expect(parsed).not.toHaveProperty('sourceType');
    expect(parsed).not.toHaveProperty('candidateId');
    expect(parsed).not.toHaveProperty('reviewAudit');
  });

  it('canonicalizes and deeply freezes reviewed candidate provenance', () => {
    const parsed = parseEvidenceItem(evidence('candidate', '1,200.00', {
      sourceDocumentId: ' document-1 ',
      sourceFragmentIds: [' fragment-2 ', 'fragment-1'],
      sourceType: 'document_fact',
      candidateId: ' candidate-1 ',
      sourceLocator: ' 第 2 页 ',
      reviewAudit: {
        originalCandidateValue: ' 1,000.00 ',
        reviewedValue: ' 1,200 ',
        reason: ' corrected against source ',
        reviewedAt: '2026-07-23T08:00:00+08:00',
      },
    }));

    expect(parsed).toMatchObject({
      normalizedValue: '1200',
      sourceDocumentId: 'document-1',
      sourceFragmentIds: ['fragment-2', 'fragment-1'],
      sourceType: 'document_fact',
      candidateId: 'candidate-1',
      sourceLocator: ' 第 2 页 ',
      reviewAudit: {
        originalCandidateValue: '1000',
        reviewedValue: '1200',
        reason: 'corrected against source',
        reviewedAt: '2026-07-23T00:00:00.000Z',
      },
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.sourceFragmentIds)).toBe(true);
    expect(Object.isFrozen(parsed.reviewAudit)).toBe(true);
  });

  it('rejects duplicate source fragment ids after trimming', () => {
    expect(() => parseEvidenceItem(evidence('duplicate', '100', {
      sourceFragmentIds: ['fragment-1', ' fragment-1 '],
    }))).toThrow();
  });

  it.each([
    [{ originalCandidateValue: 'bad', reviewedValue: '100', reviewedAt: '2026-07-23T00:00:00Z' }],
    [{ originalCandidateValue: '100', reviewedValue: 'bad', reviewedAt: '2026-07-23T00:00:00Z' }],
    [{ originalCandidateValue: '100', reviewedValue: '100', reason: ' ', reviewedAt: '2026-07-23T00:00:00Z' }],
  ])('rejects invalid review audit values', (reviewAudit) => {
    expect(() => parseEvidenceItem(evidence('invalid-audit', '100', {
      reviewAudit,
    }))).toThrow();
  });

  it('rejects a reviewed value that differs from final normalized evidence', () => {
    expect(() => parseEvidenceItem(evidence('mismatch', '100', {
      reviewAudit: {
        originalCandidateValue: '100',
        reviewedValue: '101',
        reviewedAt: '2026-07-23T00:00:00Z',
      },
    }))).toThrow();
  });

  it.each([
    ['sourceDocumentId'],
    ['sourceFragmentIds'],
    ['sourceType'],
    ['sourceLocator'],
    ['reviewAudit'],
  ] as const)('requires %s when candidateId is present', (missingProperty) => {
    const input = {
      ...evidence('missing-provenance', '100', {
      sourceDocumentId: 'document-1',
      sourceFragmentIds: ['fragment-1'],
      sourceType: 'document_fact',
      candidateId: 'candidate-1',
      sourceLocator: '第 1 页',
      reviewAudit: {
        originalCandidateValue: '100',
        reviewedValue: '100',
        reviewedAt: '2026-07-23T00:00:00Z',
      },
      }),
    } as Record<string, unknown>;
    delete input[missingProperty];

    expect(() => parseEvidenceItem(input)).toThrow();
  });

  it('rejects unknown properties', () => {
    expect(() => parseEvidenceItem({ ...evidence('strict', '100'), extra: true })).toThrow();
  });
});

describe('EvidenceRepository', () => {
  let db: AppDb;
  let repository: EvidenceRepository;

  beforeEach(() => {
    db = new AppDb(`evidence-repository-${crypto.randomUUID()}`);
    repository = new EvidenceRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('rejects an invalid batch before writing any row', async () => {
    await repository.saveMany([evidence('existing', '100')]);

    await expect(
      repository.saveMany([
        evidence('valid-new', '120'),
        evidence('invalid', 'not-a-number'),
      ]),
    ).rejects.toMatchObject({ code: 'invalid-evidence' });

    expect((await repository.listByProject('project-1')).map(({ id }) => id)).toEqual([
      'existing',
    ]);
  });

  it('replays stable evidence IDs idempotently with bulk upsert', async () => {
    const batch = [
      evidence('b', '120', { sourceRow: 3 }),
      evidence('a', '100', { sourceRow: 2 }),
    ];

    await repository.saveMany(batch);
    const first = await repository.listByProject('project-1');
    await repository.saveMany(batch);

    expect(await db.evidence.count()).toBe(2);
    expect(await repository.listByProject('project-1')).toEqual(first);
    expect(batch.map((item) => item.conflictStatus)).toEqual(['none', 'none']);
  });

  it('marks every disagreeing row in one full identity group unresolved', async () => {
    await repository.saveMany([
      evidence('high', '120'),
      evidence('low', '100', { sourceRow: 3 }),
    ]);

    expect(
      (await repository.listByProject('project-1')).map(({ id, conflictStatus }) => ({
        id,
        conflictStatus,
      })),
    ).toEqual([
      { id: 'high', conflictStatus: 'unresolved' },
      { id: 'low', conflictStatus: 'unresolved' },
    ]);
  });

  it('uses the canonical target direction for conservative numeric resolution', async () => {
    await repository.saveMany([
      evidence('high', '120'),
      evidence('low', '100', { sourceRow: 3 }),
    ]);
    const definition = findTargetFieldDefinition('revenue');
    if (!definition) {
      throw new Error('Expected revenue target definition');
    }

    const resolution = resolveEvidenceConflict(
      await repository.listByProject('project-1'),
      definition.direction,
    );

    expect(resolution).toMatchObject({
      status: 'provisional',
      analysisValue: '100',
      selectedEvidenceId: 'low',
    });
  });

  it('resets an affected group to none when an overwrite makes values agree', async () => {
    await repository.saveMany([
      evidence('a', '100'),
      evidence('b', '120', { sourceRow: 3 }),
    ]);

    await repository.saveMany([
      evidence('b', '100', { sourceRow: 3, conflictStatus: 'resolved' }),
    ]);

    expect(
      (await repository.listByProject('project-1')).map(({ id, conflictStatus }) => ({
        id,
        conflictStatus,
      })),
    ).toEqual([
      { id: 'a', conflictStatus: 'none' },
      { id: 'b', conflictStatus: 'none' },
    ]);
  });

  it('recomputes both old and new identity groups when an ID moves', async () => {
    await repository.saveMany([
      evidence('a', '100'),
      evidence('b', '120', { sourceRow: 3 }),
    ]);

    await repository.saveMany([
      evidence('b', '120', { periodIdentity: '2024', sourceRow: 3 }),
    ]);

    expect(
      (await repository.listByProject('project-1')).map(
        ({ id, periodIdentity, conflictStatus }) => ({ id, periodIdentity, conflictStatus }),
      ),
    ).toEqual([
      { id: 'b', periodIdentity: '2024', conflictStatus: 'none' },
      { id: 'a', periodIdentity: '2025', conflictStatus: 'none' },
    ]);
  });

  it('isolates conflicts across project, field, period, and dimension identities', async () => {
    await repository.saveMany([
      evidence('base', '100'),
      evidence('other-project', '120', { projectId: 'project-2' }),
      evidence('other-field', '0.4', { fieldId: 'gross_margin' }),
      evidence('other-period', '120', { periodIdentity: '2024' }),
      evidence('other-dimension', '120', { dimensionIdentity: 'company=beta' }),
    ]);

    expect(
      [...await repository.listByProject('project-1'), ...await repository.listByProject('project-2')]
        .every((item) => item.conflictStatus === 'none'),
    ).toBe(true);
  });

  it('serializes concurrent writes and leaves the complete group unresolved', async () => {
    await Promise.all([
      repository.saveMany([evidence('a', '100')]),
      repository.saveMany([evidence('b', '120', { sourceRow: 3 })]),
    ]);

    expect(await db.evidence.count()).toBe(2);
    expect(
      (await repository.listByProject('project-1')).map((item) => item.conflictStatus),
    ).toEqual(['unresolved', 'unresolved']);
  });

  it('returns deterministic identity ordering independent of write order', async () => {
    await repository.saveMany([
      evidence('z', '1', { fieldId: 'net_profit', periodIdentity: '2025' }),
      evidence('c', '1', { fieldId: 'revenue', periodIdentity: '2025', dimensionIdentity: 'b' }),
      evidence('b', '1', { fieldId: 'revenue', periodIdentity: '2025', dimensionIdentity: 'a' }),
      evidence('a', '1', { fieldId: 'revenue', periodIdentity: '2024', dimensionIdentity: 'z' }),
    ]);

    expect((await repository.listByProject('project-1')).map(({ id }) => id)).toEqual([
      'z',
      'a',
      'b',
      'c',
    ]);
  });

  it('parses and deeply freezes evidence records when listing', async () => {
    await db.evidence.put(evidence('stored', '1,200.00', {
      sourceFragmentIds: ['fragment-1'],
      sourceType: 'document_fact',
      candidateId: 'candidate-1',
      sourceLocator: '第 1 页',
      reviewAudit: {
        originalCandidateValue: '1000',
        reviewedValue: '1200',
        reviewedAt: '2026-07-23T00:00:00Z',
      },
    }));

    const [stored] = await repository.listByProject('project-1');

    expect(stored?.normalizedValue).toBe('1200');
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored?.sourceFragmentIds)).toBe(true);
    expect(Object.isFrozen(stored?.reviewAudit)).toBe(true);
  });

  it('rejects malformed stored evidence with an invalid-evidence repository error', async () => {
    await db.evidence.put({
      ...evidence('malformed', '100'),
      normalizedValue: 'not-a-number',
    } as EvidenceItem);

    await expect(repository.listByProject('project-1')).rejects.toMatchObject({
      code: 'invalid-evidence',
    });
  });

  it('canonicalizes stored rows before grouping and persists canonical agreement', async () => {
    await db.evidence.put(evidence('stored-noncanonical', '1,000.00'));

    await repository.saveMany([
      evidence('incoming-canonical', '1000', { sourceRow: 3 }),
    ]);

    expect(await repository.listByProject('project-1')).toEqual([
      expect.objectContaining({
        id: 'incoming-canonical',
        normalizedValue: '1000',
        conflictStatus: 'none',
      }),
      expect.objectContaining({
        id: 'stored-noncanonical',
        normalizedValue: '1000',
        conflictStatus: 'none',
      }),
    ]);
    expect((await db.evidence.get('stored-noncanonical'))?.normalizedValue).toBe('1000');
  });

  it('rolls back a write when an affected stored evidence row is malformed', async () => {
    const malformed = {
      ...evidence('malformed-affected', '100'),
      normalizedValue: 'not-a-number',
    } as EvidenceItem;
    await db.evidence.put(malformed);

    await expect(repository.saveMany([
      evidence('incoming', '100', { sourceRow: 3 }),
    ])).rejects.toMatchObject({ code: 'invalid-evidence' });

    expect(await db.evidence.get('incoming')).toBeUndefined();
    expect(await db.evidence.get('malformed-affected')).toEqual(malformed);
  });

  it.each([
    ['immutable candidate field', (commit: CandidateReviewCommit) => ({
      ...commit,
      nextCandidate: { ...commit.nextCandidate, fieldId: 'net_profit' },
    })],
    ['confirmed review reason', (commit: CandidateReviewCommit) => ({
      ...commit,
      nextCandidate: { ...commit.nextCandidate, reviewReason: 'not allowed' },
    })],
    ['review timestamp mismatch', (commit: CandidateReviewCommit) => ({
      ...commit,
      nextCandidate: {
        ...commit.nextCandidate,
        updatedAt: '2026-07-23T03:00:00.000Z',
      },
    })],
    ['evidence field', (commit: CandidateReviewCommit) => ({
      ...commit,
      evidence: { ...commit.evidence!, fieldId: 'net_profit' },
    })],
    ['reviewed value', (commit: CandidateReviewCommit) => ({
      ...commit,
      evidence: {
        ...commit.evidence!,
        normalizedValue: '900',
        reviewAudit: {
          ...commit.evidence!.reviewAudit!,
          reviewedValue: '900',
        },
      },
    })],
    ['audit original value', (commit: CandidateReviewCommit) => ({
      ...commit,
      evidence: {
        ...commit.evidence!,
        reviewAudit: {
          ...commit.evidence!.reviewAudit!,
          originalCandidateValue: '900',
        },
      },
    })],
    ['source type', (commit: CandidateReviewCommit) => ({
      ...commit,
      evidence: { ...commit.evidence!, sourceType: 'management_forecast' as const },
    })],
    ['confidence', (commit: CandidateReviewCommit) => ({
      ...commit,
      evidence: { ...commit.evidence!, confidence: 0.2 },
    })],
    ['source sheet', (commit: CandidateReviewCommit) => ({
      ...commit,
      evidence: { ...commit.evidence!, sourceSheet: 'PPTX' },
    })],
    ['source row', (commit: CandidateReviewCommit) => ({
      ...commit,
      evidence: { ...commit.evidence!, sourceRow: 2 },
    })],
    ['source locator', (commit: CandidateReviewCommit) => ({
      ...commit,
      evidence: { ...commit.evidence!, sourceLocator: '第 2 页' },
    })],
    ['raw value', (commit: CandidateReviewCommit) => ({
      ...commit,
      evidence: { ...commit.evidence!, rawValue: 'Different raw value' },
    })],
    ['deterministic evidence id', (commit: CandidateReviewCommit) => ({
      ...commit,
      evidence: { ...commit.evidence!, id: 'candidate-evidence:wrong' },
    })],
    ['deterministic import batch id', (commit: CandidateReviewCommit) => ({
      ...commit,
      evidence: { ...commit.evidence!, importBatchId: 'document-candidate:wrong' },
    })],
  ])('rejects incoherent atomic review input: %s', async (_name, mutate) => {
    const expected = pendingCandidate();
    await db.documents.put(storedDocument());
    await db.sourceFragments.put(sourceFragment());
    await db.evidenceCandidates.put(expected);

    await expect(
      repository.commitCandidateReview(mutate(validReviewCommit())),
    ).rejects.toMatchObject({ code: 'invalid-review' });

    expect(await db.evidence.count()).toBe(0);
    expect(await db.evidenceCandidates.get(expected.id)).toEqual(expected);
    expect(await db.documents.get(expected.documentId)).toMatchObject({
      parseStatus: 'review',
    });
  });

  it('rewrites only canonical-changed or conflict-changed evidence rows', async () => {
    await db.evidence.bulkPut([
      evidence('stored-noncanonical-selective', '1,000.00'),
      evidence('unrelated-canonical', '50', {
        fieldId: 'net_profit',
        dimensionIdentity: 'company=other',
      }),
    ]);
    const bulkPut = vi.spyOn(db.evidence, 'bulkPut');

    await repository.saveMany([
      evidence('incoming-selective', '1000', { sourceRow: 3 }),
    ]);

    expect(bulkPut).toHaveBeenCalledTimes(2);
    expect(bulkPut.mock.calls[1]?.[0].map(({ id }) => id)).toEqual([
      'stored-noncanonical-selective',
    ]);
  });
});
