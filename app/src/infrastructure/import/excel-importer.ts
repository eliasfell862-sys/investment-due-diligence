import * as XLSX from 'xlsx';
import type { EvidenceItem } from '../../domain/evidence/evidence';

export interface InspectedSheet {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface InspectedWorkbook {
  sheetNames: string[];
  sheets: Record<string, InspectedSheet>;
}

export type ExcelImporterErrorCode =
  | 'empty-input'
  | 'input-too-large'
  | 'parse-failed'
  | 'no-sheets'
  | 'too-many-sheets'
  | 'too-many-rows'
  | 'too-many-columns'
  | 'too-many-cells'
  | 'invalid-header'
  | 'duplicate-header'
  | 'time-budget-exceeded'
  | 'invalid-project'
  | 'invalid-source-document'
  | 'invalid-field'
  | 'unknown-column';

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
}

export interface EvidenceMappingOptions {
  createId?: () => string;
  nowDate?: () => Date;
}

interface SheetLocation {
  startColumn: number;
  startRow: number;
}

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_SHEETS = 20;
const MAX_ROWS_PER_SHEET = 50_000;
const MAX_COLUMNS_PER_SHEET = 256;
const MAX_TOTAL_POPULATED_CELLS = 250_000;
const DEFAULT_TIME_BUDGET_MS = 2_000;
const sheetLocations = new WeakMap<InspectedSheet, SheetLocation>();

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
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function isPopulated(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

/**
 * Inspects a local workbook synchronously. SheetJS read is synchronous and cannot
 * be preempted in this phase, so callers must keep this action local and explicitly
 * user-initiated. The elapsed-time budget is enforced as soon as control returns.
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

  const now = options.now ?? (() => performance.now());
  const budgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const startedAt = now();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: 'array', cellDates: true });
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

  const sheets: Record<string, InspectedSheet> = Object.create(null);
  let totalPopulatedCells = 0;

  for (const name of sheetNames) {
    const worksheet = workbook.Sheets[name];
    const reference = worksheet?.['!ref'];
    if (!worksheet || !reference) {
      throw importerError('invalid-header', `Sheet "${name}" has no header row.`);
    }

    const range = XLSX.utils.decode_range(reference);
    const columnCount = range.e.c - range.s.c + 1;
    const rowCount = range.e.r - range.s.r;
    if (columnCount > MAX_COLUMNS_PER_SHEET) {
      throw importerError(
        'too-many-columns',
        `Sheet "${name}" cannot contain more than 256 columns.`,
      );
    }
    if (rowCount > MAX_ROWS_PER_SHEET) {
      throw importerError(
        'too-many-rows',
        `Sheet "${name}" cannot contain more than 50,000 data rows.`,
      );
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: true,
      range,
    });
    const headerRow = matrix[0] ?? [];
    const headers = Array.from({ length: columnCount }, (_, index) =>
      normalizeHeader(headerRow[index]),
    );
    if (headers.some((header) => !header)) {
      throw importerError(
        'invalid-header',
        `Sheet "${name}" contains an empty header within its used range.`,
      );
    }
    if (new Set(headers).size !== headers.length) {
      throw importerError('duplicate-header', `Sheet "${name}" contains duplicate headers.`);
    }

    totalPopulatedCells += matrix.reduce(
      (total, row) => total + row.filter(isPopulated).length,
      0,
    );
    if (totalPopulatedCells > MAX_TOTAL_POPULATED_CELLS) {
      throw importerError(
        'too-many-cells',
        'Workbook cannot represent more than 250,000 populated cell values.',
      );
    }

    const rows = matrix.slice(1).map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])),
    );
    const inspectedSheet: InspectedSheet = { name, headers, rows };
    sheetLocations.set(inspectedSheet, {
      startColumn: range.s.c,
      startRow: range.s.r,
    });
    sheets[name] = inspectedSheet;
    validateElapsed(startedAt, now, budgetMs);
  }

  validateElapsed(startedAt, now, budgetMs);
  return { sheetNames, sheets };
}

function requireIdentifier(
  value: string,
  code: 'invalid-project' | 'invalid-source-document' | 'invalid-field',
  label: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw importerError(code, `${label} is required.`);
  }
  return normalized;
}

function rawCellValue(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalizedCellValue(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value).replace(/,/g, '');
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
  const validatedMapping = Object.entries(mapping).map(([column, fieldId]) => {
    if (!headers.has(column)) {
      throw importerError('unknown-column', `Mapped column "${column}" is not present in the sheet.`);
    }
    return [column, requireIdentifier(fieldId, 'invalid-field', 'Field id')] as const;
  });

  const createId = options.createId ?? (() => crypto.randomUUID());
  const updatedAt = (options.nowDate ?? (() => new Date()))().toISOString();
  const location = sheetLocations.get(sheet) ?? { startColumn: 0, startRow: 0 };
  const evidence: EvidenceItem[] = [];

  for (const [rowIndex, row] of sheet.rows.entries()) {
    for (const [column, fieldId] of validatedMapping) {
      const value = row[column];
      if (value === null || value === undefined || value === '') {
        continue;
      }
      const columnIndex = sheet.headers.indexOf(column);
      const cell = XLSX.utils.encode_cell({
        c: location.startColumn + columnIndex,
        r: location.startRow + rowIndex + 1,
      });
      evidence.push({
        id: createId(),
        projectId: normalizedProjectId,
        fieldId,
        sourceDocumentId: normalizedSourceDocumentId,
        sourceLocator: `${sheet.name}!${cell}`,
        rawValue: rawCellValue(value),
        normalizedValue: normalizedCellValue(value),
        confidence: 0.8,
        conflictStatus: 'none',
        updatedAt,
      });
    }
  }

  return evidence;
}
