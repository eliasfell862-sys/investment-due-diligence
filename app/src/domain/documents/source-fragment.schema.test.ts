import { describe, expect, it } from 'vitest';
import { formatSourceLocator } from './source-fragment';
import { parseSourceFragment } from './source-fragment.schema';

function validPdfFragment() {
  return {
    id: 'fragment-1',
    projectId: 'project-1',
    documentId: 'document-1',
    documentVersionId: 'document-version-1',
    sourceKind: 'pdf_table',
    locator: {
      pageNumber: 12,
      tableIndex: 2,
      tableRow: 4,
      tableColumn: 3,
    },
    rawText: 'Revenue 1,234.50',
    normalizedText: 'Revenue 1,234.50',
    extractionMethod: 'pdfjs',
    extractionVersion: '1.0.0',
    contentHash: 'sha256:fragment-1',
    createdAt: '2026-07-23T09:30:00+08:00',
  };
}

describe('parseSourceFragment', () => {
  it('accepts a located PDF table cell and formats its locator', () => {
    const fragment = parseSourceFragment(validPdfFragment());

    expect(fragment.createdAt).toBe('2026-07-23T01:30:00.000Z');
    expect(formatSourceLocator(fragment)).toBe(
      '第 12 页 / 表格 2 / 第 4 行第 3 列',
    );
  });

  it('rejects a fragment without a page or slide locator', () => {
    const input = validPdfFragment();

    expect(() => parseSourceFragment({ ...input, locator: {} })).toThrow();
  });

  it('rejects raw text longer than 65,536 characters', () => {
    expect(() =>
      parseSourceFragment({ ...validPdfFragment(), rawText: 'x'.repeat(65_537) }),
    ).toThrow();
  });

  it('rejects a locator containing both page and slide numbers', () => {
    expect(() =>
      parseSourceFragment({
        ...validPdfFragment(),
        locator: { pageNumber: 1, slideNumber: 2 },
      }),
    ).toThrow();
  });

  it.each([
    { boundingBox: [1, 2, 3] as const },
    { boundingBox: [-1, 0, 2, 3] as const },
    { boundingBox: [0, 0, Number.POSITIVE_INFINITY, 3] as const },
  ])('rejects invalid bounding box $boundingBox', ({ boundingBox }) => {
    expect(() =>
      parseSourceFragment({
        ...validPdfFragment(),
        locator: { pageNumber: 1, boundingBox },
      }),
    ).toThrow();
  });

  it('formats a named PowerPoint object locator', () => {
    const fragment = parseSourceFragment({
      ...validPdfFragment(),
      sourceKind: 'ppt_text',
      extractionMethod: 'pptx_ooxml',
      locator: { slideNumber: 7, objectName: 'Revenue summary' },
    });

    expect(formatSourceLocator(fragment)).toBe(
      '第 7 页 / 对象 Revenue summary',
    );
  });

  it('deep-freezes the parsed fragment and locator structures', () => {
    const fragment = parseSourceFragment({
      ...validPdfFragment(),
      locator: {
        pageNumber: 12,
        boundingBox: [10, 20, 30, 40],
      },
    });

    expect(Object.isFrozen(fragment)).toBe(true);
    expect(Object.isFrozen(fragment.locator)).toBe(true);
    expect(Object.isFrozen(fragment.locator.boundingBox)).toBe(true);

    expect(() => {
      (fragment as { rawText: string }).rawText = 'mutated';
    }).toThrow(TypeError);
    expect(() => {
      (fragment.locator.boundingBox as unknown as number[])[0] = 999;
    }).toThrow(TypeError);
    expect(fragment.rawText).toBe('Revenue 1,234.50');
    expect(fragment.locator.boundingBox?.[0]).toBe(10);
  });

  it('rejects unknown storage fields', () => {
    expect(() =>
      parseSourceFragment({ ...validPdfFragment(), ignored: true }),
    ).toThrow();
  });
});
