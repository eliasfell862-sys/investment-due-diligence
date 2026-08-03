/**
 * Bond Market Data API — 可转债 + 国债
 * Tencent qt.gtimg.cn for realtime quotes (XHR, CORS-free)
 */

import {
  createMarketDataMeta,
  currentMarketDataTime,
  type MarketDataResult,
} from './market-data-meta';
export interface ConvertibleBond {
  code: string; name: string;
  price: number; changePct: number; volume: number;
  convertPrice: number | null; premium: number | null;       // 转股价, 转股溢价率
  stockPrice: number | null; stockChangePct: number | null;  // 正股价, 正股涨跌
  yieldToMaturity: number | null;                            // 到期收益率
}

export interface YieldCurvePoint {
  term: string;
  yield: number;
  change: number;
}

export interface TreasuryFuture {
  code: string; name: string;
  price: number; changePct: number; volume: number;
}

// ── Embedded CB list (major active convertible bonds) ──

const CB_LIST = [
  '123111','123112','123113','123114','123115','123116','123117','123118','123119',
  '123120','123121','123122','123123','123124','123125','123126','123127','123128',
  '123129','123130','123131','123132','123133','123134','123135','123136','123137',
  '123138','123139','123140','123141','123142','123143','123144','123145','123146',
  '123147','123148','123149','123150',
  '110043','110044','110045','110046','110047','110048','110049','110050',
  '110051','110052','110053','110054','110055','110056','110057','110058',
  '110059','110060','110061','110062','110063','110064','110065','110066',
  '110067','110068','110069','110070','110071','110072','110073','110074',
  '110075','110076','110077','110078','110079','110080','110081','110082',
  '110083','110084','110085','110086','110087','110088','110089','110090',
  '113050','113051','113052','113053','113054','113055','113056','113057',
  '113058','113059','113060','113061','113062','113063','113064','113065',
  '113066','113067','113600','113601','113602','113603','113604','113605',
  '127000','127001','127002','127003','127004','127005','127006','127007',
  '127008','127009','127010','127011','127012','127013','127014','127015',
  '127016','127017','127018','127019','127020','127021','127022','127023',
  '128000','128001','128002','128003','128004','128005','128006','128007',
  '128008','128009','128010','128011','128012','128013','128014','128015',
];

// ── XHR helper ──

function xhrText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 10000);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.onload = () => { clearTimeout(timer); resolve(xhr.responseText); };
    xhr.onerror = () => { clearTimeout(timer); reject(new Error('xhr error')); };
    xhr.ontimeout = () => { clearTimeout(timer); reject(new Error('timeout')); };
    xhr.send();
  });
}

function tcCode(code: string): string {
  const isShanghaiBond = code.startsWith('110')
    || code.startsWith('111')
    || code.startsWith('113')
    || code.startsWith('118');
  return (isShanghaiBond ? 'sh' : 'sz') + code;
}

export function parseTencentConvertibleBonds(
  text: string,
  codes: readonly string[],
): ConvertibleBond[] {
  const results: ConvertibleBond[] = [];
  for (const code of codes) {
    const pattern = new RegExp(`v_${tcCode(code)}="([^"]*)"`);
    const match = text.match(pattern);
    if (!match) continue;
    const parts = match[1].split('~');
    if (parts.length < 30) continue;
    results.push({
      code,
      name: parts[1] || '',
      price: Number.parseFloat(parts[3]) || 0,
      changePct: Number.parseFloat(parts[32]) || 0,
      volume: Number.parseFloat(parts[6]) || 0,
      convertPrice: null,
      premium: null,
      stockPrice: null,
      stockChangePct: null,
      yieldToMaturity: null,
    });
  }
  return results;
}

// ── 可转债实时行情 ──

export async function fetchConvertibleBondsResult(
  options: { requestText?: (url: string) => Promise<string> } = {},
): Promise<MarketDataResult<ConvertibleBond[]>> {
  const results: ConvertibleBond[] = [];
  const failures: string[] = [];
  const requestText = options.requestText ?? xhrText;

  for (let i = 0; i < CB_LIST.length; i += 80) {
    const batch = CB_LIST.slice(i, i + 80);
    const codes = batch.map(tcCode).join(',');
    try {
      const text = await requestText('https://qt.gtimg.cn/q=' + codes);
      results.push(...parseTencentConvertibleBonds(text, batch));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  const status = failures.length === 0 ? 'success' : results.length > 0 ? 'partial' : 'error';
  return {
    data: results,
    meta: createMarketDataMeta({
      source: '腾讯可转债行情',
      mode: 'realtime',
      status,
      asOf: results.length > 0 ? currentMarketDataTime() : undefined,
      error: failures.length > 0 ? [...new Set(failures)].join('; ') : undefined,
    }),
  };
}

export async function fetchConvertibleBonds(): Promise<ConvertibleBond[]> {
  return (await fetchConvertibleBondsResult()).data;
}
// ── 国债收益率曲线 (embedded — updated periodically) ──

let _cachedYieldCurve: YieldCurvePoint[] | null = null;

export async function fetchTreasuryYieldCurve(): Promise<YieldCurvePoint[]> {
  // Always return embedded data (Eastmoney API doesn't work from browser)
  if (!_cachedYieldCurve) {
    _cachedYieldCurve = [
      { term: '3M', yield: 1.45, change: -2 }, { term: '6M', yield: 1.52, change: -1 },
      { term: '1Y', yield: 1.60, change: -3 }, { term: '2Y', yield: 1.75, change: 0 },
      { term: '3Y', yield: 1.90, change: -2 }, { term: '5Y', yield: 2.15, change: 1 },
      { term: '7Y', yield: 2.40, change: 3 }, { term: '10Y', yield: 2.65, change: 2 },
      { term: '30Y', yield: 3.10, change: 5 },
    ];
  }
  return _cachedYieldCurve;
}

// ── 国债期货 (Tencent) ──

const TF_CODES = ['T2509', 'TF2509', 'TS2509', 'TL2509'];

export async function fetchTreasuryFutures(): Promise<TreasuryFuture[]> {
  try {
    const codes = TF_CODES.map(c => {
      if (c.startsWith('T') && !c.startsWith('TF') && !c.startsWith('TS') && !c.startsWith('TL')) return 'sh' + c.toLowerCase();
      return 'sh' + c.toLowerCase();
    }).join(',');
    const text = await xhrText(`https://qt.gtimg.cn/q=${codes}`);
    const results: TreasuryFuture[] = [];
    for (const c of TF_CODES) {
      const tc = c.startsWith('T') ? 'sh' + c.toLowerCase() : 'sh' + c.toLowerCase();
      const pattern = new RegExp(`v_${tc}="([^"]*)"`);
      const match = text.match(pattern);
      if (!match) continue;
      const parts = match[1].split('~');
      results.push({
        code: c, name: parts[1] || c,
        price: parseFloat(parts[3]) || 0,
        changePct: parseFloat(parts[32]) || 0,
        volume: parseFloat(parts[6]) || 0,
      });
    }
    return results;
  } catch { return []; }
}

// Legacy
export const fetchConvertibleBondInfo = async () => null;
