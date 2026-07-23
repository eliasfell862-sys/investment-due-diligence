import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { SourceFragment, SourceLocator } from '../../domain/documents/source-fragment';
import { parseSourceFragment } from '../../domain/documents/source-fragment.schema';
import { sha256Hex } from '../../shared/crypto/sha256';
import {
  DocumentExtractorError,
  MAX_EXTRACTED_TEXT_LENGTH,
  MAX_FRAGMENT_TEXT_LENGTH,
  MAX_PDF_PAGES,
  freezeDocumentExtractionResult,
  validateDocumentExtractionRequest,
  type DocumentExtractionRequest,
  type DocumentExtractionResult,
} from './document-extractor';

if (GlobalWorkerOptions.workerSrc !== pdfWorkerUrl) GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfPageAdapter { readonly getTextContent: () => Promise<unknown> }
export interface PdfDocumentAdapter {
  readonly numPages: number;
  readonly getPage: (pageNumber: number) => Promise<PdfPageAdapter>;
  readonly destroy: () => Promise<void>;
}
export interface PdfExtractionDependencies {
  readonly load?: (data: Uint8Array) => Promise<PdfDocumentAdapter>;
  readonly now?: () => Date;
  readonly isCancelled?: () => boolean;
}

const MAX_PDF_TEXT_ITEMS_PER_PAGE = 100_000;

interface TextItem {
  readonly str: string; readonly hasEOL: boolean;
  readonly x?: number; readonly y?: number; readonly width?: number; readonly height?: number;
  readonly boundingBox?: readonly [number, number, number, number];
}
interface TextBlock {
  readonly rawText: string; readonly normalizedText: string;
  readonly boundingBox?: readonly [number, number, number, number];
}

function error(code: ConstructorParameters<typeof DocumentExtractorError>[0], message: string, cause?: unknown) {
  return new DocumentExtractorError(code, message, cause);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function parseItem(value: unknown): TextItem | null {
  if (!isRecord(value)) throw error('malformed-document', 'PDF text content contains an invalid item.');
  if (!Object.prototype.hasOwnProperty.call(value, 'str')) {
    if (typeof value.type === 'string') return null;
    throw error('malformed-document', 'PDF text content contains an invalid item.');
  }
  if (typeof value.str !== 'string') throw error('malformed-document', 'PDF text item text must be a string.');
  if (value.str.length > MAX_FRAGMENT_TEXT_LENGTH) {
    throw error('text-limit', 'A PDF text item exceeds the fragment text limit.');
  }
  const transform = value.transform;
  const validTransform = Array.isArray(transform)
    && transform.length === 6
    && isFiniteNumber(transform[0])
    && isFiniteNumber(transform[1])
    && isFiniteNumber(transform[2])
    && isFiniteNumber(transform[3])
    && isFiniteNumber(transform[4])
    && isFiniteNumber(transform[5]);
  const x = validTransform ? transform[4] : undefined;
  const y = validTransform ? transform[5] : undefined;
  const width = isFiniteNumber(value.width) && value.width >= 0 ? value.width : undefined;
  const height = isFiniteNumber(value.height) && value.height >= 0 ? value.height : undefined;
  const boundingBox = x !== undefined && y !== undefined && x >= 0 && y >= 0
    && width !== undefined && height !== undefined ? [x, y, width, height] as const : undefined;
  return {
    str: value.str, hasEOL: value.hasEOL === true,
    ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }),
    ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }),
    ...(boundingBox === undefined ? {} : { boundingBox }),
  };
}
function contentItems(value: unknown): readonly unknown[] {
  if (!isRecord(value) || !Array.isArray(value.items)) throw error('malformed-document', 'PDF page returned invalid text content.');
  return value.items;
}
function gap(left: TextItem, right: TextItem): number | undefined {
  return left.x === undefined || left.width === undefined || right.x === undefined
    ? undefined : right.x - (left.x + left.width);
}
function startsBlock(left: TextItem, right: TextItem): boolean {
  if (left.y !== undefined && right.y !== undefined) {
    const tolerance = Math.max(2, Math.min(left.height ?? 4, right.height ?? 4) / 2);
    if (Math.abs(left.y - right.y) > tolerance) return true;
  }
  const horizontal = gap(left, right);
  return horizontal !== undefined && horizontal > Math.max(72, Math.max(left.height ?? 0, right.height ?? 0) * 8);
}
function separator(left: TextItem, right: TextItem): string {
  if (/\s$/u.test(left.str) || /^\s/u.test(right.str) || /^\p{M}/u.test(right.str)) return '';
  const horizontal = gap(left, right);
  if (horizontal === undefined) return ' ';
  return horizontal > Math.max(1, Math.min(left.height ?? 4, right.height ?? 4) * 0.15) ? ' ' : '';
}

interface BlockAccumulator {
  readonly parts: string[];
  length: number;
  previous?: TextItem;
  boundingBoxValid: boolean;
  hasBoundingBox: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function emptyAccumulator(): BlockAccumulator {
  return {
    parts: [],
    length: 0,
    boundingBoxValid: true,
    hasBoundingBox: false,
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function addBoundingBox(accumulator: BlockAccumulator, item: TextItem): void {
  const box = item.boundingBox;
  if (!box) {
    accumulator.boundingBoxValid = false;
    return;
  }
  accumulator.hasBoundingBox = true;
  accumulator.minX = Math.min(accumulator.minX, box[0]);
  accumulator.minY = Math.min(accumulator.minY, box[1]);
  accumulator.maxX = Math.max(accumulator.maxX, box[0] + box[2]);
  accumulator.maxY = Math.max(accumulator.maxY, box[1] + box[3]);
}

function finishBlock(accumulator: BlockAccumulator): TextBlock | null {
  if (accumulator.parts.length === 0) return null;
  const rawText = accumulator.parts.join('').trim().normalize('NFC');
  const normalizedText = rawText
    .replace(/[\s\u0085\p{Z}]+/gu, ' ')
    .trim()
    .normalize('NFC');
  if (!normalizedText) return null;
  const boundingBox = accumulator.boundingBoxValid && accumulator.hasBoundingBox
    ? [
      accumulator.minX,
      accumulator.minY,
      accumulator.maxX - accumulator.minX,
      accumulator.maxY - accumulator.minY,
    ] as const
    : undefined;
  return { rawText, normalizedText, ...(boundingBox === undefined ? {} : { boundingBox }) };
}
function blocks(items: readonly unknown[], remainingTextLength: number): readonly TextBlock[] {
  if (items.length > MAX_PDF_TEXT_ITEMS_PER_PAGE) {
    throw error('text-limit', 'PDF page contains too many text items.');
  }
  const result: TextBlock[] = [];
  let emittedTextLength = 0;
  let current = emptyAccumulator();
  const flush = () => {
    const block = finishBlock(current);
    if (block) {
      if (block.rawText.length > remainingTextLength - emittedTextLength) {
        throw error('text-limit', 'Extracted PDF text exceeds its aggregate limit.');
      }
      emittedTextLength += block.rawText.length;
      result.push(block);
    }
    current = emptyAccumulator();
  };
  for (const value of items) {
    const item = parseItem(value);
    if (!item) continue;
    if (current.previous && startsBlock(current.previous, item)) flush();
    const joiningText = current.previous ? separator(current.previous, item) : '';
    const additionalLength = joiningText.length + item.str.length;
    if (additionalLength > MAX_FRAGMENT_TEXT_LENGTH - current.length) {
      throw error('text-limit', 'A PDF text block exceeds the fragment text limit.');
    }
    if (joiningText) current.parts.push(joiningText);
    current.parts.push(item.str);
    current.length += additionalLength;
    current.previous = item;
    addBoundingBox(current, item);
    if (item.hasEOL) flush();
  }
  flush();
  return result;
}
function extractionTimestamp(now: () => Date): string {
  try {
    const value = now();
    if (!Number.isFinite(Date.prototype.getTime.call(value))) throw new TypeError('Invalid date');
    return Date.prototype.toISOString.call(value);
  } catch (cause) { throw error('malformed-document', 'Extraction timestamp is invalid.', cause); }
}
function isPasswordError(value: unknown): boolean {
  return isRecord(value) && (value.name === 'PasswordException' || value.code === 1 || value.code === 2);
}
function validateDocumentAdapter(value: unknown): PdfDocumentAdapter {
  if (
    !isRecord(value)
    || !Number.isInteger(value.numPages)
    || (value.numPages as number) <= 0
    || typeof value.getPage !== 'function'
    || typeof value.destroy !== 'function'
  ) {
    throw error('malformed-document', 'PDF loader returned an invalid document adapter.');
  }
  return value as unknown as PdfDocumentAdapter;
}
async function defaultLoad(data: Uint8Array): Promise<PdfDocumentAdapter> {
  const task = getDocument({ data: new Uint8Array(data), isEvalSupported: false, useWorkerFetch: false, disableFontFace: true });
  try {
    const document = await task.promise; let destroyed = false;
    return {
      numPages: document.numPages,
      getPage: async (pageNumber) => { const page = await document.getPage(pageNumber); return { getTextContent: async () => page.getTextContent() }; },
      destroy: async () => { if (!destroyed) { destroyed = true; await document.destroy(); } },
    };
  } catch (cause) {
    try { await task.destroy(); } catch { /* Preserve the load failure. */ }
    throw cause;
  }
}
function makeFragment(request: DocumentExtractionRequest, pageNumber: number, blockNumber: number, block: TextBlock, createdAt: string): SourceFragment {
  const locator: SourceLocator = { pageNumber, objectId: `text:${blockNumber}`, objectName: `文本段 ${blockNumber}`, ...(block.boundingBox ? { boundingBox: block.boundingBox } : {}) };
  const digest = sha256Hex(JSON.stringify([request.projectId, request.documentId, request.documentVersionId, pageNumber, blockNumber, block.rawText, locator]));
  return parseSourceFragment({
    id: `pdf:${digest}`, projectId: request.projectId, documentId: request.documentId,
    documentVersionId: request.documentVersionId, sourceKind: 'pdf_text', locator,
    rawText: block.rawText, normalizedText: block.normalizedText, extractionMethod: 'pdfjs',
    extractionVersion: 'pdfjs-5.6.205', contentHash: `sha256:${digest}`, createdAt,
  });
}

export async function extractPdfFragments(input: DocumentExtractionRequest, dependencies: PdfExtractionDependencies = {}): Promise<DocumentExtractionResult> {
  const request = validateDocumentExtractionRequest(input);
  if (request.kind !== 'pdf') throw error('unsupported-format', 'PDF extraction requires kind "pdf".');
  const isCancelled = dependencies.isCancelled ?? (() => false);
  if (isCancelled()) throw error('cancelled', 'PDF extraction was cancelled.');
  const createdAt = extractionTimestamp(dependencies.now ?? (() => new Date()));
  let document: PdfDocumentAdapter | undefined;
  let cleanup: (() => Promise<void>) | undefined;
  let cleanupCalled = false;
  let result: DocumentExtractionResult | undefined;
  let primaryError: DocumentExtractorError | undefined;
  try {
    let loaded: unknown;
    try {
      loaded = await (dependencies.load ?? defaultLoad)(new Uint8Array(request.data));
    } catch (cause) {
      if (cause instanceof DocumentExtractorError) throw cause;
      throw isPasswordError(cause) ? error('password-protected', 'Password-protected PDFs are unsupported.', cause) : error('malformed-document', 'PDF could not be loaded.', cause);
    }
    if (isRecord(loaded) && typeof loaded.destroy === 'function') {
      const destroy = loaded.destroy;
      cleanup = async () => {
        if (cleanupCalled) return;
        cleanupCalled = true;
        await destroy.call(loaded);
      };
    }
    document = validateDocumentAdapter(loaded);
    if (document.numPages > MAX_PDF_PAGES) throw error('page-limit', 'PDF cannot contain more than 500 pages.');
    const fragments: SourceFragment[] = []; const needsOcrPageNumbers: number[] = []; let total = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (isCancelled()) throw error('cancelled', 'PDF extraction was cancelled.');
      let pageBlocks: readonly TextBlock[];
      try {
        const page = await document.getPage(pageNumber);
        if (!isRecord(page) || typeof page.getTextContent !== 'function') {
          throw error('malformed-document', 'PDF page adapter is invalid.');
        }
        pageBlocks = blocks(
          contentItems(await page.getTextContent()),
          MAX_EXTRACTED_TEXT_LENGTH - total,
        );
      } catch (cause) {
        if (cause instanceof DocumentExtractorError && cause.code === 'text-limit') {
          throw cause;
        }
        throw error('malformed-document', `PDF page ${pageNumber} could not be read.`, cause);
      }
      if (pageBlocks.length === 0) { needsOcrPageNumbers.push(pageNumber); continue; }
      for (const [index, block] of pageBlocks.entries()) {
        if (block.rawText.length > MAX_FRAGMENT_TEXT_LENGTH || block.normalizedText.length > MAX_FRAGMENT_TEXT_LENGTH || block.rawText.length > MAX_EXTRACTED_TEXT_LENGTH - total) {
          throw error('text-limit', 'Extracted PDF text exceeds its limit.');
        }
        total += block.rawText.length; fragments.push(makeFragment(request, pageNumber, index + 1, block, createdAt));
      }
    }
    result = freezeDocumentExtractionResult({ fragments, needsOcrPageNumbers, warnings: [] });
  } catch (cause) {
    primaryError = cause instanceof DocumentExtractorError
      ? cause
      : error('malformed-document', 'PDF extraction failed.', cause);
  }

  let cleanupFailed = false;
  let cleanupCause: unknown;
  try {
    await cleanup?.();
  } catch (cause) {
    cleanupFailed = true;
    cleanupCause = cause;
  }
  if (primaryError) throw primaryError;
  if (cleanupFailed) {
    throw error('malformed-document', 'PDF cleanup failed.', cleanupCause);
  }
  if (!result) {
    throw error('worker-failed', 'PDF extraction did not produce a result.');
  }
  return result;
}
