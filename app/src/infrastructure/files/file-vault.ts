import type { AppDb, StoredDocument } from '../db/app-db';

export type FileVaultErrorCode =
  | 'invalid-project'
  | 'invalid-file'
  | 'unsupported-file'
  | 'file-too-large'
  | 'duplicate-id'
  | 'quota-exceeded'
  | 'batch-too-large';

export class FileVaultError extends Error {
  readonly code: FileVaultErrorCode;
  override readonly cause: unknown;

  constructor(code: FileVaultErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'FileVaultError';
    this.code = code;
    this.cause = cause;
  }
}

export interface FileVaultDependencies {
  createId?: () => string;
  now?: () => Date;
}

const ALLOWED_EXTENSIONS = new Set(['xlsx', 'xls', 'pdf', 'doc', 'docx', 'ppt', 'pptx']);
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_BATCH_FILE_COUNT = 50;
const MAX_BATCH_SIZE_BYTES = 250 * 1024 * 1024;

interface ValidatedFile {
  file: File;
  name: string;
}

function normalizeProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (!normalized) {
    throw new FileVaultError('invalid-project', 'Project id is required.');
  }
  return normalized;
}

function validateFile(file: File): ValidatedFile {
  if (
    !file ||
    typeof file !== 'object' ||
    typeof file.name !== 'string' ||
    typeof file.size !== 'number' ||
    typeof file.type !== 'string'
  ) {
    throw new FileVaultError('invalid-file', 'A valid local file is required.');
  }

  const name = file.name.trim();
  if (!name || name.length > 255 || !Number.isFinite(file.size) || file.size <= 0) {
    throw new FileVaultError('invalid-file', 'The selected file is invalid.');
  }

  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined;
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    throw new FileVaultError('unsupported-file', 'The selected file type is not supported.');
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new FileVaultError('file-too-large', 'The selected file exceeds 100 MiB.');
  }

  return { file, name };
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

function translateStorageError(error: unknown): never {
  if (error instanceof FileVaultError) {
    throw error;
  }
  if (hasErrorName(error, 'ConstraintError')) {
    throw new FileVaultError('duplicate-id', 'A document id already exists.', error);
  }
  if (hasErrorName(error, 'QuotaExceededError')) {
    throw new FileVaultError('quota-exceeded', 'Local storage capacity was exceeded.', error);
  }
  throw error;
}


export function sortStoredDocuments(
  documents: readonly StoredDocument[],
): StoredDocument[] {
  return [...documents].sort((left, right) => {
    const uploadedAtDifference =
      (Date.parse(right.uploadedAt) || 0) - (Date.parse(left.uploadedAt) || 0);
    return uploadedAtDifference || left.id.localeCompare(right.id);
  });
}

export class FileVault {
  private readonly db: AppDb;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(db: AppDb, dependencies: FileVaultDependencies = {}) {
    this.db = db;
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
    this.now = dependencies.now ?? (() => new Date());
  }

  async store(projectId: string, file: File): Promise<StoredDocument> {
    const [document] = await this.storeMany(projectId, [file]);
    return document!;
  }

  async storeMany(projectId: string, files: readonly File[]): Promise<StoredDocument[]> {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (files.length > MAX_BATCH_FILE_COUNT) {
      throw new FileVaultError('batch-too-large', 'A batch can contain at most 50 files.');
    }

    const validatedFiles = files.map(validateFile);
    const totalSize = validatedFiles.reduce((sum, { file }) => sum + file.size, 0);
    if (totalSize > MAX_BATCH_SIZE_BYTES) {
      throw new FileVaultError('batch-too-large', 'A batch cannot exceed 250 MiB.');
    }

    const documents = validatedFiles.map(({ file, name }) => ({
      id: this.createId(),
      projectId: normalizedProjectId,
      name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      uploadedAt: this.now().toISOString(),
      parseStatus: 'unparsed' as const,
      blob: file,
    }));

    if (documents.length === 0) {
      return [];
    }

    try {
      await this.db.transaction('rw', this.db.documents, async () => {
        for (const document of documents) {
          await this.db.documents.add(document);
        }
      });
    } catch (error) {
      translateStorageError(error);
    }

    return documents;
  }

  async countByProject(projectId: string): Promise<number> {
    const normalizedProjectId = normalizeProjectId(projectId);
    return this.db.documents
      .where('projectId')
      .equals(normalizedProjectId)
      .count();
  }

  async list(projectId: string): Promise<StoredDocument[]> {
    const normalizedProjectId = normalizeProjectId(projectId);
    const documents = await this.db.documents
      .where('projectId')
      .equals(normalizedProjectId)
      .toArray();

    return sortStoredDocuments(documents);
  }
}
