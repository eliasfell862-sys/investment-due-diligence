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

const minimalWorkbook: InspectedWorkbook = {
  sheetNames: ['S'],
  sheets: {
    S: {
      name: 'S',
      headers: ['Value'],
      rows: [],
      cells: [],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    },
  },
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
    worker.onmessage?.({ data: { ok: true, workbook: minimalWorkbook } } as MessageEvent);

    await expect(promise).resolves.toEqual(minimalWorkbook);
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

  it('rejects empty worker workbooks with the typed no-sheets error', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectWorkbookInWorker(new Uint8Array([1]), options);

    worker.onmessage?.({
      data: { ok: true, workbook: { sheetNames: [], sheets: {} } },
    } as MessageEvent);

    await expect(promise).rejects.toMatchObject({
      name: 'ExcelImporterError',
      code: 'no-sheets',
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
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

  it('wraps synchronous worker construction failures', async () => {
    await expect(inspectWorkbookInWorker(new Uint8Array([1]), {
      workerFactory: () => {
        throw new Error('constructor blocked');
      },
    })).rejects.toMatchObject({
      name: 'ExcelImporterError',
      code: 'worker-failed',
      message: 'constructor blocked',
    });
  });

  it('rebuilds null-prototype workbook maps from worker results', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectWorkbookInWorker(new Uint8Array([1]), options);
    const workbook: InspectedWorkbook = {
      sheetNames: ['S'],
      sheets: {
        S: {
          name: 'S',
          headers: ['Value'],
          rows: [{ Value: 1 }],
          cells: [{ Value: { value: 1, w: '' } }],
          startRow: 0,
          startColumn: 0,
          headerRowIndex: 0,
        },
      },
    };

    worker.onmessage?.({ data: { ok: true, workbook } } as MessageEvent);
    const inspected = await promise;

    expect(Object.getPrototypeOf(inspected.sheets)).toBeNull();
    expect(Object.getPrototypeOf(inspected.sheets.S?.rows[0])).toBeNull();
    expect(Object.getPrototypeOf(inspected.sheets.S?.cells[0])).toBeNull();
    expect(inspected.sheets.S?.cells[0]?.Value?.w).toBe('');
  });

  it('rejects invalid successful worker payloads with a typed error', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectWorkbookInWorker(new Uint8Array([1]), options);

    worker.onmessage?.({
      data: { ok: true, workbook: { sheetNames: ['Missing'], sheets: {} } },
    } as MessageEvent);

    await expect(promise).rejects.toMatchObject({
      name: 'ExcelImporterError',
      code: 'worker-failed',
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('reapplies workbook grid limits to successful worker payloads', async () => {
    const worker = new FakeWorker();
    const options = workerOptions(worker);
    const promise = inspectWorkbookInWorker(new Uint8Array([1]), options);
    const headers = Array.from({ length: 257 }, (_, index) => `H${index}`);

    worker.onmessage?.({
      data: {
        ok: true,
        workbook: {
          sheetNames: ['Wide'],
          sheets: {
            Wide: {
              name: 'Wide',
              headers,
              rows: [],
              cells: [],
              startRow: 0,
              startColumn: 0,
              headerRowIndex: 0,
            },
          },
        },
      },
    } as MessageEvent);

    await expect(promise).rejects.toMatchObject({ code: 'worker-failed' });
  });
});
