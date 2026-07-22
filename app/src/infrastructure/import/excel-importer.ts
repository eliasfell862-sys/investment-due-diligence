import Decimal from 'decimal.js';
import * as XLSX from 'xlsx';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import {
  findTargetFieldDefinition,
  type TargetFieldDefinition,
} from '../../domain/evidence/target-fields';
import excelImportWorkerUrl from './excel-import.worker?worker&url';

export interface InspectedCell {
  readonly value: unknown;
  readonly w?: string;
  readonly f?: string;
  readonly t?: string;
  readonly z?: string;
}

export interface InspectedSheet {
  readonly name: string;
  readonly headers: string[];
  readonly rows: Record<string, unknown>[];
  readonly cells: Record<string, InspectedCell>[];
  readonly startRow: number;
  readonly startColumn: number;
  readonly headerRowIndex: number;
}

export interface InspectedWorkbook {
  sheetNames: string[];
  sheets: Record<string, InspectedSheet>;
}

export type ExcelImporterErrorCode =
  | 'malformed-zip'
  | 'zip-entry-limit'
  | 'zip-entry-too-large'
  | 'zip-expanded-size-limit'
  | 'zip-compression-ratio'
  | 'worker-timeout'
  | 'worker-failed'
  | 'empty-input'
  | 'input-too-large'
  | 'parse-failed'
  | 'no-sheets'
  | 'invalid-sheet-name'
  | 'duplicate-sheet-name'
  | 'ambiguous-header-row'
  | 'invalid-header-row'
  | 'invalid-cell-value'
  | 'text-limit-exceeded'
  | 'too-many-sheets'
  | 'too-many-rows'
  | 'too-many-columns'
  | 'too-many-cells'
  | 'invalid-header'
  | 'duplicate-header'
  | 'unsafe-header'
  | 'time-budget-exceeded'
  | 'invalid-project'
  | 'invalid-source-document'
  | 'invalid-import-batch'
  | 'invalid-field'
  | 'unknown-target-field'
  | 'non-importable-target-field'
  | 'duplicate-target-field'
  | 'unknown-column'
  | 'empty-mapping';

export class ExcelImporterError extends Error {
  readonly code: ExcelImporterErrorCode;
  override readonly cause: unknown;

  constructor(code: ExcelImporterErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ExcelImporterError';
    this.code = code;
    this.cause = cause;
  }
}

export interface WorkbookTextLimits {
  readonly sheetName: number;
  readonly header: number;
  readonly cell: number;
  readonly formula: number;
  readonly numberFormat: number;
  readonly total: number;
}

export interface WorkbookInspectionOptions {
  now?: () => number;
  timeBudgetMs?: number;
  headerRowBySheet?: Readonly<Record<string, number>>;
  archiveLimits?: {
    maxEntryUncompressedBytes?: number;
    maxTotalUncompressedBytes?: number;
  };
  textLimits?: Partial<WorkbookTextLimits>;
}

export interface EvidenceMappingOptions {
  createId?: () => string;
  createImportBatchId?: () => string;
  nowDate?: () => Date;
}


const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_SHEETS = 20;
const MAX_ROWS_PER_SHEET = 50_000;
const MAX_COLUMNS_PER_SHEET = 256;
const MAX_TOTAL_REPRESENTED_CELLS = 250_000;
const DEFAULT_TIME_BUDGET_MS = 2_000;

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIZE = 22;
const ZIP_CENTRAL_ENTRY_SIZE = 46;
const ZIP_MAX_COMMENT_SIZE = 65_535;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_ZIP_COMPRESSION_RATIO = 100;
const MAX_WORKBOOK_TEXT_LIMITS: WorkbookTextLimits = {
  sheetName: 31,
  header: 256,
  cell: 65_536,
  formula: 8_192,
  numberFormat: 1_024,
  total: 1024 * 1024,
};

function boundedTextLimit(supplied: number | undefined, maximum: number): number {
  if (supplied === undefined || !Number.isFinite(supplied)) {
    return maximum;
  }
  return Math.min(maximum, Math.max(0, Math.floor(supplied)));
}

function workbookTextLimits(supplied?: Partial<WorkbookTextLimits>): WorkbookTextLimits {
  return {
    sheetName: boundedTextLimit(supplied?.sheetName, MAX_WORKBOOK_TEXT_LIMITS.sheetName),
    header: boundedTextLimit(supplied?.header, MAX_WORKBOOK_TEXT_LIMITS.header),
    cell: boundedTextLimit(supplied?.cell, MAX_WORKBOOK_TEXT_LIMITS.cell),
    formula: boundedTextLimit(supplied?.formula, MAX_WORKBOOK_TEXT_LIMITS.formula),
    numberFormat: boundedTextLimit(supplied?.numberFormat, MAX_WORKBOOK_TEXT_LIMITS.numberFormat),
    total: boundedTextLimit(supplied?.total, MAX_WORKBOOK_TEXT_LIMITS.total),
  };
}

class WorkbookTextBudget {
  private total = 0;

  private readonly limits: WorkbookTextLimits;

  constructor(limits: WorkbookTextLimits) {
    this.limits = limits;
  }

  add(value: string, limit: number, label: string): void {
    if (value.length > limit) {
      throw importerError('text-limit-exceeded', `${label} exceeds the workbook text limit.`);
    }
    if (value.length > this.limits.total - this.total) {
      throw importerError(
        'text-limit-exceeded',
        'Workbook text exceeds the aggregate text limit.',
      );
    }
    this.total += value.length;
  }
}
function workbookBytesView(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}

function malformedZip(message: string): never {
  throw importerError('malformed-zip', message);
}

function findZipEocd(view: DataView): number {
  if (view.byteLength < ZIP_EOCD_SIZE) {
    malformedZip('ZIP end-of-central-directory record is missing.');
  }
  const minimumOffset = Math.max(
    0,
    view.byteLength - ZIP_EOCD_SIZE - ZIP_MAX_COMMENT_SIZE,
  );
  for (let offset = view.byteLength - ZIP_EOCD_SIZE; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }
  return malformedZip('ZIP end-of-central-directory record is missing.');
}

function checkedZipEnd(start: number, size: number, limit: number, label: string): number {
  if (start > limit || size > limit - start) {
    malformedZip(`${label} exceeds workbook bounds.`);
  }
  return start + size;
}

const ZIP_LOCAL_ENTRY_SIGNATURE = 0x04034b50;
const ZIP_LOCAL_ENTRY_SIZE = 30;

interface ZipEntryDescriptor {
  readonly name: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly dataOffset: number;
}

interface WorkbookArchiveLimits {
  readonly maxEntryUncompressedBytes: number;
  readonly maxTotalUncompressedBytes: number;
}

function workbookArchiveLimits(
  supplied: WorkbookInspectionOptions['archiveLimits'],
): WorkbookArchiveLimits {
  return {
    maxEntryUncompressedBytes: Math.min(
      MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES,
      Math.max(0, supplied?.maxEntryUncompressedBytes ?? MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES),
    ),
    maxTotalUncompressedBytes: Math.min(
      MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
      Math.max(0, supplied?.maxTotalUncompressedBytes ?? MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES),
    ),
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseWorkbookZipEntries(data: ArrayBuffer | Uint8Array): readonly ZipEntryDescriptor[] {
  const bytes = workbookBytesView(data);
  const hasLeadingZipSignature = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const searchStart = bytes.length - ZIP_EOCD_SIZE;
  const searchEnd = Math.max(0, bytes.length - ZIP_EOCD_SIZE - ZIP_MAX_COMMENT_SIZE);
  let hasEocd = false;
  if (searchStart >= 0) {
    const candidateView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = searchStart; offset >= searchEnd; offset -= 1) {
      if (candidateView.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
        hasEocd = true;
        break;
      }
    }
  }
  if (!hasLeadingZipSignature && !hasEocd) {
    return [];
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findZipEocd(view);
  const commentLength = view.getUint16(eocdOffset + 20, true);
  if (checkedZipEnd(eocdOffset, ZIP_EOCD_SIZE + commentLength, view.byteLength, 'ZIP EOCD') !== view.byteLength) {
    malformedZip('ZIP EOCD comment length is inconsistent.');
  }

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    malformedZip('Multi-disk and ZIP64 workbooks are not supported.');
  }
  if (entryCount > MAX_ZIP_ENTRIES) {
    throw importerError('zip-entry-limit', 'Workbook ZIP cannot contain more than 2,000 entries.');
  }

  const centralDirectoryEnd = checkedZipEnd(
    centralDirectoryOffset,
    centralDirectorySize,
    eocdOffset,
    'ZIP central directory',
  );
  let resourceCursor = centralDirectoryOffset;
  let totalDeclaredUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    checkedZipEnd(resourceCursor, ZIP_CENTRAL_ENTRY_SIZE, centralDirectoryEnd, 'ZIP central entry');
    if (view.getUint32(resourceCursor, true) !== ZIP_CENTRAL_ENTRY_SIGNATURE) {
      malformedZip('ZIP central directory entry signature is invalid.');
    }
    const uncompressedSize = view.getUint32(resourceCursor + 24, true);
    if (uncompressedSize > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES - totalDeclaredUncompressedBytes) {
      throw importerError(
        'zip-expanded-size-limit',
        'Workbook ZIP entries cannot expand beyond 200 MiB in total.',
      );
    }
    totalDeclaredUncompressedBytes += uncompressedSize;
    const fileNameLength = view.getUint16(resourceCursor + 28, true);
    const extraLength = view.getUint16(resourceCursor + 30, true);
    const entryCommentLength = view.getUint16(resourceCursor + 32, true);
    resourceCursor = checkedZipEnd(
      resourceCursor,
      ZIP_CENTRAL_ENTRY_SIZE + fileNameLength + extraLength + entryCommentLength,
      centralDirectoryEnd,
      'ZIP central entry',
    );
  }
  let cursor = centralDirectoryOffset;
  let totalUncompressedBytes = 0;
  const entries: ZipEntryDescriptor[] = [];
  const localRanges: Array<readonly [number, number]> = [];

  for (let index = 0; index < entryCount; index += 1) {
    checkedZipEnd(cursor, ZIP_CENTRAL_ENTRY_SIZE, centralDirectoryEnd, 'ZIP central entry');
    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_ENTRY_SIGNATURE) {
      malformedZip('ZIP central directory entry signature is invalid.');
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc32 = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const entryCommentLength = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      diskStart !== 0
    ) {
      malformedZip('ZIP64 and multi-disk entries are not supported.');
    }
    if ((flags & 0x0001) !== 0) {
      malformedZip('Encrypted ZIP entries are not supported.');
    }
    if ((flags & 0x0008) !== 0) {
      malformedZip('ZIP data descriptors are not supported.');
    }
    const allowedFlags = method === 8 ? 0x0806 : 0x0800;
    if ((flags & ~allowedFlags) !== 0 || (method !== 0 && method !== 8)) {
      malformedZip('ZIP entry flags or compression method are not supported.');
    }
    if (uncompressedSize > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES) {
      throw importerError(
        'zip-entry-too-large',
        'A workbook ZIP entry cannot expand beyond 100 MiB.',
      );
    }
    if (
      uncompressedSize > 0 &&
      (compressedSize === 0 || uncompressedSize > compressedSize * MAX_ZIP_COMPRESSION_RATIO)
    ) {
      throw importerError(
        'zip-compression-ratio',
        'A workbook ZIP entry exceeds the 100:1 compression ratio limit.',
      );
    }
    if (uncompressedSize > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES - totalUncompressedBytes) {
      throw importerError(
        'zip-expanded-size-limit',
        'Workbook ZIP entries cannot expand beyond 200 MiB in total.',
      );
    }
    totalUncompressedBytes += uncompressedSize;

    const centralEntryEnd = checkedZipEnd(
      cursor,
      ZIP_CENTRAL_ENTRY_SIZE + fileNameLength + extraLength + entryCommentLength,
      centralDirectoryEnd,
      'ZIP central entry',
    );
    const centralName = bytes.slice(cursor + ZIP_CENTRAL_ENTRY_SIZE, cursor + ZIP_CENTRAL_ENTRY_SIZE + fileNameLength);

    checkedZipEnd(localHeaderOffset, ZIP_LOCAL_ENTRY_SIZE, centralDirectoryOffset, 'ZIP local entry');
    if (view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_ENTRY_SIGNATURE) {
      malformedZip('ZIP local entry signature is invalid.');
    }
    const localFlags = view.getUint16(localHeaderOffset + 6, true);
    const localMethod = view.getUint16(localHeaderOffset + 8, true);
    const localCrc32 = view.getUint32(localHeaderOffset + 14, true);
    const localCompressedSize = view.getUint32(localHeaderOffset + 18, true);
    const localUncompressedSize = view.getUint32(localHeaderOffset + 22, true);
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const localHeaderEnd = checkedZipEnd(
      localHeaderOffset,
      ZIP_LOCAL_ENTRY_SIZE + localNameLength + localExtraLength,
      centralDirectoryOffset,
      'ZIP local entry',
    );
    const localName = bytes.slice(
      localHeaderOffset + ZIP_LOCAL_ENTRY_SIZE,
      localHeaderOffset + ZIP_LOCAL_ENTRY_SIZE + localNameLength,
    );
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localCrc32 !== crc32 ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize ||
      !equalBytes(localName, centralName)
    ) {
      malformedZip('ZIP central and local entry metadata are inconsistent.');
    }
    const dataEnd = checkedZipEnd(
      localHeaderEnd,
      compressedSize,
      centralDirectoryOffset,
      'ZIP local entry data',
    );
    localRanges.push([localHeaderOffset, dataEnd]);
    entries.push({
      name: centralName,
      flags,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      dataOffset: localHeaderEnd,
    });
    cursor = centralEntryEnd;
  }

  if (cursor !== centralDirectoryEnd) {
    malformedZip('ZIP central directory size is inconsistent.');
  }
  localRanges.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index]![0] < localRanges[index - 1]![1]) {
      malformedZip('ZIP local entries overlap.');
    }
  }
  return entries;
}

export function preflightWorkbookData(data: ArrayBuffer | Uint8Array): void {
  if (data.byteLength === 0) {
    throw importerError('empty-input', 'Workbook input cannot be empty.');
  }
  if (data.byteLength > MAX_INPUT_BYTES) {
    throw importerError('input-too-large', 'Workbook input cannot exceed 25 MiB.');
  }

  parseWorkbookZipEntries(data);
}

async function validateWorkbookArchiveOutput(
  data: ArrayBuffer | Uint8Array,
  limits: WorkbookArchiveLimits,
): Promise<void> {
  const bytes = workbookBytesView(data);
  const entries = parseWorkbookZipEntries(bytes);
  let totalActualBytes = 0;

  for (const entry of entries) {
    let actualBytes = 0;
    if (entry.method === 0) {
      actualBytes = entry.compressedSize;
    } else {
      const compressed = bytes.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const source = new ReadableStream<BufferSource>({
          start(controller) {
            controller.enqueue(compressed);
            controller.close();
          },
        });
        const stream = source.pipeThrough(
          new DecompressionStream('deflate-raw'),
        );
        reader = stream.getReader();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          actualBytes += chunk.value.byteLength;
          if (actualBytes > limits.maxEntryUncompressedBytes) {
            await reader.cancel();
            throw importerError(
              'zip-entry-too-large',
              'A workbook ZIP entry cannot expand beyond 100 MiB.',
            );
          }
          if (actualBytes > limits.maxTotalUncompressedBytes - totalActualBytes) {
            await reader.cancel();
            throw importerError(
              'zip-expanded-size-limit',
              'Workbook ZIP entries cannot expand beyond 200 MiB in total.',
            );
          }
        }
      } catch (error) {
        if (error instanceof ExcelImporterError) {
          throw error;
        }
        throw importerError('malformed-zip', 'ZIP entry decompression failed.', error);
      } finally {
        reader?.releaseLock();
      }
    }
    if (actualBytes !== entry.uncompressedSize) {
      malformedZip('ZIP entry actual output size differs from its declaration.');
    }
    if (actualBytes > limits.maxTotalUncompressedBytes - totalActualBytes) {
      throw importerError(
        'zip-expanded-size-limit',
        'Workbook ZIP entries cannot expand beyond 200 MiB in total.',
      );
    }
    totalActualBytes += actualBytes;
  }
}
function importerError(
  code: ExcelImporterErrorCode,
  message: string,
  cause?: unknown,
): ExcelImporterError {
  return new ExcelImporterError(code, message, cause);
}

function validateElapsed(startedAt: number, now: () => number, budgetMs: number) {
  if (now() - startedAt > budgetMs) {
    throw importerError(
      'time-budget-exceeded',
      `Workbook inspection exceeded the ${budgetMs} ms time budget.`,
    );
  }
}

function normalizeHeader(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isUnsafeHeader(header: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(Object.prototype, header) || header === 'prototype'
  );
}

function worksheetCell(
  worksheet: XLSX.WorkSheet,
  row: number,
  column: number,
): XLSX.CellObject | undefined {
  return worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
}

function selectHeaderRow(
  worksheet: XLSX.WorkSheet,
  sheetName: string,
  range: XLSX.Range,
  options: WorkbookInspectionOptions,
): number {
  const configuredRows = options.headerRowBySheet;
  if (
    configuredRows &&
    Object.prototype.hasOwnProperty.call(configuredRows, sheetName)
  ) {
    const configuredRow = configuredRows[sheetName]!;
    if (
      !Number.isInteger(configuredRow) ||
      configuredRow < range.s.r ||
      configuredRow > range.e.r
    ) {
      throw importerError(
        'invalid-header-row',
        `Configured header row for sheet "${sheetName}" is outside the used range.`,
      );
    }
    return configuredRow;
  }

  const finalScanRow = Math.min(range.e.r, range.s.r + 19);
  let bestScore = 0;
  const bestRows: number[] = [];
  for (let row = range.s.r; row <= finalScanRow; row += 1) {
    const distinctHeaders = new Set<string>();
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const header = normalizeHeader(worksheetCell(worksheet, row, column)?.v);
      if (header) {
        distinctHeaders.add(header);
      }
    }
    const score = distinctHeaders.size;
    if (score > bestScore) {
      bestScore = score;
      bestRows.length = 0;
      bestRows.push(row);
    } else if (score === bestScore && score > 0) {
      bestRows.push(row);
    }
  }

  if (bestScore === 0) {
    throw importerError('invalid-header', `Sheet "${sheetName}" has no usable header row.`);
  }
  if (bestRows.length !== 1) {
    throw importerError(
      'ambiguous-header-row',
      `Sheet "${sheetName}" has ambiguous header rows; configure one explicitly.`,
    );
  }
  return bestRows[0]!;
}

function inspectedCell(
  value: unknown,
  cell: XLSX.CellObject | undefined,
  sheetName: string,
  locator: string,
  textBudget: WorkbookTextBudget,
  textLimits: WorkbookTextLimits,
): InspectedCell {
  if (
    cell?.t === 'e' ||
    (typeof value === 'number' && !Number.isFinite(value)) ||
    (value instanceof Date && Number.isNaN(value.getTime()))
  ) {
    throw importerError(
      'invalid-cell-value',
      `Sheet "${sheetName}" contains an invalid value at ${locator}.`,
    );
  }
  if (typeof value === 'string') {
    textBudget.add(value, textLimits.cell, 'Cell text');
  }
  if (typeof cell?.w === 'string') {
    textBudget.add(cell.w, textLimits.cell, 'Formatted cell text');
  }
  if (typeof cell?.f === 'string') {
    textBudget.add(cell.f, textLimits.formula, 'Cell formula');
  }
  if (typeof cell?.z === 'string') {
    textBudget.add(cell.z, textLimits.numberFormat, 'Cell number format');
  }
  return {
    value,
    ...(typeof cell?.w === 'string' ? { w: cell.w } : {}),
    ...(typeof cell?.f === 'string' ? { f: cell.f } : {}),
    ...(typeof cell?.t === 'string' ? { t: cell.t } : {}),
    ...(typeof cell?.z === 'string' ? { z: cell.z } : {}),
  };
}

/** Async validated boundary. UI callers still use inspectWorkbookInWorker for isolation. */
export async function inspectWorkbook(
  data: ArrayBuffer | Uint8Array,
  options: WorkbookInspectionOptions = {},
): Promise<InspectedWorkbook> {
  preflightWorkbookData(data);

  await validateWorkbookArchiveOutput(data, workbookArchiveLimits(options.archiveLimits));

  const now = options.now ?? (() => performance.now());
  const budgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const startedAt = now();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: 'array', cellDates: true, cellNF: true });
  } catch (error) {
    throw importerError('parse-failed', 'Workbook could not be parsed.', error);
  }
  validateElapsed(startedAt, now, budgetMs);

  const textLimits = workbookTextLimits(options.textLimits);
  const textBudget = new WorkbookTextBudget(textLimits);
  const sheetNames = [...workbook.SheetNames];
  for (const name of sheetNames) {
    textBudget.add(name, textLimits.sheetName, 'Sheet name');
  }
  if (sheetNames.length === 0) {
    throw importerError('no-sheets', 'Workbook must contain at least one sheet.');
  }
  if (sheetNames.length > MAX_SHEETS) {
    throw importerError('too-many-sheets', 'Workbook cannot contain more than 20 sheets.');
  }
  if (sheetNames.some((name) => !name.trim())) {
    throw importerError('invalid-sheet-name', 'Workbook sheet names cannot be empty.');
  }
  if (new Set(sheetNames).size !== sheetNames.length) {
    throw importerError('duplicate-sheet-name', 'Workbook sheet names must be unique.');
  }

  const sheets: Record<string, InspectedSheet> = Object.create(null);
  let totalRepresentedCells = 0;

  for (const name of sheetNames) {
    const worksheet = workbook.Sheets[name];
    const reference = worksheet?.['!ref'];
    if (!worksheet || !reference) {
      throw importerError('invalid-header', `Sheet "${name}" has no header row.`);
    }

    const range = XLSX.utils.decode_range(reference);
    const columnCount = range.e.c - range.s.c + 1;
    if (columnCount > MAX_COLUMNS_PER_SHEET) {
      throw importerError(
        'too-many-columns',
        `Sheet "${name}" cannot contain more than 256 columns.`,
      );
    }

    const headerRowIndex = selectHeaderRow(worksheet, name, range, options);
    const dataRowCount = range.e.r - headerRowIndex;
    if (dataRowCount > MAX_ROWS_PER_SHEET) {
      throw importerError(
        'too-many-rows',
        `Sheet "${name}" cannot contain more than 50,000 data rows.`,
      );
    }

    const representedCells = dataRowCount * columnCount;
    if (representedCells > MAX_TOTAL_REPRESENTED_CELLS - totalRepresentedCells) {
      throw importerError(
        'too-many-cells',
        'Workbook cannot represent more than 250,000 data grid cells.',
      );
    }
    totalRepresentedCells += representedCells;

    const conversionRange: XLSX.Range = {
      s: { r: headerRowIndex, c: range.s.c },
      e: range.e,
    };
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: true,
      range: conversionRange,
    });
    const headerRow = matrix[0] ?? [];
    const headers = Array.from({ length: columnCount }, (_, index) =>
      normalizeHeader(headerRow[index]),
    );
    for (const header of headers) {
      textBudget.add(header, textLimits.header, 'Header');
    }
    if (headers.some((header) => !header)) {
      throw importerError(
        'invalid-header',
        `Sheet "${name}" contains an empty or non-string header.`,
      );
    }
    if (headers.some(isUnsafeHeader)) {
      throw importerError(
        'unsafe-header',
        `Sheet "${name}" contains a reserved header key.`,
      );
    }
    if (new Set(headers).size !== headers.length) {
      throw importerError('duplicate-header', `Sheet "${name}" contains duplicate headers.`);
    }

    const convertedRepresentedCells = (matrix.length - 1) * headers.length;
    if (convertedRepresentedCells !== representedCells) {
      throw importerError(
        'parse-failed',
        `Sheet "${name}" changed dimensions during conversion.`,
      );
    }

    const inspectedRows = matrix.slice(1).map((row, rowIndex) => {
      const values: [string, unknown][] = [];
      const metadata: [string, InspectedCell][] = [];
      headers.forEach((header, columnIndex) => {
        const sheetRow = headerRowIndex + rowIndex + 1;
        const sheetColumn = range.s.c + columnIndex;
        const locator = XLSX.utils.encode_cell({ r: sheetRow, c: sheetColumn });
        const cell = worksheetCell(worksheet, sheetRow, sheetColumn);
        const value = row[columnIndex] ?? null;
        if (typeof value === 'string') {
          textBudget.add(value, textLimits.cell, 'Row text');
        }
        values.push([header, value]);
        metadata.push([
          header,
          inspectedCell(value, cell, name, locator, textBudget, textLimits),
        ]);
      });
      return {
        row: Object.fromEntries(values),
        cells: Object.fromEntries(metadata),
      };
    });
    const inspectedSheet: InspectedSheet = {
      name,
      headers,
      rows: inspectedRows.map((entry) => entry.row),
      cells: inspectedRows.map((entry) => entry.cells),
      startRow: range.s.r,
      startColumn: range.s.c,
      headerRowIndex,
    };
    sheets[name] = inspectedSheet;
    validateElapsed(startedAt, now, budgetMs);
  }

  validateElapsed(startedAt, now, budgetMs);
  return { sheetNames, sheets };
}

function requireIdentifier(
  value: string,
  code:
    | 'invalid-project'
    | 'invalid-source-document'
    | 'invalid-field'
    | 'invalid-import-batch',
  label: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw importerError(code, `${label} is required.`);
  }
  return normalized;
}

function canonicalText(value: unknown): string {
  return String(value).trim().normalize('NFC');
}

function canonicalNumber(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw importerError('invalid-cell-value', 'Non-finite numbers cannot be mapped to evidence.');
    }
    return new Decimal(value).toString();
  }
  const textValue = canonicalText(value);
  const ungrouped = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const groupedEnUs = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
  if (!ungrouped.test(textValue) && !groupedEnUs.test(textValue)) {
    throw importerError('invalid-cell-value', 'Numeric fields require a valid en-US number.');
  }
  try {
    return new Decimal(textValue.replace(/,/g, '')).toString();
  } catch (error) {
    throw importerError('invalid-cell-value', 'Numeric fields require a valid decimal.', error);
  }
}

function canonicalPeriod(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw importerError('invalid-cell-value', 'Invalid dates cannot be mapped to evidence.');
    }
    return value.toISOString().slice(0, 10);
  }
  const textValue = canonicalText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(textValue)) {
    const parsed = new Date(`${textValue}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== textValue) {
      throw importerError('invalid-cell-value', 'Period fields require a valid date.');
    }
    return textValue;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(textValue)) {
    const parsed = new Date(textValue);
    if (Number.isNaN(parsed.getTime())) {
      throw importerError('invalid-cell-value', 'Period fields require a valid ISO date.');
    }
    return parsed.toISOString().slice(0, 10);
  }
  return textValue;
}

function normalizedCellValue(
  value: unknown,
  definition: TargetFieldDefinition,
  cell?: InspectedCell,
): string {
  if (cell?.t === 'e') {
    throw importerError('invalid-cell-value', 'Error cells cannot be mapped to evidence.');
  }
  switch (definition.valueKind) {
    case 'number':
      return canonicalNumber(value);
    case 'period':
      return canonicalPeriod(value);
    case 'dimension':
    case 'text':
      return canonicalText(value);
  }
}

function rawCellValue(value: unknown, cell?: InspectedCell): string {
  if (cell?.w !== undefined) {
    return cell.w;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function sourceSheetName(name: string): string {
  return /^[\p{L}\p{N}_]+$/u.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

export function mapRowsToEvidence(
  projectId: string,
  sourceDocumentId: string,
  sheet: InspectedSheet,
  mapping: Record<string, string>,
  options: EvidenceMappingOptions = {},
): EvidenceItem[] {
  const normalizedProjectId = requireIdentifier(projectId, 'invalid-project', 'Project id');
  const normalizedSourceDocumentId = requireIdentifier(
    sourceDocumentId,
    'invalid-source-document',
    'Source document id',
  );
  const headers = new Set(sheet.headers);
  if (Object.keys(mapping).length === 0) {
    throw importerError('empty-mapping', 'At least one field mapping is required.');
  }

  const seenTargetFields = new Set<string>();
  const validatedMapping = Object.entries(mapping).map(([column, fieldId]) => {
    if (!headers.has(column)) {
      throw importerError('unknown-column', `Mapped column "${column}" is not present in the sheet.`);
    }
    const normalizedFieldId = requireIdentifier(fieldId, 'invalid-field', 'Field id');
    const definition = findTargetFieldDefinition(normalizedFieldId);
    if (!definition) {
      throw importerError(
        'unknown-target-field',
        `Target field "${normalizedFieldId}" is not canonical.`,
      );
    }
    if (!definition.importable) {
      throw importerError(
        'non-importable-target-field',
        `Target field "${normalizedFieldId}" cannot be imported directly.`,
      );
    }
    if (seenTargetFields.has(normalizedFieldId)) {
      throw importerError(
        'duplicate-target-field',
        `Target field "${normalizedFieldId}" is mapped more than once.`,
      );
    }
    seenTargetFields.add(normalizedFieldId);
    return [column, normalizedFieldId, definition] as const;
  });

  const createId = options.createId ?? (() => crypto.randomUUID());
  const createImportBatchId = options.createImportBatchId ?? (() => crypto.randomUUID());
  const importBatchId = requireIdentifier(
    createImportBatchId(),
    'invalid-import-batch',
    'Import batch id',
  );
  const periodMapping = validatedMapping.find(
    ([, , definition]) => definition.identityKind === 'period',
  );
  const dimensionMappings = validatedMapping.filter(
    ([, , definition]) => definition.identityKind === 'dimension',
  );
  const sourceDocumentIdentity =
    `source-document:${encodeURIComponent(normalizedSourceDocumentId)}`;

  const defaultDimensionIdentity =
    `project:${encodeURIComponent(normalizedProjectId)}:default`;
  const updatedAt = (options.nowDate ?? (() => new Date()))().toISOString();
  const evidence: EvidenceItem[] = [];

  for (const [rowIndex, row] of sheet.rows.entries()) {
    const sourceRow = sheet.headerRowIndex + rowIndex + 2;
    const periodValue = periodMapping
      ? row[periodMapping[0]]
      : undefined;
    const periodCell = periodMapping
      ? sheet.cells[rowIndex]?.[periodMapping[0]]
      : undefined;
    const periodIdentity = periodValue !== null && periodValue !== undefined && periodValue !== ''
      ? normalizedCellValue(periodValue, periodMapping![2], periodCell)
      : `${sourceDocumentIdentity}:sheet:${encodeURIComponent(sheet.name)}:row:${sourceRow}`;
    const dimensionParts: string[] = [];
    for (const [dimensionColumn, dimensionFieldId, definition] of dimensionMappings) {
      const dimensionValue = row[dimensionColumn];
      if (dimensionValue === null || dimensionValue === undefined || dimensionValue === '') {
        continue;
      }
      const inspected = sheet.cells[rowIndex]?.[dimensionColumn];
      dimensionParts.push(
        `${dimensionFieldId}=${encodeURIComponent(normalizedCellValue(dimensionValue, definition, inspected))}`,
      );
    }
    const dimensionIdentity = dimensionParts.length > 0
      ? dimensionParts.join('|') : defaultDimensionIdentity;
    for (const [column, fieldId, definition] of validatedMapping) {
      const value = row[column];
      if (value === null || value === undefined || value === '') {
        continue;
      }
      const columnIndex = sheet.headers.indexOf(column);
      const inspected = sheet.cells[rowIndex]?.[column];
      const cell = XLSX.utils.encode_cell({
        c: sheet.startColumn + columnIndex,
        r: sheet.headerRowIndex + rowIndex + 1,
      });
      evidence.push({
        id: createId(),
        importBatchId,
        projectId: normalizedProjectId,
        fieldId,
        periodIdentity,
        dimensionIdentity,
        sourceDocumentId: normalizedSourceDocumentId,
        sourceLocator: `${sourceSheetName(sheet.name)}!${cell}`,
        sourceSheet: sheet.name,
        sourceRow,
        rawValue: rawCellValue(value, inspected),
        normalizedValue: normalizedCellValue(value, definition, inspected),
        ...(inspected?.w !== undefined ? { displayValue: inspected.w } : {}),
        ...(inspected?.f !== undefined ? { formula: inspected.f } : {}),
        ...(inspected?.t !== undefined ? { cellType: inspected.t } : {}),
        ...(inspected?.z !== undefined ? { numberFormat: inspected.z } : {}),
        confidence: 0.8,
        conflictStatus: 'none',
        updatedAt,
      });
    }
  }

  return evidence;
}

export interface SerializedExcelImporterError {
  readonly name: 'ExcelImporterError';
  readonly code: ExcelImporterErrorCode;
  readonly message: string;
}

export interface ExcelWorkerRequest {
  readonly data: ArrayBuffer | Uint8Array;
  readonly options: Pick<WorkbookInspectionOptions, 'headerRowBySheet' | 'timeBudgetMs' | 'textLimits'>;
}

export type ExcelWorkerResponse =
  | { readonly ok: true; readonly workbook: InspectedWorkbook }
  | { readonly ok: false; readonly error: SerializedExcelImporterError };

export interface ExcelImportWorker {
  onmessage: ((event: MessageEvent<ExcelWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ExcelWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface WorkerInspectionOptions {
  readonly timeoutMs?: number;
  readonly headerRowBySheet?: Readonly<Record<string, number>>;
  readonly textLimits?: Partial<WorkbookTextLimits>;
  readonly workerFactory?: (
    url: URL,
    options: { type: 'module' },
  ) => ExcelImportWorker;
  readonly setTimer?: (handler: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export function serializeExcelImporterError(error: unknown): SerializedExcelImporterError {
  if (error instanceof ExcelImporterError) {
    return { name: 'ExcelImporterError', code: error.code, message: error.message };
  }
  return {
    name: 'ExcelImporterError',
    code: 'worker-failed',
    message: error instanceof Error ? error.message : 'Excel workbook worker failed.',
  };
}

function isWorkerRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function workerFailed(error: unknown): ExcelImporterError {
  return new ExcelImporterError(
    'worker-failed',
    error instanceof Error ? error.message : 'Excel workbook worker failed.',
  );
}

function rebuildWorkerWorkbook(
  value: unknown,
  suppliedTextLimits?: Partial<WorkbookTextLimits>,
): InspectedWorkbook {
  if (!isWorkerRecord(value)) {
    throw workerFailed(new Error('Excel workbook worker returned an invalid workbook.'));
  }
  const sheetNamesValue = value.sheetNames;
  const sheetsValue = value.sheets;
  if (
    !Array.isArray(sheetNamesValue) ||
    sheetNamesValue.length > MAX_SHEETS ||
    !sheetNamesValue.every((name) => typeof name === 'string' && name.trim().length > 0) ||
    new Set(sheetNamesValue).size !== sheetNamesValue.length ||
    !isWorkerRecord(sheetsValue)
  ) {
    throw workerFailed(new Error('Excel workbook worker returned invalid sheet metadata.'));
  }
  if (sheetNamesValue.length === 0) {
    throw importerError('no-sheets', 'Excel workbook worker returned no sheets.');
  }

  const textLimits = workbookTextLimits(suppliedTextLimits);
  const textBudget = new WorkbookTextBudget(textLimits);
  const sheetNames = [...sheetNamesValue];
  for (const name of sheetNames) {
    textBudget.add(name, textLimits.sheetName, 'Sheet name');
  }
  if (
    Object.keys(sheetsValue).length !== sheetNames.length ||
    !sheetNames.every((name) => Object.prototype.hasOwnProperty.call(sheetsValue, name))
  ) {
    throw workerFailed(new Error('Excel workbook worker returned inconsistent sheets.'));
  }

  const sheets: Record<string, InspectedSheet> = Object.create(null);
  let totalRepresentedCells = 0;
  for (const name of sheetNames) {
    const sheetValue = sheetsValue[name];
    if (!isWorkerRecord(sheetValue) || sheetValue.name !== name) {
      throw workerFailed(new Error(`Excel workbook worker returned invalid sheet "${name}".`));
    }
    const headersValue = sheetValue.headers;
    const rowsValue = sheetValue.rows;
    const cellsValue = sheetValue.cells;
    const startRow = sheetValue.startRow;
    const startColumn = sheetValue.startColumn;
    const headerRowIndex = sheetValue.headerRowIndex;
    if (
      !Array.isArray(headersValue) ||
      headersValue.length === 0 ||
      headersValue.length > MAX_COLUMNS_PER_SHEET ||
      !headersValue.every((header) => typeof header === 'string' && header.trim().length > 0 && !isUnsafeHeader(header)) ||
      new Set(headersValue).size !== headersValue.length ||
      !Array.isArray(rowsValue) ||
      rowsValue.length > MAX_ROWS_PER_SHEET ||
      !Array.isArray(cellsValue) ||
      rowsValue.length !== cellsValue.length ||
      rowsValue.length * headersValue.length > MAX_TOTAL_REPRESENTED_CELLS - totalRepresentedCells ||
      !Number.isInteger(startRow) ||
      !Number.isInteger(startColumn) ||
      !Number.isInteger(headerRowIndex) ||
      (startRow as number) < 0 ||
      (startColumn as number) < 0 ||
      (headerRowIndex as number) < (startRow as number)
    ) {
      throw workerFailed(new Error(`Excel workbook worker returned invalid sheet data for "${name}".`));
    }
    totalRepresentedCells += rowsValue.length * headersValue.length;

    const headers = [...headersValue];
    for (const header of headers) {
      textBudget.add(header, textLimits.header, 'Header');
    }
    const rows = rowsValue.map((sourceRow) => {
      if (!isWorkerRecord(sourceRow)) {
        throw workerFailed(new Error(`Excel workbook worker returned an invalid row for "${name}".`));
      }
      const row: Record<string, unknown> = Object.create(null);
      for (const header of headers) {
        if (!Object.prototype.hasOwnProperty.call(sourceRow, header)) {
          throw workerFailed(new Error(`Excel workbook worker omitted column "${header}".`));
        }
        const rowValue = sourceRow[header];
        if (typeof rowValue === 'string') {
          textBudget.add(rowValue, textLimits.cell, 'Row text');
        }
        row[header] = rowValue;
      }
      return row;
    });
    const cells = cellsValue.map((sourceCells) => {
      if (!isWorkerRecord(sourceCells)) {
        throw workerFailed(new Error(`Excel workbook worker returned invalid cell metadata for "${name}".`));
      }
      const cellMap: Record<string, InspectedCell> = Object.create(null);
      for (const header of headers) {
        const sourceCell = sourceCells[header];
        if (
          !Object.prototype.hasOwnProperty.call(sourceCells, header) ||
          !isWorkerRecord(sourceCell) ||
          !Object.prototype.hasOwnProperty.call(sourceCell, 'value')
        ) {
          throw workerFailed(new Error(`Excel workbook worker omitted cell metadata for "${header}".`));
        }
        if (typeof sourceCell.value === 'string') {
          textBudget.add(sourceCell.value, textLimits.cell, 'Cell text');
        }
        if (typeof sourceCell.w === 'string') {
          textBudget.add(sourceCell.w, textLimits.cell, 'Formatted cell text');
        }
        if (typeof sourceCell.f === 'string') {
          textBudget.add(sourceCell.f, textLimits.formula, 'Cell formula');
        }
        if (typeof sourceCell.z === 'string') {
          textBudget.add(sourceCell.z, textLimits.numberFormat, 'Cell number format');
        }
        cellMap[header] = {
          value: sourceCell.value,
          ...(typeof sourceCell.w === 'string' ? { w: sourceCell.w } : {}),
          ...(typeof sourceCell.f === 'string' ? { f: sourceCell.f } : {}),
          ...(typeof sourceCell.t === 'string' ? { t: sourceCell.t } : {}),
          ...(typeof sourceCell.z === 'string' ? { z: sourceCell.z } : {}),
        };
      }
      return cellMap;
    });

    sheets[name] = {
      name,
      headers,
      rows,
      cells,
      startRow: startRow as number,
      startColumn: startColumn as number,
      headerRowIndex: headerRowIndex as number,
    };
  }

  return { sheetNames, sheets };
}

export function inspectWorkbookInWorker(
  data: ArrayBuffer | Uint8Array,
  options: WorkerInspectionOptions = {},
): Promise<InspectedWorkbook> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIME_BUDGET_MS;
  const setTimer = options.setTimer ?? (
    (handler: () => void, delayMs: number) => globalThis.setTimeout(handler, delayMs)
  );
  const clearTimer = options.clearTimer ?? (
    (handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
  );

  return new Promise((resolve, reject) => {
    let worker: ExcelImportWorker;
    let transferableData: Uint8Array<ArrayBuffer>;
    try {
      preflightWorkbookData(data);
      const source = workbookBytesView(data);
      const transferableBuffer = new ArrayBuffer(source.byteLength);
      transferableData = new Uint8Array(transferableBuffer);
      transferableData.set(source);
    } catch (error) {
      reject(error instanceof ExcelImporterError ? error : workerFailed(error));
      return;
    }

    try {
      const workerUrl = new URL(excelImportWorkerUrl, import.meta.url);
      worker = options.workerFactory
        ? options.workerFactory(workerUrl, { type: 'module' })
        : new Worker(workerUrl, { type: 'module' });
    } catch (error) {
      reject(workerFailed(error));
      return;
    }
    let settled = false;
    let timerHandle: unknown;

    function finish(action: () => void) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer(timerHandle);
      worker.terminate();
      action();
    }

    worker.onmessage = (event: MessageEvent<ExcelWorkerResponse>) => {
      try {
        const response = event.data;
        if (response.ok) {
          const workbook = rebuildWorkerWorkbook(response.workbook, options.textLimits);
          finish(() => resolve(workbook));
        } else {
          finish(() => reject(
            new ExcelImporterError(response.error.code, response.error.message),
          ));
        }
      } catch (error) {
        const rejection = error instanceof ExcelImporterError ? error : workerFailed(error);
        finish(() => reject(rejection));
      }
    };
    worker.onerror = (event) => {
      finish(() => reject(
        new ExcelImporterError('worker-failed', event.message || 'Excel workbook worker failed.'),
      ));
    };
    timerHandle = setTimer(() => {
      finish(() => reject(
        new ExcelImporterError(
          'worker-timeout',
          `Excel workbook inspection exceeded ${timeoutMs} ms.`,
        ),
      ));
    }, timeoutMs);

    try {
      worker.postMessage({
        data: transferableData,
        options: {
          headerRowBySheet: options.headerRowBySheet,
          ...(options.textLimits ? { textLimits: options.textLimits } : {}),
          timeBudgetMs: timeoutMs,
        },
      }, [transferableData.buffer]);
    } catch (error) {
      const serialized = serializeExcelImporterError(error);
      finish(() => reject(new ExcelImporterError(serialized.code, serialized.message)));
    }
  });
}
