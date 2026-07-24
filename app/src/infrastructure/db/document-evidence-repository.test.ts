import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceFragment } from '../../domain/documents/source-fragment';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import { extractPdfFragments, type PdfDocumentAdapter } from '../import/pdf-extractor';
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

  it('treats createdAt as retry metadata and preserves the original stored timestamp', async () => {
    const original = fragment();
    await repository.saveExtraction('project-1', 'document-1', [original], []);
    const bulkPut = vi.spyOn(db.sourceFragments, 'bulkPut');
    await repository.saveExtraction('project-1', 'document-1', [{
      ...original,
      createdAt: '2026-07-24T00:00:00.000Z',
    }], []);

    expect(await repository.listFragments('project-1', 'document-1')).toEqual([original]);
    expect(bulkPut).not.toHaveBeenCalled();
  });

  it.each([
    ['text', {
      rawText: 'Changed raw text',
      normalizedText: 'Changed normalized text',
    }],
    ['hash', { contentHash: 'changed-hash' }],
    ['locator', { locator: { pageNumber: 2 } }],
    ['version', { documentVersionId: 'version-2' }],
  ] satisfies ReadonlyArray<readonly [string, Partial<SourceFragment>]>)(
    'still rejects same-id fragment collisions when %s changes',
    async (_label, overrides) => {
      const original = fragment();
      await repository.saveExtraction('project-1', 'document-1', [original], []);

      await expect(repository.saveExtraction(
        'project-1',
        'document-1',
        [{ ...original, ...overrides, createdAt: '2026-07-24T00:00:00.000Z' }],
        [],
      )).rejects.toMatchObject({ code: 'fragment-collision' });
    },
  );

  it('saves deterministic PDF retries from different clocks and keeps the first timestamp', async () => {
    const adapter: PdfDocumentAdapter = {
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: [{ str: 'Retry safe text' }] }),
      }),
      destroy: async () => undefined,
    };
    const extractionRequest = {
      projectId: 'project-1',
      documentId: 'document-1',
      documentVersionId: 'version-1',
      fileName: 'retry.pdf',
      kind: 'pdf' as const,
      data: new Uint8Array([1]),
    };
    const first = await extractPdfFragments(extractionRequest, {
      load: async () => adapter,
      now: () => new Date('2026-07-23T00:00:00.000Z'),
    });
    const second = await extractPdfFragments(extractionRequest, {
      load: async () => adapter,
      now: () => new Date('2026-07-24T00:00:00.000Z'),
    });
    expect(first.fragments[0]?.id).toBe(second.fragments[0]?.id);
    expect(first.fragments[0]?.createdAt).not.toBe(second.fragments[0]?.createdAt);

    await repository.saveExtraction(
      'project-1',
      'document-1',
      first.fragments,
      [],
    );
    await repository.saveExtraction(
      'project-1',
      'document-1',
      second.fragments,
      [],
    );

    expect((await repository.listFragments('project-1', 'document-1'))[0]?.createdAt)
      .toBe('2026-07-23T00:00:00.000Z');
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

  it('rolls back all prior extraction state when a candidate table write fails', async () => {
    const oldFragment = fragment('old-fragment');
    const oldCandidate = candidate('old-candidate', {
      sourceFragmentIds: ['old-fragment'],
    });
    await repository.saveExtraction(
      'project-1',
      'document-1',
      [oldFragment],
      [oldCandidate],
    );
    const beforeDocument = await db.documents.get('document-1');
    vi.spyOn(db.evidenceCandidates, 'bulkPut').mockRejectedValueOnce(new Error('write failed'));

    await expect(
      repository.saveExtraction(
        'project-1',
        'document-1',
        [fragment('new-fragment')],
        [candidate('new-candidate', { sourceFragmentIds: ['new-fragment'] })],
      ),
    ).rejects.toThrow('write failed');

    expect(await repository.listFragments('project-1', 'document-1')).toEqual([oldFragment]);
    expect(await repository.listCandidates('project-1', 'document-1')).toEqual([oldCandidate]);
    expect(await db.documents.get('document-1')).toEqual(beforeDocument);
  });

  it('rejects changed content for an immutable fragment id without losing reviewed provenance', async () => {
    const originalFragment = fragment();
    await repository.saveExtraction(
      'project-1',
      'document-1',
      [originalFragment],
      [candidate()],
    );
    const reviewed = candidate('candidate-1', {
      reviewStatus: 'confirmed',
      reviewedAt: '2026-07-23T01:00:00.000Z',
      updatedAt: '2026-07-23T01:00:00.000Z',
    });
    await repository.setCandidate(reviewed);
    const beforeDocument = await db.documents.get('document-1');

    await expect(
      repository.saveExtraction(
        'project-1',
        'document-1',
        [fragment('fragment-1', {
          rawText: 'Changed raw text',
          normalizedText: 'Changed normalized text',
          contentHash: 'changed-hash',
        })],
        [],
      ),
    ).rejects.toMatchObject({ code: 'fragment-collision' });

    expect(await repository.listFragments('project-1', 'document-1')).toEqual([
      originalFragment,
    ]);
    expect(await repository.getCandidate('project-1', 'candidate-1')).toEqual(reviewed);
    expect(await db.documents.get('document-1')).toEqual(beforeDocument);
  });

  it('removes stale machine candidates and unreferenced fragments on an empty reparse', async () => {
    await repository.saveExtraction('project-1', 'document-1', [fragment()], [candidate()]);

    await repository.saveExtraction('project-1', 'document-1', [], []);

    expect(await repository.listFragments('project-1', 'document-1')).toEqual([]);
    expect(await repository.listCandidates('project-1', 'document-1')).toEqual([]);
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'partial' });
  });

  it('preserves a terminal candidate and its fragment and keeps complete after an empty reparse', async () => {
    const retainedFragment = fragment();
    await repository.saveExtraction(
      'project-1',
      'document-1',
      [retainedFragment],
      [candidate()],
    );
    const terminal = candidate('candidate-1', {
      reviewStatus: 'confirmed',
      reviewedAt: '2026-07-23T01:00:00.000Z',
      updatedAt: '2026-07-23T01:00:00.000Z',
    });
    await repository.setCandidate(terminal);

    await repository.saveExtraction('project-1', 'document-1', [], []);

    expect(await repository.listFragments('project-1', 'document-1')).toEqual([
      retainedFragment,
    ]);
    expect(await repository.listCandidates('project-1', 'document-1')).toEqual([terminal]);
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'complete' });
  });

  it('derives partial from a preserved terminal candidate plus incoming machine output', async () => {
    await repository.saveExtraction('project-1', 'document-1', [fragment()], [candidate()]);
    const terminal = candidate('candidate-1', {
      reviewStatus: 'confirmed',
      reviewedAt: '2026-07-23T01:00:00.000Z',
      updatedAt: '2026-07-23T01:00:00.000Z',
    });
    await repository.setCandidate(terminal);
    const incomingFragment = fragment('fragment-2');
    const incomingCandidate = candidate('candidate-2', {
      sourceFragmentIds: ['fragment-2'],
    });

    await repository.saveExtraction(
      'project-1',
      'document-1',
      [incomingFragment],
      [incomingCandidate],
    );

    expect(await repository.listFragments('project-1', 'document-1')).toEqual([
      fragment(),
      incomingFragment,
    ]);
    expect(await repository.listCandidates('project-1', 'document-1')).toEqual([
      terminal,
      incomingCandidate,
    ]);
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'partial' });
  });

  it('allows an incoming machine candidate to reuse a fingerprint released by stale output', async () => {
    const retainedFragment = fragment();
    await repository.saveExtraction(
      'project-1',
      'document-1',
      [retainedFragment],
      [candidate('stale-candidate', { candidateFingerprint: 'shared-fingerprint' })],
    );
    const replacement = candidate('replacement-candidate', {
      candidateFingerprint: 'shared-fingerprint',
    });

    await repository.saveExtraction(
      'project-1',
      'document-1',
      [retainedFragment],
      [replacement],
    );

    expect(await repository.listCandidates('project-1', 'document-1')).toEqual([replacement]);
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'review' });
  });

  it('rejects an extraction candidate whose source fragment is missing', async () => {
    await expect(
      repository.saveExtraction(
        'project-1',
        'document-1',
        [fragment()],
        [candidate('candidate-1', { sourceFragmentIds: ['missing-fragment'] })],
      ),
    ).rejects.toMatchObject({ code: 'invalid-fragment-reference' });

    expect(await repository.listFragments('project-1', 'document-1')).toEqual([]);
    expect(await repository.listCandidates('project-1', 'document-1')).toEqual([]);
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'unparsed' });
  });

  it('rejects an extraction candidate whose source fragment belongs to another project', async () => {
    await db.sourceFragments.put(fragment('cross-fragment', {
      projectId: 'project-2',
      documentId: 'other-document',
    }));

    await expect(
      repository.saveExtraction(
        'project-1',
        'document-1',
        [],
        [candidate('candidate-1', { sourceFragmentIds: ['cross-fragment'] })],
      ),
    ).rejects.toMatchObject({ code: 'invalid-fragment-reference' });

    expect(await repository.listCandidates('project-1', 'document-1')).toEqual([]);
    expect(await db.documents.get('document-1')).toMatchObject({ parseStatus: 'unparsed' });
  });

  it('rejects setCandidate when a source fragment is missing and preserves review state', async () => {
    const original = candidate();
    await repository.saveExtraction('project-1', 'document-1', [fragment()], [original]);
    const beforeDocument = await db.documents.get('document-1');

    await expect(
      repository.setCandidate(candidate('candidate-1', {
        normalizedValue: '200',
        sourceFragmentIds: ['missing-fragment'],
        updatedAt: '2026-07-23T01:00:00.000Z',
      })),
    ).rejects.toMatchObject({ code: 'invalid-fragment-reference' });

    expect(await repository.getCandidate('project-1', 'candidate-1')).toEqual(original);
    expect(await db.documents.get('document-1')).toEqual(beforeDocument);
  });

  it('rejects setCandidate when a source fragment belongs to another project', async () => {
    const original = candidate();
    await repository.saveExtraction('project-1', 'document-1', [fragment()], [original]);
    await db.sourceFragments.put(fragment('cross-fragment', {
      documentId: 'other-document',
      projectId: 'project-2',
    }));
    const beforeDocument = await db.documents.get('document-1');

    await expect(
      repository.setCandidate(candidate('candidate-1', {
        normalizedValue: '200',
        sourceFragmentIds: ['cross-fragment'],
        updatedAt: '2026-07-23T01:00:00.000Z',
      })),
    ).rejects.toMatchObject({ code: 'invalid-fragment-reference' });

    expect(await repository.getCandidate('project-1', 'candidate-1')).toEqual(original);
    expect(await db.documents.get('document-1')).toEqual(beforeDocument);
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

  it('rejects a fingerprint owned by a terminal candidate without partial writes', async () => {
    await db.sourceFragments.put(fragment());
    await db.evidenceCandidates.put(candidate('existing', {
      reviewStatus: 'confirmed',
      reviewedAt: '2026-07-23T01:00:00.000Z',
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

    expect(await db.sourceFragments.count()).toBe(1);
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
    const where = vi.spyOn(db.evidenceCandidates, 'where');
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
    expect(where).toHaveBeenCalledWith('[projectId+documentId]');
    expect(Object.isFrozen(fragments[0])).toBe(true);
    expect(Object.isFrozen(fragments[0]!.locator)).toBe(true);
    expect(Object.isFrozen(projectCandidates[0])).toBe(true);
    expect(Object.isFrozen(projectCandidates[0]!.sourceFragmentIds)).toBe(true);
  });

  it('sorts fragments by table index before object names and ids', async () => {
    await db.sourceFragments.bulkPut([
      fragment('z-table-one', {
        locator: { pageNumber: 1, tableIndex: 1, objectName: 'z-object' },
      }),
      fragment('a-table-two', {
        locator: { pageNumber: 1, tableIndex: 2, objectName: 'a-object' },
      }),
    ]);

    expect(
      (await repository.listFragments('project-1', 'document-1')).map(({ id }) => id),
    ).toEqual(['z-table-one', 'a-table-two']);
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
  it('counts only pending and conflicted candidates for the requested project', async () => {
    await db.evidenceCandidates.bulkPut([
      candidate('pending'),
      candidate('conflicted', { reviewStatus: 'conflicted' }),
      candidate('confirmed', {
        reviewStatus: 'confirmed',
        reviewedAt: '2026-07-23T01:00:00.000Z',
      }),
      candidate('corrected', {
        reviewStatus: 'corrected',
        correctedValue: '110',
        reviewReason: 'Adjusted',
        reviewedAt: '2026-07-23T01:00:00.000Z',
      }),
      candidate('rejected', {
        reviewStatus: 'rejected',
        reviewReason: 'Irrelevant',
        reviewedAt: '2026-07-23T01:00:00.000Z',
      }),
      candidate('other-project', {
        projectId: 'project-2',
        documentId: 'other-document',
      }),
    ]);
    const listCandidates = vi.spyOn(repository, 'listCandidates');

    await expect(repository.countPendingByProject(' project-1 ')).resolves.toBe(2);
    expect(listCandidates).not.toHaveBeenCalled();
    await expect(repository.countPendingByProject('project-2')).resolves.toBe(1);
  });

});
