import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceFragment } from '../../domain/documents/source-fragment';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import { AppDb, type StoredDocument } from './app-db';
import {
  DocumentEvidenceRepository,
  DocumentEvidenceRepositoryError,
} from './document-evidence-repository';

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
    normalizedValue: '100',
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

describe('AppDb v2 migration', () => {
  const databaseNames: string[] = [];

  afterEach(async () => {
    await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
  });

  it('migrates stored documents to unparsed and creates usable extraction tables', async () => {
    const name = `app-db-migration-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const legacyDb = new Dexie(name);
    legacyDb.version(1).stores({
      projects: 'id, updatedAt, status, name',
      evidence: 'id, projectId, fieldId, conflictStatus, updatedAt',
      documents: 'id, projectId, uploadedAt, mimeType',
    });
    await legacyDb.table('documents').put({
      ...document(),
      parseStatus: 'stored',
      parseErrorCode: '',
    });
    legacyDb.close();

    const db = new AppDb(name);
    await db.open();

    const migrated = await db.documents.get('document-1');
    expect(migrated).toMatchObject({ parseStatus: 'unparsed' });
    expect(migrated).not.toHaveProperty('parseErrorCode');
    await db.sourceFragments.put(fragment());
    await db.evidenceCandidates.put(candidate());
    expect(await db.sourceFragments.count()).toBe(1);
    expect(await db.evidenceCandidates.count()).toBe(1);
    db.close();
  });
});

describe('DocumentEvidenceRepository', () => {
  let db: AppDb;
  let repository: DocumentEvidenceRepository;

  beforeEach(async () => {
    db = new AppDb(`document-evidence-${crypto.randomUUID()}`);
    repository = new DocumentEvidenceRepository(db);
    await db.documents.put(document());
  });

  afterEach(async () => {
    await db.delete();
  });

  it('marks a document as parsing and clears its previous error', async () => {
    await db.documents.update('document-1', {
      parseStatus: 'failed',
      parseErrorCode: 'old-error',
    });

    await repository.markParsing(' project-1 ', ' document-1 ');

    const stored = await db.documents.get('document-1');
    expect(stored).toMatchObject({ parseStatus: 'parsing' });
    expect(stored).not.toHaveProperty('parseErrorCode');
  });

  it('saves the same extraction idempotently and marks it for review', async () => {
    await repository.saveExtraction('project-1', 'document-1', [fragment()], [candidate()]);
    await repository.saveExtraction('project-1', 'document-1', [fragment()], [candidate()]);

    expect(await db.sourceFragments.count()).toBe(1);
    expect(await db.evidenceCandidates.count()).toBe(1);
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'review' });
  });

  it('keeps fragments and marks an extraction partial when it has no candidates', async () => {
    await repository.saveExtraction('project-1', 'document-1', [fragment()], []);

    expect(await repository.listFragments('project-1', 'document-1')).toHaveLength(1);
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'partial' });
  });

  it('rejects project mismatches before writing anything', async () => {
    await expect(
      repository.saveExtraction(
        'project-1',
        'document-1',
        [fragment('fragment-wrong', { projectId: 'project-2' })],
        [candidate()],
      ),
    ).rejects.toMatchObject({ code: 'project-mismatch' });

    expect(await db.sourceFragments.count()).toBe(0);
    expect(await db.evidenceCandidates.count()).toBe(0);
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'unparsed' });
  });

  it('marks failed extraction without deleting previous extraction records', async () => {
    await repository.saveExtraction('project-1', 'document-1', [fragment()], [candidate()]);

    await repository.markFailed('project-1', 'document-1', ' parser-timeout ');

    expect(await db.documents.get('document-1')).toMatchObject({
      parseStatus: 'failed',
      parseErrorCode: 'parser-timeout',
    });
    expect(await db.sourceFragments.count()).toBe(1);
    expect(await db.evidenceCandidates.count()).toBe(1);
  });

  it('rolls back fragments and status when a candidate table write fails', async () => {
    await repository.markParsing('project-1', 'document-1');
    vi.spyOn(db.evidenceCandidates, 'bulkPut').mockRejectedValueOnce(new Error('write failed'));

    await expect(
      repository.saveExtraction('project-1', 'document-1', [fragment()], [candidate()]),
    ).rejects.toThrow('write failed');

    expect(await db.sourceFragments.count()).toBe(0);
    expect(await db.evidenceCandidates.count()).toBe(0);
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'parsing' });
  });

  it.each(['confirmed', 'corrected', 'rejected'] as const)(
    'preserves a %s candidate when the document is reparsed',
    async (reviewStatus) => {
      const reviewed = candidate('candidate-1', {
        reviewStatus,
        ...(reviewStatus === 'corrected' ? { correctedValue: '90', reviewReason: 'Adjusted' } : {}),
        ...(reviewStatus === 'rejected' ? { reviewReason: 'Duplicate' } : {}),
        reviewedAt: '2026-07-23T01:00:00.000Z',
        updatedAt: '2026-07-23T01:00:00.000Z',
      });
      await db.evidenceCandidates.put(reviewed);

      await repository.saveExtraction(
        'project-1',
        'document-1',
        [fragment()],
        [candidate('candidate-1', { normalizedValue: '200', updatedAt: '2026-07-23T02:00:00.000Z' })],
      );

      expect(await repository.getCandidate('project-1', 'candidate-1')).toEqual(reviewed);
    },
  );

  it('refreshes a pending candidate deterministically on reparse', async () => {
    await repository.saveExtraction('project-1', 'document-1', [fragment()], [candidate()]);
    const refreshed = candidate('candidate-1', {
      normalizedValue: '200',
      confidence: 0.9,
      updatedAt: '2026-07-23T02:00:00.000Z',
    });

    await repository.saveExtraction('project-1', 'document-1', [fragment()], [refreshed]);

    expect(await repository.getCandidate('project-1', 'candidate-1')).toEqual(refreshed);
  });

  it('rejects a duplicate fingerprint on a different candidate id without partial writes', async () => {
    await db.evidenceCandidates.put(candidate('existing', {
      candidateFingerprint: 'shared-fingerprint',
    }));

    await expect(
      repository.saveExtraction(
        'project-1',
        'document-1',
        [fragment()],
        [candidate('new-id', { candidateFingerprint: 'shared-fingerprint' })],
      ),
    ).rejects.toMatchObject({ code: 'duplicate-extraction' });

    expect(await db.sourceFragments.count()).toBe(0);
    expect(await db.evidenceCandidates.count()).toBe(1);
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'unparsed' });
  });

  it('returns project-isolated, sorted, validated, deeply frozen records', async () => {
    await db.documents.put(document('document-2'));
    await db.documents.put(document('other-document', 'project-2'));
    await db.sourceFragments.bulkPut([
      fragment('z', { locator: { pageNumber: 2 } }),
      fragment('c', { locator: { pageNumber: 1, tableRow: 2 } }),
      fragment('b', { locator: { pageNumber: 1, tableRow: 1, tableColumn: 2 } }),
      fragment('a', { locator: { pageNumber: 1, tableRow: 1, tableColumn: 1 } }),
      fragment('other-project', { projectId: 'project-2', documentId: 'other-document' }),
    ]);
    await db.evidenceCandidates.bulkPut([
      candidate('z', { fieldId: 'net_profit' }),
      candidate('c', { periodIdentity: '2025', dimensionIdentity: 'b' }),
      candidate('b', { periodIdentity: '2025', dimensionIdentity: 'a' }),
      candidate('a', { periodIdentity: '2024' }),
      candidate('document-2-candidate', { documentId: 'document-2' }),
      candidate('other-project-candidate', {
        projectId: 'project-2',
        documentId: 'other-document',
      }),
    ]);

    const fragments = await repository.listFragments('project-1', 'document-1');
    const projectCandidates = await repository.listCandidates('project-1');
    const documentCandidates = await repository.listCandidates('project-1', 'document-1');

    expect(fragments.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'z']);
    expect(projectCandidates.map(({ id }) => id)).toEqual([
      'z',
      'a',
      'b',
      'c',
      'document-2-candidate',
    ]);
    expect(documentCandidates.map(({ id }) => id)).toEqual(['z', 'a', 'b', 'c']);
    expect(Object.isFrozen(fragments[0])).toBe(true);
    expect(Object.isFrozen(fragments[0]!.locator)).toBe(true);
    expect(Object.isFrozen(projectCandidates[0])).toBe(true);
    expect(Object.isFrozen(projectCandidates[0]!.sourceFragmentIds)).toBe(true);
  });

  it('rejects malformed stored records instead of leaking them', async () => {
    await db.sourceFragments.put({ ...fragment(), rawText: '' });

    await expect(repository.listFragments('project-1', 'document-1')).rejects.toThrow();
  });

  it('moves document status from review to partial to complete as candidates are reviewed', async () => {
    await repository.saveExtraction(
      'project-1',
      'document-1',
      [fragment()],
      [candidate('candidate-1'), candidate('candidate-2')],
    );
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'review' });

    await repository.setCandidate(candidate('candidate-1', {
      reviewStatus: 'confirmed',
      reviewedAt: '2026-07-23T01:00:00.000Z',
      updatedAt: '2026-07-23T01:00:00.000Z',
    }));
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'partial' });

    await repository.setCandidate(candidate('candidate-2', {
      reviewStatus: 'rejected',
      reviewReason: 'Not relevant',
      reviewedAt: '2026-07-23T01:00:00.000Z',
      updatedAt: '2026-07-23T01:00:00.000Z',
    }));
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'complete' });
  });

  it('does not allow setCandidate to move an existing candidate to another document', async () => {
    await db.documents.put(document('document-2'));
    await repository.saveExtraction('project-1', 'document-1', [fragment()], [candidate()]);

    await expect(
      repository.setCandidate(candidate('candidate-1', { documentId: 'document-2' })),
    ).rejects.toMatchObject({ code: 'project-mismatch' });

    expect((await db.evidenceCandidates.get('candidate-1'))?.documentId).toBe('document-1');
  });

  it.each([
    ['markParsing', () => repository.markParsing(' ', 'document-1'), 'invalid-project'],
    ['markParsing', () => repository.markParsing('project-1', ' '), 'invalid-document'],
    ['markFailed', () => repository.markFailed('project-1', 'document-1', ' '), 'invalid-error-code'],
    [
      'markFailed',
      () => repository.markFailed('project-1', 'document-1', 'x'.repeat(129)),
      'invalid-error-code',
    ],
  ])('validates identifiers for %s', async (_name, operation, code) => {
    const error = await operation().then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(DocumentEvidenceRepositoryError);
    expect(error).toMatchObject({ code });
  });

  it('rejects missing documents and stored project mismatches', async () => {
    await expect(repository.markParsing('project-1', 'missing')).rejects.toMatchObject({
      code: 'document-not-found',
    });
    await expect(repository.markParsing('project-2', 'document-1')).rejects.toMatchObject({
      code: 'project-mismatch',
    });
  });
});
