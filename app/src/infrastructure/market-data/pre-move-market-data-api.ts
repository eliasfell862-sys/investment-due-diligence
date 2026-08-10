import type { StockKLine } from './stock-api';
import { createMarketDataMeta, currentMarketDataTime, type MarketDataResult } from './market-data-meta';
import { requestWithEastmoneyFailover } from './eastmoney-host-failover';

export interface IndustryFlowRow {
  industryCode: string;
  industryName: string;
  changePct1d: number;
  mainNet1d: number;
  mainRatio1d: number;
  mainNet5d: number | null;
  mainRatio5d: number | null;
  mainNet10d: number | null;
  mainRatio10d: number | null;
  leadingStockCode: string | null;
}

export interface HistoricalCapitalFlowPoint {
  date: string;
  mainNet: number;
  mainRatio: number;
  superLargeNet: number;
  largeNet: number;
}

export interface MultiDayCapitalFlow {
  code: string;
  changePct3d: number | null;
  changePct5d: number | null;
  changePct10d: number | null;
  mainNet3d: number | null;
  mainRatio3d: number | null;
  mainNet5d: number | null;
  mainRatio5d: number | null;
  mainNet10d: number | null;
  mainRatio10d: number | null;
}

type RequestJson = (url: string, timeoutMs: number) => Promise<unknown>;

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowsFrom(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return [];
  const diff = (data as { diff?: unknown }).diff;
  return Array.isArray(diff) ? diff : [];
}

export function parseIndustryFlowResponse(payload: unknown): IndustryFlowRow[] {
  return rowsFrom(payload).flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const industryCode = String(row.f12 ?? '').trim();
    if (!industryCode) return [];
    return [{
      industryCode,
      industryName: String(row.f14 ?? '').trim(),
      changePct1d: finiteOrNull(row.f3) ?? 0,
      mainNet1d: finiteOrNull(row.f62) ?? 0,
      mainRatio1d: finiteOrNull(row.f184) ?? 0,
      mainNet5d: finiteOrNull(row.f164),
      mainRatio5d: finiteOrNull(row.f165),
      mainNet10d: finiteOrNull(row.f174),
      mainRatio10d: finiteOrNull(row.f175),
      leadingStockCode: row.f204 == null || row.f204 === '-' ? null : String(row.f204),
    }];
  });
}

export function parseMultiDayCapitalFlowResponse(payload: unknown, _period: 3 | 5 | 10): MultiDayCapitalFlow[] {
  return rowsFrom(payload).flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const code = String(row.f12 ?? '').trim();
    if (!code) return [];
    return [{
      code,
      changePct3d: finiteOrNull(row.f127), mainNet3d: finiteOrNull(row.f267), mainRatio3d: finiteOrNull(row.f268),
      changePct5d: finiteOrNull(row.f109), mainNet5d: finiteOrNull(row.f164), mainRatio5d: finiteOrNull(row.f165),
      changePct10d: finiteOrNull(row.f160), mainNet10d: finiteOrNull(row.f174), mainRatio10d: finiteOrNull(row.f175),
    }];
  });
}

export function parseBenchmarkKlineResponse(payload: unknown): StockKLine[] {
  const data = payload && typeof payload === 'object' ? (payload as { data?: { klines?: unknown } }).data : undefined;
  if (!Array.isArray(data?.klines)) return [];
  return data.klines.flatMap(value => {
    const parts = String(value).split(',');
    if (parts.length < 7 || !parts[0]) return [];
    return [{ date: parts[0], open: Number(parts[1]) || 0, close: Number(parts[2]) || 0,
      high: Number(parts[3]) || 0, low: Number(parts[4]) || 0, volume: Number(parts[5]) || 0,
      amount: Number(parts[6]) || 0 }];
  });
}

export function parseHistoricalCapitalFlowResponse(payload: unknown): HistoricalCapitalFlowPoint[] {
  const data = payload && typeof payload === 'object' ? (payload as { data?: { klines?: unknown } }).data : undefined;
  if (!Array.isArray(data?.klines)) return [];
  return data.klines.flatMap(value => {
    const parts = String(value).split(',');
    if (parts.length < 5 || !parts[0]) return [];
    return [{ date: parts[0], mainNet: Number(parts[1]) || 0, largeNet: Number(parts[4]) || 0,
      superLargeNet: Number(parts[5]) || 0, mainRatio: Number(parts[6]) || 0 }];
  });
}

function xhrJson(url: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('invalid json')); }
    };
    xhr.onerror = () => reject(new Error('market data request failed'));
    xhr.ontimeout = () => reject(new Error('market data request timed out'));
    xhr.send();
  });
}

async function fetchResult<T>(source: string, url: string, parse: (payload: unknown) => T, request: RequestJson): Promise<MarketDataResult<T>> {
  try {
    const data = parse(await request(url, 12_000));
    return { data, meta: createMarketDataMeta({ source, mode: 'realtime', status: 'success', asOf: currentMarketDataTime() }) };
  } catch (error) {
    return { data: parse(null), meta: createMarketDataMeta({ source, mode: 'realtime', status: 'error', asOf: currentMarketDataTime(), error: error instanceof Error ? error.message : String(error) }) };
  }
}

export function fetchIndustryFlows(request: RequestJson = xhrJson): Promise<MarketDataResult<IndustryFlowRow[]>> {
  const url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=500&po=1&np=1&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f12,f14,f3,f62,f184,f164,f165,f174,f175,f204';
  // push2 网络抖动时自动切换 push2his/push2delay 备用域名重试
  const failover: RequestJson = (_url, timeoutMs) => requestWithEastmoneyFailover(url, request, timeoutMs);
  return fetchResult('东方财富行业资金流', url, parseIndustryFlowResponse, failover);
}

export function fetchMultiDayCapitalFlows(period: 3 | 5 | 10, request: RequestJson = xhrJson): Promise<MarketDataResult<MultiDayCapitalFlow[]>> {
  const config = {
    3: { fid: 'f267', fields: 'f12,f14,f2,f127,f267,f268' },
    5: { fid: 'f164', fields: 'f12,f14,f2,f109,f164,f165' },
    10: { fid: 'f174', fields: 'f12,f14,f2,f160,f174,f175' },
  } as const;
  const fs = 'm:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2';
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=6000&po=1&np=1&fltt=2&invt=2&fid=${config[period].fid}&fs=${fs}&fields=${config[period].fields}`;
  const failover: RequestJson = (_url, timeoutMs) => requestWithEastmoneyFailover(url, request, timeoutMs);
  return fetchResult(`东方财富${period}日个股资金流`, url, payload => parseMultiDayCapitalFlowResponse(payload, period), failover);
}

export function fetchCsi300Klines(days = 300, request: RequestJson = xhrJson): Promise<MarketDataResult<StockKLine[]>> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000300&klt=101&fqt=1&lmt=${Math.min(days, 1000)}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57`;
  return fetchResult('东方财富沪深300日线', url, parseBenchmarkKlineResponse, request);
}

export function fetchHistoricalCapitalFlow(code: string, days = 300, request: RequestJson = xhrJson): Promise<MarketDataResult<HistoricalCapitalFlowPoint[]>> {
  const secid = `${code.startsWith('6') ? 1 : 0}.${code}`;
  const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid=${secid}&lmt=${Math.min(days, 1000)}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63`;
  return fetchResult('东方财富个股历史资金流', url, parseHistoricalCapitalFlowResponse, request);
}