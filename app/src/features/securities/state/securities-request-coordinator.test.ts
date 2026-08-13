import { describe, expect, it, vi } from 'vitest';
import { createRequestCoordinator } from './securities-request-coordinator';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('createRequestCoordinator', () => {
  it('shares one loader promise for concurrent non-force reads', async () => {
    const deferred = createDeferred<number>();
    const loader = vi.fn(() => deferred.promise);
    const coordinator = createRequestCoordinator<number>();

    const first = coordinator.run(loader);
    const second = coordinator.run(loader);
    expect(loader).toHaveBeenCalledOnce();

    deferred.resolve(7);
    expect((await first).value).toBe(7);
    expect((await second).value).toBe(7);
  });

  it('marks an older response stale after a forced refresh', async () => {
    const slow = createDeferred<string>();
    const fast = createDeferred<string>();
    const coordinator = createRequestCoordinator<string>();

    const oldRequest = coordinator.run(() => slow.promise);
    const newRequest = coordinator.run(() => fast.promise, { force: true });
    fast.resolve('new');
    slow.resolve('old');

    expect(await newRequest).toMatchObject({ value: 'new', current: true });
    expect(await oldRequest).toMatchObject({ value: 'old', current: false });
  });

  it('invalidates an active response and starts a fresh generation', async () => {
    const stale = createDeferred<number>();
    const fresh = createDeferred<number>();
    const coordinator = createRequestCoordinator<number>();

    const staleRequest = coordinator.run(() => stale.promise);
    coordinator.invalidate();
    const freshRequest = coordinator.run(() => fresh.promise);
    fresh.resolve(2);
    stale.resolve(1);

    expect(await freshRequest).toMatchObject({ value: 2, current: true, version: 3 });
    expect(await staleRequest).toMatchObject({ value: 1, current: false, version: 1 });
    expect(coordinator.version()).toBe(3);
  });

  it('does not let an older rejection clear a newer in-flight request', async () => {
    const oldRequest = createDeferred<number>();
    const newRequest = createDeferred<number>();
    const coordinator = createRequestCoordinator<number>();

    const oldResult = coordinator.run(() => oldRequest.promise);
    const newResult = coordinator.run(() => newRequest.promise, { force: true });
    oldRequest.reject(new Error('old failed'));
    await expect(oldResult).rejects.toThrow('old failed');

    const sharedNewResult = coordinator.run(() => Promise.resolve(99));
    newRequest.resolve(5);
    expect(await newResult).toMatchObject({ value: 5, current: true });
    expect(await sharedNewResult).toMatchObject({ value: 5, current: true });
  });
});
