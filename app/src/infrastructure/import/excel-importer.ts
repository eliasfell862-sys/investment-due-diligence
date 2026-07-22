import Decimal from 'decimal.js';
import * as XLSX from 'xlsx';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
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

export interface WorkbookInspectionOptions {
  now?: () => number;
  timeBudgetMs?: number;
  headerRowBySheet?: Readonly<Record<string, number>>;
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

export function preflightWorkbookData(data: ArrayBuffer | Uint8Array): void {
  const bytes = workbookBytesView(data);
  if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return;
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
  let cursor = centralDirectoryOffset;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    checkedZipEnd(cursor, ZIP_CENTRAL_ENTRY_SIZE, centralDirectoryEnd, 'ZIP central entry');
    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_ENTRY_SIGNATURE) {
      malformedZip('ZIP central directory entry signature is invalid.');
    }
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const entryCommentLength = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      diskStart !== 0
    ) {
      malformedZip('ZIP64 and multi-disk entries are not supported.');
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
    const variableLength = fileNameLength + extraLength + entryCommentLength;
    cursor = checkedZipEnd(
      cursor,
      ZIP_CENTRAL_ENTRY_SIZE + variableLength,
      centralDirectoryEnd,
      'ZIP central entry',
    );
  }

  if (cursor !== centralDirectoryEnd) {
    malformedZip('ZIP central directory size is inconsistent.');
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
  return {
    value,
    ...(typeof cell?.w === 'string' ? { w: cell.w } : {}),
    ...(typeof cell?.f === 'string' ? { f: cell.f } : {}),
    ...(typeof cell?.t === 'string' ? { t: cell.t } : {}),
    ...(typeof cell?.z === 'string' ? { z: cell.z } : {}),
  };
}

/**
 * Synchronous core/test path only. SheetJS read cannot be preempted, so untrusted
 * UI files must use inspectWorkbookInWorker instead of calling this function directly.
 * The elapsed-time budget is enforced after synchronous control returns; the worker
 * boundary provides the hard timeout and termination mechanism.
 */
export function inspectWorkbook(
  data: ArrayBuffer | Uint8Array,
  options: WorkbookInspectionOptions = {},
): InspectedWorkbook {
  const byteLength = data.byteLength;
  if (byteLength === 0) {
    throw importerError('empty-input', 'Workbook input cannot be empty.');
  }
  if (byteLength > MAX_INPUT_BYTES) {
    throw importerError('input-too-large', 'Workbook input cannot exceed 25 MiB.');
  }

  preflightWorkbookData(data);

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

  const sheetNames = [...workbook.SheetNames];
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
        values.push([header, value]);
        metadata.push([header, inspectedCell(value, cell, name, locator)]);
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

function normalizedCellValue(value: unknown, cell?: InspectedCell): string {
  if (cell?.t === 'e') {
    throw importerError('invalid-cell-value', 'Error cells cannot be mapped to evidence.');
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw importerError('invalid-cell-value', 'Invalid dates cannot be mapped to evidence.');
    }
    return value.toISOString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw importerError('invalid-cell-value', 'Non-finite numbers cannot be mapped to evidence.');
    }
    return new Decimal(value).toString();
  }
  return String(value);
}

function rawCellValue(value: unknown, cell?: InspectedCell): string {
  if (cell?.w) {
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
      ? normalizedCellValue(periodValue, periodCell)
      : `source:${sheet.name}:${sourceRow}`;
    const dimensionParts: string[] = [];
    for (const [dimensionColumn, dimensionFieldId] of dimensionMappings) {
      const dimensionValue = row[dimensionColumn];
      if (dimensionValue === null || dimensionValue === undefined || dimensionValue === '') {
        continue;
      }
      const inspected = sheet.cells[rowIndex]?.[dimensionColumn];
      dimensionParts.push(
        `${dimensionFieldId}=${encodeURIComponent(normalizedCellValue(dimensionValue, inspected))}`,
      );
    }
    const dimensionIdentity = dimensionParts.length > 0 ? dimensionParts.join('|') : 'default';
    for (const [column, fieldId] of validatedMapping) {
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
        normalizedValue: normalizedCellValue(value, inspected),
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
  readonly options: Pick<WorkbookInspectionOptions, 'headerRowBySheet' | 'timeBudgetMs'>;
}

export type ExcelWorkerResponse =
  | { readonly ok: true; readonly workbook: InspectedWorkbook }
  | { readonly ok: false; readonly error: SerializedExcelImporterError };

export interface ExcelImportWorker {
  onmessage: ((event: MessageEvent<ExcelWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ExcelWorkerRequest): void;
  terminate(): void;
}

export interface WorkerInspectionOptions {
  readonly timeoutMs?: number;
  readonly headerRowBySheet?: Readonly<Record<string, number>>;
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
    const workerUrl = new URL(excelImportWorkerUrl, import.meta.url);
    const worker = options.workerFactory
      ? options.workerFactory(workerUrl, { type: 'module' })
      : new Worker(workerUrl, { type: 'module' });
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
      const response = event.data;
      if (response.ok) {
        finish(() => resolve(response.workbook));
      } else {
        finish(() => reject(
          new ExcelImporterError(response.error.code, response.error.message),
        ));
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
        data,
        options: {
          headerRowBySheet: options.headerRowBySheet,
          timeBudgetMs: timeoutMs,
        },
      });
    } catch (error) {
      const serialized = serializeExcelImporterError(error);
      finish(() => reject(new ExcelImporterError(serialized.code, serialized.message)));
    }
  });
}
