/**
 * Project-scoped localStorage wrapper for non-React contexts.
 * For React components, import and use like:
 *   import { store } from '../../infrastructure/storage/store';
 *   const data = store(projectId).get('module', fallback);
 *   store(projectId).set('module', data);
 */
export function scopedStore(projectId: string) {
  const key = (module: string) => `dd-p-${projectId}-${module}`;
  return {
    get<T>(module: string, fallback: T): T {
      try {
        const raw = localStorage.getItem(key(module));
        return raw ? (JSON.parse(raw) as T) : fallback;
      } catch {
        return fallback;
      }
    },
    set(module: string, data: unknown): void {
      localStorage.setItem(key(module), JSON.stringify(data));
    },
    remove(module: string): void {
      localStorage.removeItem(key(module));
    },
  };
}
