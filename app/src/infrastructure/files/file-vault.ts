import type { AppDb, StoredDocument } from '../db/app-db';

export class FileVault {
  private readonly db: AppDb;

  constructor(db: AppDb) {
    this.db = db;
  }

  async store(projectId: string, file: File): Promise<StoredDocument> {
    const document: StoredDocument = {
      id: crypto.randomUUID(),
      projectId,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      uploadedAt: new Date().toISOString(),
      parseStatus: 'stored',
      blob: file,
    };

    await this.db.documents.put(document);
    return document;
  }

  async list(projectId: string): Promise<StoredDocument[]> {
    return this.db.documents.where('projectId').equals(projectId).sortBy('uploadedAt');
  }
}
