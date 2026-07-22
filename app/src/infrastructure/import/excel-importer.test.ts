import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import {
  ExcelImporterError,
  inspectWorkbook,
  preflightWorkbookData,
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

function workbookFromWorksheet(sheetName: string, worksheet: XLSX.WorkSheet): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
}

interface SyntheticZipEntry {
  compressedSize: number;
  uncompressedSize: number;
  signature?: number;
}

interface SyntheticZipOptions {
  centralDirectoryOffset?: number;
  centralDirectorySize?: number;
  eocdSignature?: number;
}

function syntheticZip(
  entries: readonly SyntheticZipEntry[],
  options: SyntheticZipOptions = {},
): Uint8Array {
  const centralDirectorySize = entries.length * 46;
  const data = new Uint8Array(centralDirectorySize + 22);
  const view = new DataView(data.buffer);

  entries.forEach((entry, index) => {
    const offset = index * 46;
    view.setUint32(offset, entry.signature ?? 0x02014b50, true);
    view.setUint32(offset + 20, entry.compressedSize, true);
    view.setUint32(offset + 24, entry.uncompressedSize, true);
  });

  const eocdOffset = centralDirectorySize;
  view.setUint32(eocdOffset, options.eocdSignature ?? 0x06054b50, true);
  view.setUint16(eocdOffset + 8, entries.length, true);
  view.setUint16(eocdOffset + 10, entries.length, true);
  view.setUint32(
    eocdOffset + 12,
    options.centralDirectorySize ?? centralDirectorySize,
    true,
  );
  view.setUint32(eocdOffset + 16, options.centralDirectoryOffset ?? 0, true);
  return data;
}

describe('preflightWorkbookData', () => {
  it('allows non-ZIP legacy workbook bytes', () => {
    expect(() => preflightWorkbookData(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).not.toThrow();
  });

  it.each([
    [
      'zip-entry-limit',
      Array.from({ length: 2_001 }, () => ({ compressedSize: 1, uncompressedSize: 1 })),
    ],
    ['zip-entry-too-large', [{ compressedSize: 1, uncompressedSize: 100 * 1024 * 1024 + 1 }]],
    [
      'zip-expanded-size-limit',
      Array.from({ length: 3 }, () => ({
        compressedSize: 70 * 1024 * 1024,
        uncompressedSize: 70 * 1024 * 1024,
      })),
    ],
    ['zip-compression-ratio', [{ compressedSize: 1, uncompressedSize: 101 }]],
    ['zip-compression-ratio', [{ compressedSize: 0, uncompressedSize: 1 }]],
  ])('rejects ZIP metadata violating %s', (code, entries) => {
    expect(() => preflightWorkbookData(syntheticZip(entries))).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('rejects malformed central directory bounds and signatures', () => {
    expect(() =>
      preflightWorkbookData(
        syntheticZip([{ compressedSize: 1, uncompressedSize: 1 }], {
          centralDirectoryOffset: 47,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'malformed-zip' }));
    expect(() =>
      preflightWorkbookData(
        syntheticZip([{ compressedSize: 1, uncompressedSize: 1, signature: 0x00004b50 }]),
      ),
    ).toThrowError(expect.objectContaining({ code: 'malformed-zip' }));
  });
});

describe('inspectWorkbook', () => {
  it('inspects sheet names, headers, and rows from an Excel workbook', () => {
    const data = workbookBytes('利润表', [{ 年份: '2025', 营业收入: 1200 }]);

    const inspected = inspectWorkbook(data);

    expect(inspected.sheetNames).toEqual(['利润表']);
    expect(inspected.sheets['利润表']).toMatchObject({
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

  it('preflights ZIP metadata before SheetJS parsing', () => {
    const data = syntheticZip([{ compressedSize: 1, uncompressedSize: 101 }]);

    expect(() => inspectWorkbook(data)).toThrowError(
      expect.objectContaining({ code: 'zip-compression-ratio' }),
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
    const conversion = vi.spyOn(XLSX.utils, 'sheet_to_json');

    expect(() => inspectWorkbook(data, { now: () => 0 })).toThrowError(
      expect.objectContaining({ code: 'too-many-cells' }),
    );
    expect(conversion).not.toHaveBeenCalled();
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

  it('selects a header row below a merged title and preserves absolute coordinates', () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['FY25 results'],
      ['Year', 'Revenue'],
      ['2025', 1200],
    ]);
    worksheet['!merges'] = [XLSX.utils.decode_range('A1:B1')];

    const inspected = inspectWorkbook(workbookFromWorksheet('Title', worksheet), { now: () => 0 });
    const sheet = inspected.sheets.Title!;

    expect(sheet).toMatchObject({
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 1,
      headers: ['Year', 'Revenue'],
      rows: [{ Year: '2025', Revenue: 1200 }],
    });
    expect(mapRowsToEvidence('p', 'd', sheet, { Revenue: 'revenue' })[0]?.sourceLocator).toBe(
      'Title!B3',
    );
  });

  it('rejects ambiguous header candidates and accepts an explicit absolute header row', () => {
    const data = workbookFromArrays('S', [
      ['Title A', 'Title B'],
      ['Year', 'Revenue'],
      ['2025', 1200],
    ]);

    expect(() => inspectWorkbook(data, { now: () => 0 })).toThrowError(
      expect.objectContaining({ code: 'ambiguous-header-row' }),
    );
    expect(
      inspectWorkbook(data, { now: () => 0, headerRowBySheet: { S: 1 } }).sheets.S,
    ).toMatchObject({ headerRowIndex: 1, headers: ['Year', 'Revenue'] });
  });

  it('rejects an explicit header row outside the used range', () => {
    const data = workbookFromArrays('S', [['Value'], [1]]);

    expect(() =>
      inspectWorkbook(data, { now: () => 0, headerRowBySheet: { S: 5 } }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-header-row' }));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects non-finite or error cell value %s',
    (value) => {
      expect(() =>
        inspectWorkbook(workbookFromArrays('S', [['Value'], [value]]), { now: () => 0 }),
      ).toThrowError(expect.objectContaining({ code: 'invalid-cell-value' }));
    },
  );

  it('preserves percent and formula cell provenance', () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Margin', 'Formula'],
      [0.123, 3],
    ]);
    worksheet.A2!.z = '0.0%';
    worksheet.B2!.f = 'SUM(A2,2)';
    worksheet.B2!.z = '0.00';

    const sheet = inspectWorkbook(workbookFromWorksheet('Metrics', worksheet), {
      now: () => 0,
    }).sheets.Metrics!;

    expect(sheet.cells[0]?.Margin).toMatchObject({
      value: 0.123,
      w: '12.3%',
      t: 'n',
      z: '0.0%',
    });
    expect(sheet.cells[0]?.Formula).toMatchObject({
      value: 3,
      w: '3.00',
      f: 'SUM(A2,2)',
      t: 'n',
      z: '0.00',
    });
    const [evidence] = mapRowsToEvidence(
      'p',
      'd',
      sheet,
      { Margin: 'gross_margin' },
      { createId: () => 'id', nowDate: () => new Date(0) },
    );
    expect(evidence).toMatchObject({
      rawValue: '12.3%',
      normalizedValue: '0.123',
      displayValue: '12.3%',
      cellType: 'n',
      numberFormat: '0.0%',
    });
  });
});

describe('mapRowsToEvidence', () => {
  const sheet: InspectedSheet = {
    name: '利润表',
    headers: ['年份', '营业收入'],
    rows: [{ 年份: '2025', 营业收入: 1200 }],
    cells: [{}],
    startRow: 0,
    startColumn: 0,
    headerRowIndex: 0,
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

  it('normalizes dates and preserves comma-formatted text', () => {
    const date = new Date('2025-12-31T00:00:00.000Z');
    const inspected: InspectedSheet = {
      name: '财务',
      headers: ['日期', '收入'],
      rows: [{ 日期: date, 收入: '1,200.50' }],
      cells: [{}],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
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
      '1,200.50',
    ]);
    expect(evidence[1]?.rawValue).toBe('1,200.50');
  });

  it('skips null, undefined, and empty-string values', () => {
    const inspected: InspectedSheet = {
      name: 'S',
      headers: ['A', 'B', 'C', 'D'],
      rows: [{ A: null, B: undefined, C: '', D: 0 }],
      cells: [{}],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
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

  it('preserves arbitrary text including commas during normalization', () => {
    const textSheet: InspectedSheet = {
      name: 'Text',
      headers: ['Company', 'Locale'],
      rows: [{ Company: 'ACME, Inc.', Locale: '1.234,56' }],
      cells: [{
        Company: { value: 'ACME, Inc.', t: 's', w: 'ACME, Inc.' },
        Locale: { value: '1.234,56', t: 's', w: '1.234,56' },
      }],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };

    const evidence = mapRowsToEvidence(
      'p',
      'd',
      textSheet,
      { Company: 'company_name', Locale: 'locale_text' },
      { createId: () => 'id', nowDate: () => new Date(0) },
    );

    expect(evidence.map((item) => item.normalizedValue)).toEqual([
      'ACME, Inc.',
      '1.234,56',
    ]);
  });

  it('keeps cloned coordinates and provenance for quoted sheet locators', () => {
    const worksheet: XLSX.WorkSheet = {};
    XLSX.utils.sheet_add_aoa(worksheet, [['Metric'], [3]], { origin: 'D5' });
    worksheet['!ref'] = 'D5:D6';
    worksheet.D6!.f = '1+2';
    worksheet.D6!.z = '0.00';
    const inspected = inspectWorkbook(
      workbookFromWorksheet("O'Brien! FY25", worksheet),
      { now: () => 0 },
    ).sheets["O'Brien! FY25"]!;
    const cloned = structuredClone(inspected);

    const [evidence] = mapRowsToEvidence(
      'p',
      'd',
      cloned,
      { Metric: 'metric' },
      { createId: () => 'id', nowDate: () => new Date(0) },
    );

    expect(cloned).toMatchObject({ startRow: 4, startColumn: 3, headerRowIndex: 4 });
    expect(evidence).toMatchObject({
      sourceLocator: "'O''Brien! FY25'!D6",
      rawValue: '3.00',
      normalizedValue: '3',
      displayValue: '3.00',
      formula: '1+2',
      cellType: 'n',
      numberFormat: '0.00',
    });
  });
});
