/**
 * A-Share Market Data API
 *
 * Uses free public endpoints (新浪/东方财富) accessible from browser.
 * No API key required. Rate-limited on client side.
 */

import { emSecid, jsonp } from './common';

export interface StockQuote {
  code: string;        // 股票代码 e.g. '000001'
  name: string;        // 股票名称
  market: 'sh' | 'sz'; // 上海/深圳
  price: number;       // 最新价
  change: number;      // 涨跌额
  changePct: number;   // 涨跌幅%
  open: number;        // 开盘
  high: number;        // 最高
  low: number;         // 最低
  volume: number;      // 成交量(手)
  amount: number;      // 成交额(万)
  preClose: number;    // 昨收
  turnover: number;    // 换手率%
  pe: number;          // 市盈率
  pb: number;          // 市净率
  totalShares: number; // 总股本(万)
  floatShares: number; // 流通股本(万)
  totalCap: number;    // 总市值(亿)
  floatCap: number;    // 流通市值(亿)
}

export interface StockKLine {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
}

export interface DailyBasicData {
  code: string;
  date: string;
  pe: number;
  peTTM: number;
  pb: number;
  ps: number;
  pcf: number;
  roe: number;
  roa: number;
  grossMargin: number;
  netMargin: number;
  revenueGrowth: number;
  profitGrowth: number;
  debtRatio: number;
  currentRatio: number;
  dividendYield: number;
  totalCap: number;
  floatCap: number;
}

// ── 东方财富实时行情 (CORS-friendly) ──

export async function fetchStockQuotes(codes: string[]): Promise<StockQuote[]> {
  if (codes.length === 0) return [];
  try {
    // 东方财富 push2 API — supports CORS, returns JSON
    const secids = codes.map(c => (c.startsWith('6') ? '1.' : '0.') + c).join(',');
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21,f22,f38,f39,f42,f44,f45,f46,f47&secids=${secids}`;
    const resp = await fetch(url, { headers: { Referer: 'https://quote.eastmoney.com' } });
    const data = await resp.json() as any;
    const items = data?.data?.diff || [];

    return items.map((item: any) => {
      const price = item.f2 || 0;
      const preClose = item.f18 || price;
      const change = price - preClose;
      return {
        code: item.f12,
        name: item.f14 || '',
        market: (item.f12 || '').startsWith('6') ? 'sh' : 'sz',
        price,
        change,
        changePct: preClose > 0 ? (change / preClose) * 100 : 0,
        open: item.f17 || 0,
        high: item.f15 || 0,
        low: item.f16 || 0,
        volume: item.f5 || 0,
        amount: item.f6 || 0,
        preClose,
        turnover: item.f8 || 0,
        pe: item.f9 || 0,
        pb: item.f22 || 0,
        totalShares: item.f44 || 0,
        floatShares: item.f45 || 0,
        totalCap: item.f20 || 0,
        floatCap: item.f21 || 0,
      };
    });
  } catch {
    return [];
  }
}

/** @deprecated use fetchStockQuotes */
export const fetchSinaQuotes = fetchStockQuotes;

// ── 东方财富 K 线 API ──

export async function fetchEastmoneyKLine(code: string, days: number = 250): Promise<StockKLine[]> {
  const secid = emSecid(code);
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&end=20500101&lmt=${days}`;

  try {
    const resp = await fetch(url, { headers: { Referer: 'https://quote.eastmoney.com' } });
    const data = await resp.json() as any;
    const klines = data?.data?.klines || [];

    return klines.map((line: string) => {
      const parts = line.split(',');
      return {
        date: parts[0],
        open: parseFloat(parts[1]) || 0,
        close: parseFloat(parts[2]) || 0,
        high: parseFloat(parts[3]) || 0,
        low: parseFloat(parts[4]) || 0,
        volume: parseFloat(parts[5]) || 0,
        amount: parseFloat(parts[6]) || 0,
      };
    });
  } catch {
    return [];
  }
}

// ── 东方财富基本面数据 ──

export async function fetchEastmoneyBasic(code: string): Promise<DailyBasicData | null> {
  const secid = emSecid(code);
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f55,f57,f58,f60,f78,f84,f85,f86,f92,f115,f116,f117,f162,f163,f164,f167,f168,f169,f170,f171,f172,f173,f174`;

  try {
    const resp = await fetch(url, { headers: { Referer: 'https://quote.eastmoney.com' } });
    const data = await resp.json() as any;
    const d = data?.data || {};

    return {
      code,
      date: new Date().toISOString().slice(0, 10),
      pe: d.f162 || 0,
      peTTM: d.f164 || 0,
      pb: d.f167 || 0,
      ps: d.f168 || 0,
      pcf: d.f169 || 0,
      roe: d.f173 || 0,
      roa: d.f174 || 0,
      grossMargin: d.f43 || 0,
      netMargin: d.f44 || 0,
      revenueGrowth: d.f45 || 0,
      profitGrowth: d.f46 || 0,
      debtRatio: d.f51 || 0,
      currentRatio: d.f52 || 0,
      dividendYield: d.f57 || 0,
      totalCap: d.f115 || 0,
      floatCap: d.f116 || 0,
    };
  } catch {
    return null;
  }
}

// ── 股票列表 (东方财富) ──

export interface StockBrief {
  code: string;
  name: string;
  market: 'sh' | 'sz';
  industry: string;
  area: string;
  totalCap: number;
}

export interface AStockDirectoryItem {
  code: string;
  name: string;
  industry: string;
}

type StockDirectoryRequest = (url: string) => Promise<any>;

export interface FetchAllAStocksOptions {
  pageSize?: number;
  maxPages?: number;
  request?: StockDirectoryRequest;
  fallbackRequest?: StockDirectoryRequest;
}

const A_STOCK_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';

async function fetchStockDirectoryJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Stock directory request failed: ${response.status}`);
  }
  return response.json();
}

function fetchStockDirectoryJsonp(url: string): Promise<any> {
  return jsonp<any>(url, 15000, 'cb');
}

export async function fetchAllAStocks(
  options: FetchAllAStocksOptions = {},
): Promise<AStockDirectoryItem[]> {
  const {
    pageSize = 500,
    maxPages = 20,
    request = fetchStockDirectoryJson,
    fallbackRequest = fetchStockDirectoryJsonp,
  } = options;
  const stocks = new Map<string, AStockDirectoryItem>();
  let total = Number.POSITIVE_INFINITY;

  for (let page = 1; page <= maxPages && stocks.size < total; page += 1) {
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${A_STOCK_FS}&fields=f12,f14,f100`;
    let payload: any;

    try {
      payload = await request(url);
    } catch {
      payload = await fallbackRequest(url);
    }

    const rows = Array.isArray(payload?.data?.diff) ? payload.data.diff : [];
    const reportedTotal = Number(payload?.data?.total);
    if (Number.isFinite(reportedTotal) && reportedTotal >= 0) {
      total = reportedTotal;
    }

    for (const row of rows) {
      const code = String(row?.f12 ?? '').trim();
      const name = String(row?.f14 ?? '').trim();
      if (!/^\d{6}$/.test(code) || !name) continue;
      stocks.set(code, {
        code,
        name,
        industry: String(row?.f100 ?? '').trim(),
      });
    }

    if (rows.length === 0 || (rows.length < pageSize && stocks.size >= total)) {
      break;
    }
  }

  return [...stocks.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function filterAStocks<T extends AStockDirectoryItem>(
  stocks: T[],
  keyword: string,
  industry: string,
): T[] {
  const normalizedKeyword = keyword.trim().toLowerCase();

  return stocks.filter((stock) => {
    if (industry && stock.industry !== industry) return false;
    if (!normalizedKeyword) return Boolean(industry);
    return stock.code.includes(normalizedKeyword)
      || stock.name.toLowerCase().includes(normalizedKeyword);
  });
}

export async function fetchStockList(market: 'sh' | 'sz'): Promise<StockBrief[]> {
  const pageSize = 500;
  const results: StockBrief[] = [];
  const fs = market === 'sh' ? 'm:1+t:2,m:1+t:23' : 'm:0+t:6,m:0+t:80';

  try {
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${fs}&fields=f12,f14,f100,f102`;
    const resp = await fetch(url, { headers: { Referer: 'https://quote.eastmoney.com' } });
    const data = await resp.json() as any;
    const list = data?.data?.diff || [];

    for (const item of list) {
      results.push({
        code: item.f12,
        name: item.f14,
        market,
        industry: item.f100 || '',
        area: item.f102 || '',
        totalCap: item.f20 || 0,
      });
    }
  } catch {}

  return results;
}
