import { describe, expect, it } from "vitest";

import {
  DocumentExtractorError,
  MAX_DOCUMENT_INPUT_BYTES,
  type DocumentExtractionRequest,
} from "./document-extractor";
import { extractPdfFragments, type PdfDocumentAdapter } from "./pdf-extractor";

describe("extractPdfFragments", () => {
  it("extracts ordered PDF text fragments", async () => {
    const document: PdfDocumentAdapter = {
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: [{ str: "First line", hasEOL: true }] }),
      }),
      destroy: async () => undefined,
    };

    const result = await extractPdfFragments(
      {
        projectId: "project-1",
        documentId: "document-1",
        documentVersionId: "version-1",
        fileName: "sample.pdf",
        kind: "pdf",
        data: new Uint8Array([1]),
      },
      { load: async () => document, now: () => new Date("2026-07-23T00:00:00.000Z") },
    );

    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]?.rawText).toBe("First line");
  });
});

const NOW = '2026-07-23T00:00:00.000Z';
function request(overrides: Partial<DocumentExtractionRequest> = {}): DocumentExtractionRequest {
  return {
    projectId: 'project-1', documentId: 'document-1', documentVersionId: 'version-1',
    fileName: 'sample.pdf', kind: 'pdf', data: new Uint8Array([1, 2, 3]), ...overrides,
  };
}
function fakeDocument(itemsByPage: readonly (readonly unknown[])[], onDestroy = () => undefined): PdfDocumentAdapter {
  return {
    numPages: itemsByPage.length,
    getPage: async (pageNumber) => ({
      getTextContent: async () => ({ items: itemsByPage[pageNumber - 1] }),
    }),
    destroy: async () => { onDestroy(); },
  };
}
async function extractionError(action: () => Promise<unknown>): Promise<DocumentExtractorError> {
  try { await action(); } catch (caught) {
    expect(caught).toBeInstanceOf(DocumentExtractorError);
    return caught as DocumentExtractorError;
  }
  throw new Error('Expected an extraction error.');
}

describe('bounded PDF extraction', () => {
  it('groups lines, derives finite boxes, marks blank pages, and remains deterministic', async () => {
    const load = async () => fakeDocument([
      [
        { str: 'Revenue', transform: [1, 0, 0, 1, 10, 80], width: 40, height: 10 },
        { str: '  1,234.50 ', transform: [1, 0, 0, 1, 55, 80], width: 45, height: 10, hasEOL: true },
        { str: 'Margin', transform: [1, 0, 0, 1, Number.NaN, 60], width: 30, height: 10 },
        { str: '25%', hasEOL: true },
      ],
      [{ type: 'beginMarkedContent', id: 'x' }, { str: '   ' }],
      [{ str: 'Final page' }],
    ]);
    const dependencies = { load, now: () => new Date(NOW) };
    const first = await extractPdfFragments(request(), dependencies);
    const second = await extractPdfFragments(request(), dependencies);

    expect(first.fragments.map(({ rawText }) => rawText)).toEqual([
      'Revenue  1,234.50', 'Margin 25%', 'Final page',
    ]);
    expect(first.fragments[0]?.normalizedText).toBe('Revenue 1,234.50');
    expect(first.fragments[0]?.locator).toEqual({
      pageNumber: 1, objectId: 'text:1', objectName: '\u6587\u672c\u6bb5 1', boundingBox: [10, 80, 90, 10],
    });
    expect(first.fragments[1]?.locator.boundingBox).toBeUndefined();
    expect(first.fragments[2]?.locator.pageNumber).toBe(3);
    expect(first.needsOcrPageNumbers).toEqual([2]);
    expect(first.fragments.map(({ id }) => id)).toEqual(second.fragments.map(({ id }) => id));
    expect(first.fragments[0]?.id).toMatch(/^pdf:[a-f0-9]{64}$/);
    expect(first.fragments[0]?.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(new Set(first.fragments.map(({ createdAt }) => createdAt))).toEqual(new Set([NOW]));
  });

  it('accepts 500 pages and rejects 501 before page iteration', async () => {
    let calls = 0;
    const accepted: PdfDocumentAdapter = {
      numPages: 500,
      getPage: async () => {
        calls += 1;
        return { getTextContent: async () => ({ items: [] }) };
      },
      destroy: async () => undefined,
    };
    const result = await extractPdfFragments(request(), {
      load: async () => accepted, now: () => new Date(NOW),
    });
    expect(result.needsOcrPageNumbers).toHaveLength(500);
    expect(calls).toBe(500);

    calls = 0;
    const rejected = { ...accepted, numPages: 501 };
    expect((await extractionError(() => extractPdfFragments(request(), {
      load: async () => rejected, now: () => new Date(NOW),
    }))).code).toBe('page-limit');
    expect(calls).toBe(0);
  });

  it('enforces per-fragment and aggregate text limits', async () => {
    const tooLong = fakeDocument([[{ str: 'x'.repeat(65_537) }]]);
    expect((await extractionError(() => extractPdfFragments(request(), {
      load: async () => tooLong, now: () => new Date(NOW),
    }))).code).toBe('text-limit');

    const chunks = Array.from({ length: 65 }, (_, index) => ({
      str: 'x'.repeat(index === 64 ? 1 : 65_536), hasEOL: true,
    }));
    let aggregateDestroys = 0;
    const aggregate = fakeDocument([chunks], () => { aggregateDestroys += 1; });
    expect((await extractionError(() => extractPdfFragments(request(), {
      load: async () => aggregate, now: () => new Date(NOW),
    }))).code).toBe('text-limit');
    expect(aggregateDestroys).toBe(1);
  });

  it.each([
    [request({ data: new Uint8Array() }), 'empty-input'],
    [request({ data: new Uint8Array(MAX_DOCUMENT_INPUT_BYTES + 1) }), 'input-too-large'],
    [request({ kind: 'pptx' }), 'unsupported-format'],
    [request({ projectId: '  ' }), 'malformed-document'],
    [request({ documentVersionId: 'x'.repeat(257) }), 'malformed-document'],
  ] as const)('validates request bounds with typed errors', async (input, code) => {
    const caught = await extractionError(() => extractPdfFragments(input, {
      load: async () => fakeDocument([[]]), now: () => new Date(NOW),
    }));
    expect(caught.code).toBe(code);
  });

  it('validates timestamps and maps password and malformed load errors with causes', async () => {
    expect((await extractionError(() => extractPdfFragments(request(), {
      load: async () => fakeDocument([[]]), now: () => new Date(Number.NaN),
    }))).code).toBe('malformed-document');

    const passwordCause = Object.assign(new Error('password'), { name: 'PasswordException', code: 1 });
    const password = await extractionError(() => extractPdfFragments(request(), {
      load: async () => { throw passwordCause; },
    }));
    expect(password.code).toBe('password-protected');
    expect(password.cause).toBe(passwordCause);

    const malformedCause = new Error('invalid PDF');
    const malformed = await extractionError(() => extractPdfFragments(request(), {
      load: async () => { throw malformedCause; },
    }));
    expect(malformed.code).toBe('malformed-document');
    expect(malformed.cause).toBe(malformedCause);
  });

  it('maps invalid page counts, content shapes, and page failures to malformed-document', async () => {
    for (const numPages of [0, 1.5]) {
      const adapter = { ...fakeDocument([[]]), numPages };
      expect((await extractionError(() => extractPdfFragments(request(), {
        load: async () => adapter, now: () => new Date(NOW),
      }))).code).toBe('malformed-document');
    }
    for (const content of [null, {}, { items: null }, { items: [{ str: 42 }] }]) {
      const adapter: PdfDocumentAdapter = {
        numPages: 1,
        getPage: async () => ({ getTextContent: async () => content }),
        destroy: async () => undefined,
      };
      expect((await extractionError(() => extractPdfFragments(request(), {
        load: async () => adapter, now: () => new Date(NOW),
      }))).code).toBe('malformed-document');
    }
    const cause = new Error('page failed');
    const adapter: PdfDocumentAdapter = {
      numPages: 1, getPage: async () => { throw cause; }, destroy: async () => undefined,
    };
    const caught = await extractionError(() => extractPdfFragments(request(), {
      load: async () => adapter, now: () => new Date(NOW),
    }));
    expect(caught.message).toContain('page 1');
    expect(caught.cause).toBe(cause);
  });

  it('checks cancellation before load and between pages and always cleans up once', async () => {
    let loads = 0;
    expect((await extractionError(() => extractPdfFragments(request(), {
      load: async () => { loads += 1; return fakeDocument([[]]); },
      isCancelled: () => true,
    }))).code).toBe('cancelled');
    expect(loads).toBe(0);

    let checks = 0; let destroys = 0;
    const adapter = fakeDocument([[{ str: 'one' }], [{ str: 'two' }]], () => { destroys += 1; });
    expect((await extractionError(() => extractPdfFragments(request(), {
      load: async () => adapter,
      now: () => new Date(NOW),
      isCancelled: () => { checks += 1; return checks >= 3; },
    }))).code).toBe('cancelled');
    expect(destroys).toBe(1);
  });

  it('copies sliced input, does not mutate caller bytes, and changes identity with source', async () => {
    const backing = new Uint8Array([9, 1, 2, 3, 8]);
    const input = backing.subarray(1, 4);
    const before = [...backing];
    let loaded: Uint8Array | undefined;
    const first = await extractPdfFragments(request({ data: input }), {
      load: async (data) => {
        loaded = data; data[0] = 42; return fakeDocument([[{ str: 'text' }]]);
      },
      now: () => new Date(NOW),
    });
    const changed = await extractPdfFragments(request({ documentVersionId: 'version-2' }), {
      load: async () => fakeDocument([[{ str: 'text' }]]), now: () => new Date(NOW),
    });
    expect([...backing]).toEqual(before);
    expect([...loaded ?? []]).toEqual([42, 2, 3]);
    expect(loaded?.buffer).not.toBe(input.buffer);
    expect(changed.fragments[0]?.id).not.toBe(first.fragments[0]?.id);
    expect(changed.fragments[0]?.contentHash).not.toBe(first.fragments[0]?.contentHash);
  });

  it('deep-freezes result arrays, fragments, locators, and bounding boxes', async () => {
    const result = await extractPdfFragments(request(), {
      load: async () => fakeDocument([[{
        str: 'text', transform: [1, 0, 0, 1, 1, 2], width: 3, height: 4,
      }]]),
      now: () => new Date(NOW),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.fragments)).toBe(true);
    expect(Object.isFrozen(result.needsOcrPageNumbers)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
    expect(Object.isFrozen(result.fragments[0])).toBe(true);
    expect(Object.isFrozen(result.fragments[0]?.locator)).toBe(true);
    expect(Object.isFrozen(result.fragments[0]?.locator.boundingBox)).toBe(true);
  });

  it('normalizes split combining sequences and every supported whitespace separator', async () => {
    const result = await extractPdfFragments(request(), {
      load: async () => fakeDocument([[
        { str: 'Cafe' },
        { str: '\u0301\r\nnext\u0085line\u2028more\u2029done' },
      ]]),
      now: () => new Date(NOW),
    });
    expect(result.fragments[0]?.rawText).toBe('Caf\u00e9\r\nnext\u0085line\u2028more\u2029done');
    expect(result.fragments[0]?.normalizedText).toBe('Caf\u00e9 next line more done');
  });

  it('rejects incremental block and page-item resource overruns with cleanup', async () => {
    let destroys = 0;
    const blockAdapter = fakeDocument([
      Array.from({ length: 65_537 }, () => ({ str: 'x' })),
    ], () => { destroys += 1; });
    expect((await extractionError(() => extractPdfFragments(request(), {
      load: async () => blockAdapter,
      now: () => new Date(NOW),
    }))).code).toBe('text-limit');
    expect(destroys).toBe(1);

    destroys = 0;
    const itemCapAdapter = fakeDocument([
      Array.from({ length: 100_001 }, () => ({ str: '', hasEOL: true })),
    ], () => { destroys += 1; });
    expect((await extractionError(() => extractPdfFragments(request(), {
      load: async () => itemCapAdapter,
      now: () => new Date(NOW),
    }))).code).toBe('text-limit');
    expect(destroys).toBe(1);
  });

  it('rejects malformed loaded adapters without leaking raw TypeErrors', async () => {
    for (const adapter of [
      null,
      {},
      { numPages: 1, getPage: async () => ({}), destroy: 42 },
      { numPages: 1, getPage: 42, destroy: async () => undefined },
    ]) {
      const caught = await extractionError(() => extractPdfFragments(request(), {
        load: async () => adapter as unknown as PdfDocumentAdapter,
        now: () => new Date(NOW),
      }));
      expect(caught.code).toBe('malformed-document');
    }
  });

  it('types cleanup failures and preserves primary page errors when cleanup also fails', async () => {
    const cleanupCause = new Error('cleanup failed');
    const successAdapter: PdfDocumentAdapter = {
      ...fakeDocument([[{ str: 'text' }]]),
      destroy: async () => { throw cleanupCause; },
    };
    const cleanup = await extractionError(() => extractPdfFragments(request(), {
      load: async () => successAdapter,
      now: () => new Date(NOW),
    }));
    expect(cleanup.code).toBe('malformed-document');
    expect(cleanup.cause).toBe(cleanupCause);

    let destroys = 0;
    const pageCause = new Error('page failed');
    const pageAdapter: PdfDocumentAdapter = {
      numPages: 1,
      getPage: async () => { throw pageCause; },
      destroy: async () => { destroys += 1; throw cleanupCause; },
    };
    const primary = await extractionError(() => extractPdfFragments(request(), {
      load: async () => pageAdapter,
      now: () => new Date(NOW),
    }));
    expect(primary.code).toBe('malformed-document');
    expect(primary.message).toContain('page 1');
    expect(primary.cause).toBe(pageCause);
    expect(destroys).toBe(1);
  });
});
