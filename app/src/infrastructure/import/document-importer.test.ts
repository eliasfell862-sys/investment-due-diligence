import { describe, expect, it, vi } from 'vitest';
import type { DocumentExtractionRequest } from './document-extractor';
import { DocumentExtractorError } from './document-extractor';
import {
  inspectDocumentInWorker,
  type DocumentCandidateWorkerResponse,
} from './document-importer';

class FakeWorker {
  onmessage: ((event: MessageEvent<DocumentCandidateWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
}

function workerOptions(worker: FakeWorker) {
  let timeoutHandler: (() => void) | undefined;
  return {
    clearTimer: vi.fn(),
    workerFactory: vi.fn(() => worker),
    setTimer: vi.fn((handler: () => void) => {
      timeoutHandler = handler;
      return 17;
    }),
    triggerTimeout: () => timeoutHandler?.(),
  };
}

function request(data = new Uint8Array([9, 1, 2, 8]).subarray(1, 3)): DocumentExtractionRequest {
  return {
    projectId: 'project-1', documentId: 'document-1', documentVersionId: 'version-1',
    fileName: 'memo.pdf', kind: 'pdf', data,
  };
}

function fragment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fragment-1', projectId: 'project-1', documentId: 'document-1',
    documentVersionId: 'version-1', sourceKind: 'pdf_text', locator: { pageNumber: 1 },
    rawText: 'Revenue: 100', normalizedText: 'Revenue: 100', extractionMethod: 'pdfjs',
    extractionVersion: '1.0.0', contentHash: 'sha256:fragment-1',
    createdAt: '2026-07-23T01:30:00.000Z', ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'candidate-1', projectId: 'project-1', documentId: 'document-1', fieldId: 'revenue',
    normalizedValue: '100', displayValue: '100',
    periodIdentity: 'source-document:document-1:undated',
    dimensionIdentity: 'project:project-1:default', sourceFragmentIds: ['fragment-1'],
    recognitionMethod: 'rule', sourceTypeHint: 'document_fact', confidence: 0.82,
    reviewStatus: 'pending', candidateFingerprint: 'sha256:candidate-1',
    createdAt: '2026-07-23T01:30:00.000Z', updatedAt: '2026-07-23T01:30:00.000Z',
    ...overrides,
  };
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'project-1', documentId: 'document-1', fragments: [fragment()],
    candidates: [candidate()], needsOcrPageNumbers: [], warnings: [], ...overrides,
  };
}

function succeed(worker: FakeWorker, value: unknown): void {
  worker.onmessage?.({
    data: { ok: true, result: value },
  } as MessageEvent<DocumentCandidateWorkerResponse>);
}

function workerResult(overrides: Record<string, unknown> = {}) {
  const worker = new FakeWorker();
  const promise = inspectDocumentInWorker(request(), workerOptions(worker));
  succeed(worker, result(overrides));
  return { promise, worker };
}

describe('inspectDocumentInWorker', () => {
  it('preflights empty and oversized input before constructing a worker', async () => {
    const workerFactory = vi.fn(() => new FakeWorker());
    await expect(inspectDocumentInWorker(request(new Uint8Array()), { workerFactory }))
      .rejects.toMatchObject({ code: 'empty-input' });
    await expect(inspectDocumentInWorker(
      request(new Uint8Array(100 * 1024 * 1024 + 1)), { workerFactory },
    )).rejects.toMatchObject({ code: 'input-too-large' });
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('transfers a copied buffer, rebuilds validated fragments, and terminates', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const input = new Uint8Array([9, 1, 2, 8]);
    const original = input.slice();
    const promise = inspectDocumentInWorker(request(input.subarray(1, 3)), {
      ...options, timeoutMs: 5_000,
    });
    const [message, transfer] = worker.postMessage.mock.calls[0]!;
    expect(options.workerFactory).toHaveBeenCalledWith(
      expect.any(URL), { type: 'module' },
    );
    expect(message.request.data).toEqual(new Uint8Array([1, 2]));
    expect(message.request.data.buffer).not.toBe(input.buffer);
    expect(transfer).toEqual([message.request.data.buffer]);
    expect(input).toEqual(original);
    expect(input.buffer.byteLength).toBe(4);

    const workerResult = result();
    succeed(worker, workerResult);
    await expect(promise).resolves.toEqual(workerResult);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(options.clearTimer).toHaveBeenCalledWith(17);
  });

  it('ignores the exact pdf.js fake-worker ready handshake before the app response', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectDocumentInWorker(request(), options);

    worker.onmessage?.({
      data: {
        sourceName: 'worker',
        targetName: 'main',
        action: 'ready',
        data: null,
      },
    } as unknown as MessageEvent<DocumentCandidateWorkerResponse>);

    expect(worker.terminate).not.toHaveBeenCalled();
    succeed(worker, result());
    await expect(promise).resolves.toEqual(result());
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates exactly once on timeout and ignores late worker responses', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectDocumentInWorker(request(), { ...options, timeoutMs: 25 });
    options.triggerTimeout();
    succeed(worker, result());
    worker.onerror?.({ message: 'late crash' } as ErrorEvent);
    await expect(promise).rejects.toMatchObject({ code: 'worker-timeout' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('maps worker onerror to a typed worker failure and terminates', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectDocumentInWorker(request(), options);
    worker.onerror?.({ message: 'worker crashed' } as ErrorEvent);
    await expect(promise).rejects.toEqual(expect.objectContaining({
      name: 'DocumentExtractorError', code: 'worker-failed', message: 'Worker error: worker crashed',
    }));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['malformed fragment ids', result({ fragments: [fragment({ id: '' })] })],
    ['cross-project fragments', result({ fragments: [fragment({ projectId: 'project-2' })] })],
    ['cross-version fragments', result({
      fragments: [fragment({ documentVersionId: 'version-2' })],
    })],
    ['cross-project candidates', result({ candidates: [candidate({ projectId: 'project-2' })] })],
    ['cross-document result metadata', result({ documentId: 'document-2' })],
    ['too many fragments', result({ fragments: Array.from({ length: 10_001 }, () => fragment()) })],
    ['duplicate fragment ids', result({ fragments: [fragment(), fragment()] })],
    ['invalid candidate values', result({ candidates: [candidate({ confidence: 2 })] })],
    ['candidate references to missing fragments', result({
      candidates: [candidate({ sourceFragmentIds: ['missing'] })],
    })],
  ])('rejects %s from a successful worker response', async (_name, workerResult) => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectDocumentInWorker(request(), options);
    succeed(worker, workerResult);
    await expect(promise).rejects.toMatchObject({ code: 'worker-failed' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects too many candidates', async () => {
    const worker = new FakeWorker();
    const promise = inspectDocumentInWorker(request(), workerOptions(worker));
    succeed(worker, result({ candidates: Array.from({ length: 10_001 }, () => candidate()) }));
    await expect(promise).rejects.toMatchObject({ code: 'worker-failed' });
  });

  it('accepts exactly 4 MiB of aggregate returned raw fragment text', async () => {
    const worker = new FakeWorker();
    const promise = inspectDocumentInWorker(request(), workerOptions(worker));
    const text = 'x'.repeat(65_536);
    const fragments = Array.from({ length: 64 }, (_, index) => fragment({
      id: 'fragment-' + index, rawText: text, normalizedText: text,
    }));
    succeed(worker, result({ fragments, candidates: [] }));
    await expect(promise).resolves.toMatchObject({ fragments });
  });

  it('rejects one character over 4 MiB of aggregate returned raw fragment text', async () => {
    const worker = new FakeWorker();
    const promise = inspectDocumentInWorker(request(), workerOptions(worker));
    const text = 'x'.repeat(65_536);
    const fragments = Array.from({ length: 64 }, (_, index) => fragment({
      id: 'fragment-' + index, rawText: text, normalizedText: 'x',
    }));
    fragments.push(fragment({ id: 'fragment-64', rawText: 'x', normalizedText: 'x' }));
    succeed(worker, result({ fragments, candidates: [] }));
    await expect(promise).rejects.toMatchObject({ code: 'worker-failed' });
  });

  it.each([
    ['non-boolean success discriminant', { ok: 1, result: result() }],
    ['extra success key', { ok: true, result: result(), extra: true }],
    ['success with error', {
      ok: true,
      result: result(),
      error: { name: 'DocumentExtractorError', code: 'worker-failed', message: 'bad' },
    }],
    ['extra failure key', {
      ok: false,
      error: { name: 'DocumentExtractorError', code: 'worker-failed', message: 'bad' },
      extra: true,
    }],
    ['failure with result', {
      ok: false,
      error: { name: 'DocumentExtractorError', code: 'worker-failed', message: 'bad' },
      result: result(),
    }],
    ['extra serialized error key', {
      ok: false,
      error: {
        name: 'DocumentExtractorError', code: 'worker-failed', message: 'bad', extra: true,
      },
    }],
  ])('rejects malformed outer response shape: %s', async (_name, response) => {
    const worker = new FakeWorker();
    const promise = inspectDocumentInWorker(request(), workerOptions(worker));
    worker.onmessage?.({ data: response } as unknown as MessageEvent<DocumentCandidateWorkerResponse>);
    await expect(promise).rejects.toMatchObject({ code: 'worker-failed' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['extra failure key', {
      ok: false,
      error: { name: 'DocumentExtractorError', code: 'worker-failed', message: 'bad' },
      extra: true,
    }],
    ['failure with result', {
      ok: false,
      error: { name: 'DocumentExtractorError', code: 'worker-failed', message: 'bad' },
      result: result(),
    }],
  ])('rejects malformed failure response shape: %s', async (_name, response) => {
    const worker = new FakeWorker();
    const promise = inspectDocumentInWorker(request(), workerOptions(worker));
    worker.onmessage?.({ data: response } as unknown as MessageEvent<DocumentCandidateWorkerResponse>);
    await expect(promise).rejects.toMatchObject({
      code: 'worker-failed',
      message: 'Document extraction worker returned an invalid response.',
    });
  });

  it('rejects extra serialized error fields', async () => {
    const worker = new FakeWorker();
    const promise = inspectDocumentInWorker(request(), workerOptions(worker));
    worker.onmessage?.({ data: {
      ok: false,
      error: {
        name: 'DocumentExtractorError', code: 'worker-failed', message: 'bad', extra: true,
      },
    } } as unknown as MessageEvent<DocumentCandidateWorkerResponse>);
    await expect(promise).rejects.toMatchObject({
      code: 'worker-failed',
      message: 'Document extraction worker returned an invalid error.',
    });
  });

  it.each([
    ['OCR count', { needsOcrPageNumbers: Array.from({ length: 500 }, (_, index) => index + 1) }],
    ['OCR value', { needsOcrPageNumbers: [500] }],
    ['warning count', { warnings: Array.from({ length: 500 }, () => '') }],
    ['individual warning length', { warnings: ['x'.repeat(1_024)] }],
    ['aggregate warning length', { warnings: Array.from({ length: 64 }, () => 'x'.repeat(1_024)) }],
  ])('accepts the exact %s metadata boundary', async (_name, overrides) => {
    const { promise } = workerResult(overrides);
    await expect(promise).resolves.toBeDefined();
  });

  it.each([
    ['OCR count', {
      needsOcrPageNumbers: Array.from({ length: 501 }, (_, index) => index + 1),
    }],
    ['OCR value', { needsOcrPageNumbers: [501] }],
    ['warning count', { warnings: Array.from({ length: 501 }, () => '') }],
    ['individual warning length', { warnings: ['x'.repeat(1_025)] }],
    ['aggregate warning length', {
      warnings: [...Array.from({ length: 64 }, () => 'x'.repeat(1_024)), 'x'],
    }],
  ])('rejects one over the %s metadata boundary', async (_name, overrides) => {
    const { promise, worker } = workerResult(overrides);
    await expect(promise).rejects.toMatchObject({ code: 'worker-failed' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['OCR', { needsOcrPageNumbers: new Array(1) }],
    ['warning', { warnings: new Array(1) }],
  ])('rejects sparse %s metadata arrays', async (_name, overrides) => {
    const { promise } = workerResult(overrides);
    await expect(promise).rejects.toMatchObject({ code: 'worker-failed' });
  });

  it('rejects oversized sparse OCR metadata before traversing elements', async () => {
    const access = vi.fn(() => { throw new Error('must not traverse'); });
    const needsOcrPageNumbers = new Array(1_000_000);
    Object.defineProperty(needsOcrPageNumbers, 0, { get: access });
    const { promise } = workerResult({ needsOcrPageNumbers });

    await expect(promise).rejects.toMatchObject({ code: 'worker-failed' });
    expect(access).not.toHaveBeenCalled();
  });

  it.each([
    ['fragments', { fragments: new Array(1), candidates: [] }],
    ['candidates', { candidates: new Array(1) }],
  ])('rejects sparse %s through the parser boundary', async (_name, overrides) => {
    const { promise } = workerResult(overrides);
    await expect(promise).rejects.toMatchObject({
      code: 'worker-failed',
      message: 'Document extraction worker returned invalid evidence data.',
    });
  });

  it('accepts an extractor error message exactly 4,096 characters long', async () => {
    const worker = new FakeWorker();
    const promise = inspectDocumentInWorker(request(), workerOptions(worker));
    const message = 'x'.repeat(4_096);
    worker.onmessage?.({ data: { ok: false, error: {
      name: 'DocumentExtractorError', code: 'worker-failed', message,
    } } } as MessageEvent<DocumentCandidateWorkerResponse>);
    await expect(promise).rejects.toMatchObject({ code: 'worker-failed', message });
  });

  it.each([
    ['empty', ''],
    ['one over', 'x'.repeat(4_097)],
  ])('rejects an %s extractor error message boundary', async (_name, message) => {
    const worker = new FakeWorker();
    const promise = inspectDocumentInWorker(request(), workerOptions(worker));
    worker.onmessage?.({ data: { ok: false, error: {
      name: 'DocumentExtractorError', code: 'worker-failed', message,
    } } } as MessageEvent<DocumentCandidateWorkerResponse>);
    await expect(promise).rejects.toMatchObject({
      code: 'worker-failed',
      message: 'Document extraction worker returned an invalid error.',
    });
  });

  it('rejects duplicate candidate ids', async () => {
    const { promise } = workerResult({
      candidates: [
        candidate(),
        candidate({
          candidateFingerprint: 'sha256:candidate-2',
          normalizedValue: '200',
          displayValue: '200',
        }),
      ],
    });
    await expect(promise).rejects.toMatchObject({ code: 'worker-failed' });
  });

  it.each([
    ['otherwise identical candidates', candidate({ id: 'candidate-2' })],
    ['conflicting candidates', candidate({
      id: 'candidate-2',
      normalizedValue: '200',
      displayValue: '200',
    })],
  ])('rejects duplicate fingerprints from %s', async (_name, secondCandidate) => {
    const { promise } = workerResult({ candidates: [candidate(), secondCandidate] });
    await expect(promise).rejects.toMatchObject({ code: 'worker-failed' });
  });

  it('reconstructs structured extractor errors returned by the worker', async () => {
    const worker = new FakeWorker();
    const promise = inspectDocumentInWorker(request(), workerOptions(worker));
    worker.onmessage?.({ data: { ok: false, error: {
      name: 'DocumentExtractorError', code: 'password-protected', message: 'Password required.',
    } } } as MessageEvent<DocumentCandidateWorkerResponse>);
    await expect(promise).rejects.toBeInstanceOf(DocumentExtractorError);
    await expect(promise).rejects.toMatchObject({ code: 'password-protected' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates when postMessage fails synchronously', async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => { throw new Error('clone failed'); });
    await expect(inspectDocumentInWorker(request(), workerOptions(worker))).rejects.toMatchObject({
      code: 'worker-failed', message: 'clone failed',
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('maps timer setup failure and terminates the constructed worker once', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    await expect(inspectDocumentInWorker(request(), {
      ...options,
      setTimer: () => { throw new Error('timer failed'); },
    })).rejects.toMatchObject({
      name: 'DocumentExtractorError', code: 'worker-failed', message: 'timer failed',
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('does not post work after a synchronous timeout callback settles the request', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectDocumentInWorker(request(), {
      ...options,
      setTimer: (handler) => {
        handler();
        return 23;
      },
    });
    await expect(promise).rejects.toMatchObject({ code: 'worker-timeout' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });
});
