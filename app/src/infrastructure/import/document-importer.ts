import type { SourceFragment } from '../../domain/documents/source-fragment';
import { parseSourceFragment } from '../../domain/documents/source-fragment.schema';
import { deepFreeze } from '../../domain/deep-freeze';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import { parseEvidenceCandidate } from '../../domain/evidence/evidence-candidate.schema';
import documentCandidateWorkerUrl from './document-candidate.worker?worker&url';
import {
  DocumentExtractorError,
  MAX_DOCUMENT_INPUT_BYTES,
  MAX_EXTRACTED_TEXT_LENGTH,
  validateDocumentExtractionRequest,
  type DocumentExtractionRequest,
  type DocumentExtractorErrorCode,
} from './document-extractor';

const DEFAULT_DOCUMENT_WORKER_TIMEOUT_MS = 15_000;
const MAX_WORKER_FRAGMENTS = 10_000;
const MAX_WORKER_CANDIDATES = 10_000;
const documentExtractorErrorCodes = new Set<DocumentExtractorErrorCode>([
  'empty-input',
  'input-too-large',
  'password-protected',
  'malformed-document',
  'page-limit',
  'slide-limit',
  'text-limit',
  'archive-limit',
  'unsupported-format',
  'cancelled',
  'worker-timeout',
  'worker-failed',
]);

export interface DocumentCandidateResult {
  readonly projectId: string;
  readonly documentId: string;
  readonly fragments: readonly SourceFragment[];
  readonly candidates: readonly EvidenceCandidate[];
  readonly needsOcrPageNumbers: readonly number[];
  readonly warnings: readonly string[];
}

export interface SerializedDocumentExtractorError {
  readonly name: 'DocumentExtractorError';
  readonly code: DocumentExtractorErrorCode;
  readonly message: string;
}

export interface DocumentCandidateWorkerRequest {
  readonly request: DocumentExtractionRequest;
}

export type DocumentCandidateWorkerResponse =
  | { readonly ok: true; readonly result: DocumentCandidateResult }
  | { readonly ok: false; readonly error: SerializedDocumentExtractorError };

export interface DocumentCandidateWorker {
  onmessage: ((event: MessageEvent<DocumentCandidateWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: DocumentCandidateWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface DocumentWorkerInspectionOptions {
  readonly timeoutMs?: number;
  readonly workerFactory?: (
    url: URL,
    options: { type: 'module' },
  ) => DocumentCandidateWorker;
  readonly setTimer?: (handler: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export function serializeDocumentExtractorError(
  error: unknown,
): SerializedDocumentExtractorError {
  if (error instanceof DocumentExtractorError) {
    return {
      name: 'DocumentExtractorError',
      code: error.code,
      message: error.message,
    };
  }
  return {
    name: 'DocumentExtractorError',
    code: 'worker-failed',
    message: error instanceof Error ? error.message : 'Document extraction worker failed.',
  };
}

function workerFailure(message: string, cause?: unknown): DocumentExtractorError {
  return new DocumentExtractorError('worker-failed', message, cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rebuildStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw workerFailure(`Document extraction worker returned invalid ${label}.`);
  }
  return [...value];
}

function rebuildPageNumbers(value: unknown): number[] {
  if (
    !Array.isArray(value)
    || !value.every((item) => Number.isInteger(item) && item > 0)
    || new Set(value).size !== value.length
  ) {
    throw workerFailure('Document extraction worker returned invalid OCR page numbers.');
  }
  return [...value] as number[];
}

function rebuildDocumentCandidateResult(
  value: unknown,
  request: DocumentExtractionRequest,
): DocumentCandidateResult {
  if (!isRecord(value)) {
    throw workerFailure('Document extraction worker returned an invalid result.');
  }
  const keys = Object.keys(value);
  const expectedKeys = [
    'projectId',
    'documentId',
    'fragments',
    'candidates',
    'needsOcrPageNumbers',
    'warnings',
  ];
  if (
    keys.length !== expectedKeys.length
    || !expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    || value.projectId !== request.projectId
    || value.documentId !== request.documentId
    || !Array.isArray(value.fragments)
    || value.fragments.length > MAX_WORKER_FRAGMENTS
    || !Array.isArray(value.candidates)
    || value.candidates.length > MAX_WORKER_CANDIDATES
  ) {
    throw workerFailure('Document extraction worker returned invalid result metadata.');
  }

  let aggregateTextLength = 0;
  let fragments: SourceFragment[];
  let candidates: EvidenceCandidate[];
  try {
    fragments = value.fragments.map((fragment) => {
      const parsed = parseSourceFragment(fragment);
      aggregateTextLength += parsed.rawText.length + parsed.normalizedText.length;
      if (
        aggregateTextLength > MAX_EXTRACTED_TEXT_LENGTH
        || parsed.projectId !== request.projectId
        || parsed.documentId !== request.documentId
      ) {
        throw new Error('Source fragment does not match the requested document boundary.');
      }
      return parsed;
    });
    candidates = value.candidates.map((candidate) => parseEvidenceCandidate(candidate));
  } catch (error) {
    throw workerFailure('Document extraction worker returned invalid evidence data.', error);
  }

  const fragmentIds = new Set(fragments.map((fragment) => fragment.id));
  if (fragmentIds.size !== fragments.length) {
    throw workerFailure('Document extraction worker returned duplicate source fragment ids.');
  }
  for (const candidate of candidates) {
    if (
      candidate.projectId !== request.projectId
      || candidate.documentId !== request.documentId
      || candidate.sourceFragmentIds.some((id) => !fragmentIds.has(id))
    ) {
      throw workerFailure('Document extraction worker returned inconsistent candidates.');
    }
  }

  return deepFreeze({
    projectId: request.projectId,
    documentId: request.documentId,
    fragments,
    candidates,
    needsOcrPageNumbers: rebuildPageNumbers(value.needsOcrPageNumbers),
    warnings: rebuildStringArray(value.warnings, 'warnings'),
  });
}

function rebuildWorkerError(value: unknown): DocumentExtractorError {
  if (
    !isRecord(value)
    || value.name !== 'DocumentExtractorError'
    || typeof value.code !== 'string'
    || !documentExtractorErrorCodes.has(value.code as DocumentExtractorErrorCode)
    || typeof value.message !== 'string'
  ) {
    return workerFailure('Document extraction worker returned an invalid error.');
  }
  return new DocumentExtractorError(
    value.code as DocumentExtractorErrorCode,
    value.message,
  );
}

export function inspectDocumentInWorker(
  input: DocumentExtractionRequest,
  options: DocumentWorkerInspectionOptions = {},
): Promise<DocumentCandidateResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOCUMENT_WORKER_TIMEOUT_MS;
  const setTimer = options.setTimer ?? (
    (handler: () => void, delayMs: number) => globalThis.setTimeout(handler, delayMs)
  );
  const clearTimer = options.clearTimer ?? (
    (handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
  );

  return new Promise((resolve, reject) => {
    let request: DocumentExtractionRequest;
    try {
      const validated = validateDocumentExtractionRequest(input);
      if (validated.data.byteLength > MAX_DOCUMENT_INPUT_BYTES) {
        throw new DocumentExtractorError(
          'input-too-large',
          'Document input cannot exceed 100 MiB.',
        );
      }
      const copiedBuffer = new ArrayBuffer(validated.data.byteLength);
      const copiedData = new Uint8Array(copiedBuffer);
      copiedData.set(validated.data);
      request = { ...validated, data: copiedData };
    } catch (error) {
      reject(
        error instanceof DocumentExtractorError
          ? error
          : workerFailure('Document extraction request is invalid.', error),
      );
      return;
    }

    let worker: DocumentCandidateWorker;
    try {
      const workerUrl = new URL(documentCandidateWorkerUrl, import.meta.url);
      worker = options.workerFactory
        ? options.workerFactory(workerUrl, { type: 'module' })
        : new Worker(workerUrl, { type: 'module' });
    } catch (error) {
      reject(workerFailure(
        error instanceof Error ? error.message : 'Document worker construction failed.',
        error,
      ));
      return;
    }

    let settled = false;
    let timerHandle: unknown;
    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer(timerHandle);
      worker.terminate();
      action();
    };

    worker.onmessage = (event) => {
      if (settled) {
        return;
      }
      try {
        const response: unknown = event.data;
        if (!isRecord(response) || typeof response.ok !== 'boolean') {
          throw workerFailure('Document extraction worker returned an invalid response.');
        }
        if (response.ok) {
          const result = rebuildDocumentCandidateResult(response.result, request);
          finish(() => resolve(result));
        } else {
          finish(() => reject(rebuildWorkerError(response.error)));
        }
      } catch (error) {
        finish(() => reject(
          error instanceof DocumentExtractorError
            ? error
            : workerFailure('Document extraction worker response failed validation.', error),
        ));
      }
    };
    worker.onerror = (event) => {
      finish(() => reject(workerFailure(
        event.message || 'Document extraction worker failed.',
      )));
    };
    timerHandle = setTimer(() => {
      finish(() => reject(new DocumentExtractorError(
        'worker-timeout',
        `Document extraction exceeded ${timeoutMs} ms.`,
      )));
    }, timeoutMs);

    try {
      worker.postMessage({ request }, [request.data.buffer]);
    } catch (error) {
      const serialized = serializeDocumentExtractorError(error);
      finish(() => reject(new DocumentExtractorError(
        serialized.code,
        serialized.message,
      )));
    }
  });
}
