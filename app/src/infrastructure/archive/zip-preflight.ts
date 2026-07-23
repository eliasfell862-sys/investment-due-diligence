export type ZipPreflightErrorCode =
  | 'malformed-zip'
  | 'zip-entry-limit'
  | 'zip-entry-too-large'
  | 'zip-expanded-size-limit'
  | 'zip-compression-ratio';

export class ZipPreflightError extends Error {
  readonly code: ZipPreflightErrorCode;
  override readonly cause: unknown;

  constructor(code: ZipPreflightErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ZipPreflightError';
    this.code = code;
    this.cause = cause;
  }
}

export interface ZipPreflightLimits {
  readonly maxEntries: number;
  readonly maxEntryUncompressedBytes: number;
  readonly maxTotalUncompressedBytes: number;
  readonly maxCompressionRatio: number;
}

export interface ZipEntryMetadata {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly compressionMethod: number;
  readonly crc32: number;
  readonly dataOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
const MAX_COMMENT_BYTES = 65_535;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const CENTRAL_ENTRY_SIZE = 46;
const LOCAL_ENTRY_SIGNATURE = 0x04034b50;
const LOCAL_ENTRY_SIZE = 30;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const UINT16_SENTINEL = 0xffff;
const UINT32_SENTINEL = 0xffffffff;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const STORE_METHOD = 0;
const DEFLATE_METHOD = 8;
const CP437_HIGH_CODE_POINTS = [
  0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7, 0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5,
  0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9, 0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192,
  0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00ba, 0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556, 0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b, 0x2510,
  0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f, 0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567,
  0x2568, 0x2564, 0x2565, 0x2559, 0x2558, 0x2552, 0x2553, 0x256b, 0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580,
  0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4, 0x03a6, 0x0398, 0x03a9, 0x03b4, 0x221e, 0x03c6, 0x03b5, 0x2229,
  0x2261, 0x00b1, 0x2265, 0x2264, 0x2320, 0x2321, 0x00f7, 0x2248, 0x00b0, 0x2219, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x25a0, 0x00a0,
] as const;

function zipError(
  code: ZipPreflightErrorCode,
  message: string,
  cause?: unknown,
): ZipPreflightError {
  return new ZipPreflightError(code, message, cause);
}

function malformed(message: string, cause?: unknown): never {
  throw zipError('malformed-zip', message, cause);
}

function bytesView(data: ArrayBuffer | Uint8Array): Uint8Array {
  try {
    if (data instanceof Uint8Array) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
  } catch (error) {
    malformed('ZIP input cannot be read.', error);
  }
  return malformed('ZIP input must be an ArrayBuffer or Uint8Array.');
}

function validateLimits(limits: ZipPreflightLimits): void {
  if (limits === null || typeof limits !== 'object') {
    malformed('ZIP preflight limits are invalid.');
  }
  const requiredLimits = [
    ['maxEntries', limits.maxEntries],
    ['maxEntryUncompressedBytes', limits.maxEntryUncompressedBytes],
    ['maxTotalUncompressedBytes', limits.maxTotalUncompressedBytes],
    ['maxCompressionRatio', limits.maxCompressionRatio],
  ] as const;
  for (const [name, value] of requiredLimits) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      malformed(`ZIP preflight limit ${name} must be a positive safe integer.`);
    }
  }
}

function checkedEnd(start: number, size: number, limit: number, label: string): number {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(size) ||
    !Number.isSafeInteger(limit) ||
    start < 0 ||
    size < 0 ||
    start > limit ||
    size > limit - start
  ) {
    malformed(`${label} exceeds ZIP bounds.`);
  }
  return start + size;
}

function findEocdCandidate(view: DataView): number | undefined {
  if (view.byteLength < EOCD_SIZE) {
    return undefined;
  }
  const minimumOffset = Math.max(0, view.byteLength - EOCD_SIZE - MAX_COMMENT_BYTES);
  for (let offset = view.byteLength - EOCD_SIZE; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) {
      continue;
    }
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + EOCD_SIZE + commentLength === view.byteLength) {
      return offset;
    }
  }
  return undefined;
}

function findEocd(view: DataView): number {
  return findEocdCandidate(view) ?? malformed('ZIP end-of-central-directory record is missing.');
}

export function isZipArchiveCandidate(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = bytesView(data);
  if (bytes.byteLength < 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return true;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const leadingSignature = bytes.byteLength >= 4 ? view.getUint32(0, true) : undefined;
  return (
    leadingSignature === LOCAL_ENTRY_SIGNATURE ||
    leadingSignature === CENTRAL_ENTRY_SIGNATURE ||
    leadingSignature === ZIP64_EOCD_SIGNATURE ||
    leadingSignature === ZIP64_LOCATOR_SIGNATURE ||
    findEocdCandidate(view) !== undefined
  );
}

function rejectZip64Records(view: DataView, start: number, end: number): void {
  for (let offset = start; offset + 4 <= end; offset += 1) {
    const signature = view.getUint32(offset, true);
    if (signature === ZIP64_EOCD_SIGNATURE || signature === ZIP64_LOCATOR_SIGNATURE) {
      malformed('ZIP64 archives are not supported.');
    }
  }
}

function rejectZip64Extra(view: DataView, start: number, length: number): void {
  const end = checkedEnd(start, length, view.byteLength, 'ZIP extra field');
  let cursor = start;
  while (cursor < end) {
    checkedEnd(cursor, 4, end, 'ZIP extra field header');
    const fieldId = view.getUint16(cursor, true);
    const fieldSize = view.getUint16(cursor + 2, true);
    cursor = checkedEnd(cursor + 4, fieldSize, end, 'ZIP extra field value');
    if (fieldId === ZIP64_EXTRA_FIELD_ID) {
      malformed('ZIP64 entries are not supported.');
    }
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function decodeCp437(nameBytes: Uint8Array): string {
  const characters = new Array<string>(nameBytes.length);
  for (let index = 0; index < nameBytes.length; index += 1) {
    const byte = nameBytes[index]!;
    characters[index] = byte < 0x80
      ? String.fromCharCode(byte)
      : String.fromCodePoint(CP437_HIGH_CODE_POINTS[byte - 0x80]!);
  }
  return characters.join('');
}

function decodeName(nameBytes: Uint8Array, flags: number): string {
  if ((flags & UTF8_FLAG) === 0) {
    return decodeCp437(nameBytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
  } catch (error) {
    return malformed('ZIP entry name cannot be decoded safely.', error);
  }
}

function normalizeName(nameBytes: Uint8Array, flags: number): string {
  if (nameBytes.length === 0) {
    malformed('ZIP entry name cannot be empty.');
  }
  const decoded = decodeName(nameBytes, flags);
  if ([...decoded].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  })) {
    malformed('ZIP entry name contains control characters.');
  }
  const normalized = decoded.replaceAll('\\', '/');
  if (
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.startsWith('//')
  ) {
    malformed('ZIP entry name cannot be absolute.');
  }
  const isDirectory = normalized.endsWith('/');
  const segments = normalized.split('/');
  if (isDirectory) {
    segments.pop();
  }
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    malformed('ZIP entry name contains an unsafe path segment.');
  }
  return normalized;
}

function frozenResult(entries: ZipEntryMetadata[], totalUncompressedBytes: number): {
  readonly entries: readonly ZipEntryMetadata[];
  readonly totalUncompressedBytes: number;
} {
  const frozenEntries = Object.freeze(entries.map((entry) => Object.freeze(entry)));
  return Object.freeze({ entries: frozenEntries, totalUncompressedBytes });
}

export function preflightZipArchive(
  data: ArrayBuffer | Uint8Array,
  limits: ZipPreflightLimits,
): {
  readonly entries: readonly ZipEntryMetadata[];
  readonly totalUncompressedBytes: number;
} {
  validateLimits(limits);
  const bytes = bytesView(data);
  if (bytes.byteLength === 0) {
    malformed('ZIP input cannot be empty.');
  }

  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEocd(view);
    const diskNumber = view.getUint16(eocdOffset + 4, true);
    const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
    const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
    const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);

    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
      malformed('Multi-disk ZIP archives are not supported.');
    }
    if (
      entryCount === UINT16_SENTINEL ||
      entriesOnDisk === UINT16_SENTINEL ||
      centralDirectorySize === UINT32_SENTINEL ||
      centralDirectoryOffset === UINT32_SENTINEL
    ) {
      malformed('ZIP64 archives are not supported.');
    }
    if (entryCount > limits.maxEntries) {
      throw zipError(
        'zip-entry-limit',
        `ZIP archive cannot contain more than ${limits.maxEntries.toLocaleString('en-US')} entries.`,
      );
    }

    const centralDirectoryEnd = checkedEnd(
      centralDirectoryOffset,
      centralDirectorySize,
      eocdOffset,
      'ZIP central directory',
    );
    rejectZip64Records(view, centralDirectoryEnd, eocdOffset);

    let metadataCursor = centralDirectoryOffset;
    let declaredTotalUncompressedBytes = 0;
    for (let index = 0; index < entryCount; index += 1) {
      checkedEnd(metadataCursor, CENTRAL_ENTRY_SIZE, centralDirectoryEnd, 'ZIP central entry');
      if (view.getUint32(metadataCursor, true) !== CENTRAL_ENTRY_SIGNATURE) {
        malformed('ZIP central directory entry signature is invalid.');
      }
      const compressedSize = view.getUint32(metadataCursor + 20, true);
      const uncompressedSize = view.getUint32(metadataCursor + 24, true);
      const diskStart = view.getUint16(metadataCursor + 34, true);
      const localHeaderOffset = view.getUint32(metadataCursor + 42, true);
      if (
        compressedSize === UINT32_SENTINEL ||
        uncompressedSize === UINT32_SENTINEL ||
        localHeaderOffset === UINT32_SENTINEL ||
        diskStart === UINT16_SENTINEL
      ) {
        malformed('ZIP64 entries are not supported.');
      }
      if (uncompressedSize > limits.maxTotalUncompressedBytes - declaredTotalUncompressedBytes) {
        throw zipError(
          'zip-expanded-size-limit',
          `ZIP entries cannot expand beyond ${limits.maxTotalUncompressedBytes.toLocaleString('en-US')} bytes in total.`,
        );
      }
      declaredTotalUncompressedBytes += uncompressedSize;
      const nameLength = view.getUint16(metadataCursor + 28, true);
      const extraLength = view.getUint16(metadataCursor + 30, true);
      const commentLength = view.getUint16(metadataCursor + 32, true);
      metadataCursor = checkedEnd(
        metadataCursor,
        CENTRAL_ENTRY_SIZE + nameLength + extraLength + commentLength,
        centralDirectoryEnd,
        'ZIP central entry',
      );
    }
    if (metadataCursor !== centralDirectoryEnd) {
      malformed('ZIP central directory size is inconsistent.');
    }

    let cursor = centralDirectoryOffset;
    let totalUncompressedBytes = 0;
    const entries: ZipEntryMetadata[] = [];
    const names = new Set<string>();
    const localRanges: Array<readonly [number, number]> = [];

    for (let index = 0; index < entryCount; index += 1) {
      checkedEnd(cursor, CENTRAL_ENTRY_SIZE, centralDirectoryEnd, 'ZIP central entry');
      if (view.getUint32(cursor, true) !== CENTRAL_ENTRY_SIGNATURE) {
        malformed('ZIP central directory entry signature is invalid.');
      }

      const flags = view.getUint16(cursor + 8, true);
      const compressionMethod = view.getUint16(cursor + 10, true);
      const crc32 = view.getUint32(cursor + 16, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const diskStart = view.getUint16(cursor + 34, true);
      const localHeaderOffset = view.getUint32(cursor + 42, true);
      if (
        compressedSize === UINT32_SENTINEL ||
        uncompressedSize === UINT32_SENTINEL ||
        localHeaderOffset === UINT32_SENTINEL ||
        diskStart === UINT16_SENTINEL
      ) {
        malformed('ZIP64 entries are not supported.');
      }
      if (diskStart !== 0) {
        malformed('Multi-disk ZIP entries are not supported.');
      }
      if ((flags & ENCRYPTED_FLAG) !== 0) {
        malformed('Encrypted ZIP entries are not supported.');
      }
      if ((flags & DATA_DESCRIPTOR_FLAG) !== 0) {
        malformed('ZIP data descriptors are not supported.');
      }
      const allowedFlags = compressionMethod === DEFLATE_METHOD ? 0x0806 : UTF8_FLAG;
      if (
        (compressionMethod !== STORE_METHOD && compressionMethod !== DEFLATE_METHOD) ||
        (flags & ~allowedFlags) !== 0
      ) {
        malformed('ZIP entry flags or compression method are not supported.');
      }
      if (uncompressedSize > limits.maxEntryUncompressedBytes) {
        throw zipError(
          'zip-entry-too-large',
          `A ZIP entry cannot expand beyond ${limits.maxEntryUncompressedBytes.toLocaleString('en-US')} bytes.`,
        );
      }
      if (
        uncompressedSize > 0 &&
        (compressedSize === 0 || uncompressedSize > compressedSize * limits.maxCompressionRatio)
      ) {
        throw zipError(
          'zip-compression-ratio',
          `A ZIP entry exceeds the ${limits.maxCompressionRatio}:1 compression ratio limit.`,
        );
      }
      if (compressionMethod === STORE_METHOD && compressedSize !== uncompressedSize) {
        malformed('Stored ZIP entry sizes are inconsistent.');
      }
      if (uncompressedSize > limits.maxTotalUncompressedBytes - totalUncompressedBytes) {
        throw zipError(
          'zip-expanded-size-limit',
          `ZIP entries cannot expand beyond ${limits.maxTotalUncompressedBytes.toLocaleString('en-US')} bytes in total.`,
        );
      }
      totalUncompressedBytes += uncompressedSize;

      const centralEntryEnd = checkedEnd(
        cursor,
        CENTRAL_ENTRY_SIZE + nameLength + extraLength + commentLength,
        centralDirectoryEnd,
        'ZIP central entry',
      );
      const centralNameStart = cursor + CENTRAL_ENTRY_SIZE;
      const centralName = bytes.subarray(centralNameStart, centralNameStart + nameLength);
      rejectZip64Extra(view, centralNameStart + nameLength, extraLength);
      const normalizedName = normalizeName(centralName, flags);
      if (names.has(normalizedName)) {
        malformed('ZIP archive contains duplicate normalized entry names.');
      }
      names.add(normalizedName);

      checkedEnd(localHeaderOffset, LOCAL_ENTRY_SIZE, centralDirectoryOffset, 'ZIP local entry');
      if (view.getUint32(localHeaderOffset, true) !== LOCAL_ENTRY_SIGNATURE) {
        malformed('ZIP local entry signature is invalid.');
      }
      const localFlags = view.getUint16(localHeaderOffset + 6, true);
      const localMethod = view.getUint16(localHeaderOffset + 8, true);
      const localCrc32 = view.getUint32(localHeaderOffset + 14, true);
      const localCompressedSize = view.getUint32(localHeaderOffset + 18, true);
      const localUncompressedSize = view.getUint32(localHeaderOffset + 22, true);
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const localHeaderEnd = checkedEnd(
        localHeaderOffset,
        LOCAL_ENTRY_SIZE + localNameLength + localExtraLength,
        centralDirectoryOffset,
        'ZIP local entry',
      );
      const localNameStart = localHeaderOffset + LOCAL_ENTRY_SIZE;
      const localName = bytes.subarray(localNameStart, localNameStart + localNameLength);
      rejectZip64Extra(view, localNameStart + localNameLength, localExtraLength);
      if (
        localFlags !== flags ||
        localMethod !== compressionMethod ||
        localCrc32 !== crc32 ||
        localCompressedSize !== compressedSize ||
        localUncompressedSize !== uncompressedSize ||
        !equalBytes(localName, centralName)
      ) {
        malformed('ZIP central and local entry metadata are inconsistent.');
      }
      const dataEnd = checkedEnd(
        localHeaderEnd,
        compressedSize,
        centralDirectoryOffset,
        'ZIP local entry data',
      );
      localRanges.push([localHeaderOffset, dataEnd]);
      entries.push({
        name: normalizedName,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        crc32,
        dataOffset: localHeaderEnd,
      });
      cursor = centralEntryEnd;
    }

    if (cursor !== centralDirectoryEnd) {
      malformed('ZIP central directory size is inconsistent.');
    }
    localRanges.sort((left, right) => left[0] - right[0]);
    for (let index = 1; index < localRanges.length; index += 1) {
      if (localRanges[index]![0] < localRanges[index - 1]![1]) {
        malformed('ZIP local entries overlap.');
      }
    }
    return frozenResult(entries, totalUncompressedBytes);
  } catch (error) {
    if (error instanceof ZipPreflightError) {
      throw error;
    }
    throw zipError('malformed-zip', 'ZIP metadata cannot be read safely.', error);
  }
}
