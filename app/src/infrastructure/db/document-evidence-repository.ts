import type { SourceFragment } from '../../domain/documents/source-fragment';
import { parseSourceFragment } from '../../domain/documents/source-fragment.schema';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import { parseEvidenceCandidate } from '../../domain/evidence/evidence-candidate.schema';
import type { AppDb, DocumentParseStatus, StoredDocument } from './app-db';

export type DocumentEvidenceRepositoryErrorCode =
  | 'invalid-project'
  | 'invalid-document'
  | 'document-not-found'
  | 'project-mismatch'
  | 'invalid-fragment'
  | 'invalid-candidate'
  | 'candidate-not-found'
  | 'invalid-error-code'
  | 'duplicate-extraction';

export class DocumentEvidenceRepositoryError extends Error {
  readonly code: DocumentEvidenceRepositoryErrorCode;
  override readonly cause: unknown;

  constructor(
    code: DocumentEvidenceRepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'DocumentEvidenceRepositoryError';
    this.code = code;
    this.cause = cause;
  }
}

const TERMINAL_REVIEW_STATUSES = new Set(['confirmed', 'corrected', 'rejected']);
const MAX_ERROR_CODE_LENGTH = 128;

function normalizeIdentifier(
  value: string,
  code: 'invalid-project' | 'invalid-document',
): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new DocumentEvidenceRepositoryError(code, 'A non-empty identifier is required.');
  }
  return normalized;
}

function normalizeErrorCode(errorCode: string): string {
  const normalized = typeof errorCode === 'string' ? errorCode.trim() : '';
  if (!normalized || normalized.length > MAX_ERROR_CODE_LENGTH) {
    throw new DocumentEvidenceRepositoryError(
      'invalid-error-code',
      `Error code must contain between 1 and ${MAX_ERROR_CODE_LENGTH} characters.`,
    );
  }
  return normalized;
}

function validateFragment(input: unknown): SourceFragment {
  try {
    return parseSourceFragment(input);
  } catch (error) {
    throw new DocumentEvidenceRepositoryError(
      'invalid-fragment',
      'Source fragment validation failed.',
      error,
    );
  }
}

function validateCandidate(input: unknown): EvidenceCandidate {
  try {
    return parseEvidenceCandidate(input);
  } catch (error) {
    throw new DocumentEvidenceRepositoryError(
      'invalid-candidate',
      'Evidence candidate validation failed.',
      error,
    );
  }
}

function assertExtractionIdentity(
  record: Pick<SourceFragment | EvidenceCandidate, 'projectId' | 'documentId'>,
  projectId: string,
  documentId: string,
): void {
  if (record.projectId !== projectId || record.documentId !== documentId) {
    throw new DocumentEvidenceRepositoryError(
      'project-mismatch',
      'Extraction record does not belong to the requested project and document.',
    );
  }
}

function updatedDocument(
  document: StoredDocument,
  parseStatus: DocumentParseStatus,
  parseErrorCode?: string,
): StoredDocument {
  const updated = { ...document, parseStatus, parseErrorCode };
  if (parseErrorCode === undefined) {
    delete updated.parseErrorCode;
  }
  return updated;
}

function deriveStatus(candidates: readonly EvidenceCandidate[]): DocumentParseStatus {
  if (candidates.length === 0) {
    return 'partial';
  }

  const terminalCount = candidates.filter(({ reviewStatus }) =>
    TERMINAL_REVIEW_STATUSES.has(reviewStatus),
  ).length;
  if (terminalCount === 0) {
    return 'review';
  }
  if (terminalCount === candidates.length) {
    return 'complete';
  }
  return 'partial';
}

function compareOptionalNumber(left?: number, right?: number): number {
  return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
}

function compareFragments(left: SourceFragment, right: SourceFragment): number {
  return (
    compareOptionalNumber(
      left.locator.pageNumber ?? left.locator.slideNumber,
      right.locator.pageNumber ?? right.locator.slideNumber,
    ) ||
    compareOptionalNumber(left.locator.tableRow, right.locator.tableRow) ||
    compareOptionalNumber(left.locator.tableColumn, right.locator.tableColumn) ||
    (left.locator.objectId ?? left.locator.objectName ?? '').localeCompare(
      right.locator.objectId ?? right.locator.objectName ?? '',
    ) ||
    left.id.localeCompare(right.id)
  );
}

function compareCandidates(left: EvidenceCandidate, right: EvidenceCandidate): number {
  return (
    left.documentId.localeCompare(right.documentId) ||
    left.fieldId.localeCompare(right.fieldId) ||
    left.periodIdentity.localeCompare(right.periodIdentity) ||
    left.dimensionIdentity.localeCompare(right.dimensionIdentity) ||
    left.id.localeCompare(right.id)
  );
}

function hasErrorName(error: unknown, name: string, seen = new Set<unknown>()): boolean {
  if (!error || typeof error !== 'object' || seen.has(error)) {
    return false;
  }
  seen.add(error);
  const candidate = error as { name?: unknown; cause?: unknown; inner?: unknown };
  return (
    candidate.name === name ||
    hasErrorName(candidate.cause, name, seen) ||
    hasErrorName(candidate.inner, name, seen)
  );
}

function translateExtractionError(error: unknown): never {
  if (error instanceof DocumentEvidenceRepositoryError) {
    throw error;
  }
  if (hasErrorName(error, 'ConstraintError')) {
    throw new DocumentEvidenceRepositoryError(
      'duplicate-extraction',
      'Candidate fingerprint already belongs to another candidate.',
      error,
    );
  }
  throw error;
}

export class DocumentEvidenceRepository {
  private readonly db: AppDb;

  constructor(db: AppDb) {
    this.db = db;
  }

  async markParsing(projectId: string, documentId: string): Promise<void> {
    const normalizedProjectId = normalizeIdentifier(projectId, 'invalid-project');
    const normalizedDocumentId = normalizeIdentifier(documentId, 'invalid-document');

    await this.db.transaction('rw', this.db.documents, async () => {
      const document = await this.requireDocument(normalizedProjectId, normalizedDocumentId);
      await this.db.documents.put(updatedDocument(document, 'parsing'));
    });
  }

  async saveExtraction(
    projectId: string,
    documentId: string,
    fragments: readonly SourceFragment[],
    candidates: readonly EvidenceCandidate[],
  ): Promise<void> {
    const normalizedProjectId = normalizeIdentifier(projectId, 'invalid-project');
    const normalizedDocumentId = normalizeIdentifier(documentId, 'invalid-document');
    const validatedFragments = fragments.map(validateFragment);
    const validatedCandidates = candidates.map(validateCandidate);

    validatedFragments.forEach((record) =>
      assertExtractionIdentity(record, normalizedProjectId, normalizedDocumentId),
    );
    validatedCandidates.forEach((record) =>
      assertExtractionIdentity(record, normalizedProjectId, normalizedDocumentId),
    );
    this.assertUniqueBatchFingerprints(validatedCandidates);

    try {
      await this.db.transaction(
        'rw',
        this.db.documents,
        this.db.sourceFragments,
        this.db.evidenceCandidates,
        async () => {
          const document = await this.requireDocument(
            normalizedProjectId,
            normalizedDocumentId,
          );
          await this.assertFragmentIdentities(validatedFragments);
          const candidatesToWrite = await this.prepareCandidates(validatedCandidates);

          if (validatedFragments.length > 0) {
            await this.db.sourceFragments.bulkPut(validatedFragments);
          }
          if (candidatesToWrite.length > 0) {
            await this.db.evidenceCandidates.bulkPut(candidatesToWrite);
          }
          await this.db.documents.put(
            updatedDocument(document, validatedCandidates.length > 0 ? 'review' : 'partial'),
          );
        },
      );
    } catch (error) {
      translateExtractionError(error);
    }
  }

  async markFailed(projectId: string, documentId: string, errorCode: string): Promise<void> {
    const normalizedProjectId = normalizeIdentifier(projectId, 'invalid-project');
    const normalizedDocumentId = normalizeIdentifier(documentId, 'invalid-document');
    const normalizedErrorCode = normalizeErrorCode(errorCode);

    await this.db.transaction('rw', this.db.documents, async () => {
      const document = await this.requireDocument(normalizedProjectId, normalizedDocumentId);
      await this.db.documents.put(updatedDocument(document, 'failed', normalizedErrorCode));
    });
  }

  async listFragments(projectId: string, documentId: string): Promise<SourceFragment[]> {
    const normalizedProjectId = normalizeIdentifier(projectId, 'invalid-project');
    const normalizedDocumentId = normalizeIdentifier(documentId, 'invalid-document');
    const records = await this.db.sourceFragments
      .where('[projectId+documentId]')
      .equals([normalizedProjectId, normalizedDocumentId])
      .toArray();

    return records.map(validateFragment).sort(compareFragments);
  }

  async listCandidates(projectId: string, documentId?: string): Promise<EvidenceCandidate[]> {
    const normalizedProjectId = normalizeIdentifier(projectId, 'invalid-project');
    const normalizedDocumentId =
      documentId === undefined ? undefined : normalizeIdentifier(documentId, 'invalid-document');
    const records = await this.db.evidenceCandidates
      .where('projectId')
      .equals(normalizedProjectId)
      .toArray();

    return records
      .filter((record) =>
        normalizedDocumentId === undefined ? true : record.documentId === normalizedDocumentId,
      )
      .map(validateCandidate)
      .sort(compareCandidates);
  }

  async getCandidate(
    projectId: string,
    candidateId: string,
  ): Promise<EvidenceCandidate | undefined> {
    const normalizedProjectId = normalizeIdentifier(projectId, 'invalid-project');
    const normalizedCandidateId = candidateId.trim();
    if (!normalizedCandidateId) {
      throw new DocumentEvidenceRepositoryError('invalid-candidate', 'Candidate id is required.');
    }
    const record = await this.db.evidenceCandidates.get(normalizedCandidateId);
    if (!record || record.projectId !== normalizedProjectId) {
      return undefined;
    }
    return validateCandidate(record);
  }

  async setCandidate(candidate: EvidenceCandidate): Promise<void> {
    const validated = validateCandidate(candidate);

    try {
      await this.db.transaction(
        'rw',
        this.db.documents,
        this.db.evidenceCandidates,
        async () => {
          const document = await this.requireDocument(validated.projectId, validated.documentId);
          const existing = await this.db.evidenceCandidates.get(validated.id);
          if (!existing) {
            throw new DocumentEvidenceRepositoryError(
              'candidate-not-found',
              'The candidate does not exist.',
            );
          }
          if (
            existing.projectId !== validated.projectId ||
            existing.documentId !== validated.documentId
          ) {
            throw new DocumentEvidenceRepositoryError(
              'project-mismatch',
              'A candidate cannot be moved to another project or document.',
            );
          }
          await this.assertCandidateFingerprint(validated);
          await this.db.evidenceCandidates.put(validated);
          const candidates = await this.loadValidatedDocumentCandidates(
            validated.projectId,
            validated.documentId,
          );
          await this.db.documents.put(updatedDocument(document, deriveStatus(candidates)));
        },
      );
    } catch (error) {
      translateExtractionError(error);
    }
  }

  async refreshDocumentStatus(projectId: string, documentId: string): Promise<void> {
    const normalizedProjectId = normalizeIdentifier(projectId, 'invalid-project');
    const normalizedDocumentId = normalizeIdentifier(documentId, 'invalid-document');

    await this.db.transaction(
      'rw',
      this.db.documents,
      this.db.evidenceCandidates,
      async () => {
        const document = await this.requireDocument(
          normalizedProjectId,
          normalizedDocumentId,
        );
        const candidates = await this.loadValidatedDocumentCandidates(
          normalizedProjectId,
          normalizedDocumentId,
        );
        await this.db.documents.put(updatedDocument(document, deriveStatus(candidates)));
      },
    );
  }

  private async requireDocument(projectId: string, documentId: string): Promise<StoredDocument> {
    const document = await this.db.documents.get(documentId);
    if (!document) {
      throw new DocumentEvidenceRepositoryError(
        'document-not-found',
        'The requested document does not exist.',
      );
    }
    if (document.projectId !== projectId) {
      throw new DocumentEvidenceRepositoryError(
        'project-mismatch',
        'The document belongs to another project.',
      );
    }
    return document;
  }

  private assertUniqueBatchFingerprints(candidates: readonly EvidenceCandidate[]): void {
    const fingerprintOwners = new Map<string, string>();
    for (const candidate of candidates) {
      const owner = fingerprintOwners.get(candidate.candidateFingerprint);
      if (owner !== undefined && owner !== candidate.id) {
        throw new DocumentEvidenceRepositoryError(
          'duplicate-extraction',
          'A candidate fingerprint cannot belong to multiple candidate ids.',
        );
      }
      fingerprintOwners.set(candidate.candidateFingerprint, candidate.id);
    }
  }

  private async assertFragmentIdentities(fragments: readonly SourceFragment[]): Promise<void> {
    const existing = await this.db.sourceFragments.bulkGet(fragments.map(({ id }) => id));
    existing.forEach((record, index) => {
      if (
        record &&
        (record.projectId !== fragments[index]!.projectId ||
          record.documentId !== fragments[index]!.documentId)
      ) {
        throw new DocumentEvidenceRepositoryError(
          'project-mismatch',
          'A source fragment cannot be moved to another project or document.',
        );
      }
    });
  }

  private async prepareCandidates(
    candidates: readonly EvidenceCandidate[],
  ): Promise<EvidenceCandidate[]> {
    const result: EvidenceCandidate[] = [];
    for (const candidate of candidates) {
      await this.assertCandidateFingerprint(candidate);
      const existing = await this.db.evidenceCandidates.get(candidate.id);
      if (
        existing &&
        (existing.projectId !== candidate.projectId || existing.documentId !== candidate.documentId)
      ) {
        throw new DocumentEvidenceRepositoryError(
          'project-mismatch',
          'A candidate cannot be moved to another project or document.',
        );
      }
      if (existing && TERMINAL_REVIEW_STATUSES.has(existing.reviewStatus)) {
        continue;
      }
      result.push(candidate);
    }
    return result;
  }

  private async assertCandidateFingerprint(candidate: EvidenceCandidate): Promise<void> {
    const existing = await this.db.evidenceCandidates
      .where('candidateFingerprint')
      .equals(candidate.candidateFingerprint)
      .first();
    if (existing && existing.id !== candidate.id) {
      throw new DocumentEvidenceRepositoryError(
        'duplicate-extraction',
        'Candidate fingerprint already belongs to another candidate.',
      );
    }
  }

  private async loadValidatedDocumentCandidates(
    projectId: string,
    documentId: string,
  ): Promise<EvidenceCandidate[]> {
    const records = await this.db.evidenceCandidates
      .where('[projectId+documentId]')
      .equals([projectId, documentId])
      .toArray();
    return records.map(validateCandidate);
  }
}
