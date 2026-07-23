import { describe, expect, it } from 'vitest';
import {
  preflightZipArchive,
  ZipPreflightError,
  type ZipPreflightLimits,
} from './zip-preflight';

const limits: ZipPreflightLimits = {
  maxEntries: 10,
  maxEntryUncompressedBytes: 1_000,
  maxTotalUncompressedBytes: 2_000,
  maxCompressionRatio: 100,
};

interface EntryOptions {
  readonly name?: string;
  readonly localName?: string;
  readonly data?: Uint8Array;
  readonly flags?: number;
  readonly localFlags?: number;
  readonly method?: number;
  readonly localMethod?: number;
  readonly crc32?: number;
  readonly localCrc32?: number;
  readonly compressedSize?: number;
  readonly localCompressedSize?: number;
  readonly uncompressedSize?: number;
  readonly localUncompressedSize?: number;
  readonly localSignature?: number;
}

interface ArchiveOptions {
  readonly eocdSignature?: number;
  readonly diskNumber?: number;
  readonly centralDirectoryDisk?: number;
  readonly entriesOnDisk?: number;
  readonly totalEntries?: number;
  readonly centralDirectorySize?: number;
  readonly centralDirectoryOffset?: number;
}

function encodeName(name: string): Uint8Array {
  return new TextEncoder().encode(name);
}

function zipArchive(
  entryOptions: readonly EntryOptions[],
  archiveOptions: ArchiveOptions = {},
): Uint8Array {
  const entries = entryOptions.map((entry) => {
    const name = encodeName(entry.name ?? 'entry.bin');
    const localName = encodeName(entry.localName ?? entry.name ?? 'entry.bin');
    const data = entry.data ?? new Uint8Array([1]);
    return { entry, name, localName, data };
  });
  const localSize = entries.reduce(
    (total, item) => total + 30 + item.localName.length + item.data.length,
    0,
  );
  const centralSize = entries.reduce((total, item) => total + 46 + item.name.length, 0);
  const bytes = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(bytes.buffer);
  const localOffsets: number[] = [];
  let cursor = 0;

  for (const { entry, localName, data } of entries) {
    const flags = entry.flags ?? 0x0800;
    const method = entry.method ?? 0;
    const compressedSize = entry.compressedSize ?? data.length;
    const uncompressedSize = entry.uncompressedSize ?? data.length;
    const crc32 = entry.crc32 ?? 0x12345678;
    localOffsets.push(cursor);
    view.setUint32(cursor, entry.localSignature ?? 0x04034b50, true);
    view.setUint16(cursor + 4, 20, true);
    view.setUint16(cursor + 6, entry.localFlags ?? flags, true);
    view.setUint16(cursor + 8, entry.localMethod ?? method, true);
    view.setUint32(cursor + 14, entry.localCrc32 ?? crc32, true);
    view.setUint32(cursor + 18, entry.localCompressedSize ?? compressedSize, true);
    view.setUint32(cursor + 22, entry.localUncompressedSize ?? uncompressedSize, true);
    view.setUint16(cursor + 26, localName.length, true);
    bytes.set(localName, cursor + 30);
    bytes.set(data, cursor + 30 + localName.length);
    cursor += 30 + localName.length + data.length;
  }

  const centralOffset = cursor;
  entries.forEach(({ entry, name, data }, index) => {
    const flags = entry.flags ?? 0x0800;
    const method = entry.method ?? 0;
    const compressedSize = entry.compressedSize ?? data.length;
    const uncompressedSize = entry.uncompressedSize ?? data.length;
    const crc32 = entry.crc32 ?? 0x12345678;
    view.setUint32(cursor, 0x02014b50, true);
    view.setUint16(cursor + 4, 20, true);
    view.setUint16(cursor + 6, 20, true);
    view.setUint16(cursor + 8, flags, true);
    view.setUint16(cursor + 10, method, true);
    view.setUint32(cursor + 16, crc32, true);
    view.setUint32(cursor + 20, compressedSize, true);
    view.setUint32(cursor + 24, uncompressedSize, true);
    view.setUint16(cursor + 28, name.length, true);
    view.setUint32(cursor + 42, localOffsets[index]!, true);
    bytes.set(name, cursor + 46);
    cursor += 46 + name.length;
  });

  view.setUint32(cursor, archiveOptions.eocdSignature ?? 0x06054b50, true);
  view.setUint16(cursor + 4, archiveOptions.diskNumber ?? 0, true);
  view.setUint16(cursor + 6, archiveOptions.centralDirectoryDisk ?? 0, true);
  view.setUint16(cursor + 8, archiveOptions.entriesOnDisk ?? entries.length, true);
  view.setUint16(cursor + 10, archiveOptions.totalEntries ?? entries.length, true);
  view.setUint32(cursor + 12, archiveOptions.centralDirectorySize ?? centralSize, true);
  view.setUint32(cursor + 16, archiveOptions.centralDirectoryOffset ?? centralOffset, true);
  return bytes;
}

function expectCode(action: () => unknown, code: ZipPreflightError['code']): void {
  expect(action).toThrowError(expect.objectContaining({ code }));
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ZipPreflightError);
  }
}

describe('preflightZipArchive', () => {
  it('returns frozen bounded metadata for a valid workbook archive', () => {
    const result = preflightZipArchive(
      zipArchive([{ name: 'xl/workbook.xml', data: new Uint8Array([1, 2, 3]) }]),
      limits,
    );

    expect(result).toEqual({
      entries: [{
        name: 'xl/workbook.xml',
        compressedSize: 3,
        uncompressedSize: 3,
        compressionMethod: 0,
        crc32: 0x12345678,
        dataOffset: 45,
      }],
      totalUncompressedBytes: 3,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.entries)).toBe(true);
    expect(Object.isFrozen(result.entries[0])).toBe(true);
  });

  it('uses the exact bytes of a sliced Uint8Array view', () => {
    const archive = zipArchive([{ name: 'xl/workbook.xml' }]);
    const padded = new Uint8Array(archive.length + 11);
    padded.set(archive, 7);

    expect(preflightZipArchive(padded.subarray(7, 7 + archive.length), limits).entries[0]?.name)
      .toBe('xl/workbook.xml');
  });

  it.each([
    ['empty input', () => new Uint8Array()],
    ['missing EOCD', () => zipArchive([{ name: 'a' }]).subarray(0, 20)],
    ['invalid EOCD signature', () => zipArchive([{ name: 'a' }], { eocdSignature: 0 })],
    ['central directory offset out of bounds', () => zipArchive(
      [{ name: 'a' }], { centralDirectoryOffset: 0xfffffff0 },
    )],
    ['central directory size out of bounds', () => zipArchive(
      [{ name: 'a' }], { centralDirectorySize: 0xfffffff0 },
    )],
    ['invalid local signature', () => zipArchive([{ name: 'a', localSignature: 0 }])],
    ['compressed data out of bounds', () => zipArchive([
      { name: 'a', compressedSize: 100, localCompressedSize: 100 },
    ])],
  ])('rejects %s', (_name, createArchive) => {
    expectCode(() => preflightZipArchive(createArchive(), limits), 'malformed-zip');
  });

  it('enforces entry, per-entry, total, ratio, and zero-compressed limits', () => {
    expectCode(
      () => preflightZipArchive(zipArchive([{ name: 'a' }, { name: 'b' }]), {
        ...limits,
        maxEntries: 1,
      }),
      'zip-entry-limit',
    );
    expectCode(
      () => preflightZipArchive(zipArchive([{ uncompressedSize: 1_001, method: 8 }]), limits),
      'zip-entry-too-large',
    );
    expectCode(
      () => preflightZipArchive(zipArchive([
        { name: 'a', data: new Uint8Array(10), uncompressedSize: 1_000, method: 8 },
        { name: 'b', data: new Uint8Array(11), uncompressedSize: 1_001, method: 8 },
      ]), { ...limits, maxEntryUncompressedBytes: 2_000 }),
      'zip-expanded-size-limit',
    );
    expectCode(
      () => preflightZipArchive(zipArchive([
        { data: new Uint8Array(2), uncompressedSize: 201, method: 8 },
      ]), limits),
      'zip-compression-ratio',
    );
    expectCode(
      () => preflightZipArchive(zipArchive([
        { data: new Uint8Array(), compressedSize: 0, uncompressedSize: 1, method: 8 },
      ]), limits),
      'zip-compression-ratio',
    );
  });

  it('rejects encrypted, data-descriptor, ZIP64, and multi-disk archives', () => {
    expectCode(
      () => preflightZipArchive(zipArchive([{ flags: 0x0801 }]), limits),
      'malformed-zip',
    );
    expectCode(
      () => preflightZipArchive(zipArchive([{ flags: 0x0808 }]), limits),
      'malformed-zip',
    );
    expectCode(
      () => preflightZipArchive(zipArchive([{ compressedSize: 0xffffffff }]), limits),
      'malformed-zip',
    );
    expectCode(
      () => preflightZipArchive(zipArchive([{ name: 'a' }], { totalEntries: 0xffff }), limits),
      'malformed-zip',
    );
    expectCode(
      () => preflightZipArchive(zipArchive([{ name: 'a' }], { diskNumber: 1 }), limits),
      'malformed-zip',
    );
    expectCode(
      () => preflightZipArchive(zipArchive([{ name: 'a' }], { centralDirectoryDisk: 1 }), limits),
      'malformed-zip',
    );
    expectCode(
      () => preflightZipArchive(zipArchive([{ name: 'a' }], { entriesOnDisk: 0 }), limits),
      'malformed-zip',
    );
  });

  it.each([
    '../secret',
    '..\\secret',
    '/absolute',
    '\\absolute',
    'C:\\drive',
    'C:relative',
    '\\\\server\\share',
    'a/./b',
    'a/../b',
    'a\0b',
    'a\u0001b',
  ])('rejects unsafe entry name %j', (name) => {
    expectCode(() => preflightZipArchive(zipArchive([{ name }]), limits), 'malformed-zip');
  });

  it('rejects duplicate names after separator normalization', () => {
    expectCode(
      () => preflightZipArchive(zipArchive([{ name: 'a\\b' }, { name: 'a/b' }]), limits),
      'malformed-zip',
    );
  });

  it.each([
    ['flags', { flags: 0x0800, localFlags: 0 }],
    ['method', { method: 8, localMethod: 0 }],
    ['name', { name: 'central', localName: 'local' }],
    ['compressed size', { compressedSize: 1, localCompressedSize: 2 }],
    ['uncompressed size', { uncompressedSize: 1, localUncompressedSize: 2 }],
    ['CRC', { crc32: 1, localCrc32: 2 }],
  ] as const)('rejects local/central %s mismatch', (_name, entry) => {
    expectCode(() => preflightZipArchive(zipArchive([entry]), limits), 'malformed-zip');
  });

  it('rejects unsupported methods and stored entries with mismatched sizes', () => {
    expectCode(
      () => preflightZipArchive(zipArchive([{ method: 12 }]), limits),
      'malformed-zip',
    );
    expectCode(
      () => preflightZipArchive(zipArchive([{ method: 0, uncompressedSize: 2 }]), limits),
      'malformed-zip',
    );
  });

  it.each([
    ['maxEntries', 0],
    ['maxEntries', -1],
    ['maxEntries', 1.5],
    ['maxEntryUncompressedBytes', Number.POSITIVE_INFINITY],
    ['maxTotalUncompressedBytes', Number.NaN],
    ['maxCompressionRatio', -1],
  ] as const)('rejects invalid limit %s=%s with a typed error', (key, value) => {
    expectCode(
      () => preflightZipArchive(zipArchive([{ name: 'a' }]), { ...limits, [key]: value }),
      'malformed-zip',
    );
  });

  it('rejects limits with a required property missing', () => {
    const { maxEntries: _omitted, ...incompleteLimits } = limits;
    expectCode(
      () => preflightZipArchive(zipArchive([{ name: 'a' }]), incompleteLimits as ZipPreflightLimits),
      'malformed-zip',
    );
  });
});
