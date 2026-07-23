import type { SourceFragment } from '../../domain/documents/source-fragment';
import { parseSourceFragment } from '../../domain/documents/source-fragment.schema';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import { parseEvidenceCandidate } from '../../domain/evidence/evidence-candidate.schema';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import { parseEvidenceItem } from '../../domain/evidence/evidence.schema';
import { resolveEvidenceConflict } from '../../domain/evidence/resolve-conflict';
import {
  CandidateReviewDerivationError,
  deriveCandidateReview,
  evidenceContentEqual,
} from './candidate-review-derivation';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
import type { AppDb, DocumentParseStatus, StoredDocument } from './app-db';

export type EvidenceRepositoryErrorCode =
  | 'invalid-evidence'
  | 'invalid-project'
  | 'invalid-review'
  | 'stale-candidate'
  | 'stale-source'
  | 'evidence-collision'
  | 'document-not-found';

export class EvidenceRepositoryError extends Error {
  readonly code: EvidenceRepositoryErrorCode;

  constructor(code: EvidenceRepositoryErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'EvidenceRepositoryError';
    this.code = code;
  }
}

export interface CandidateReviewCommit {
  readonly expectedCandidate: EvidenceCandidate;
  readonly nextCandidate: EvidenceCandidate;
  readonly sourceFragments: readonly SourceFragment[];
  readonly evidence?: EvidenceItem;
}

const TERMINAL_REVIEW_STATUSES = new Set(['confirmed', 'corrected', 'rejected']);

function identityKey(item: Pick<
  EvidenceItem,
  'projectId' | 'fieldId' | 'periodIdentity' | 'dimensionIdentity'
>): string {
  return JSON.stringify([
    item.projectId,
    item.fieldId,
    item.periodIdentity,
    item.dimensionIdentity,
  ]);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareEvidence(left: EvidenceItem, right: EvidenceItem): number {
  return (
    compareText(left.fieldId, right.fieldId) ||
    compareText(left.periodIdentity, right.periodIdentity) ||
    compareText(left.dimensionIdentity, right.dimensionIdentity) ||
    compareText(left.id, right.id)
  );
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalizeBatch(items: readonly EvidenceItem[]): EvidenceItem[] {
  if (!Array.isArray(items)) {
    throw new EvidenceRepositoryError('invalid-evidence', 'Evidence batch must be an array.');
  }

  try {
    return items.map((item) => parseEvidenceItem(item));
  } catch (error) {
    throw new EvidenceRepositoryError(
      'invalid-evidence',
      'Evidence batch contains an invalid item.',
      error,
    );
  }
}

function parseStoredEvidence(item: unknown): EvidenceItem {
  try {
    return parseEvidenceItem(item);
  } catch (error) {
    throw new EvidenceRepositoryError(
      'invalid-evidence',
      'Stored evidence contains an invalid item.',
      error,
    );
  }
}

function parseReviewCandidate(input: unknown): EvidenceCandidate {
  try {
    return parseEvidenceCandidate(input);
  } catch (error) {
    throw new EvidenceRepositoryError(
      'invalid-review',
      'Candidate review input is invalid.',
      error,
    );
  }
}

function parseReviewSource(input: unknown): SourceFragment {
  try {
    return parseSourceFragment(input);
  } catch (error) {
    throw new EvidenceRepositoryError(
      'invalid-review',
      'Candidate source snapshot is invalid.',
      error,
    );
  }
}

function requireProjectId(projectId: string): string {
  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    throw new EvidenceRepositoryError('invalid-project', 'Project id is required.');
  }
  return projectId.trim();
}

function deriveStatus(candidates: readonly EvidenceCandidate[]): DocumentParseStatus {
  if (candidates.length === 0) return 'partial';
  const terminalCount = candidates.filter(({ reviewStatus }) =>
    TERMINAL_REVIEW_STATUSES.has(reviewStatus),
  ).length;
  if (terminalCount === 0) return 'review';
  if (terminalCount === candidates.length) return 'complete';
  return 'partial';
}

function reviewedDocument(
  document: StoredDocument,
  candidates: readonly EvidenceCandidate[],
): StoredDocument {
  const updated = { ...document, parseStatus: deriveStatus(candidates) };
  delete updated.parseErrorCode;
  return updated;
}

function validateReviewCommit(input: CandidateReviewCommit): {
  expectedCandidate: EvidenceCandidate;
  nextCandidate: EvidenceCandidate;
  sourceFragments: SourceFragment[];
  evidence?: EvidenceItem;
} {
  const expectedCandidate = parseReviewCandidate(input.expectedCandidate);
  const nextCandidate = parseReviewCandidate(input.nextCandidate);
  const sourceFragments = input.sourceFragments.map(parseReviewSource);
  const evidence = input.evidence === undefined
    ? undefined
    : canonicalizeBatch([input.evidence])[0]!;

  try {
    const derived = deriveCandidateReview(
      expectedCandidate,
      nextCandidate,
      sourceFragments,
      evidence?.conflictStatus ?? 'none',
    );
    const expectedEvidence = derived.evidence === undefined
      ? undefined
      : parseEvidenceItem(derived.evidence);
    if (
      (expectedEvidence === undefined) !== (evidence === undefined) ||
      (expectedEvidence !== undefined && !recordsEqual(expectedEvidence, evidence))
    ) {
      throw new CandidateReviewDerivationError(
        'invalid-review',
        'Formal evidence does not exactly match the derived candidate review.',
      );
    }
    return {
      expectedCandidate,
      nextCandidate,
      sourceFragments,
      ...(expectedEvidence === undefined ? {} : { evidence: expectedEvidence }),
    };
  } catch (error) {
    throw new EvidenceRepositoryError(
      'invalid-review',
      'Candidate review invariants are invalid.',
      error,
    );
  }
}

export class EvidenceRepository {
  private readonly db: AppDb;

  constructor(db: AppDb) {
    this.db = db;
  }

  async saveMany(items: readonly EvidenceItem[]): Promise<void> {
    const canonicalItems = canonicalizeBatch(items);
    if (canonicalItems.length === 0) return;

    await this.db.transaction('rw', this.db.evidence, async () => {
      const previousRows = await this.db.evidence.bulkGet(
        canonicalItems.map((item) => item.id),
      );
      const previousItems = previousRows.map((row) =>
        row === undefined ? undefined : parseStoredEvidence(row),
      );
      const affectedGroupKeys = new Set<string>();
      const affectedProjectIds = new Set<string>();

      for (const item of [...previousItems, ...canonicalItems]) {
        if (!item) continue;
        affectedGroupKeys.add(identityKey(item));
        affectedProjectIds.add(item.projectId);
      }

      await this.db.evidence.bulkPut(canonicalItems);
      for (const projectId of affectedProjectIds) {
        await this.recomputeProjectConflictGroups(projectId, affectedGroupKeys);
      }
    });
  }

  async commitCandidateReview(input: CandidateReviewCommit): Promise<void> {
    const canonical = validateReviewCommit(input);
    const { expectedCandidate, nextCandidate, sourceFragments, evidence } = canonical;

    await this.db.transaction(
      'rw',
      this.db.evidence,
      this.db.evidenceCandidates,
      this.db.documents,
      this.db.sourceFragments,
      async () => {
        const document = await this.db.documents.get(nextCandidate.documentId);
        if (!document || document.projectId !== nextCandidate.projectId) {
          throw new EvidenceRepositoryError(
            'document-not-found',
            'The reviewed candidate document is missing or belongs to another project.',
          );
        }

        const currentRow = await this.db.evidenceCandidates.get(nextCandidate.id);
        if (!currentRow) {
          throw new EvidenceRepositoryError(
            'stale-candidate',
            'The reviewed candidate no longer exists.',
          );
        }
        let currentCandidate: EvidenceCandidate;
        try {
          currentCandidate = parseEvidenceCandidate(currentRow);
        } catch (error) {
          throw new EvidenceRepositoryError(
            'stale-candidate',
            'The reviewed candidate changed or became invalid.',
            error,
          );
        }
        if (
          !recordsEqual(currentCandidate, expectedCandidate) &&
          !recordsEqual(currentCandidate, nextCandidate)
        ) {
          throw new EvidenceRepositoryError(
            'stale-candidate',
            'The reviewed candidate changed before the decision was committed.',
          );
        }

        for (const snapshot of sourceFragments) {
          const currentSourceRow = await this.db.sourceFragments.get(snapshot.id);
          if (!currentSourceRow) {
            throw new EvidenceRepositoryError(
              'stale-source',
              `Candidate source fragment is missing: ${snapshot.id}`,
            );
          }
          let currentSource: SourceFragment;
          try {
            currentSource = parseSourceFragment(currentSourceRow);
          } catch (error) {
            throw new EvidenceRepositoryError(
              'stale-source',
              `Candidate source fragment became invalid: ${snapshot.id}`,
              error,
            );
          }
          if (
            currentSource.projectId !== nextCandidate.projectId ||
            currentSource.documentId !== nextCandidate.documentId ||
            !recordsEqual(currentSource, snapshot)
          ) {
            throw new EvidenceRepositoryError(
              'stale-source',
              `Candidate source fragment changed before review commit: ${snapshot.id}`,
            );
          }
        }

        if (evidence !== undefined) {
          const existingRow = await this.db.evidence.get(evidence.id);
          let retainedEvidence: EvidenceItem;
          if (existingRow !== undefined) {
            const existing = parseStoredEvidence(existingRow);
            if (!evidenceContentEqual(existing, evidence)) {
              throw new EvidenceRepositoryError(
                'evidence-collision',
                'Deterministic candidate evidence already exists with different content.',
              );
            }
            retainedEvidence = existing;
          } else {
            retainedEvidence = parseEvidenceItem({
              ...evidence,
              conflictStatus: 'none',
            });
            await this.db.evidence.put(retainedEvidence);
          }
          await this.recomputeProjectConflictGroups(
            retainedEvidence.projectId,
            new Set([identityKey(retainedEvidence)]),
          );
        }

        await this.db.evidenceCandidates.put(nextCandidate);
        const candidateRows = await this.db.evidenceCandidates
          .where('[projectId+documentId]')
          .equals([nextCandidate.projectId, nextCandidate.documentId])
          .toArray();
        const candidates = candidateRows.map((row) => {
          try {
            return parseEvidenceCandidate(row);
          } catch (error) {
            throw new EvidenceRepositoryError(
              'invalid-review',
              'Stored document candidates contain an invalid record.',
              error,
            );
          }
        });
        await this.db.documents.put(reviewedDocument(document, candidates));
      },
    );
  }

  async getById(id: string): Promise<EvidenceItem | undefined> {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new EvidenceRepositoryError('invalid-evidence', 'Evidence id is required.');
    }
    const row = await this.db.evidence.get(id.trim());
    return row === undefined ? undefined : parseStoredEvidence(row);
  }

  async listByProject(projectId: string): Promise<EvidenceItem[]> {
    const canonicalProjectId = requireProjectId(projectId);
    const items = await this.db.evidence
      .where('projectId')
      .equals(canonicalProjectId)
      .toArray();
    try {
      return items.map((item) => parseEvidenceItem(item)).sort(compareEvidence);
    } catch (error) {
      throw new EvidenceRepositoryError(
        'invalid-evidence',
        'Stored evidence contains an invalid item.',
        error,
      );
    }
  }

  private async recomputeProjectConflictGroups(
    projectId: string,
    affectedGroupKeys: ReadonlySet<string>,
  ): Promise<void> {
    const rows = await this.db.evidence
      .where('projectId')
      .equals(projectId)
      .toArray();
    const parsedRows = rows.map((raw) => ({
      raw,
      canonical: parseStoredEvidence(raw),
    }));
    const groups = new Map<string, EvidenceItem[]>();

    for (const { canonical } of parsedRows) {
      const key = identityKey(canonical);
      if (!affectedGroupKeys.has(key)) continue;
      const group = groups.get(key) ?? [];
      group.push(canonical);
      groups.set(key, group);
    }

    const conflictStatusByKey = new Map<string, EvidenceItem['conflictStatus']>();
    for (const [key, group] of groups) {
      const definition = findTargetFieldDefinition(group[0]!.fieldId);
      if (!definition) {
        throw new EvidenceRepositoryError(
          'invalid-evidence',
          'Stored evidence references an unknown target field.',
        );
      }
      const resolution = resolveEvidenceConflict(group, definition.direction);
      conflictStatusByKey.set(
        key,
        resolution.status === 'agreed' ? 'none' : 'unresolved',
      );
    }

    const changedRows: EvidenceItem[] = [];
    for (const { raw, canonical } of parsedRows) {
      const conflictStatus = conflictStatusByKey.get(identityKey(canonical));
      const finalItem = conflictStatus === undefined || canonical.conflictStatus === conflictStatus
        ? canonical
        : parseEvidenceItem({ ...canonical, conflictStatus });
      if (!recordsEqual(raw, finalItem)) {
        changedRows.push(finalItem);
      }
    }
    if (changedRows.length > 0) {
      await this.db.evidence.bulkPut(changedRows);
    }
  }
}
