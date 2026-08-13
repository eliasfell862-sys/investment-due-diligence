export interface CoordinatedResult<T> {
  value: T;
  current: boolean;
  version: number;
}

export interface RequestCoordinator<T> {
  run(loader: () => Promise<T>, options?: { force?: boolean }): Promise<CoordinatedResult<T>>;
  invalidate(): void;
  version(): number;
}

export function createRequestCoordinator<T>(): RequestCoordinator<T> {
  let currentVersion = 0;
  let inflight: Promise<CoordinatedResult<T>> | null = null;

  const run: RequestCoordinator<T>['run'] = (loader, options = {}) => {
    if (!options.force && inflight) return inflight;

    const requestVersion = currentVersion + 1;
    currentVersion = requestVersion;
    let loaded: Promise<T>; try { loaded = loader(); } catch (error) { loaded = Promise.reject(error); }
    const request = loaded.then(value => ({
        value,
        current: requestVersion === currentVersion,
        version: requestVersion,
      }));

    const tracked = request.finally(() => {
      if (inflight === tracked) inflight = null;
    });
    inflight = tracked;
    return tracked;
  };

  return {
    run,
    invalidate() {
      currentVersion += 1;
      inflight = null;
    },
    version() {
      return currentVersion;
    },
  };
}
