/**
 * Capital Flow Analysis — TypeScript port of InStock's fund flow module.
 * Eastmoney datacenter API for 主力/超大单/大单/中单/小单 net flows.
 */

export interface CapitalFlow {
  code: string;
  name: string;
  price: number;
  changePct: number;
  /** 主力净流入(万元) */
  mainNet: number;
  /** 主力净占比(%) */
  mainRatio: number;
  /** 超大单净流入(万元) */
  superLargeNet: number;
  /** 超大单净占比(%) */
  superLargeRatio: number;
  /** 大单净流入(万元) */
  largeNet: number;
  /** 大单净占比(%) */
  largeRatio: number;
  /** 中单净流入(万元) */
  mediumNet: number;
  /** 小单净流入(万元) */
  smallNet: number;
}

export interface CapitalFlowSummary {
  stock: CapitalFlow | null;
  rankList: CapitalFlow[];
  updatedAt: string;
}

// ── Fetch single stock fund flow ──
export async function fetchStockFundFlow(code: string): Promise<CapitalFlow | null> {
  const market = code.startsWith('6') ? '1' : '0';
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${code}&fields=f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87`;

  try {
    const text = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 8000);
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.setRequestHeader('Referer', 'https://data.eastmoney.com');
      xhr.onload = () => { clearTimeout(timer); resolve(xhr.responseText); };
      xhr.onerror = () => { clearTimeout(timer); reject(new Error('xhr error')); };
      xhr.ontimeout = () => { clearTimeout(timer); reject(new Error('timeout')); };
      xhr.send();
    });
    const data = JSON.parse(text);
    const d = data?.data;
    if (!d) return null;

    return {
      code: d.f12 || code,
      name: d.f14 || '',
      price: d.f2 || 0,
      changePct: d.f3 || 0,
      mainNet: (d.f62 || 0) / 10000,       // 元→万元
      mainRatio: d.f184 || 0,
      superLargeNet: (d.f66 || 0) / 10000,
      superLargeRatio: d.f69 || 0,
      largeNet: (d.f72 || 0) / 10000,
      largeRatio: d.f75 || 0,
      mediumNet: (d.f78 || 0) / 10000,
      smallNet: (d.f81 || 0) / 10000,
    };
  } catch {
    return null;
  }
}

// ── Fetch fund flow ranking (top N by main inflow) ──
export async function fetchFundFlowRanking(count: number = 20): Promise<CapitalFlow[]> {
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${count}&po=1&np=1&fltt=2&invt=2&fid=f62&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87`;

  try {
    const text = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 10000);
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.setRequestHeader('Referer', 'https://data.eastmoney.com');
      xhr.onload = () => { clearTimeout(timer); resolve(xhr.responseText); };
      xhr.onerror = () => { clearTimeout(timer); reject(new Error('xhr error')); };
      xhr.ontimeout = () => { clearTimeout(timer); reject(new Error('timeout')); };
      xhr.send();
    });
    const data = JSON.parse(text);
    const items = data?.data?.diff || [];

    return items.map((d: any) => ({
      code: d.f12 || '',
      name: d.f14 || '',
      price: d.f2 || 0,
      changePct: d.f3 || 0,
      mainNet: (d.f62 || 0) / 10000,
      mainRatio: d.f184 || 0,
      superLargeNet: (d.f66 || 0) / 10000,
      superLargeRatio: d.f69 || 0,
      largeNet: (d.f72 || 0) / 10000,
      largeRatio: d.f75 || 0,
      mediumNet: (d.f78 || 0) / 10000,
      smallNet: (d.f81 || 0) / 10000,
    }));
  } catch {
    return [];
  }
}

/** Format 万元 to readable string */
export function fmtFundFlow(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) return `${(value / 10000).toFixed(1)}亿`;
  return `${value.toFixed(0)}万`;
}

/** Color for flow value */
export function flowColor(value: number): string {
  if (value > 0) return '#ff6666';
  if (value < 0) return '#66cc66';
  return '#dddddd';
}
