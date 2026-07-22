import type { EvidenceItem } from '../../domain/evidence/evidence';
import { parseEvidenceItem } from '../../domain/evidence/evidence.schema';
import { resolveEvidenceConflict } from '../../domain/evidence/resolve-conflict';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
import type { AppDb } from './app-db';

export type EvidenceRepositoryErrorCode = 'invalid-evidence' | 'invalid-project';

export class EvidenceRepositoryError extends Error {
  readonly code: EvidenceRepositoryErrorCode;

  constructor(code: EvidenceRepositoryErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'EvidenceRepositoryError';
    this.code = code;
  }
}

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

function requireProjectId(projectId: string): string {
  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    throw new EvidenceRepositoryError('invalid-project', 'Project id is required.');
  }
  return projectId.trim();
}

export class EvidenceRepository {
  private readonly db: AppDb;

  constructor(db: AppDb) {
    this.db = db;
  }

  async saveMany(items: readonly EvidenceItem[]): Promise<void> {
    const canonicalItems = canonicalizeBatch(items);
    if (canonicalItems.length === 0) {
      return;
    }

    await this.db.transaction('rw', this.db.evidence, async () => {
      const previousItems = await this.db.evidence.bulkGet(
        canonicalItems.map((item) => item.id),
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
        const projectItems = await this.db.evidence
          .where('projectId')
          .equals(projectId)
          .toArray();
        const groups = new Map<string, EvidenceItem[]>();

        for (const item of projectItems) {
          const key = identityKey(item);
          if (!affectedGroupKeys.has(key)) continue;
          const group = groups.get(key) ?? [];
          group.push(item);
          groups.set(key, group);
        }

        const statusUpdates: EvidenceItem[] = [];
        for (const group of groups.values()) {
          const definition = findTargetFieldDefinition(group[0]!.fieldId);
          if (!definition) {
            throw new EvidenceRepositoryError(
              'invalid-evidence',
              'Stored evidence references an unknown target field.',
            );
          }
          const resolution = resolveEvidenceConflict(group, definition.direction);
          const conflictStatus = resolution.status === 'agreed' ? 'none' : 'unresolved';

          for (const item of group) {
            if (item.conflictStatus !== conflictStatus) {
              statusUpdates.push({ ...item, conflictStatus });
            }
          }
        }

        if (statusUpdates.length > 0) {
          await this.db.evidence.bulkPut(statusUpdates);
        }
      }
    });
  }

  async listByProject(projectId: string): Promise<EvidenceItem[]> {
    const canonicalProjectId = requireProjectId(projectId);
    const items = await this.db.evidence
      .where('projectId')
      .equals(canonicalProjectId)
      .toArray();
    return items.sort(compareEvidence);
  }
}
