import { describe, expect, it, vi } from 'vitest';
import {
  ExcelImporterError,
  inspectWorkbookInWorker,
  type InspectedWorkbook,
} from './excel-importer';

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
}

function workerOptions(worker: FakeWorker) {
  let timeoutHandler: (() => void) | undefined;
  const clearTimer = vi.fn();
  const workerFactory = vi.fn(() => worker as never);
  return {
    clearTimer,
    workerFactory,
    setTimer: vi.fn((handler: () => void) => {
      timeoutHandler = handler;
      return 1;
    }),
    triggerTimeout: () => timeoutHandler?.(),
  };
}

const emptyWorkbook: InspectedWorkbook = {
  sheetNames: [],
  sheets: {},
};

describe('inspectWorkbookInWorker', () => {
  it('resolves a worker result and terminates the worker', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectWorkbookInWorker(new Uint8Array([1]), {
      ...options,
      headerRowBySheet: { S: 1 },
    });

    expect(options.workerFactory).toHaveBeenCalledWith(expect.any(URL), { type: 'module' });
    expect(worker.postMessage).toHaveBeenCalledWith({
      data: expect.any(Uint8Array),
      options: { headerRowBySheet: { S: 1 }, timeBudgetMs: 2_000 },
    });
    worker.onmessage?.({ data: { ok: true, workbook: emptyWorkbook } } as MessageEvent);

    await expect(promise).resolves.toEqual(emptyWorkbook);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(options.clearTimer).toHaveBeenCalledWith(1);
  });

  it('reconstructs a serialized typed error and terminates the worker', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectWorkbookInWorker(new Uint8Array([1]), options);

    worker.onmessage?.({
      data: {
        ok: false,
        error: { name: 'ExcelImporterError', code: 'malformed-zip', message: 'bad zip' },
      },
    } as MessageEvent);

    await expect(promise).rejects.toMatchObject({
      name: 'ExcelImporterError',
      code: 'malformed-zip',
      message: 'bad zip',
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(options.clearTimer).toHaveBeenCalledWith(1);
  });

  it('terminates and rejects with a typed error on hard timeout', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectWorkbookInWorker(new Uint8Array([1]), {
      ...options,
      timeoutMs: 25,
    });

    options.triggerTimeout();

    await expect(promise).rejects.toEqual(
      expect.objectContaining({ code: 'worker-timeout' }),
    );
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(options.clearTimer).toHaveBeenCalledWith(1);
  });

  it('uses ExcelImporterError instances for worker failures', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectWorkbookInWorker(new Uint8Array([1]), options);

    worker.onerror?.({ message: 'worker crashed' } as ErrorEvent);

    await expect(promise).rejects.toBeInstanceOf(ExcelImporterError);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
