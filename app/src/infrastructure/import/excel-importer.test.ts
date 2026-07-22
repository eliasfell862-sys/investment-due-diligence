import { deflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import { resolveEvidenceConflict } from '../../domain/evidence/resolve-conflict';
import { targetFieldDefinitions } from '../../domain/evidence/target-fields';
import {
  createExcelImportKey,
  EXCEL_EVIDENCE_ID_MAX_LENGTH,
  EXCEL_IMPORT_BATCH_ID_LENGTH,
  EXCEL_IMPORT_KEY_LENGTH,
  sha256Hex,
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


function textWorkbook(options: {
  sheetName?: string;
  header?: string;
  value?: unknown;
  formula?: string;
  numberFormat?: string;
} = {}): Uint8Array {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [options.header ?? 'H'],
    [options.value ?? 1],
  ]);
  if (options.formula !== undefined) {
    worksheet.A2!.f = options.formula;
  }
  if (options.numberFormat !== undefined) {
    worksheet.A2!.z = options.numberFormat;
  }
  return workbookFromWorksheet(options.sheetName ?? 'S', worksheet);
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

interface ZipFixtureOptions {
  readonly centralName?: string;
  readonly localName?: string;
  readonly flags?: number;
  readonly localFlags?: number;
  readonly method?: number;
  readonly localMethod?: number;
  readonly compressedData?: Uint8Array;
  readonly declaredCompressedSize?: number;
  readonly declaredUncompressedSize?: number;
  readonly localCompressedSize?: number;
  readonly localUncompressedSize?: number;
  readonly localSignature?: number;
}

function zipFixture(options: ZipFixtureOptions = {}): Uint8Array {
  const encoder = new TextEncoder();
  const centralName = encoder.encode(options.centralName ?? 'entry.bin');
  const localName = encoder.encode(options.localName ?? options.centralName ?? 'entry.bin');
  const compressedData = options.compressedData ?? new Uint8Array([1]);
  const compressedSize = options.declaredCompressedSize ?? compressedData.length;
  const uncompressedSize = options.declaredUncompressedSize ?? compressedData.length;
  const localHeaderSize = 30 + localName.length;
  const centralOffset = localHeaderSize + compressedData.length;
  const centralSize = 46 + centralName.length;
  const data = new Uint8Array(centralOffset + centralSize + 22);
  const view = new DataView(data.buffer);
  const flags = options.flags ?? 0;
  const method = options.method ?? 0;

  view.setUint32(0, options.localSignature ?? 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, options.localFlags ?? flags, true);
  view.setUint16(8, options.localMethod ?? method, true);
  view.setUint32(18, options.localCompressedSize ?? compressedSize, true);
  view.setUint32(22, options.localUncompressedSize ?? uncompressedSize, true);
  view.setUint16(26, localName.length, true);
  data.set(localName, 30);
  data.set(compressedData, localHeaderSize);

  view.setUint32(centralOffset, 0x02014b50, true);
  view.setUint16(centralOffset + 4, 20, true);
  view.setUint16(centralOffset + 6, 20, true);
  view.setUint16(centralOffset + 8, flags, true);
  view.setUint16(centralOffset + 10, method, true);
  view.setUint32(centralOffset + 20, compressedSize, true);
  view.setUint32(centralOffset + 24, uncompressedSize, true);
  view.setUint16(centralOffset + 28, centralName.length, true);
  view.setUint32(centralOffset + 42, 0, true);
  data.set(centralName, centralOffset + 46);

  const eocdOffset = centralOffset + centralSize;
  view.setUint32(eocdOffset, 0x06054b50, true);
  view.setUint16(eocdOffset + 8, 1, true);
  view.setUint16(eocdOffset + 10, 1, true);
  view.setUint32(eocdOffset + 12, centralSize, true);
  view.setUint32(eocdOffset + 16, centralOffset, true);
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
  it.each([
    ['missing local header', { localSignature: 0x00000000 }],
    ['local filename mismatch', { centralName: 'central.bin', localName: 'local.bin' }],
    ['local method mismatch', { method: 8, localMethod: 0 }],
    ['local flags mismatch', { flags: 0, localFlags: 2 }],
    ['local size mismatch', { declaredUncompressedSize: 1, localUncompressedSize: 2 }],
  ] as const)('rejects %s', (_name, options) => {
    expect(() => preflightWorkbookData(zipFixture(options))).toThrowError(
      expect.objectContaining({ code: 'malformed-zip' }),
    );
  });

  it.each([
    ['encrypted entries', 0x0001],
    ['data descriptors', 0x0008],
  ])('rejects unsupported %s', (_name, flags) => {
    expect(() => preflightWorkbookData(zipFixture({ flags }))).toThrowError(
      expect.objectContaining({ code: 'malformed-zip' }),
    );
  });

});

describe('inspectWorkbook', () => {
  it('inspects sheet names, headers, and rows from an Excel workbook', async () => {
    const data = workbookBytes('利润表', [{ 年份: '2025', 营业收入: 1200 }]);

    const inspected = await inspectWorkbook(data);

    expect(inspected.sheetNames).toEqual(['利润表']);
    expect(inspected.sheets['利润表']).toMatchObject({
      name: '利润表',
      headers: ['年份', '营业收入'],
      rows: [{ 年份: '2025', 营业收入: 1200 }],
    });
  });

  it('rejects empty and oversized inputs before parsing', async () => {
    await expect(inspectWorkbook(new Uint8Array())).rejects.toThrowError(
      expect.objectContaining({ code: 'empty-input' }),
    );
    await expect(inspectWorkbook(new Uint8Array(25 * 1024 * 1024 + 1))).rejects.toThrowError(
      expect.objectContaining({ code: 'input-too-large' }),
    );
  });

  it('preflights ZIP metadata before SheetJS parsing', async () => {
    const data = syntheticZip([{ compressedSize: 1, uncompressedSize: 101 }]);

    await expect(inspectWorkbook(data)).rejects.toThrowError(
      expect.objectContaining({ code: 'zip-compression-ratio' }),
    );
  });


  it('rejects stored entries whose actual output exceeds the injected per-entry cap', async () => {
    const data = zipFixture({
      method: 0,
      compressedData: new Uint8Array(2 * 1024),
    });

    await expect(
      inspectWorkbook(data, { archiveLimits: { maxEntryUncompressedBytes: 1024 } }),
    ).rejects.toMatchObject({ code: 'zip-entry-too-large' });
  });
  it('rejects deflate entries whose actual output exceeds the per-entry cap', async () => {
    const expanded = new Uint8Array(2 * 1024);
    const compressed = new Uint8Array(deflateRawSync(expanded));
    const data = zipFixture({
      method: 8,
      compressedData: compressed,
      declaredUncompressedSize: 512,
    });

    await expect(
      inspectWorkbook(data, { archiveLimits: { maxEntryUncompressedBytes: 1024 } }),
    ).rejects.toMatchObject({ code: 'zip-entry-too-large' });
  });
  it('rejects more than 20 sheets', async () => {
    const workbook = XLSX.utils.book_new();
    for (let index = 0; index < 21; index += 1) {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([['value'], [index]]),
        `S${index}`,
      );
    }
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

    await expect(inspectWorkbook(data)).rejects.toThrowError(
      expect.objectContaining({ code: 'too-many-sheets' }),
    );
  });

  it('rejects empty and duplicate headers', async () => {
    await expect(inspectWorkbook(workbookFromArrays('S', [['A', ''], [1, 2]]))).rejects.toThrowError(
      expect.objectContaining({ code: 'invalid-header' }),
    );
    await expect(inspectWorkbook(workbookFromArrays('S', [['A', 'A'], [1, 2]]))).rejects.toThrowError(
      expect.objectContaining({ code: 'duplicate-header' }),
    );
  });

  it.each(['__proto__', 'prototype', 'constructor', 'toString', 'hasOwnProperty'])(
    'rejects the unsafe header %s',
    async (header) => {
      await expect(inspectWorkbook(workbookFromArrays('S', [[header], [1]]))).rejects.toThrowError(
        expect.objectContaining({ code: 'unsafe-header' }),
      );
    },
  );

  it('rejects sheets wider than 256 columns', async () => {
    const headers = Array.from({ length: 257 }, (_, index) => `H${index}`);
    await expect(inspectWorkbook(workbookFromArrays('Wide', [headers, headers]))).rejects.toThrowError(
      expect.objectContaining({ code: 'too-many-columns' }),
    );
  });

  it('rejects sheets with more than 50,000 data rows', async () => {
    const rows = [['value'], ...Array.from({ length: 50_001 }, (_, index) => [index])];
    const data = workbookFromArrays('Long', rows);

    await expect(inspectWorkbook(data, { now: () => 0 })).rejects.toThrowError(
      expect.objectContaining({ code: 'too-many-rows' }),
    );
  }, 20_000);

  it('rejects workbooks representing more than 250,000 grid cells', async () => {
    const headers = Array.from({ length: 251 }, (_, index) => `H${index}`);
    const valueRow = Array.from({ length: 251 }, () => 1);
    const data = workbookFromArrays('Dense', [
      headers,
      ...Array.from({ length: 997 }, () => valueRow),
    ]);

    await expect(inspectWorkbook(data, { now: () => 0 })).rejects.toThrowError(
      expect.objectContaining({ code: 'too-many-cells' }),
    );
  }, 20_000);

  it('rejects a sparse sheet whose represented grid exceeds 250,000 cells', async () => {
    const headers = Array.from({ length: 251 }, (_, index) => `H${index}`);
    const finalRow: unknown[] = Array.from({ length: 251 }, () => null);
    finalRow[250] = 1;
    const data = workbookFromArrays('Sparse', [
      headers,
      ...Array.from({ length: 996 }, () => []),
      finalRow,
    ]);
    const conversion = vi.spyOn(XLSX.utils, 'sheet_to_json');

    await expect(inspectWorkbook(data, { now: () => 0 })).rejects.toThrowError(
      expect.objectContaining({ code: 'too-many-cells' }),
    );
    expect(conversion).not.toHaveBeenCalled();
  }, 20_000);

  it('rejects inspection when the synchronous work exceeds the elapsed-time budget', async () => {
    const ticks = [100, 100, 2_101];
    const data = workbookBytes('S', [{ value: 1 }]);

    await expect(inspectWorkbook(data, { now: () => ticks.shift() ?? 2_101 })).rejects.toThrowError(
      expect.objectContaining({ code: 'time-budget-exceeded' }),
    );
  });

  it('treats special sheet names as record keys without prototype pollution', async () => {
    const inspected = await inspectWorkbook(workbookBytes('__proto__', [{ value: 1 }]));

    expect(Object.hasOwn(inspected.sheets, '__proto__')).toBe(true);
    expect(inspected.sheets['__proto__']?.rows).toEqual([{ value: 1 }]);
  });

  it('does not mutate the input bytes', async () => {
    const data = workbookBytes('S', [{ value: 1 }]);
    const before = new Uint8Array(data.slice(0));

    await inspectWorkbook(data, { now: () => 0 });

    expect(new Uint8Array(data)).toEqual(before);
  });
  it('uses typed importer errors', async () => {
    try {
      await inspectWorkbook(new Uint8Array());
      throw new Error('Expected inspection to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ExcelImporterError);
    }
  });

  it('selects a header row below a merged title and preserves absolute coordinates', async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['FY25 results'],
      ['Year', 'Revenue'],
      ['2025', 1200],
    ]);
    worksheet['!merges'] = [XLSX.utils.decode_range('A1:B1')];

    const inspected = await inspectWorkbook(workbookFromWorksheet('Title', worksheet), { now: () => 0 });
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

  it('rejects ambiguous header candidates and accepts an explicit absolute header row', async () => {
    const data = workbookFromArrays('S', [
      ['Title A', 'Title B'],
      ['Year', 'Revenue'],
      ['2025', 1200],
    ]);

    await expect(inspectWorkbook(data, { now: () => 0 })).rejects.toThrowError(
      expect.objectContaining({ code: 'ambiguous-header-row' }),
    );
    expect(
      (await inspectWorkbook(data, { now: () => 0, headerRowBySheet: { S: 1 } })).sheets.S,
    ).toMatchObject({ headerRowIndex: 1, headers: ['Year', 'Revenue'] });
  });

  it('rejects an explicit header row outside the used range', async () => {
    const data = workbookFromArrays('S', [['Value'], [1]]);

    await expect(
      inspectWorkbook(data, { now: () => 0, headerRowBySheet: { S: 5 } }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'invalid-header-row' }));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects non-finite or error cell value %s',
    async (value) => {
      await expect(
        inspectWorkbook(workbookFromArrays('S', [['Value'], [value]]), { now: () => 0 }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'invalid-cell-value' }));
    },
  );

  it('preserves percent and formula cell provenance', async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Margin', 'Formula'],
      [0.123, 3],
    ]);
    worksheet.A2!.z = '0.0%';
    worksheet.B2!.f = 'SUM(A2,2)';
    worksheet.B2!.z = '0.00';

    const sheet = (await inspectWorkbook(workbookFromWorksheet('Metrics', worksheet), {
      now: () => 0,
    })).sheets.Metrics!;

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


describe('workbook text limits', () => {
  const limits = {
    sheetName: 100,
    header: 100,
    cell: 100,
    formula: 100,
    numberFormat: 100,
    total: 1_000,
  };

  it.each([
    ['sheet name', { sheetName: 3 }, textWorkbook({ sheetName: 'ABC' }), textWorkbook({ sheetName: 'ABCD' })],
    ['header', { header: 3 }, textWorkbook({ header: 'ABC' }), textWorkbook({ header: 'ABCD' })],
    ['string cell', { cell: 3 }, textWorkbook({ value: 'abc' }), textWorkbook({ value: 'abcd' })],
    ['formula', { formula: 3 }, textWorkbook({ formula: '1+1' }), textWorkbook({ formula: '1+12' })],
    ['number format', { numberFormat: 3 }, textWorkbook({ numberFormat: '0.0' }), textWorkbook({ numberFormat: '0.00' })],
  ] as const)(
    'allows %s at the limit and rejects limit plus one',
    async (_label, override, allowed, rejected) => {
      const textLimits = { ...limits, ...override };
      const headerRowBySheet = { S: 0, ABC: 0, ABCD: 0 };
      await expect(inspectWorkbook(allowed, { now: () => 0, textLimits, headerRowBySheet })).resolves.toBeDefined();
      await expect(inspectWorkbook(rejected, { now: () => 0, textLimits, headerRowBySheet })).rejects.toMatchObject({
        code: 'text-limit-exceeded',
      });
    },
  );

  it('enforces the aggregate workbook text boundary', async () => {
    const data = textWorkbook({ value: 'abc' });
    await expect(inspectWorkbook(data, { now: () => 0, headerRowBySheet: { S: 0 }, textLimits: { ...limits, total: 18 } }))
      .resolves.toBeDefined();
    await expect(inspectWorkbook(data, { now: () => 0, headerRowBySheet: { S: 0 }, textLimits: { ...limits, total: 17 } }))
      .rejects.toMatchObject({ code: 'text-limit-exceeded' });
  });
});


describe('sha256Hex', () => {
  it('matches the standard empty and abc vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
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


  it('defines valueKind, unit, and locale for every canonical target', () => {
    for (const definition of targetFieldDefinitions) {
      expect(definition).toEqual(expect.objectContaining({
        valueKind: expect.stringMatching(/^(number|period|dimension|text)$/),
        unit: expect.any(String),
        locale: 'en-US',
      }));
    }
  });

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


  it('derives stable batch and evidence ids from the import identity', () => {
    const stableSheet: InspectedSheet = {
      name: 'Stable',
      headers: ['Period', 'Revenue'],
      rows: [{ Period: '2025', Revenue: 100 }],
      cells: [{}],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };
    const mapping = { Period: 'period_end', Revenue: 'revenue' };
    const options = { nowDate: () => new Date(0) };

    const first = mapRowsToEvidence('project', 'document-a', stableSheet, mapping, options);
    const replay = mapRowsToEvidence('project', 'document-a', stableSheet, mapping, options);
    const otherDocument = mapRowsToEvidence(
      'project', 'document-b', stableSheet, mapping, options,
    );
    const otherMapping = mapRowsToEvidence(
      'project',
      'document-a',
      stableSheet,
      { Period: 'period_end', Revenue: 'net_profit' },
      options,
    );

    expect(replay.map((item) => item.id)).toEqual(first.map((item) => item.id));
    expect(new Set(replay.map((item) => item.importBatchId))).toEqual(
      new Set(first.map((item) => item.importBatchId)),
    );
    expect(otherDocument[0]?.importBatchId).not.toBe(first[0]?.importBatchId);
    expect(otherDocument[0]?.id).not.toBe(first[0]?.id);
    expect(otherMapping[0]?.importBatchId).not.toBe(first[0]?.importBatchId);
    expect(otherMapping[0]?.id).not.toBe(first[0]?.id);
  });


  it('keeps import keys and ids bounded at maximum header and high-row boundaries', () => {
    const headers = Array.from({ length: 256 }, (_, index) =>
      `${String(index).padStart(3, '0')}${'H'.repeat(253)}`,
    );
    const periodHeader = headers[0]!;
    const revenueHeader = headers[1]!;
    const boundarySheet: InspectedSheet = {
      name: 'Boundary',
      headers,
      rows: [{ [periodHeader]: '2025', [revenueHeader]: 100 }],
      cells: [{}],
      startRow: 1_000_000,
      startColumn: 0,
      headerRowIndex: 1_000_000,
    };
    const mapping = { [periodHeader]: 'period_end', [revenueHeader]: 'revenue' };
    const key = createExcelImportKey('document', boundarySheet, mapping);
    const evidence = mapRowsToEvidence('project', 'document', boundarySheet, mapping, {
      nowDate: () => new Date(0),
    });
    const replay = mapRowsToEvidence('project', 'document', boundarySheet, mapping, {
      nowDate: () => new Date(0),
    });

    expect(key).toMatch(/^excel:[a-f0-9]{64}$/);
    expect(key).toHaveLength(EXCEL_IMPORT_KEY_LENGTH);
    expect(createExcelImportKey('other-document', boundarySheet, mapping)).not.toBe(key);
    expect(createExcelImportKey('document', boundarySheet, {
      [periodHeader]: 'period_end', [revenueHeader]: 'net_profit',
    })).not.toBe(key);
    expect(evidence.map((item) => item.id)).toEqual(replay.map((item) => item.id));
    expect(evidence.every((item) => item.id.length <= EXCEL_EVIDENCE_ID_MAX_LENGTH)).toBe(true);
    expect(evidence.every(
      (item) => item.importBatchId.length === EXCEL_IMPORT_BATCH_ID_LENGTH,
    )).toBe(true);
  });

  it('keeps revenue from different periods in distinct evidence identities', () => {
    const multiPeriodSheet: InspectedSheet = {
      name: 'Periods',
      headers: ['Period', 'Company', 'Revenue'],
      rows: [
        { Period: '2025', Company: 'ACME', Revenue: 1200 },
        { Period: '2024', Company: 'ACME', Revenue: 1000 },
      ],
      cells: [{}, {}],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };

    const revenues = mapRowsToEvidence(
      'p',
      'd',
      multiPeriodSheet,
      { Period: 'period_end', Company: 'company_name', Revenue: 'revenue' },
      {
        createImportBatchId: () => 'batch-1',
        createId: () => 'evidence',
        nowDate: () => new Date(0),
      },
    ).filter((item) => item.fieldId === 'revenue');

    expect(revenues).toMatchObject([
      {
        importBatchId: 'batch-1',
        sourceSheet: 'Periods',
        sourceRow: 2,
        periodIdentity: '2025',
        dimensionIdentity: 'company_name=ACME',
      },
      {
        importBatchId: 'batch-1',
        sourceSheet: 'Periods',
        sourceRow: 3,
        periodIdentity: '2024',
        dimensionIdentity: 'company_name=ACME',
      },
    ]);
  });

  it('scopes only the missing-period fallback to the source document', () => {
    const fallbackSheet: InspectedSheet = {
      name: 'Periods',
      headers: ['Revenue'],
      rows: [{ Revenue: 1200 }],
      cells: [{}],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };
    const options = {
      createImportBatchId: () => 'shared-batch',
      createId: () => 'evidence',
      nowDate: () => new Date(0),
    };

    const [first] = mapRowsToEvidence(
      'p', 'document-1', fallbackSheet, { Revenue: 'revenue' }, options,
    );
    const [second] = mapRowsToEvidence(
      'p', 'document-2', fallbackSheet, { Revenue: 'revenue' }, options,
    );

    expect(first).toMatchObject({
      periodIdentity: 'source-document:document-1:sheet:Periods:row:2',
      dimensionIdentity: 'project:p:default',
    });
    expect(second).toMatchObject({
      periodIdentity: 'source-document:document-2:sheet:Periods:row:2',
      dimensionIdentity: 'project:p:default',
    });
  });

  it('groups the same project and period across documents without a dimension mapping', () => {
    const periodSheet: InspectedSheet = {
      name: 'Periods',
      headers: ['Period', 'Revenue'],
      rows: [{ Period: '2025', Revenue: 100 }],
      cells: [{}],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };
    const mapping = { Period: 'period_end', Revenue: 'revenue' };
    const [first] = mapRowsToEvidence(
      'p',
      'document-1',
      periodSheet,
      mapping,
      { createImportBatchId: () => 'batch-1', createId: () => 'first', nowDate: () => new Date(0) },
    ).filter((item) => item.fieldId === 'revenue');
    const [second] = mapRowsToEvidence(
      'p',
      'document-2',
      { ...periodSheet, rows: [{ Period: '2025', Revenue: 120 }] },
      mapping,
      { createImportBatchId: () => 'batch-2', createId: () => 'second', nowDate: () => new Date(0) },
    ).filter((item) => item.fieldId === 'revenue');

    expect(first).toMatchObject({ periodIdentity: '2025', dimensionIdentity: 'project:p:default' });
    expect(second).toMatchObject({ periodIdentity: '2025', dimensionIdentity: 'project:p:default' });
    expect(resolveEvidenceConflict([first!, second!], 'higher_is_better')).toMatchObject({
      status: 'provisional',
      analysisValue: '100',
    });
  });

  it('preserves an explicitly empty formatted display value', () => {
    const displaySheet: InspectedSheet = {
      name: 'Display',
      headers: ['Revenue'],
      rows: [{ Revenue: 123 }],
      cells: [{ Revenue: { value: 123, w: '', t: 'n' } }],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };

    const [evidence] = mapRowsToEvidence(
      'p',
      'document',
      displaySheet,
      { Revenue: 'revenue' },
      {
        createImportBatchId: () => 'batch',
        createId: () => 'evidence',
        nowDate: () => new Date(0),
      },
    );

    expect(evidence).toMatchObject({ rawValue: '', displayValue: '' });
  });

  it('canonicalizes dates and en-US numbers while preserving raw provenance', () => {
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
      '2025-12-31',
      '1200.5',
    ]);
    expect(evidence[1]?.rawValue).toBe('1,200.50');
  });


  it('normalizes valid en-US grouping and rejects malformed grouping', () => {
    const groupedSheet: InspectedSheet = {
      name: 'Numbers',
      headers: ['Revenue'],
      rows: [{ Revenue: '1,234.50' }],
      cells: [{ Revenue: { value: '1,234.50', w: '$1,234.50', t: 's' } }],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };
    const [evidence] = mapRowsToEvidence(
      'p', 'd', groupedSheet, { Revenue: 'revenue' }, { createId: () => 'id' },
    );
    expect(evidence).toMatchObject({
      rawValue: '$1,234.50',
      normalizedValue: '1234.5',
      displayValue: '$1,234.50',
    });
    expect(() => mapRowsToEvidence(
      'p', 'd', { ...groupedSheet, rows: [{ Revenue: '12,34' }] }, { Revenue: 'revenue' },
    )).toThrowError(expect.objectContaining({ code: 'invalid-cell-value' }));
  });

  it.each([
    ['1e3', '1000'],
    ['.50', '0.5'],
    ['12,345.60', '12345.6'],
  ] as const)('uses strict shared number canonicalization for %s', (value, canonicalValue) => {
    const sheet: InspectedSheet = {
      name: 'Numbers',
      headers: ['Revenue'],
      rows: [{ Revenue: value }],
      cells: [{}],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };

    const [item] = mapRowsToEvidence(
      'p',
      'd',
      sheet,
      { Revenue: 'revenue' },
      { createId: () => 'id' },
    );

    expect(item?.normalizedValue).toBe(canonicalValue);
  });

  it.each([
    '0x10',
    '0b10',
    '0o10',
    '1_000',
    '1.',
    '12,34',
    '1234,567',
    '1,23,456',
    '1,234e2',
    'NaN',
    'Infinity',
  ])('rejects numeric syntax outside the strict shared grammar: %s', (value) => {
    const sheet: InspectedSheet = {
      name: 'Numbers',
      headers: ['Revenue'],
      rows: [{ Revenue: value }],
      cells: [{}],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };

    expect(() =>
      mapRowsToEvidence('p', 'd', sheet, { Revenue: 'revenue' }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-cell-value' }));
  });

  it('canonicalizes period Date/string inputs and Unicode dimensions', () => {
    const canonicalSheet: InspectedSheet = {
      name: 'Canonical',
      headers: ['Period', 'Company'],
      rows: [
        { Period: new Date('2025-12-31T00:00:00.000Z'), Company: '  Cafe\u0301  ' },
        { Period: ' 2025-12-31 ', Company: 'Caf\u00e9' },
      ],
      cells: [{}, {}],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };
    const evidence = mapRowsToEvidence(
      'p',
      'd',
      canonicalSheet,
      { Period: 'period_end', Company: 'company_name' },
      { createId: () => 'id', nowDate: () => new Date(0) },
    );

    expect(evidence.filter((item) => item.fieldId === 'period_end')
      .map((item) => item.normalizedValue)).toEqual(['2025-12-31', '2025-12-31']);
    expect(new Set(evidence.map((item) => item.periodIdentity))).toEqual(new Set(['2025-12-31']));
    expect(evidence.find((item) => item.fieldId === 'company_name')).toMatchObject({
      rawValue: '  Cafe\u0301  ',
      normalizedValue: 'Caf\u00e9',
      dimensionIdentity: 'company_name=Caf%C3%A9',
    });
  });


  it('canonicalizes each mapped cell only once per row', () => {
    let conversions = 0;
    const periodValue = {
      toString() {
        conversions += 1;
        return ' 2025 ';
      },
    };
    const inspected: InspectedSheet = {
      name: 'Once',
      headers: ['Period', 'Revenue'],
      rows: [{ Period: periodValue, Revenue: 1 }],
      cells: [{ Period: { value: periodValue, w: ' 2025 ' } }],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };

    const evidence = mapRowsToEvidence(
      'p', 'd', inspected, { Period: 'period_end', Revenue: 'revenue' },
      { createId: () => 'id', nowDate: () => new Date(0) },
    );

    expect(conversions).toBe(1);
    expect(evidence).toHaveLength(2);
    expect(evidence.every((item) => item.periodIdentity === '2025')).toBe(true);
  });


  it('treats canonical whitespace as missing for periods, dimensions, and evidence', () => {
    const inspected: InspectedSheet = {
      name: 'Whitespace',
      headers: ['Period', 'Company', 'Description', 'Revenue'],
      rows: [{ Period: ' \t ', Company: '\u00a0 ', Description: '  ', Revenue: 1 }],
      cells: [{}],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };

    const evidence = mapRowsToEvidence(
      'p',
      'document',
      inspected,
      {
        Period: 'period_end', Company: 'company_name',
        Description: 'business_description', Revenue: 'revenue',
      },
      { createId: () => 'id', nowDate: () => new Date(0) },
    );

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      fieldId: 'revenue',
      periodIdentity: 'source-document:document:sheet:Whitespace:row:2',
      dimensionIdentity: 'project:p:default',
      normalizedValue: '1',
    });
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
      { A: 'company_name', B: 'business_description', C: 'period_end', D: 'revenue' },
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

  it('rejects target fields outside the canonical registry', () => {
    expect(() => mapRowsToEvidence(
      'p',
      'd',
      sheet,
      { 营业收入: 'locale_text' },
    )).toThrowError(expect.objectContaining({ code: 'unknown-target-field' }));
  });

  it('rejects canonical fields that are not directly importable', () => {
    expect(() => mapRowsToEvidence(
      'p',
      'd',
      sheet,
      { 营业收入: 'nrr' },
    )).toThrowError(expect.objectContaining({ code: 'non-importable-target-field' }));
  });

  it('rejects duplicate target fields at the mapper boundary', () => {
    expect(() => mapRowsToEvidence(
      'p',
      'd',
      sheet,
      { 年份: 'revenue', 营业收入: 'revenue' },
    )).toThrowError(expect.objectContaining({ code: 'duplicate-target-field' }));
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
      { Company: 'company_name', Locale: 'business_description' },
      { createId: () => 'id', nowDate: () => new Date(0) },
    );

    expect(evidence.map((item) => item.normalizedValue)).toEqual([
      'ACME, Inc.',
      '1.234,56',
    ]);
  });

  it('keeps cloned coordinates and provenance for quoted sheet locators', async () => {
    const worksheet: XLSX.WorkSheet = {};
    XLSX.utils.sheet_add_aoa(worksheet, [['Metric'], [3]], { origin: 'D5' });
    worksheet['!ref'] = 'D5:D6';
    worksheet.D6!.f = '1+2';
    worksheet.D6!.z = '0.00';
    const inspected = (await inspectWorkbook(
      workbookFromWorksheet("O'Brien! FY25", worksheet),
      { now: () => 0 },
    )).sheets["O'Brien! FY25"]!;
    const cloned = structuredClone(inspected);

    const [evidence] = mapRowsToEvidence(
      'p',
      'd',
      cloned,
      { Metric: 'revenue' },
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
