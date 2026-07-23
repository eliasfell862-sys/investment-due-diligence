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

export const MAX_PDF_FRAGMENTS = 10_000;
const MAX_PDF_TEXT_ITEMS_PER_PAGE = 100_000;
const MAX_PDF_BOUNDING_BOX_VALUE = 1_000_000_000;

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
  try {
    if (!isRecord(value)) {
      throw error('malformed-document', 'PDF text content contains an invalid item.');
    }
    const hasText = Object.prototype.hasOwnProperty.call(value, 'str');
    const type = value.type;
    if (!hasText) {
      if (typeof type === 'string') return null;
      throw error('malformed-document', 'PDF text content contains an invalid item.');
    }
    const str = value.str;
    const transform = value.transform;
    const widthValue = value.width;
    const heightValue = value.height;
    const hasEOL = value.hasEOL;
    if (typeof str !== 'string') {
      throw error('malformed-document', 'PDF text item text must be a string.');
    }
    if (str.length > MAX_FRAGMENT_TEXT_LENGTH) {
      throw error('text-limit', 'A PDF text item exceeds the fragment text limit.');
    }
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
    const width = isFiniteNumber(widthValue) && widthValue >= 0 ? widthValue : undefined;
    const height = isFiniteNumber(heightValue) && heightValue >= 0 ? heightValue : undefined;
    const endX = x !== undefined && width !== undefined ? x + width : undefined;
    const endY = y !== undefined && height !== undefined ? y + height : undefined;
    const geometryValues = [x, y, width, height, endX, endY];
    const boundedGeometry = geometryValues.every(
      (coordinate) => coordinate !== undefined
        && Number.isFinite(coordinate)
        && coordinate >= 0
        && coordinate <= MAX_PDF_BOUNDING_BOX_VALUE,
    );
    return {
      str,
      hasEOL: hasEOL === true,
      ...(boundedGeometry ? {
        x: x!,
        y: y!,
        width: width!,
        height: height!,
        boundingBox: [x!, y!, width!, height!] as const,
      } : {}),
    };
  } catch (cause) {
    if (cause instanceof DocumentExtractorError) throw cause;
    throw error('malformed-document', 'PDF text item could not be read.', cause);
  }
}
function contentItems(value: unknown): readonly unknown[] {
  try {
    if (!isRecord(value)) {
      throw error('malformed-document', 'PDF page returned invalid text content.');
    }
    const items = value.items;
    if (!Array.isArray(items)) {
      throw error('malformed-document', 'PDF page returned invalid text content.');
    }
    return items;
  } catch (cause) {
    if (cause instanceof DocumentExtractorError) throw cause;
    throw error('malformed-document', 'PDF text content could not be read.', cause);
  }
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
  const rightContinuesGrapheme = /^\p{M}/u.test(right.str)
    || right.str.startsWith('\u200d')
    || right.str.startsWith('\ufe0e')
    || right.str.startsWith('\ufe0f');
  const rightContinuesExtendedEmoji =
    /^[\u{1f3fb}-\u{1f3ff}]/u.test(right.str)
    || /^[\u{e0020}-\u{e007f}]/u.test(right.str);
  const regionalIndicatorPair =
    /[\u{1f1e6}-\u{1f1ff}]$/u.test(left.str)
    && /^[\u{1f1e6}-\u{1f1ff}]/u.test(right.str);
  if (/\s$/u.test(left.str) || /^\s/u.test(right.str)
    || rightContinuesGrapheme || rightContinuesExtendedEmoji
    || left.str.endsWith('\u200d') || regionalIndicatorPair) {
    return '';
  }
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
  const boundingWidth = accumulator.maxX - accumulator.minX;
  const boundingHeight = accumulator.maxY - accumulator.minY;
  const finalGeometry = [
    accumulator.minX,
    accumulator.minY,
    boundingWidth,
    boundingHeight,
    accumulator.maxX,
    accumulator.maxY,
  ];
  const boundedFinalGeometry = finalGeometry.every(
    (coordinate) => Number.isFinite(coordinate)
      && coordinate >= 0
      && coordinate <= MAX_PDF_BOUNDING_BOX_VALUE,
  );
  const boundingBox = accumulator.boundingBoxValid && accumulator.hasBoundingBox
    && boundedFinalGeometry
    ? [
      accumulator.minX,
      accumulator.minY,
      boundingWidth,
      boundingHeight,
    ] as const
    : undefined;
  return { rawText, normalizedText, ...(boundingBox === undefined ? {} : { boundingBox }) };
}
function blocks(
  items: readonly unknown[],
  remainingTextLength: number,
  remainingFragmentCount: number,
): readonly TextBlock[] {
  if (items.length > MAX_PDF_TEXT_ITEMS_PER_PAGE) {
    throw error('text-limit', 'PDF page contains too many text items.');
  }
  const result: TextBlock[] = [];
  let emittedTextLength = 0;
  let current = emptyAccumulator();
  const flush = () => {
    const block = finishBlock(current);
    if (block) {
      if (result.length >= remainingFragmentCount) {
        throw error('text-limit', 'PDF contains too many text fragments.');
      }
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
    const iso = Date.prototype.toISOString.call(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(iso)) {
      throw new RangeError('Extraction timestamp must use a four-digit UTC year.');
    }
    return iso;
  } catch (cause) { throw error('malformed-document', 'Extraction timestamp is invalid.', cause); }
}
function isPasswordError(value: unknown): boolean {
  return isRecord(value) && (value.name === 'PasswordException' || value.code === 1 || value.code === 2);
}

function snapshotRequest(input: DocumentExtractionRequest): DocumentExtractionRequest {
  try {
    if (!isRecord(input)) {
      throw error('malformed-document', 'PDF extraction request is invalid.');
    }
    return validateDocumentExtractionRequest({
      projectId: input.projectId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      fileName: input.fileName,
      kind: input.kind,
      data: input.data,
    });
  } catch (cause) {
    if (cause instanceof DocumentExtractorError) throw cause;
    throw error('malformed-document', 'PDF extraction request could not be read.', cause);
  }
}

interface SnapshotDependencies {
  readonly load?: (data: Uint8Array) => Promise<PdfDocumentAdapter>;
  readonly now?: () => Date;
  readonly isCancelled?: () => boolean;
}

function snapshotDependencies(value: PdfExtractionDependencies): SnapshotDependencies {
  try {
    if (!isRecord(value)) {
      throw error('malformed-document', 'PDF extraction dependencies are invalid.');
    }
    const load = value.load;
    const now = value.now;
    const isCancelled = value.isCancelled;
    if (load !== undefined && typeof load !== 'function') {
      throw error('malformed-document', 'PDF loader dependency is invalid.');
    }
    if (now !== undefined && typeof now !== 'function') {
      throw error('malformed-document', 'PDF clock dependency is invalid.');
    }
    if (isCancelled !== undefined && typeof isCancelled !== 'function') {
      throw error('malformed-document', 'PDF cancellation dependency is invalid.');
    }
    return {
      load: load as SnapshotDependencies['load'],
      now: now as SnapshotDependencies['now'],
      isCancelled: isCancelled as SnapshotDependencies['isCancelled'],
    };
  } catch (cause) {
    if (cause instanceof DocumentExtractorError) throw cause;
    throw error('malformed-document', 'PDF extraction dependencies could not be read.', cause);
  }
}

function cancellationRequested(isCancelled: (() => boolean) | undefined): boolean {
  try {
    return isCancelled?.() === true;
  } catch (cause) {
    throw error('malformed-document', 'PDF cancellation check failed.', cause);
  }
}

function validateDocumentAdapter(
  value: unknown,
  onDestroy: (destroy: () => Promise<void>) => void,
): PdfDocumentAdapter {
  try {
    if (!isRecord(value)) {
      throw error('malformed-document', 'PDF loader returned an invalid document adapter.');
    }
    const destroy = value.destroy;
    const destroySnapshot = typeof destroy === 'function'
      ? async () => { await destroy.call(value); }
      : undefined;
    if (destroySnapshot) onDestroy(destroySnapshot);
    const numPages = value.numPages;
    const getPage = value.getPage;
    if (
      !Number.isInteger(numPages)
      || (numPages as number) <= 0
      || typeof getPage !== 'function'
      || !destroySnapshot
    ) {
      throw error('malformed-document', 'PDF loader returned an invalid document adapter.');
    }
    return {
      numPages: numPages as number,
      getPage: async (pageNumber) => getPage.call(value, pageNumber) as PdfPageAdapter,
      destroy: destroySnapshot,
    };
  } catch (cause) {
    if (cause instanceof DocumentExtractorError) throw cause;
    throw error('malformed-document', 'PDF document adapter could not be read.', cause);
  }
}

function validatePageAdapter(value: unknown): PdfPageAdapter {
  try {
    if (!isRecord(value)) {
      throw error('malformed-document', 'PDF page adapter is invalid.');
    }
    const getTextContent = value.getTextContent;
    if (typeof getTextContent !== 'function') {
      throw error('malformed-document', 'PDF page adapter is invalid.');
    }
    return {
      getTextContent: async () => getTextContent.call(value),
    };
  } catch (cause) {
    if (cause instanceof DocumentExtractorError) throw cause;
    throw error('malformed-document', 'PDF page adapter could not be read.', cause);
  }
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
  let cleanup: (() => Promise<void>) | undefined;
  let cleanupCalled = false;
  let result: DocumentExtractionResult | undefined;
  let primaryError: DocumentExtractorError | undefined;
  try {
    const request = snapshotRequest(input);
    const dependencySnapshot = snapshotDependencies(dependencies);
    if (request.kind !== 'pdf') {
      throw error('unsupported-format', 'PDF extraction requires kind "pdf".');
    }
    if (cancellationRequested(dependencySnapshot.isCancelled)) {
      throw error('cancelled', 'PDF extraction was cancelled.');
    }
    const createdAt = extractionTimestamp(dependencySnapshot.now ?? (() => new Date()));
    let loaded: unknown;
    try {
      loaded = await (dependencySnapshot.load ?? defaultLoad)(new Uint8Array(request.data));
    } catch (cause) {
      if (cause instanceof DocumentExtractorError) throw cause;
      throw isPasswordError(cause) ? error('password-protected', 'Password-protected PDFs are unsupported.', cause) : error('malformed-document', 'PDF could not be loaded.', cause);
    }
    const document = validateDocumentAdapter(loaded, (destroy) => {
      cleanup = async () => {
        if (cleanupCalled) return;
        cleanupCalled = true;
        await destroy();
      };
    });
    if (document.numPages > MAX_PDF_PAGES) throw error('page-limit', 'PDF cannot contain more than 500 pages.');
    const fragments: SourceFragment[] = []; const needsOcrPageNumbers: number[] = []; let total = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (cancellationRequested(dependencySnapshot.isCancelled)) {
        throw error('cancelled', 'PDF extraction was cancelled.');
      }
      let pageBlocks: readonly TextBlock[];
      try {
        const page = validatePageAdapter(await document.getPage(pageNumber));
        pageBlocks = blocks(
          contentItems(await page.getTextContent()),
          MAX_EXTRACTED_TEXT_LENGTH - total,
          MAX_PDF_FRAGMENTS - fragments.length,
        );
      } catch (cause) {
        if (cause instanceof DocumentExtractorError && cause.code === 'text-limit') {
          throw cause;
        }
        throw error('malformed-document', `PDF page ${pageNumber} could not be read.`, cause);
      }
      if (pageBlocks.length === 0) { needsOcrPageNumbers.push(pageNumber); continue; }
      for (const [index, block] of pageBlocks.entries()) {
        if (fragments.length >= MAX_PDF_FRAGMENTS) {
          throw error('text-limit', 'PDF contains too many text fragments.');
        }
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
