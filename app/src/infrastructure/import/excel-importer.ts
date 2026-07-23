import * as XLSX from 'xlsx';
import { canonicalizeEnUsNumber } from '../../domain/evidence/canonicalize-en-us-number';
import { canonicalizeFinancialPeriod } from '../../domain/evidence/canonicalize-financial-period';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import {
  findTargetFieldDefinition,
  type TargetFieldDefinition,
} from '../../domain/evidence/target-fields';
import {
  isZipArchiveCandidate,
  preflightZipArchive,
  ZipPreflightError,
  type ZipEntryMetadata,
  type ZipPreflightLimits,
} from '../archive/zip-preflight';
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


export const EXCEL_IMPORT_KEY_LENGTH = 70;
export const EXCEL_IMPORT_BATCH_ID_LENGTH = 141;
export const EXCEL_EVIDENCE_ID_MAX_LENGTH = 256;
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

function malformedZip(message: string, cause?: unknown): never {
  throw importerError('malformed-zip', message, cause);
}

function workbookZipErrorMessage(error: ZipPreflightError): string {
  switch (error.code) {
    case 'zip-entry-limit':
      return 'Workbook ZIP cannot contain more than 2,000 entries.';
    case 'zip-entry-too-large':
      return 'A workbook ZIP entry cannot expand beyond 100 MiB.';
    case 'zip-expanded-size-limit':
      return 'Workbook ZIP entries cannot expand beyond 200 MiB in total.';
    case 'zip-compression-ratio':
      return 'A workbook ZIP entry exceeds the 100:1 compression ratio limit.';
    case 'malformed-zip':
      return error.message;
  }
}

function workbookZipLimits(limits: WorkbookArchiveLimits): ZipPreflightLimits {
  return {
    maxEntries: MAX_ZIP_ENTRIES,
    maxEntryUncompressedBytes: Math.max(1, Math.floor(limits.maxEntryUncompressedBytes)),
    maxTotalUncompressedBytes: Math.max(1, Math.floor(limits.maxTotalUncompressedBytes)),
    maxCompressionRatio: MAX_ZIP_COMPRESSION_RATIO,
  };
}

function parseWorkbookZipEntries(
  data: ArrayBuffer | Uint8Array,
  limits = workbookArchiveLimits(undefined),
): readonly ZipEntryMetadata[] {
  const bytes = workbookBytesView(data);
  if (!isZipArchiveCandidate(bytes)) {
    return Object.freeze([]);
  }
  try {
    return preflightZipArchive(bytes, workbookZipLimits(limits)).entries;
  } catch (error) {
    if (error instanceof ZipPreflightError) {
      throw importerError(error.code, workbookZipErrorMessage(error), error);
    }
    malformedZip('ZIP metadata cannot be read safely.', error);
  }
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
  const entries = parseWorkbookZipEntries(bytes, limits);
  let totalActualBytes = 0;

  for (const entry of entries) {
    let actualBytes = 0;
    if (entry.compressionMethod === 0) {
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
    if (actualBytes > limits.maxEntryUncompressedBytes) {
      throw importerError(
        'zip-entry-too-large',
        'A workbook ZIP entry cannot expand beyond 100 MiB.',
      );
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
  const numberValue = canonicalizeEnUsNumber(value);
  if (numberValue.status === 'invalid') {
    throw importerError('invalid-cell-value', 'Numeric fields require a valid en-US number.');
  }
  return numberValue.canonicalValue;
}

function canonicalPeriod(value: unknown): string {
  const periodValue = canonicalizeFinancialPeriod(value);
  if (periodValue.status === 'invalid') {
    throw importerError('invalid-cell-value', 'Period fields require a supported financial period.');
  }
  return periodValue.status === 'valid' ? periodValue.canonicalValue : '';
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

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = schedule[index - 15]!;
      const previous2 = schedule[index - 2]!;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      schedule[index] = (
        schedule[index - 16]! + sigma0 + schedule[index - 7]! + sigma1
      ) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (
        h + sum1 + choice + SHA256_ROUND_CONSTANTS[index]! + schedule[index]!
      ) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('');
}

function sourceSheetName(name: string): string {
  return /^[\p{L}\p{N}_]+$/u.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

export function createExcelImportKey(
  documentId: string,
  sheet: InspectedSheet,
  mapping?: Readonly<Record<string, string>>,
): string {
  const normalizedDocumentId = requireIdentifier(
    documentId,
    'invalid-source-document',
    'Source document id',
  );
  const mappingSignature = mapping
    ? Object.entries(mapping)
      .map(([column, fieldId]) => [column, fieldId.trim()] as const)
      .sort(([leftColumn, leftField], [rightColumn, rightField]) => {
        if (leftColumn !== rightColumn) {
          return leftColumn < rightColumn ? -1 : 1;
        }
        return leftField === rightField ? 0 : leftField < rightField ? -1 : 1;
      })
    : null;
  const canonicalSeed = JSON.stringify([
    normalizedDocumentId,
    sheet.name,
    sheet.headers,
    sheet.startRow,
    sheet.startColumn,
    sheet.headerRowIndex,

    mappingSignature,
  ]);
  return `excel:${sha256Hex(canonicalSeed)}`;
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

  const canonicalMapping = Object.fromEntries(
    validatedMapping.map(([column, fieldId]) => [column, fieldId]),
  );
  const importKey = createExcelImportKey(
    normalizedSourceDocumentId,
    sheet,
    canonicalMapping,
  );
  const importDigest = importKey.slice('excel:'.length);
  const projectDigest = sha256Hex(normalizedProjectId);
  const importBatchId = requireIdentifier(
    options.createImportBatchId?.()
      ?? `excel-batch:${projectDigest}:${importDigest}`,
    'invalid-import-batch',
    'Import batch id',
  );
  const createId = options.createId;
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
    const canonicalValues = new Map<string, string | null>();
    const canonicalValue = (
      column: string,
      definition: TargetFieldDefinition,
    ): string | null => {
      if (canonicalValues.has(column)) {
        return canonicalValues.get(column) ?? null;
      }
      const value = row[column];
      let normalized: string | null = null;
      if (value !== null && value !== undefined && value !== '') {
        const inspected = sheet.cells[rowIndex]?.[column];
        const candidate = normalizedCellValue(value, definition, inspected);
        normalized = candidate === '' ? null : candidate;
      }
      canonicalValues.set(column, normalized);
      return normalized;
    };
    const periodCanonical = periodMapping
      ? canonicalValue(periodMapping[0], periodMapping[2]) : null;
    const periodIdentity = periodCanonical
      ?? `${sourceDocumentIdentity}:sheet:${encodeURIComponent(sheet.name)}:row:${sourceRow}`;
    const dimensionParts: string[] = [];
    for (const [dimensionColumn, dimensionFieldId, definition] of dimensionMappings) {
      const dimensionValue = canonicalValue(dimensionColumn, definition);
      if (dimensionValue === null) {
        continue;
      }
      dimensionParts.push(
        `${dimensionFieldId}=${encodeURIComponent(dimensionValue)}`,
      );
    }
    const dimensionIdentity = dimensionParts.length > 0
      ? dimensionParts.join('|') : defaultDimensionIdentity;
    for (const [column, fieldId, definition] of validatedMapping) {
      const value = row[column];
      const normalizedValue = canonicalValue(column, definition);
      if (normalizedValue === null) {
        continue;
      }
      const columnIndex = sheet.headers.indexOf(column);
      const inspected = sheet.cells[rowIndex]?.[column];
      const cell = XLSX.utils.encode_cell({
        c: sheet.startColumn + columnIndex,
        r: sheet.headerRowIndex + rowIndex + 1,
      });
      const evidenceId = createId?.()
        ?? `excel-evidence:${projectDigest}:${importDigest}`
          + `:row:${sourceRow}:field:${encodeURIComponent(fieldId)}`;
      if (!createId && evidenceId.length > EXCEL_EVIDENCE_ID_MAX_LENGTH) {
        throw importerError(
          'invalid-field',
          'Deterministic Excel evidence id exceeds its maximum length.',
        );
      }
      evidence.push({
        id: evidenceId,
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
        normalizedValue,
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
