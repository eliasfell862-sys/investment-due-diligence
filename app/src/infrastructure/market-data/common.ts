/**
 * Shared Market Data Infrastructure
 *
 * Common types, JSONP helper, Eastmoney API patterns.
 * All modules (stock/fund/bond/ETF) import from here.
 */

// ── Shared Types ──

export interface Quote {
  code: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
}

export interface KLine {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
}

export interface MarketItem {
  code: string;
  name: string;
  market: string;       // sh/sz/us/hk/...
  category: string;      // sector/industry/family
  subCategory: string;
  price: number;
  changePct: number;
  cap: number;           // market cap / AUM
}

// ── JSONP Helper ──

export function jsonp<T>(url: string, timeoutMs: number = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const callbackName = `_cb_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const script = document.createElement('script');
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('JSONP timeout'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      delete (window as any)[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    (window as any)[callbackName] = (data: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };

    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}callback=${callbackName}`;
    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('JSONP error'));
    };
    document.head.appendChild(script);
  });
}

// ── Eastmoney API Helpers ──

const EM_HEADERS = { Referer: 'https://quote.eastmoney.com' };

/** Fetch from Eastmoney push2 API (JSON, not JSONP) */
export async function emFetch(url: string): Promise<any> {
  const resp = await fetch(url, { headers: EM_HEADERS });
  return resp.json();
}

/** Get list data from Eastmoney push2 clist API */
export async function emGetList(params: {
  fs: string;       // filter string e.g. 'b:MK0354'
  fields?: string;  // default: 'f12,f14,f2,f3,f5,f20'
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortDesc?: boolean;
}): Promise<any[]> {
  const { fs, fields = 'f12,f14,f2,f3,f5,f20', page = 1, pageSize = 100, sortField = 'f3', sortDesc = true } = params;
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=${sortDesc ? 1 : 0}&np=1&fltt=2&invt=2&fid=${sortField}&fs=${fs}&fields=${fields}`;
  const data = await emFetch(url);
  return data?.data?.diff || [];
}

/** Eastmoney secid helper: 600519 -> 1.600519, 000001 -> 0.000001 */
export function emSecid(code: string): string {
  return (code.startsWith('6') ? '1.' : '0.') + code;
}

// ── Sina Code Helper ──

export function sinaCode(code: string): string {
  return (code.startsWith('6') ? 'sh' : 'sz') + code;
}

// ── LocalStorage Persistence ──

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export function saveJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Number Formatting ──

export function fmtCap(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return v.toFixed(0);
}

export function fmtPct(v: number): string {
  if (v === 0 || isNaN(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export function colorPct(v: number): string {
  return v > 0 ? '#f56c6c' : v < 0 ? '#67c23a' : '#aaa';
}
