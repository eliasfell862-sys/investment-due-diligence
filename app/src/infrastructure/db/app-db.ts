import Dexie, { type EntityTable } from 'dexie';
import type { SourceFragment } from '../../domain/documents/source-fragment';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import type { Project } from '../../domain/project/project';

export type DocumentParseStatus =
  | 'unparsed'
  | 'parsing'
  | 'review'
  | 'partial'
  | 'complete'
  | 'failed'
  | 'unsupported';

export interface StoredDocument {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  parseStatus: DocumentParseStatus;
  parseErrorCode?: string;
  blob: Blob;
}

type LegacyStoredDocument = Omit<StoredDocument, 'parseStatus'> & {
  parseStatus: DocumentParseStatus | 'stored';
};

export class AppDb extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  evidence!: EntityTable<EvidenceItem, 'id'>;
  documents!: EntityTable<StoredDocument, 'id'>;

  sourceFragments!: EntityTable<SourceFragment, 'id'>;
  evidenceCandidates!: EntityTable<EvidenceCandidate, 'id'>;

  constructor(name = 'investment-due-diligence') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt, status, name',
      evidence: 'id, projectId, fieldId, conflictStatus, updatedAt',
      documents: 'id, projectId, uploadedAt, mimeType',
    });
    this.version(2)
      .stores({
        projects: 'id, updatedAt, status, name',
        evidence: 'id, projectId, fieldId, conflictStatus, updatedAt',
        documents: 'id, projectId, uploadedAt, mimeType, parseStatus',
        sourceFragments:
          'id, projectId, documentId, [projectId+documentId], contentHash, createdAt',
        evidenceCandidates:
          'id, projectId, documentId, fieldId, reviewStatus, [projectId+documentId], &candidateFingerprint, updatedAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<LegacyStoredDocument, string>('documents')
          .toCollection()
          .modify((document) => {
            if (document.parseStatus === 'stored') {
              document.parseStatus = 'unparsed';
            }
            if (typeof document.parseErrorCode === 'string' && !document.parseErrorCode.trim()) {
              delete document.parseErrorCode;
            }
          });
      });
  }
}

export const appDb = new AppDb();
