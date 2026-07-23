import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

import type { SourceFragment, SourceFragmentKind, SourceLocator } from '../../domain/documents/source-fragment';
import { parseSourceFragment } from '../../domain/documents/source-fragment.schema';
import { ZipPreflightError, preflightZipArchive } from '../archive/zip-preflight';
import { sha256Hex } from '../../shared/crypto/sha256';
import {
  DocumentExtractorError,
  MAX_EXTRACTED_TEXT_LENGTH,
  MAX_FRAGMENT_TEXT_LENGTH,
  freezeDocumentExtractionResult,
  validateDocumentExtractionRequest,
  type DocumentExtractionRequest,
  type DocumentExtractionResult,
} from './document-extractor';

export interface PptxArchiveEntryAdapter {
  readonly async: (type: 'string') => Promise<string>;
}

export interface PptxArchiveAdapter {
  readonly files: Readonly<Record<string, PptxArchiveEntryAdapter>>;
  readonly destroy?: () => void | Promise<void>;
}

export interface PptxExtractionDependencies {
  readonly now?: () => Date;
  readonly isCancelled?: () => boolean;
  readonly loadZip?: (data: Uint8Array) => Promise<PptxArchiveAdapter>;
}

export const MAX_PPTX_SLIDES = 500;
export const MAX_PPTX_FRAGMENTS = 10_000;
export const MAX_PPTX_XML_CHARACTERS = 8 * 1024 * 1024;
const MAX_PPTX_RELATIONSHIPS = 10_000;
const MAX_PPTX_OBJECTS_PER_SLIDE = 5_000;
const MAX_PPTX_TABLES_PER_SLIDE = 1_000;
const MAX_PPTX_ROWS_PER_TABLE = 2_000;
const MAX_PPTX_CELLS_PER_ROW = 2_000;
const MAX_PPTX_CELLS_PER_TABLE = 20_000;
const MAX_PPTX_XML_NODES = 250_000;
const MAX_PPTX_XML_DEPTH = 128;
const MAX_PPTX_TEXT_RUNS_PER_FRAGMENT = 100_000;
const PPTX_EXTRACTION_VERSION = 'pptx-ooxml-1';

const ZIP_LIMITS = Object.freeze({
  maxEntries: 5_000,
  maxEntryUncompressedBytes: 50 * 1024 * 1024,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 100,
});

type OrderedNode = Readonly<Record<string, unknown>>;

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

interface FragmentDraft {
  readonly sourceKind: SourceFragmentKind;
  readonly locator: SourceLocator;
  readonly rawText: string;
  readonly normalizedText: string;
  readonly objectOrder: number;
}

function extractionError(
  code: ConstructorParameters<typeof DocumentExtractorError>[0],
  message: string,
  cause?: unknown,
): DocumentExtractorError {
  return new DocumentExtractorError(code, message, cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function snapshotRequest(input: DocumentExtractionRequest): DocumentExtractionRequest {
  try {
    if (!isRecord(input)) throw extractionError('malformed-document', 'PPTX extraction request is invalid.');
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
    throw extractionError('malformed-document', 'PPTX extraction request could not be read.', cause);
  }
}

function snapshotDependencies(value: PptxExtractionDependencies): PptxExtractionDependencies {
  try {
    if (!isRecord(value)) throw extractionError('malformed-document', 'PPTX extraction dependencies are invalid.');
    const now = value.now;
    const isCancelled = value.isCancelled;
    const loadZip = value.loadZip;
    if (now !== undefined && typeof now !== 'function') throw new TypeError('Invalid PPTX clock.');
    if (isCancelled !== undefined && typeof isCancelled !== 'function') throw new TypeError('Invalid PPTX cancellation callback.');
    if (loadZip !== undefined && typeof loadZip !== 'function') throw new TypeError('Invalid PPTX ZIP loader.');
    return {
      now: now as PptxExtractionDependencies['now'],
      isCancelled: isCancelled as PptxExtractionDependencies['isCancelled'],
      loadZip: loadZip as PptxExtractionDependencies['loadZip'],
    };
  } catch (cause) {
    if (cause instanceof DocumentExtractorError) throw cause;
    throw extractionError('malformed-document', 'PPTX extraction dependencies could not be read.', cause);
  }
}

function extractionTimestamp(now: () => Date): string {
  try {
    const value = now();
    if (!Number.isFinite(Date.prototype.getTime.call(value))) throw new TypeError('Invalid date.');
    const iso = Date.prototype.toISOString.call(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(iso)) {
      throw new RangeError('Extraction timestamp must use a four-digit UTC year.');
    }
    return iso;
  } catch (cause) {
    throw extractionError('malformed-document', 'PPTX extraction timestamp is invalid.', cause);
  }
}

function cancellationRequested(check: (() => boolean) | undefined): boolean {
  try {
    return check?.() === true;
  } catch (cause) {
    throw extractionError('malformed-document', 'PPTX cancellation check failed.', cause);
  }
}

function preflight(data: Uint8Array): readonly string[] {
  try {
    return preflightZipArchive(data, ZIP_LIMITS).entries.map(({ name }) => name);
  } catch (cause) {
    if (cause instanceof ZipPreflightError) {
      const code = cause.code === 'malformed-zip' ? 'malformed-document' : 'archive-limit';
      throw extractionError(code, 'PPTX ZIP archive failed safety preflight.', cause);
    }
    throw extractionError('malformed-document', 'PPTX ZIP archive could not be inspected.', cause);
  }
}

async function defaultLoadZip(data: Uint8Array): Promise<PptxArchiveAdapter> {
  try {
    return await JSZip.loadAsync(new Uint8Array(data), { checkCRC32: true, createFolders: false }) as PptxArchiveAdapter;
  } catch (cause) {
    throw extractionError('malformed-document', 'PPTX ZIP archive could not be loaded.', cause);
  }
}

function snapshotArchive(
  value: unknown,
  onDestroy: (destroy: (() => Promise<void>) | undefined) => void,
): PptxArchiveAdapter {
  try {
    if (!isRecord(value)) throw new TypeError('Invalid PPTX archive adapter.');
    const destroy = value.destroy;
    if (destroy !== undefined && typeof destroy !== 'function') throw new TypeError('Invalid PPTX archive cleanup callback.');
    let destroyed = false;
    onDestroy(typeof destroy === 'function' ? async () => {
      if (destroyed) return;
      destroyed = true;
      await destroy.call(value);
    } : undefined);
    const files = value.files;
    if (!isRecord(files)) throw new TypeError('Invalid PPTX archive entries.');
    return { files: files as Readonly<Record<string, PptxArchiveEntryAdapter>> };
  } catch (cause) {
    if (cause instanceof DocumentExtractorError) throw cause;
    throw extractionError('malformed-document', 'PPTX archive adapter could not be read.', cause);
  }
}

function archiveReaders(
  archive: PptxArchiveAdapter,
  names: readonly string[],
): ReadonlyMap<string, () => Promise<string>> {
  try {
    const readers = new Map<string, () => Promise<string>>();
    for (const name of names) {
      if (name.endsWith('/')) continue;
      const entry = archive.files[name];
      if (!isRecord(entry)) throw new TypeError(`PPTX archive entry ${name} is missing.`);
      const read = entry.async;
      if (typeof read !== 'function') throw new TypeError(`PPTX archive entry ${name} cannot be read.`);
      readers.set(name, async () => read.call(entry, 'string'));
    }
    return readers;
  } catch (cause) {
    throw extractionError('malformed-document', 'PPTX archive entries could not be indexed.', cause);
  }
}

const XML_OPTIONS = Object.freeze({
  ignoreAttributes: false,
  removeNSPrefix: false,
  parseTagValue: false,
  trimValues: false,
  preserveOrder: true,
  processEntities: true,
});

function nodeQualifiedTag(node: OrderedNode): string | undefined {
  for (const key of Object.keys(node)) {
    if (key !== ':@' && key !== '#text' && key !== '?xml') return key;
  }
  return undefined;
}

function nodeTag(node: OrderedNode): string | undefined {
  const qualifiedTag = nodeQualifiedTag(node);
  if (!qualifiedTag) return undefined;
  const separator = qualifiedTag.lastIndexOf(':');
  return separator < 0 ? qualifiedTag : qualifiedTag.slice(separator + 1);
}

function nodeChildren(node: OrderedNode): readonly unknown[] {
  const tag = nodeQualifiedTag(node);
  if (!tag) return [];
  const value = node[tag];
  return Array.isArray(value) ? value : [];
}

function nodeAttributes(node: OrderedNode): Readonly<Record<string, unknown>> {
  const value = node[':@'];
  return isRecord(value) ? value : {};
}

function attribute(node: OrderedNode, name: string): string | undefined {
  const value = nodeAttributes(node)[`@_${name}`];
  return typeof value === 'string' ? value : undefined;
}

function orderedNodes(root: readonly unknown[], wanted?: ReadonlySet<string>): readonly OrderedNode[] {
  const result: OrderedNode[] = [];
  const stack: Array<{ value: unknown; depth: number }> = [];
  for (let index = root.length - 1; index >= 0; index -= 1) stack.push({ value: root[index], depth: 1 });
  let count = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > MAX_PPTX_XML_DEPTH) throw extractionError('archive-limit', 'PPTX XML nesting is too deep.');
    if (!isRecord(current.value)) continue;
    count += 1;
    if (count > MAX_PPTX_XML_NODES) throw extractionError('archive-limit', 'PPTX XML contains too many nodes.');
    const node = current.value as OrderedNode;
    const tag = nodeTag(node);
    if (tag && (!wanted || wanted.has(tag))) result.push(node);
    const children = nodeChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ value: children[index], depth: current.depth + 1 });
    }
  }
  return result;
}

function parseXml(xml: string, partName: string, expectedRoot: string): readonly unknown[] {
  try {
    if (typeof xml !== 'string' || xml.length === 0) throw new TypeError('XML part is empty.');
    if (xml.length > MAX_PPTX_XML_CHARACTERS) throw extractionError('archive-limit', `PPTX XML part ${partName} is too large.`);
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)) throw new TypeError('DTD and entity declarations are forbidden.');
    const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false });
    if (validation !== true) throw new TypeError(`Invalid XML: ${validation.err.msg}`);
    const parsed = new XMLParser(XML_OPTIONS).parse(decodeNumericCharacterReferences(xml)) as unknown;
    if (!Array.isArray(parsed)) throw new TypeError('XML parser returned an invalid tree.');
    orderedNodes(parsed);
    const roots = parsed.filter(isRecord).filter((node) => nodeTag(node) !== undefined && nodeTag(node) !== '?xml');
    if (roots.length !== 1 || nodeTag(roots[0]!) !== expectedRoot) throw new TypeError(`Expected ${expectedRoot} root element.`);
    return parsed;
  } catch (cause) {
    if (cause instanceof DocumentExtractorError) throw cause;
    throw extractionError('malformed-document', `PPTX XML part ${partName} is malformed.`, cause);
  }
}

async function readXml(
  readers: ReadonlyMap<string, () => Promise<string>>,
  partName: string,
  expectedRoot: string,
): Promise<readonly unknown[]> {
  const read = readers.get(partName);
  if (!read) throw extractionError('malformed-document', `Required PPTX part ${partName} is missing.`);
  try {
    return parseXml(await read(), partName, expectedRoot);
  } catch (cause) {
    if (cause instanceof DocumentExtractorError) throw cause;
    throw extractionError('malformed-document', `PPTX part ${partName} could not be read.`, cause);
  }
}

function parseRelationships(tree: readonly unknown[], partName: string): ReadonlyMap<string, Relationship> {
  const nodes = orderedNodes(tree, new Set(['Relationship']));
  if (nodes.length > MAX_PPTX_RELATIONSHIPS) throw extractionError('archive-limit', `PPTX relationships in ${partName} exceed their limit.`);
  const result = new Map<string, Relationship>();
  for (const node of nodes) {
    const id = attribute(node, 'Id');
    const type = attribute(node, 'Type');
    const target = attribute(node, 'Target');
    const mode = attribute(node, 'TargetMode');
    if (!id || !type || !target || (mode !== undefined && mode !== 'External')) {
      throw extractionError('malformed-document', `PPTX relationship in ${partName} is invalid.`);
    }
    if (result.has(id)) throw extractionError('malformed-document', `PPTX relationship id ${id} is duplicated.`);
    result.set(id, { id, type, target, external: mode === 'External' });
  }
  return result;
}

function resolveRelationshipTarget(ownerPart: string, target: string): string {
  if (
    target.length === 0 || target.includes('\\') || target.startsWith('/') || target.startsWith('//')
    || /^[a-z]:/iu.test(target) || target.includes('?') || target.includes('#')
  ) {
    throw extractionError('malformed-document', 'PPTX relationship target is unsafe.');
  }
  let decoded: string;
  try {
    decoded = decodeURI(target);
  } catch (cause) {
    throw extractionError('malformed-document', 'PPTX relationship target cannot be decoded.', cause);
  }
  const output = ownerPart.split('/').slice(0, -1);
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (output.length === 0) throw extractionError('malformed-document', 'PPTX relationship target escapes the package.');
      output.pop();
    } else {
      output.push(segment);
    }
  }
  const resolved = output.join('/');
  if (resolved !== 'ppt' && !resolved.startsWith('ppt/')) {
    throw extractionError('malformed-document', 'PPTX relationship target escapes ppt/.');
  }
  return resolved;
}

function presentationSlideIds(tree: readonly unknown[]): readonly string[] {
  const listNodes = orderedNodes(tree, new Set(['sldIdLst']));
  if (listNodes.length !== 1) throw extractionError('malformed-document', 'PPTX presentation slide list is missing or duplicated.');
  const slideNodes = nodeChildren(listNodes[0]!).filter(isRecord).filter((node) => nodeTag(node) === 'sldId');
  if (slideNodes.length === 0) throw extractionError('malformed-document', 'PPTX presentation contains no slides.');
  if (slideNodes.length > MAX_PPTX_SLIDES) throw extractionError('slide-limit', 'PPTX cannot contain more than 500 slides.');
  const result: string[] = [];
  const seen = new Set<string>();
  for (const node of slideNodes) {
    const id = attribute(node, 'r:id');
    if (!id || seen.has(id)) throw extractionError('malformed-document', 'PPTX slide relationship ids are missing or duplicated.');
    seen.add(id);
    result.push(id);
  }
  return result;
}
function decodeNumericCharacterReferences(value: string): string {
  return value.replace(/&#(?:x([0-9a-f]+)|([0-9]+));/giu, (_reference, hexadecimal: string | undefined, decimal: string | undefined) => {
    const codePoint = Number.parseInt(hexadecimal ?? decimal ?? '', hexadecimal === undefined ? 10 : 16);
    const isXmlCharacter = codePoint === 0x09
      || codePoint === 0x0a
      || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (!isXmlCharacter) {
      throw extractionError('malformed-document', 'PPTX XML contains an invalid numeric character reference.');
    }
    if (codePoint === 0x26) return '&amp;';
    if (codePoint === 0x3c) return '&lt;';
    if (codePoint === 0x3e) return '&gt;';
    if (codePoint === 0x22) return '&quot;';
    if (codePoint === 0x27) return '&apos;';
    return String.fromCodePoint(codePoint);
  });
}


function rawAndNormalized(paragraphs: readonly OrderedNode[]): { rawText: string; normalizedText: string } | undefined {
  const paragraphTexts: string[] = [];
  let runs = 0;
  for (const paragraph of paragraphs) {
    const textNodes = orderedNodes(nodeChildren(paragraph), new Set(['t']));
    runs += textNodes.length;
    if (runs > MAX_PPTX_TEXT_RUNS_PER_FRAGMENT) throw extractionError('text-limit', 'PPTX text contains too many runs.');
    let value = '';
    for (const textNode of textNodes) {
      for (const child of nodeChildren(textNode)) {
        if (isRecord(child) && typeof child['#text'] === 'string') value += child['#text'];
      }
    }
    paragraphTexts.push(value);
  }
  const rawText = paragraphTexts.join('\n').trim().normalize('NFC');
  const normalizedText = rawText.replace(/[\s\u0085\p{Z}]+/gu, ' ').trim().normalize('NFC');
  if (!normalizedText) return undefined;
  if (rawText.length > MAX_FRAGMENT_TEXT_LENGTH || normalizedText.length > MAX_FRAGMENT_TEXT_LENGTH) {
    throw extractionError('text-limit', 'A PPTX text fragment exceeds its limit.');
  }
  return { rawText, normalizedText };
}

function textFromBody(body: OrderedNode): { rawText: string; normalizedText: string } | undefined {
  const paragraphs = nodeChildren(body).filter(isRecord).filter((node) => nodeTag(node) === 'p');
  return rawAndNormalized(paragraphs);
}

function descendant(node: OrderedNode, tag: string): OrderedNode | undefined {
  return orderedNodes(nodeChildren(node), new Set([tag]))[0];
}

function objectIdentity(node: OrderedNode, fallbackId: string, fallbackName: string): { id: string; name: string } {
  const properties = descendant(node, 'cNvPr');
  const id = properties ? attribute(properties, 'id')?.trim() : undefined;
  const name = properties ? attribute(properties, 'name')?.trim() : undefined;
  return {
    id: id && id.length <= 256 ? id : fallbackId,
    name: name && name.length <= 1_024 ? name : fallbackName,
  };
}

function slideObjects(tree: readonly unknown[]): readonly OrderedNode[] {
  const spTrees = orderedNodes(tree, new Set(['spTree']));
  if (spTrees.length !== 1) throw extractionError('malformed-document', 'PPTX slide shape tree is missing or duplicated.');
  const result = orderedNodes(nodeChildren(spTrees[0]!), new Set(['sp', 'graphicFrame']));
  if (result.length > MAX_PPTX_OBJECTS_PER_SLIDE) throw extractionError('archive-limit', 'PPTX slide contains too many objects.');
  return result;
}

function excludedNotesPlaceholder(shapeNode: OrderedNode): boolean {
  const placeholder = descendant(shapeNode, 'ph');
  const type = placeholder ? attribute(placeholder, 'type') : undefined;
  return type !== undefined && new Set(['hdr', 'ftr', 'dt', 'sldNum', 'sldImg']).has(type);
}

function appendBoundedDraft(
  drafts: FragmentDraft[],
  draft: FragmentDraft,
  state: { textLength: number },
): void {
  if (drafts.length >= MAX_PPTX_FRAGMENTS) throw extractionError('text-limit', 'PPTX contains too many text fragments.');
  if (draft.rawText.length > MAX_EXTRACTED_TEXT_LENGTH - state.textLength) {
    throw extractionError('text-limit', 'Extracted PPTX text exceeds its aggregate limit.');
  }
  state.textLength += draft.rawText.length;
  drafts.push(draft);
}

function extractSlideDrafts(tree: readonly unknown[], slideNumber: number): readonly FragmentDraft[] {
  const drafts: FragmentDraft[] = [];
  let textIndex = 0;
  const state = { textLength: 0 };
  let tableIndex = 0;
  const objects = slideObjects(tree);
  for (let objectOrder = 0; objectOrder < objects.length; objectOrder += 1) {
    const object = objects[objectOrder]!;
    if (nodeTag(object) === 'sp') {
      textIndex += 1;
      const body = descendant(object, 'txBody');
      const text = body ? textFromBody(body) : undefined;
      if (!text) continue;
      const identity = objectIdentity(object, `text:${textIndex}`, `\u6587\u672c\u6846 ${textIndex}`);
      appendBoundedDraft(drafts, {
        sourceKind: 'ppt_text',
        locator: { slideNumber, objectId: identity.id, objectName: identity.name },
        ...text,
        objectOrder,
      }, state);
      continue;
    }
    const tableNode = descendant(object, 'tbl');
    if (!tableNode) continue;
    tableIndex += 1;
    if (tableIndex > MAX_PPTX_TABLES_PER_SLIDE) throw extractionError('archive-limit', 'PPTX slide contains too many tables.');
    const identity = objectIdentity(object, `table:${tableIndex}`, `\u8868\u683c ${tableIndex}`);
    const rows = nodeChildren(tableNode).filter(isRecord).filter((node) => nodeTag(node) === 'tr');
    if (rows.length > MAX_PPTX_ROWS_PER_TABLE) throw extractionError('archive-limit', 'PPTX table contains too many rows.');
    let cellCount = 0;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const cells = nodeChildren(rows[rowIndex]!).filter(isRecord).filter((node) => nodeTag(node) === 'tc');
      if (cells.length > MAX_PPTX_CELLS_PER_ROW) throw extractionError('archive-limit', 'PPTX table row contains too many cells.');
      cellCount += cells.length;
      if (cellCount > MAX_PPTX_CELLS_PER_TABLE) throw extractionError('archive-limit', 'PPTX table contains too many cells.');
      for (let columnIndex = 0; columnIndex < cells.length; columnIndex += 1) {
        const body = descendant(cells[columnIndex]!, 'txBody');
        const text = body ? textFromBody(body) : undefined;
        if (!text) continue;
        appendBoundedDraft(drafts, {
          sourceKind: 'ppt_table',
          locator: {
            slideNumber,
            objectId: identity.id,
            objectName: identity.name,
            tableIndex,
            tableRow: rowIndex + 1,
            tableColumn: columnIndex + 1,
          },
          ...text,
          objectOrder,
        }, state);
      }
    }
  }
  return drafts;
}

function extractNotesDrafts(tree: readonly unknown[], slideNumber: number): readonly FragmentDraft[] {
  const drafts: FragmentDraft[] = [];
  const objects = slideObjects(tree);
  let notesIndex = 0;
  const state = { textLength: 0 };
  for (let objectOrder = 0; objectOrder < objects.length; objectOrder += 1) {
    const object = objects[objectOrder]!;
    if (nodeTag(object) !== 'sp' || excludedNotesPlaceholder(object)) continue;
    const body = descendant(object, 'txBody');
    const text = body ? textFromBody(body) : undefined;
    if (!text) continue;
    notesIndex += 1;
    const identity = objectIdentity(object, `notes:${notesIndex}`, 'Speaker notes');
    appendBoundedDraft(drafts, {
      sourceKind: 'ppt_notes',
      locator: { slideNumber, objectId: identity.id, objectName: 'Speaker notes' },
      ...text,
      objectOrder: MAX_PPTX_OBJECTS_PER_SLIDE + objectOrder,
    }, state);
  }
  return drafts;
}

function makeFragment(
  request: DocumentExtractionRequest,
  draft: FragmentDraft,
  createdAt: string,
): SourceFragment {
  const locator = draft.locator;
  const digest = sha256Hex(JSON.stringify([
    request.projectId,
    request.documentId,
    request.documentVersionId,
    locator.slideNumber,
    draft.sourceKind,
    draft.objectOrder,
    locator.objectId,
    locator.tableIndex,
    locator.tableRow,
    locator.tableColumn,
    draft.rawText,
    locator,
  ]));
  return parseSourceFragment({
    id: `pptx:${digest}`,
    projectId: request.projectId,
    documentId: request.documentId,
    documentVersionId: request.documentVersionId,
    sourceKind: draft.sourceKind,
    locator,
    rawText: draft.rawText,
    normalizedText: draft.normalizedText,
    extractionMethod: 'pptx_ooxml',
    extractionVersion: PPTX_EXTRACTION_VERSION,
    contentHash: `sha256:${sha256Hex(draft.rawText)}`,
    createdAt,
  });
}

async function notesForSlide(
  readers: ReadonlyMap<string, () => Promise<string>>,
  slidePart: string,
  slideNumber: number,
): Promise<readonly FragmentDraft[]> {
  const slash = slidePart.lastIndexOf('/');
  const relsPart = `${slidePart.slice(0, slash)}/_rels/${slidePart.slice(slash + 1)}.rels`;
  if (!readers.has(relsPart)) return [];
  const rels = parseRelationships(await readXml(readers, relsPart, 'Relationships'), relsPart);
  const notes = [...rels.values()].filter(({ type }) => type.endsWith('/notesSlide'));
  if (notes.length > 1) throw extractionError('malformed-document', `PPTX slide ${slideNumber} has multiple notes relationships.`);
  if (notes.length === 0) return [];
  const relationship = notes[0]!;
  if (relationship.external) throw extractionError('malformed-document', `PPTX slide ${slideNumber} notes relationship is external.`);
  const notesPart = resolveRelationshipTarget(slidePart, relationship.target);
  return extractNotesDrafts(await readXml(readers, notesPart, 'notes'), slideNumber);
}

export async function extractPptxFragments(
  input: DocumentExtractionRequest,
  dependencies: PptxExtractionDependencies = {},
): Promise<DocumentExtractionResult> {
  let cleanup: (() => Promise<void>) | undefined;
  let result: DocumentExtractionResult | undefined;
  let primaryError: DocumentExtractorError | undefined;
  try {
    const request = snapshotRequest(input);
    const dependencySnapshot = snapshotDependencies(dependencies);
    if (request.kind !== 'pptx') throw extractionError('unsupported-format', 'PPTX extraction requires kind "pptx".');
    if (cancellationRequested(dependencySnapshot.isCancelled)) throw extractionError('cancelled', 'PPTX extraction was cancelled.');
    const createdAt = extractionTimestamp(dependencySnapshot.now ?? (() => new Date()));
    const copiedBytes = new Uint8Array(request.data);
    const names = preflight(copiedBytes);
    if (cancellationRequested(dependencySnapshot.isCancelled)) {
      throw extractionError('cancelled', 'PPTX extraction was cancelled.');
    }
    let loaded: unknown;
    try {
      loaded = await (dependencySnapshot.loadZip ?? defaultLoadZip)(copiedBytes);
    } catch (cause) {
      if (cause instanceof DocumentExtractorError) throw cause;
      throw extractionError('malformed-document', 'PPTX ZIP archive could not be loaded.', cause);
    }
    const archive = snapshotArchive(loaded, (destroy) => { cleanup = destroy; });
    const readers = archiveReaders(archive, names);
    parseXml(await (readers.get('[Content_Types].xml')?.() ?? Promise.reject(new Error('missing'))), '[Content_Types].xml', 'Types');
    const presentation = await readXml(readers, 'ppt/presentation.xml', 'presentation');
    const presentationRelationships = parseRelationships(
      await readXml(readers, 'ppt/_rels/presentation.xml.rels', 'Relationships'),
      'ppt/_rels/presentation.xml.rels',
    );
    const slideIds = presentationSlideIds(presentation);
    const slideParts: string[] = [];
    const seenParts = new Set<string>();
    for (const relationshipId of slideIds) {
      const relationship = presentationRelationships.get(relationshipId);
      if (!relationship || !relationship.type.endsWith('/slide') || relationship.external) {
        throw extractionError('malformed-document', `PPTX slide relationship ${relationshipId} is invalid.`);
      }
      const part = resolveRelationshipTarget('ppt/presentation.xml', relationship.target);
      if (seenParts.has(part)) throw extractionError('malformed-document', 'PPTX presentation resolves multiple slides to the same part.');
      if (!readers.has(part)) throw extractionError('malformed-document', `PPTX slide part ${part} is missing.`);
      seenParts.add(part);
      slideParts.push(part);
    }

    const fragments: SourceFragment[] = [];
    const needsOcrPageNumbers: number[] = [];
    let totalText = 0;
    for (let index = 0; index < slideParts.length; index += 1) {
      const slideNumber = index + 1;
      if (cancellationRequested(dependencySnapshot.isCancelled)) throw extractionError('cancelled', 'PPTX extraction was cancelled.');
      const slideDrafts = extractSlideDrafts(await readXml(readers, slideParts[index]!, 'sld'), slideNumber);
      if (cancellationRequested(dependencySnapshot.isCancelled)) throw extractionError('cancelled', 'PPTX extraction was cancelled.');
      const notesDrafts = await notesForSlide(readers, slideParts[index]!, slideNumber);
      if (cancellationRequested(dependencySnapshot.isCancelled)) throw extractionError('cancelled', 'PPTX extraction was cancelled.');
      if (slideDrafts.length === 0) needsOcrPageNumbers.push(slideNumber);
      for (const draft of [...slideDrafts, ...notesDrafts]) {
        if (fragments.length >= MAX_PPTX_FRAGMENTS) throw extractionError('text-limit', 'PPTX contains too many text fragments.');
        if (draft.rawText.length > MAX_EXTRACTED_TEXT_LENGTH - totalText) {
          throw extractionError('text-limit', 'Extracted PPTX text exceeds its aggregate limit.');
        }
        totalText += draft.rawText.length;
        fragments.push(makeFragment(request, draft, createdAt));
      }
    }
    if (cancellationRequested(dependencySnapshot.isCancelled)) throw extractionError('cancelled', 'PPTX extraction was cancelled.');
    result = freezeDocumentExtractionResult({ fragments, needsOcrPageNumbers, warnings: [] });
  } catch (cause) {
    primaryError = cause instanceof DocumentExtractorError
      ? cause
      : extractionError('malformed-document', 'PPTX extraction failed.', cause);
  }

  let cleanupError: unknown;
  try {
    await cleanup?.();
  } catch (cause) {
    cleanupError = cause;
  }
  if (primaryError) throw primaryError;
  if (cleanupError !== undefined) throw extractionError('malformed-document', 'PPTX cleanup failed.', cleanupError);
  if (!result) throw extractionError('worker-failed', 'PPTX extraction did not produce a result.');
  return result;
}
