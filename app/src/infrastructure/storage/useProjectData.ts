/**
 * React hook: project-scoped persistent state.
 * Every module page under /projects/:projectId/analysis/... uses this to
 * keep data isolated per project.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useParams } from 'react-router-dom';

const listeners = new Map<string, Set<() => void>>();

function subscribe(key: string, cb: () => void) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(cb);
  return () => { listeners.get(key)?.delete(cb); };
}

function notify(key: string) {
  listeners.get(key)?.forEach((cb) => cb());
}

function pkey(projectId: string, module: string): string {
  return `dd-p-${projectId}-${module}`;
}

export function useProjectData<T>(module: string, fallback: T): [T, (value: T | ((prev: T) => T)) => void] {
  const { projectId = 'default' } = useParams<{ projectId: string }>();
  const key = pkey(projectId, module);

  const getSnapshot = useCallback(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }, [key]);

  const data = useSyncExternalStore(
    useCallback((cb: () => void) => subscribe(key, cb), [key]),
    getSnapshot,
  );

  const setData = useCallback((value: T | ((prev: T) => T)) => {
    const next = typeof value === 'function' ? (value as (prev: T) => T)(getSnapshot()) : value;
    localStorage.setItem(key, JSON.stringify(next));
    notify(key);
  }, [key, getSnapshot]);

  return [data, setData];
}

// For non-React contexts (report loader, AI extractor, bridges)
export function getProjectData<T>(projectId: string, module: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(pkey(projectId, module));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

export function setProjectData(projectId: string, module: string, data: unknown): void {
  localStorage.setItem(pkey(projectId, module), JSON.stringify(data));
}
