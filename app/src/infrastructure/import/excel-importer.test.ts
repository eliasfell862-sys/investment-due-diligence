import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  ExcelImporterError,
  inspectWorkbook,
  mapRowsToEvidence,
  type InspectedSheet,
} from './excel-importer';

function workbookBytes(
  sheetName: string,
  rows: readonly Record<string, unknown>[],
): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([...rows]),
    sheetName,
  );
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
}

function workbookFromArrays(
  sheetName: string,
  rows: readonly (readonly unknown[])[],
): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows.map((row) => [...row])),
    sheetName,
  );
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
}

describe('inspectWorkbook', () => {
  it('inspects sheet names, headers, and rows from an Excel workbook', () => {
    const data = workbookBytes('利润表', [{ 年份: '2025', 营业收入: 1200 }]);

    const inspected = inspectWorkbook(data);

    expect(inspected.sheetNames).toEqual(['利润表']);
    expect(inspected.sheets['利润表']).toEqual({
      name: '利润表',
      headers: ['年份', '营业收入'],
      rows: [{ 年份: '2025', 营业收入: 1200 }],
    });
  });

  it('rejects empty and oversized inputs before parsing', () => {
    expect(() => inspectWorkbook(new Uint8Array())).toThrowError(
      expect.objectContaining({ code: 'empty-input' }),
    );
    expect(() => inspectWorkbook(new Uint8Array(25 * 1024 * 1024 + 1))).toThrowError(
      expect.objectContaining({ code: 'input-too-large' }),
    );
  });

  it('rejects more than 20 sheets', () => {
    const workbook = XLSX.utils.book_new();
    for (let index = 0; index < 21; index += 1) {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([['value'], [index]]),
        `S${index}`,
      );
    }
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

    expect(() => inspectWorkbook(data)).toThrowError(
      expect.objectContaining({ code: 'too-many-sheets' }),
    );
  });

  it('rejects empty and duplicate headers', () => {
    expect(() => inspectWorkbook(workbookFromArrays('S', [['A', ''], [1, 2]]))).toThrowError(
      expect.objectContaining({ code: 'invalid-header' }),
    );
    expect(() => inspectWorkbook(workbookFromArrays('S', [['A', 'A'], [1, 2]]))).toThrowError(
      expect.objectContaining({ code: 'duplicate-header' }),
    );
  });

  it.each(['__proto__', 'prototype', 'constructor', 'toString', 'hasOwnProperty'])(
    'rejects the unsafe header %s',
    (header) => {
      expect(() => inspectWorkbook(workbookFromArrays('S', [[header], [1]]))).toThrowError(
        expect.objectContaining({ code: 'unsafe-header' }),
      );
    },
  );

  it('rejects sheets wider than 256 columns', () => {
    const headers = Array.from({ length: 257 }, (_, index) => `H${index}`);
    expect(() => inspectWorkbook(workbookFromArrays('Wide', [headers, headers]))).toThrowError(
      expect.objectContaining({ code: 'too-many-columns' }),
    );
  });

  it('rejects sheets with more than 50,000 data rows', () => {
    const rows = [['value'], ...Array.from({ length: 50_001 }, (_, index) => [index])];
    const data = workbookFromArrays('Long', rows);

    expect(() => inspectWorkbook(data, { now: () => 0 })).toThrowError(
      expect.objectContaining({ code: 'too-many-rows' }),
    );
  }, 20_000);

  it('rejects workbooks representing more than 250,000 grid cells', () => {
    const headers = Array.from({ length: 251 }, (_, index) => `H${index}`);
    const valueRow = Array.from({ length: 251 }, () => 1);
    const data = workbookFromArrays('Dense', [
      headers,
      ...Array.from({ length: 997 }, () => valueRow),
    ]);

    expect(() => inspectWorkbook(data, { now: () => 0 })).toThrowError(
      expect.objectContaining({ code: 'too-many-cells' }),
    );
  }, 20_000);

  it('rejects a sparse sheet whose represented grid exceeds 250,000 cells', () => {
    const headers = Array.from({ length: 251 }, (_, index) => `H${index}`);
    const finalRow: unknown[] = Array.from({ length: 251 }, () => null);
    finalRow[250] = 1;
    const data = workbookFromArrays('Sparse', [
      headers,
      ...Array.from({ length: 996 }, () => []),
      finalRow,
    ]);

    expect(() => inspectWorkbook(data, { now: () => 0 })).toThrowError(
      expect.objectContaining({ code: 'too-many-cells' }),
    );
  }, 20_000);

  it('rejects inspection when the synchronous work exceeds the elapsed-time budget', () => {
    const ticks = [100, 100, 2_101];
    const data = workbookBytes('S', [{ value: 1 }]);

    expect(() => inspectWorkbook(data, { now: () => ticks.shift() ?? 2_101 })).toThrowError(
      expect.objectContaining({ code: 'time-budget-exceeded' }),
    );
  });

  it('treats special sheet names as record keys without prototype pollution', () => {
    const inspected = inspectWorkbook(workbookBytes('__proto__', [{ value: 1 }]));

    expect(Object.hasOwn(inspected.sheets, '__proto__')).toBe(true);
    expect(inspected.sheets['__proto__']?.rows).toEqual([{ value: 1 }]);
  });

  it('does not mutate the input bytes', () => {
    const data = workbookBytes('S', [{ value: 1 }]);
    const before = new Uint8Array(data.slice(0));

    inspectWorkbook(data, { now: () => 0 });

    expect(new Uint8Array(data)).toEqual(before);
  });
  it('uses typed importer errors', () => {
    try {
      inspectWorkbook(new Uint8Array());
      throw new Error('Expected inspection to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ExcelImporterError);
    }
  });
});

describe('mapRowsToEvidence', () => {
  const sheet: InspectedSheet = {
    name: '利润表',
    headers: ['年份', '营业收入'],
    rows: [{ 年份: '2025', 营业收入: 1200 }],
  };

  it('maps a workbook field to evidence with an exact source cell locator', () => {
    const [evidence] = mapRowsToEvidence(
      'project-1',
      'document-1',
      sheet,
      { 营业收入: 'revenue' },
      {
        createId: () => 'evidence-1',
        nowDate: () => new Date('2026-07-21T08:00:00.000Z'),
      },
    );

    expect(evidence).toMatchObject({
      id: 'evidence-1',
      projectId: 'project-1',
      fieldId: 'revenue',
      sourceDocumentId: 'document-1',
      sourceLocator: '利润表!B2',
      rawValue: '1200',
      normalizedValue: '1200',
      confidence: 0.8,
      conflictStatus: 'none',
      updatedAt: '2026-07-21T08:00:00.000Z',
    });
  });

  it('normalizes dates and comma-formatted values while preserving raw text', () => {
    const date = new Date('2025-12-31T00:00:00.000Z');
    const inspected: InspectedSheet = {
      name: '财务',
      headers: ['日期', '收入'],
      rows: [{ 日期: date, 收入: '1,200.50' }],
    };

    const evidence = mapRowsToEvidence(
      'p',
      'd',
      inspected,
      { 日期: 'period_end', 收入: 'revenue' },
      { createId: () => 'id', nowDate: () => new Date(0) },
    );

    expect(evidence.map((item) => item.normalizedValue)).toEqual([
      '2025-12-31T00:00:00.000Z',
      '1200.50',
    ]);
    expect(evidence[1]?.rawValue).toBe('1,200.50');
  });

  it('skips null, undefined, and empty-string values', () => {
    const inspected: InspectedSheet = {
      name: 'S',
      headers: ['A', 'B', 'C', 'D'],
      rows: [{ A: null, B: undefined, C: '', D: 0 }],
    };

    const evidence = mapRowsToEvidence(
      'p',
      'd',
      inspected,
      { A: 'a', B: 'b', C: 'c', D: 'd' },
      { createId: () => 'id', nowDate: () => new Date(0) },
    );

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.normalizedValue).toBe('0');
  });

  it('validates identifiers and mapping columns', () => {
    expect(() => mapRowsToEvidence(' ', 'd', sheet, {})).toThrowError(
      expect.objectContaining({ code: 'invalid-project' }),
    );
    expect(() => mapRowsToEvidence('p', ' ', sheet, {})).toThrowError(
      expect.objectContaining({ code: 'invalid-source-document' }),
    );
    expect(() => mapRowsToEvidence('p', 'd', sheet, {})).toThrowError(
      expect.objectContaining({ code: 'empty-mapping' }),
    );
    expect(() => mapRowsToEvidence('p', 'd', sheet, { 营业收入: ' ' })).toThrowError(
      expect.objectContaining({ code: 'invalid-field' }),
    );
    expect(() => mapRowsToEvidence('p', 'd', sheet, { 不存在: 'revenue' })).toThrowError(
      expect.objectContaining({ code: 'unknown-column' }),
    );
  });

  it('does not mutate the inspected sheet or mapping', () => {
    const originalSheet = structuredClone(sheet);
    const mapping = { 营业收入: 'revenue' };

    mapRowsToEvidence('p', 'd', sheet, mapping, {
      createId: () => 'id',
      nowDate: () => new Date(0),
    });

    expect(sheet).toEqual(originalSheet);
    expect(mapping).toEqual({ 营业收入: 'revenue' });
  });
});
