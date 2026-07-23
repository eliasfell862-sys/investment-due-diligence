import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import {
  DocumentExtractorError,
  type DocumentExtractionRequest,
} from './document-extractor';
import {
  extractPptxFragments,
  type PptxArchiveAdapter,
} from './pptx-extractor';

const NOW = '2026-07-23T00:00:00.000Z';

function request(data: Uint8Array): DocumentExtractionRequest {
  return {
    projectId: 'project-1',
    documentId: 'document-1',
    documentVersionId: 'version-1',
    fileName: 'sample.pptx',
    kind: 'pptx',
    data,
  };
}

function relationships(items: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${items.join('\n')}
    </Relationships>`;
}

function shape(id: string, name: string, paragraphs: readonly (readonly string[])[]): string {
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr/>
    <p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.map((runs) =>
      `<a:p>${runs.map((run) => `<a:r><a:t>${run}</a:t></a:r>`).join('')}</a:p>`
    ).join('')}</p:txBody>
  </p:sp>`;
}

function table(id: string, name: string, cells: readonly (readonly string[])[]): string {
  return `<p:graphicFrame>
    <p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
      <a:tbl><a:tblPr/><a:tblGrid/>${cells.map((row) => `<a:tr h="1">${row.map((cell) =>
        `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${cell}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`
      ).join('')}</a:tr>`).join('')}</a:tbl>
    </a:graphicData></a:graphic>
  </p:graphicFrame>`;
}

function slideXml(objects: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${objects.join('')}</p:spTree></p:cSld>
    </p:sld>`;
}

function notesXml(objects: readonly string[]): string {
  return slideXml(objects).replace('<p:sld ', '<p:notes ').replace('</p:sld>', '</p:notes>');
}

async function pptx(
  entries: Readonly<Record<string, string>>,
  slideIds = ['rId1', 'rId2'],
  targets: readonly string[] = slideIds.map((_id, index) => `slides/slide${index + 1}.xml`),
  relationshipItems?: readonly string[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  zip.file('ppt/presentation.xml', `<?xml version="1.0"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst>${slideIds.map((id, index) => `<p:sldId id="${256 + index}" r:id="${id}"/>`).join('')}</p:sldIdLst>
    </p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', relationships(relationshipItems ?? slideIds.map((id, index) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${targets[index]}"/>`
  )));
  for (const [name, value] of Object.entries(entries)) zip.file(name, value);
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}

async function extractionError(action: () => Promise<unknown>): Promise<DocumentExtractorError> {
  try {
    await action();
  } catch (caught) {
    expect(caught).toBeInstanceOf(DocumentExtractorError);
    return caught as DocumentExtractorError;
  }
  throw new Error('Expected PPTX extraction to fail.');
}

describe('extractPptxFragments', () => {
  it('extracts slide text, tables, and speaker notes in presentation order', async () => {
    const data = await pptx({
      'ppt/slides/slide1.xml': slideXml([
        shape('2', 'Company', [['\u516c\u53f8\u540d\u79f0\uff1a', '\u661f\u4e91\u79d1\u6280']]),
        table('3', 'Revenue table', [['2025 \u5e74\u8425\u4e1a\u6536\u5165\uff1a1.2 \u4ebf\u5143']]),
      ]),
      'ppt/slides/slide2.xml': slideXml([shape('7', 'Team', [['\u6838\u5fc3\u56e2\u961f\uff1a...', '']])]),
      'ppt/slides/_rels/slide2.xml.rels': relationships([
        '<Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide2.xml"/>',
      ]),
      'ppt/notesSlides/notesSlide2.xml': notesXml([
        shape('9', 'Notes Placeholder', [['\u7ba1\u7406\u5c42\u9884\u6d4b\uff1a2026 \u5e74 ARR\uff1a2 \u4ebf\u5143']]),
      ]),
    });

    const first = await extractPptxFragments(request(data), { now: () => new Date(NOW) });
    const second = await extractPptxFragments(request(data), { now: () => new Date('2026-07-24T00:00:00.000Z') });

    expect(first.fragments.map(({ sourceKind, rawText }) => [sourceKind, rawText])).toEqual([
      ['ppt_text', '\u516c\u53f8\u540d\u79f0\uff1a\u661f\u4e91\u79d1\u6280'],
      ['ppt_table', '2025 \u5e74\u8425\u4e1a\u6536\u5165\uff1a1.2 \u4ebf\u5143'],
      ['ppt_text', '\u6838\u5fc3\u56e2\u961f\uff1a...'],
      ['ppt_notes', '\u7ba1\u7406\u5c42\u9884\u6d4b\uff1a2026 \u5e74 ARR\uff1a2 \u4ebf\u5143'],
    ]);
    expect(first.fragments.map(({ locator }) => locator)).toEqual([
      { slideNumber: 1, objectId: '2', objectName: 'Company' },
      { slideNumber: 1, objectId: '3', objectName: 'Revenue table', tableIndex: 1, tableRow: 1, tableColumn: 1 },
      { slideNumber: 2, objectId: '7', objectName: 'Team' },
      { slideNumber: 2, objectId: '9', objectName: 'Speaker notes' },
    ]);
    expect(first.needsOcrPageNumbers).toEqual([]);
    expect(first.fragments.map(({ id }) => id)).toEqual(second.fragments.map(({ id }) => id));
    expect(first.fragments[0]?.createdAt).toBe(NOW);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.fragments)).toBe(true);
    expect(Object.isFrozen(first.fragments[0]?.locator)).toBe(true);
  });

  it('uses relationship order rather than slide filename order', async () => {
    const data = await pptx({
      'ppt/slides/slide1.xml': slideXml([shape('1', 'Filename one', [['filename one']])]),
      'ppt/slides/slide2.xml': slideXml([shape('2', 'Filename two', [['filename two']])]),
    }, ['rId1', 'rId2'], ['slides/slide2.xml', 'slides/slide1.xml']);

    const result = await extractPptxFragments(request(data), { now: () => new Date(NOW) });

    expect(result.fragments.map(({ rawText, locator }) => [rawText, locator.slideNumber])).toEqual([
      ['filename two', 1],
      ['filename one', 2],
    ]);
  });

  it('marks image-only and notes-only slides for OCR but not visible text slides', async () => {
    const data = await pptx({
      'ppt/slides/slide1.xml': slideXml(['<p:pic><p:nvPicPr/><p:blipFill/></p:pic>']),
      'ppt/slides/slide2.xml': slideXml([]),
      'ppt/slides/_rels/slide2.xml.rels': relationships([
        '<Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide2.xml"/>',
      ]),
      'ppt/notesSlides/notesSlide2.xml': notesXml([shape('2', 'Body', [['notes only']])]),
      'ppt/slides/slide3.xml': slideXml([shape('3', 'Text', [['visible']])]),
    }, ['rId1', 'rId2', 'rId3']);

    const result = await extractPptxFragments(request(data), { now: () => new Date(NOW) });

    expect(result.needsOcrPageNumbers).toEqual([1, 2]);
    expect(result.fragments.map(({ sourceKind, rawText }) => [sourceKind, rawText])).toEqual([
      ['ppt_notes', 'notes only'],
      ['ppt_text', 'visible'],
    ]);
  });

  it('excludes header/footer/date/slide-number/slide-image note placeholders', async () => {
    const excluded = ['hdr', 'ftr', 'dt', 'sldNum', 'sldImg'].map((type, index) =>
      shape(String(index + 1), type, [[type]]).replace('<p:nvPr/>', `<p:nvPr><p:ph type="${type}"/></p:nvPr>`)
    );
    const data = await pptx({
      'ppt/slides/slide1.xml': slideXml([]),
      'ppt/slides/_rels/slide1.xml.rels': relationships([
        '<Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>',
      ]),
      'ppt/notesSlides/notesSlide1.xml': notesXml([
        ...excluded,
        shape('9', 'Body', [['kept note']]).replace('<p:nvPr/>', '<p:nvPr><p:ph type="body"/></p:nvPr>'),
      ]),
    }, ['rId1']);

    const result = await extractPptxFragments(request(data), { now: () => new Date(NOW) });
    expect(result.fragments.map(({ rawText }) => rawText)).toEqual(['kept note']);
    expect(result.needsOcrPageNumbers).toEqual([1]);
  });

  it.each([
    ['multiple', relationships([
      '<Relationship Id="n1" Type="x/notesSlide" Target="../notesSlides/notesSlide1.xml"/>',
      '<Relationship Id="n2" Type="x/notesSlide" Target="../notesSlides/notesSlide1.xml"/>',
    ]), true],
    ['external', relationships([
      '<Relationship Id="n1" Type="x/notesSlide" Target="https://example.com/notes.xml" TargetMode="External"/>',
    ]), false],
    ['missing', relationships([
      '<Relationship Id="n1" Type="x/notesSlide" Target="../notesSlides/missing.xml"/>',
    ]), false],
  ] as const)('rejects %s notes relationships', async (_label, rels, includeNotes) => {
    const data = await pptx({
      'ppt/slides/slide1.xml': slideXml([]),
      'ppt/slides/_rels/slide1.xml.rels': rels,
      ...(includeNotes ? { 'ppt/notesSlides/notesSlide1.xml': notesXml([]) } : {}),
    }, ['rId1']);
    expect((await extractionError(() => extractPptxFragments(request(data)))).code)
      .toBe('malformed-document');
  });

  it('accepts 500 slides and rejects 501 before reading slide parts', async () => {
    const allowedIds = Array.from({ length: 500 }, (_, index) => `rId${index + 1}`);
    const entries = Object.fromEntries(allowedIds.map((_id, index) => [
      `ppt/slides/slide${index + 1}.xml`,
      slideXml([]),
    ]));
    const allowed = await extractPptxFragments(request(await pptx(entries, allowedIds)), {
      now: () => new Date(NOW),
    });
    expect(allowed.needsOcrPageNumbers).toHaveLength(500);

    const rejectedIds = Array.from({ length: 501 }, (_, index) => `rId${index + 1}`);
    const rejected = await pptx({}, rejectedIds);
    expect((await extractionError(() => extractPptxFragments(request(rejected)))).code)
      .toBe('slide-limit');
  }, 30_000);

  it.each([
    ['traversal', ['../../evil.xml', 'slides/slide2.xml']],
    ['absolute', ['/ppt/slides/slide1.xml', 'slides/slide2.xml']],
    ['duplicate target', ['slides/slide1.xml', 'slides/slide1.xml']],
    ['missing part', ['slides/missing.xml', 'slides/slide2.xml']],
  ] as const)('rejects %s slide relationship targets', async (_label, targets) => {
    const data = await pptx({
      'ppt/slides/slide1.xml': slideXml([]),
      'ppt/slides/slide2.xml': slideXml([]),
    }, ['rId1', 'rId2'], targets);
    expect((await extractionError(() => extractPptxFragments(request(data)))).code)
      .toBe('malformed-document');
  });

  it('rejects duplicate relationship ids and external required slides', async () => {
    const duplicate = await pptx({ 'ppt/slides/slide1.xml': slideXml([]) }, ['rId1'], undefined, [
      '<Relationship Id="rId1" Type="x/slide" Target="slides/slide1.xml"/>',
      '<Relationship Id="rId1" Type="x/slide" Target="slides/slide1.xml"/>',
    ]);
    expect((await extractionError(() => extractPptxFragments(request(duplicate)))).code)
      .toBe('malformed-document');

    const external = await pptx({}, ['rId1'], undefined, [
      '<Relationship Id="rId1" Type="x/slide" Target="https://example.com/slide.xml" TargetMode="External"/>',
    ]);
    expect((await extractionError(() => extractPptxFragments(request(external)))).code)
      .toBe('malformed-document');
  });

  it.each([
    ['DOCTYPE', slideXml([]).replace('<p:sld ', '<!DOCTYPE p:sld><p:sld ')],
    ['ENTITY', slideXml([]).replace('<p:sld ', '<!DOCTYPE p:sld [<!ENTITY x "boom">]><p:sld ')],
    ['malformed XML', slideXml([]).replace('</p:sld>', '')],
    ['deep XML', slideXml([`${'<deep>'.repeat(130)}x${'</deep>'.repeat(130)}`])],
    ['too many objects', slideXml(Array.from({ length: 5_001 }, () => '<p:sp/>'))],
    ['too-long text', slideXml([shape('1', 'Long', [['x'.repeat(65_537)]])])],
  ] as const)('rejects %s safely', async (_label, xml) => {
    const data = await pptx({ 'ppt/slides/slide1.xml': xml }, ['rId1']);
    expect(['malformed-document', 'archive-limit', 'text-limit'])
      .toContain((await extractionError(() => extractPptxFragments(request(data)))).code);
  }, 20_000);

  it('enforces table row and cell caps', async () => {
    const tableWith = (rows: string) => slideXml([
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="1" name="T"/></p:nvGraphicFramePr>
       <a:graphic><a:graphicData><a:tbl>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
    ]);
    const tooManyRows = await pptx({
      'ppt/slides/slide1.xml': tableWith('<a:tr/>'.repeat(2_001)),
    }, ['rId1']);
    expect((await extractionError(() => extractPptxFragments(request(tooManyRows)))).code)
      .toBe('archive-limit');

    const tooManyCells = await pptx({
      'ppt/slides/slide1.xml': tableWith(`<a:tr>${'<a:tc/>'.repeat(2_001)}</a:tr>`),
    }, ['rId1']);
    expect((await extractionError(() => extractPptxFragments(request(tooManyCells)))).code)
      .toBe('archive-limit');
  });

  it('rejects malformed, unsafe-path, compression-bomb, and ZIP64 archives before loading', async () => {
    const assertBeforeLoad = async (data: Uint8Array, code: string) => {
      const loadZip = vi.fn((_data: Uint8Array): Promise<PptxArchiveAdapter> =>
        Promise.reject(new Error('loadZip must not be called'))
      );
      expect((await extractionError(() => extractPptxFragments(request(data), { loadZip }))).code)
        .toBe(code);
      expect(loadZip).not.toHaveBeenCalled();
    };
    await assertBeforeLoad(new Uint8Array([1, 2, 3]), 'malformed-document');

    const unsafeZip = new JSZip();
    unsafeZip.file('abcde', 'x');
    const unsafe = await unsafeZip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    const originalName = new TextEncoder().encode('abcde');
    const unsafeName = new TextEncoder().encode('../x.');
    for (let offset = 0; offset <= unsafe.length - originalName.length; offset += 1) {
      if (originalName.every((byte, index) => unsafe[offset + index] === byte)) unsafe.set(unsafeName, offset);
    }
    await assertBeforeLoad(unsafe, 'malformed-document');

    const bombZip = new JSZip();
    bombZip.file('a', 'x');
    const bomb = await bombZip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    const bombView = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
    for (let offset = 0; offset <= bomb.length - 4; offset += 1) {
      const signature = bombView.getUint32(offset, true);
      if (signature === 0x04034b50) bombView.setUint32(offset + 22, 1_000, true);
      if (signature === 0x02014b50) bombView.setUint32(offset + 24, 1_000, true);
    }
    await assertBeforeLoad(bomb, 'archive-limit');

    const zip64 = await pptx({ 'ppt/slides/slide1.xml': slideXml([]) }, ['rId1']);
    const zip64View = new DataView(zip64.buffer, zip64.byteOffset, zip64.byteLength);
    for (let offset = zip64.length - 22; offset >= 0; offset -= 1) {
      if (zip64View.getUint32(offset, true) === 0x06054b50) {
        zip64View.setUint16(offset + 8, 0xffff, true);
        zip64View.setUint16(offset + 10, 0xffff, true);
        break;
      }
    }
    await assertBeforeLoad(zip64, 'malformed-document');
  });

  it('supports cancellation, copied sliced input, no network, and exactly-once cleanup', async () => {
    const data = await pptx({
      'ppt/slides/slide1.xml': slideXml([shape('1', 'Text', [['visible']])]),
      'ppt/slides/_rels/slide1.xml.rels': relationships([
        '<Relationship Id="notes" Type="x/notesSlide" Target="../notesSlides/notesSlide1.xml"/>',
      ]),
      'ppt/notesSlides/notesSlide1.xml': notesXml([shape('2', 'Notes', [['secret notes']])]),
    }, ['rId1']);
    const padded = new Uint8Array(data.length + 10);
    padded.set(data, 5);
    let checks = 0;
    expect((await extractionError(() => extractPptxFragments(request(padded.subarray(5, 5 + data.length)), {
      isCancelled: () => { checks += 1; return checks === 3; },
    }))).code).toBe('cancelled');

    let destroyed = 0;
    let received: Uint8Array | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const loadZip = async (bytes: Uint8Array): Promise<PptxArchiveAdapter> => {
      received = bytes;
      const archive = await JSZip.loadAsync(bytes);
      return {
        files: archive.files as unknown as PptxArchiveAdapter['files'],
        destroy: async () => { destroyed += 1; },
      };
    };
    const result = await extractPptxFragments(request(padded.subarray(5, 5 + data.length)), {
      loadZip,
      now: () => new Date(NOW),
    });
    expect(result.fragments).toHaveLength(2);
    expect(received?.byteOffset).toBe(0);
    expect(received?.buffer.byteLength).toBe(data.length);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(destroyed).toBe(1);
    fetchSpy.mockRestore();
  });

  it('preserves primary errors over cleanup errors and reports cleanup-only errors', async () => {
    const valid = await pptx({ 'ppt/slides/slide1.xml': slideXml([]) }, ['rId1']);
    const adapter = async (data: Uint8Array, corrupt: boolean): Promise<PptxArchiveAdapter> => {
      const archive = await JSZip.loadAsync(data);
      if (corrupt) archive.file('ppt/slides/slide1.xml', '<broken>');
      return {
        files: archive.files as unknown as PptxArchiveAdapter['files'],
        destroy: async () => { throw new Error('cleanup failed'); },
      };
    };
    const primary = await extractionError(() => extractPptxFragments(request(valid), {
      loadZip: async (data) => adapter(data, true),
    }));
    expect(primary.message).toContain('slide1.xml');

    const cleanup = await extractionError(() => extractPptxFragments(request(valid), {
      loadZip: async (data) => adapter(data, false),
    }));
    expect(cleanup.message).toContain('cleanup');
  });

  it('maps throwing request, dependency, and archive getters to typed errors', async () => {
    const data = await pptx({ 'ppt/slides/slide1.xml': slideXml([]) }, ['rId1']);
    const throwingRequest = new Proxy(request(data), {
      get(target, property, receiver) {
        if (property === 'data') throw new Error('request getter');
        return Reflect.get(target, property, receiver);
      },
    });
    expect((await extractionError(() => extractPptxFragments(throwingRequest))).code)
      .toBe('malformed-document');

    const throwingDependencies = Object.defineProperty({}, 'now', {
      get: () => { throw new Error('dependency getter'); },
    }) as PptxArchiveAdapter;
    expect((await extractionError(() => extractPptxFragments(
      request(data),
      throwingDependencies as unknown as Parameters<typeof extractPptxFragments>[1],
    ))).code).toBe('malformed-document');

    let destroyed = 0;
    const archive = Object.defineProperties({}, {
      destroy: { value: async () => { destroyed += 1; } },
      files: { get: () => { throw new Error('files getter'); } },
    }) as PptxArchiveAdapter;
    expect((await extractionError(() => extractPptxFragments(request(data), {
      loadZip: async () => archive,
    }))).code).toBe('malformed-document');
    expect(destroyed).toBe(1);
  });

  it('checks cancellation again after preflight and before ZIP loading', async () => {
    const data = await pptx({ 'ppt/slides/slide1.xml': slideXml([]) }, ['rId1']);
    let checks = 0;
    const loadZip = vi.fn(async (bytes: Uint8Array) => {
      const archive = await JSZip.loadAsync(bytes);
      return archive as unknown as PptxArchiveAdapter;
    });
    const caught = await extractionError(() => extractPptxFragments(request(data), {
      isCancelled: () => { checks += 1; return checks === 2; },
      loadZip,
    }));
    expect(caught.code).toBe('cancelled');
    expect(loadZip).not.toHaveBeenCalled();
  });

  it('enforces aggregate text, fragment count, and XML-entry character caps', async () => {
    const aggregateXml = slideXml(Array.from({ length: 65 }, (_, index) =>
      shape(String(index + 1), `S${index + 1}`, [['x'.repeat(index === 64 ? 1 : 65_536)]])
    ));
    const aggregate = await pptx({ 'ppt/slides/slide1.xml': aggregateXml }, ['rId1']);
    expect((await extractionError(() => extractPptxFragments(request(aggregate)))).code)
      .toBe('text-limit');

    const cell = '<a:tc><a:txBody><a:p><a:r><a:t>x</a:t></a:r></a:p></a:txBody></a:tc>';
    const rows = Array.from({ length: 6 }, (_unused, row) =>
      `<a:tr>${cell.repeat(row === 5 ? 1 : 2_000)}</a:tr>`
    ).join('');
    const fragmentOverflow = await pptx({
      'ppt/slides/slide1.xml': slideXml([
        `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="1" name="T"/></p:nvGraphicFramePr>
         <a:graphic><a:graphicData><a:tbl>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
      ]),
    }, ['rId1']);
    expect((await extractionError(() => extractPptxFragments(request(fragmentOverflow)))).code)
      .toBe('text-limit');

    const oversizedXml = `${slideXml([])}${' '.repeat(8 * 1024 * 1024 + 1)}`;
    const xmlOverflow = await pptx({ 'ppt/slides/slide1.xml': oversizedXml }, ['rId1']);
    expect((await extractionError(() => extractPptxFragments(request(xmlOverflow)))).code)
      .toBe('archive-limit');
  }, 30_000);

  it.each([
    ['invalid content types', '[Content_Types].xml', '<Wrong/>'],
    ['invalid presentation root', 'ppt/presentation.xml', '<Wrong/>'],
    ['invalid relationships root', 'ppt/_rels/presentation.xml.rels', '<Wrong/>'],
  ] as const)('rejects %s structure', async (_label, part, replacement) => {
    const base = await pptx({ 'ppt/slides/slide1.xml': slideXml([]) }, ['rId1']);
    const archive = await JSZip.loadAsync(base);
    archive.file(part, replacement);
    const data = await archive.generateAsync({ type: 'uint8array', compression: 'STORE' });
    expect((await extractionError(() => extractPptxFragments(request(data)))).code)
      .toBe('malformed-document');
  });

  it('rejects empty presentations and malformed relationship fields', async () => {
    const base = await pptx({ 'ppt/slides/slide1.xml': slideXml([]) }, ['rId1']);
    const emptyArchive = await JSZip.loadAsync(base);
    emptyArchive.file('ppt/presentation.xml', `<?xml version="1.0"?>
      <p:presentation xmlns:p="p"><p:sldIdLst/></p:presentation>`);
    const empty = await emptyArchive.generateAsync({ type: 'uint8array', compression: 'STORE' });
    expect((await extractionError(() => extractPptxFragments(request(empty)))).code)
      .toBe('malformed-document');

    const malformedRelationships = await pptx(
      { 'ppt/slides/slide1.xml': slideXml([]) },
      ['rId1'],
      undefined,
      ['<Relationship Id="rId1" Type="x/slide"/>'],
    );
    expect((await extractionError(() => extractPptxFragments(request(malformedRelationships)))).code)
      .toBe('malformed-document');
  });

  it('ignores chart/image geometry and joins Unicode runs and paragraphs without invented words', async () => {
    const fallback = shape('', '', [['Cafe\u0301', '\u00a0', '\u661f'], ['second paragraph']]);
    const data = await pptx({
      'ppt/slides/slide1.xml': slideXml([
        '<p:pic><p:blipFill><a:blip r:embed="image1"/></p:blipFill></p:pic>',
        '<p:graphicFrame><a:graphic><a:graphicData><c:chart xmlns:c="chart"><c:v>999</c:v></c:chart></a:graphicData></a:graphic></p:graphicFrame>',
        fallback,
      ]),
    }, ['rId1']);
    const result = await extractPptxFragments(request(data), { now: () => new Date(NOW) });
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]?.rawText).toBe('Caf\u00e9\u00a0\u661f\nsecond paragraph');
    expect(result.fragments[0]?.normalizedText).toBe('Caf\u00e9 \u661f second paragraph');
    expect(result.fragments[0]?.locator).toEqual({
      slideNumber: 1,
      objectId: 'text:1',
      objectName: '\u6587\u672c\u6846 1',
    });
  });
});
