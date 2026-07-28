export interface BrowserCapabilities {
  readonly indexedDB: boolean;
  readonly webWorker: boolean;
  readonly blob: boolean;
  readonly crypto: boolean;
  readonly localStorage: boolean;
  readonly es2020: boolean;
  readonly issues: readonly string[];
}

export function checkBrowserCapabilities(): BrowserCapabilities {
  const issues: string[] = [];
  const checks = {
    indexedDB: typeof indexedDB !== 'undefined',
    webWorker: typeof Worker !== 'undefined',
    blob: typeof Blob !== 'undefined',
    crypto: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function',
    localStorage: (() => { try { const k = '__test__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch { return false; } })(),
    es2020: (() => { try { return typeof globalThis !== 'undefined' && typeof BigInt !== 'undefined'; } catch { return false; } })(),
  };
  if (!checks.indexedDB) issues.push('IndexedDB not available — project data cannot be saved locally.');
  if (!checks.webWorker) issues.push('Web Workers not available — PDF extraction will run on main thread.');
  if (!checks.blob) issues.push('Blob API not available — file downloads will not work.');
  if (!checks.crypto) issues.push('Crypto API not available — secure IDs will use fallback.');
  if (!checks.localStorage) issues.push('localStorage not available — settings cannot be saved.');
  return { ...checks, issues };
}

export function getBrowserInfo(): string {
  if (typeof navigator === 'undefined') return 'Unknown';
  const ua = navigator.userAgent;
  if (ua.includes('Edg')) return 'Edge';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  return 'Unknown';
}

export function isChromiumBased(): boolean {
  const info = getBrowserInfo();
  return info === 'Chrome' || info === 'Edge';
}
