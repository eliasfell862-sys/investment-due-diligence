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
  MAX_PDF_PAGES,
  validateDocumentExtractionRequest,
  type DocumentExtractionRequest,
  type DocumentExtractorErrorCode,
} from './document-extractor';
import { MAX_PPTX_SLIDES } from './pptx-extractor';

const DEFAULT_DOCUMENT_WORKER_TIMEOUT_MS = 15_000;
const MAX_WORKER_FRAGMENTS = 10_000;
const MAX_WORKER_CANDIDATES = 10_000;
const MAX_WORKER_OCR_PAGE_NUMBERS = 500;
const MAX_WORKER_WARNINGS = 500;
const MAX_WORKER_WARNING_LENGTH = 1_024;
const MAX_WORKER_WARNING_TEXT_LENGTH = 64 * 1_024;
const MAX_SERIALIZED_ERROR_MESSAGE_LENGTH = 4_096;
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

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isPdfJsFakeWorkerReadyMessage(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['sourceName', 'targetName', 'action', 'data'])
    && value.sourceName === 'worker'
    && value.targetName === 'main'
    && value.action === 'ready'
    && value.data === null;
}

function rebuildWarnings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_WORKER_WARNINGS) {
    throw workerFailure('Document extraction worker returned invalid warnings.');
  }
  let aggregateLength = 0;
  const warnings = Array.from(value, (item) => {
    if (typeof item !== 'string' || item.length > MAX_WORKER_WARNING_LENGTH) {
      throw workerFailure('Document extraction worker returned invalid warnings.');
    }
    aggregateLength += item.length;
    if (aggregateLength > MAX_WORKER_WARNING_TEXT_LENGTH) {
      throw workerFailure('Document extraction worker returned invalid warnings.');
    }
    return item;
  });
  return warnings;
}

function rebuildPageNumbers(value: unknown, maximumValue: number): number[] {
  if (!Array.isArray(value) || value.length > MAX_WORKER_OCR_PAGE_NUMBERS) {
    throw workerFailure('Document extraction worker returned invalid OCR page numbers.');
  }
  const pageNumbers = Array.from(value);
  if (
    !pageNumbers.every((item) => (
      Number.isInteger(item) && item > 0 && item <= maximumValue
    ))
    || new Set(pageNumbers).size !== pageNumbers.length
  ) {
    throw workerFailure('Document extraction worker returned invalid OCR page numbers.');
  }
  return pageNumbers as number[];
}

function rebuildDocumentCandidateResult(
  value: unknown,
  request: DocumentExtractionRequest,
): DocumentCandidateResult {
  if (!isRecord(value)) {
    throw workerFailure('Document extraction worker returned an invalid result.');
  }
  const expectedKeys = [
    'projectId',
    'documentId',
    'fragments',
    'candidates',
    'needsOcrPageNumbers',
    'warnings',
  ];
  if (
    !hasExactKeys(value, expectedKeys)
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
    fragments = Array.from(value.fragments, (fragment) => {
      const parsed = parseSourceFragment(fragment);
      aggregateTextLength += parsed.rawText.length;
      if (
        aggregateTextLength > MAX_EXTRACTED_TEXT_LENGTH
        || parsed.projectId !== request.projectId
        || parsed.documentId !== request.documentId
        || parsed.documentVersionId !== request.documentVersionId
      ) {
        throw new Error('Source fragment does not match the requested document boundary.');
      }
      return parsed;
    });
    candidates = Array.from(
      value.candidates, (candidate) => parseEvidenceCandidate(candidate),
    );
  } catch (error) {
    throw workerFailure('Document extraction worker returned invalid evidence data.', error);
  }

  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const candidateFingerprints = new Set(
    candidates.map((candidate) => candidate.candidateFingerprint),
  );
  if (candidateIds.size !== candidates.length || candidateFingerprints.size !== candidates.length) {
    throw workerFailure('Document extraction worker returned duplicate candidate identities.');
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
    needsOcrPageNumbers: rebuildPageNumbers(
      value.needsOcrPageNumbers,
      request.kind === 'pdf' ? MAX_PDF_PAGES : MAX_PPTX_SLIDES,
    ),
    warnings: rebuildWarnings(value.warnings),
  });
}

function rebuildWorkerError(value: unknown): DocumentExtractorError {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['name', 'code', 'message'])
    || value.name !== 'DocumentExtractorError'
    || typeof value.code !== 'string'
    || !documentExtractorErrorCodes.has(value.code as DocumentExtractorErrorCode)
    || typeof value.message !== 'string'
    || value.message.length === 0
    || value.message.length > MAX_SERIALIZED_ERROR_MESSAGE_LENGTH
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
        // pdf.js emits this handshake when it initializes its fake worker inside our worker.
        // It is not an application response, so wait for the strict result/error envelope.
        if (isPdfJsFakeWorkerReadyMessage(response)) {
          return;
        }
        if (!isRecord(response)) {
          throw workerFailure('Document extraction worker returned an invalid response.');
        }
        if (response.ok === true) {
          if (!hasExactKeys(response, ['ok', 'result'])) {
            throw workerFailure('Document extraction worker returned an invalid response.');
          }
          const result = rebuildDocumentCandidateResult(response.result, request);
          finish(() => resolve(result));
        } else if (response.ok === false && hasExactKeys(response, ['ok', 'error'])) {
          finish(() => reject(rebuildWorkerError(response.error)));
        } else {
          throw workerFailure('Document extraction worker returned an invalid response.');
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
    try {
      timerHandle = setTimer(() => {
        finish(() => reject(new DocumentExtractorError(
          'worker-timeout',
          `Document extraction exceeded ${timeoutMs} ms.`,
        )));
      }, timeoutMs);
    } catch (error) {
      finish(() => reject(workerFailure(
        error instanceof Error ? error.message : 'Document timer setup failed.',
        error,
      )));
      return;
    }
    if (settled) {
      clearTimer(timerHandle);
      return;
    }

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
