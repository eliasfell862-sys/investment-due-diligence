/**
 * Project-scoped localStorage. Every analysis module reads/writes under
 * keys prefixed with the project ID, so different projects never share data.
 */
const PREFIX = 'dd';

export function projectKey(projectId: string, module: string): string {
  return `${PREFIX}-p-${projectId}-${module}`;
}

export function loadProjectData<T>(projectId: string, module: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(projectKey(projectId, module));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveProjectData(projectId: string, module: string, data: unknown): void {
  localStorage.setItem(projectKey(projectId, module), JSON.stringify(data));
}

// Migration: if old global keys exist, try to read them as fallback
export function loadProjectWithFallback<T>(projectId: string, module: string, legacyKey: string, fallback: T): T {
  const scoped = loadProjectData<T>(projectId, module, fallback as T);
  // Check if scoped data is "empty" (empty object/array) and fall back to global
  if (scoped && typeof scoped === 'object') {
    if (Array.isArray(scoped) && scoped.length > 0) return scoped;
    if (!Array.isArray(scoped) && Object.keys(scoped).length > 0) return scoped;
  }
  if (typeof scoped === 'string' && scoped.length > 0) return scoped;
  // Try legacy global key
  try {
    const raw = localStorage.getItem(legacyKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate to scoped key
      saveProjectData(projectId, module, parsed);
      return parsed as T;
    }
  } catch {}
  return fallback as T;
}
