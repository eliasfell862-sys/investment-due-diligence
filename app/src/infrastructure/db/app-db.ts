import Dexie, { type EntityTable } from 'dexie';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import type { Project } from '../../domain/project/project';

export interface StoredDocument {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  parseStatus: 'stored';
  blob: Blob;
}

export class AppDb extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  evidence!: EntityTable<EvidenceItem, 'id'>;
  documents!: EntityTable<StoredDocument, 'id'>;

  constructor(name = 'investment-due-diligence') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt, status, name',
      evidence: 'id, projectId, fieldId, conflictStatus, updatedAt',
      documents: 'id, projectId, uploadedAt, mimeType',
    });
  }
}

export const appDb = new AppDb();
