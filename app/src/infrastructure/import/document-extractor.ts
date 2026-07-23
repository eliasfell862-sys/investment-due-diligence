import type { SourceFragment } from '../../domain/documents/source-fragment';
import { deepFreeze } from '../../domain/deep-freeze';

export const MAX_DOCUMENT_INPUT_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;
export const MAX_FRAGMENT_TEXT_LENGTH = 65_536;
export const MAX_EXTRACTED_TEXT_LENGTH = 4 * 1024 * 1024;

export interface DocumentExtractionRequest {
  readonly projectId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly fileName: string;
  readonly kind: 'pdf' | 'pptx';
  readonly data: Uint8Array;
}

export interface DocumentExtractionResult {
  readonly fragments: readonly SourceFragment[];
  readonly needsOcrPageNumbers: readonly number[];
  readonly warnings: readonly string[];
}

export type DocumentExtractorErrorCode =
  | 'empty-input'
  | 'input-too-large'
  | 'password-protected'
  | 'malformed-document'
  | 'page-limit'
  | 'slide-limit'
  | 'text-limit'
  | 'archive-limit'
  | 'unsupported-format'
  | 'cancelled'
  | 'worker-timeout'
  | 'worker-failed';

export class DocumentExtractorError extends Error {
  readonly code: DocumentExtractorErrorCode;
  override readonly cause: unknown;

  constructor(code: DocumentExtractorErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'DocumentExtractorError';
    this.code = code;
    this.cause = cause;
  }
}

function malformed(message: string, cause?: unknown): never {
  throw new DocumentExtractorError('malformed-document', message, cause);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function validateBoundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') {
    malformed(`${label} must be a string.`);
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > maximum ||
    hasControlCharacter(trimmed)
  ) {
    malformed(`${label} is invalid.`);
  }
  return trimmed;
}

export function validateDocumentExtractionRequest(
  input: DocumentExtractionRequest,
): DocumentExtractionRequest {
  if (typeof input !== 'object' || input === null) {
    malformed('Document extraction request is invalid.');
  }
  if (input.kind !== 'pdf' && input.kind !== 'pptx') {
    throw new DocumentExtractorError('unsupported-format', 'Document format is unsupported.');
  }
  if (!(input.data instanceof Uint8Array)) {
    malformed('Document data must be a Uint8Array.');
  }
  if (input.data.byteLength === 0) {
    throw new DocumentExtractorError('empty-input', 'Document input cannot be empty.');
  }
  if (input.data.byteLength > MAX_DOCUMENT_INPUT_BYTES) {
    throw new DocumentExtractorError(
      'input-too-large',
      'Document input cannot exceed 100 MiB.',
    );
  }

  return {
    projectId: validateBoundedText(input.projectId, 'Project id', 256),
    documentId: validateBoundedText(input.documentId, 'Document id', 256),
    documentVersionId: validateBoundedText(input.documentVersionId, 'Document version id', 256),
    fileName: validateBoundedText(input.fileName, 'File name', 1_024),
    kind: input.kind,
    data: input.data,
  };
}

export function freezeDocumentExtractionResult(
  result: DocumentExtractionResult,
): DocumentExtractionResult {
  return deepFreeze({
    fragments: [...result.fragments],
    needsOcrPageNumbers: [...result.needsOcrPageNumbers],
    warnings: [...result.warnings],
  });
}
