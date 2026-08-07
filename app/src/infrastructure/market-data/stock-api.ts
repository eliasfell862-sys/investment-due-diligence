/**
 * A-Share Market Data API
 *
 * Uses free public endpoints (新浪/东方财富) accessible from browser.
 * No API key required. Rate-limited on client side.
 */

import { emSecid, jsonp } from './common';
import { buildSecurityMaster, type SecurityClassificationStatus, type SecurityMasterProvenance } from './security-master';
import { createMarketDataMeta, currentMarketDataTime, type MarketDataResult } from './market-data-meta';

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
  dividendPerShare: number; // 近12个月每股派息(元/股)，评分器用现价折算股息率
  totalCap: number;
  floatCap: number;
}

// ── 腾讯实时行情 (Script Tag Injection — CORS-free) ──

function tencentCode(code: string): string {
  return (code.startsWith('6') ? 'sh' : 'sz') + code;
}

const QUOTE_RETRY_DELAYS_MS = [600, 1800] as const;  // 退避重试：最多 3 次尝试

export async function fetchStockQuotes(codes: string[]): Promise<StockQuote[]> {
  if (codes.length === 0) return [];

  let lastError: unknown;
  for (let attempt = 0; attempt <= QUOTE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, QUOTE_RETRY_DELAYS_MS[attempt - 1]!));
    }
    try {
      const tcCodes = codes.map(tencentCode).join(',');
      const url = `https://qt.gtimg.cn/q=${tcCodes}`;

      const text = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 12000);
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.onload = () => { clearTimeout(timer); resolve(xhr.responseText); };
        xhr.onerror = () => { clearTimeout(timer); reject(new Error('xhr error')); };
        xhr.ontimeout = () => { clearTimeout(timer); reject(new Error('timeout')); };
        xhr.send();
      });

      return parseTencentResponse(text, codes);
    } catch (error) {
      lastError = error;
    }
  }
  // 重试耗尽后上抛错误，交由调用方（realtime store 退避调度、雷达错误收集等）处理
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseTencentResponse(text: string, codes: string[]): StockQuote[] {
  const results: StockQuote[] = [];
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const tcCode = tencentCode(code);
    const pattern = new RegExp(`v_${tcCode}="([^"]*)"`);
    const match = text.match(pattern);
    if (!match) continue;

    const parts = match[1].split('~');
    if (parts.length < 30) continue;

    const name = parts[1];
    const price = parseFloat(parts[3]) || 0;
    const preClose = parseFloat(parts[4]) || price;
    const change = price - preClose;

    results.push({
      code,
      name,
      market: code.startsWith('6') ? 'sh' : 'sz',
      price,
      change,
      changePct: preClose > 0 ? (change / preClose) * 100 : 0,
      open: parseFloat(parts[5]) || 0,
      high: parseFloat(parts[33]) || 0,
      low: parseFloat(parts[34]) || 0,
      volume: parseFloat(parts[6]) || 0,
      amount: parseFloat(parts[37]) || 0,
      preClose,
      turnover: parseFloat(parts[38]) || 0,
      pe: parseFloat(parts[39]) || 0,
      pb: parseFloat(parts[46]) || 0,
      totalShares: 0,
      floatShares: 0,
      totalCap: parseFloat(parts[45]) || 0,
      floatCap: 0,
    });
  }
  return results;
}

/** @deprecated use fetchStockQuotes */
export const fetchSinaQuotes = fetchStockQuotes;

// ── 东方财富 K 线 API ──

// ── 腾讯 K 线 API (XHR — CORS-free) ──

function tencentCodeForKline(code: string): string {
  return (code.startsWith('6') ? 'sh' : 'sz') + code;
}

export function parseTencentKLineResponse(text: string, tcCode: string): StockKLine[] {
  try {
    const data = JSON.parse(text);
    const node = data?.data?.[tcCode] ?? {};
    const qfqRows = Array.isArray(node.qfqday) ? node.qfqday : [];
    const dayRows = Array.isArray(node.day) ? node.day : [];
    const rows = qfqRows.length > 0 ? qfqRows : dayRows;

    return rows.map((row: string[]) => ({
      date: row[0] || '',
      open: Number.parseFloat(row[1]) || 0,
      close: Number.parseFloat(row[2]) || 0,
      high: Number.parseFloat(row[3]) || 0,
      low: Number.parseFloat(row[4]) || 0,
      volume: Number.parseFloat(row[5]) || 0,
      amount: Number.parseFloat(row[6]) || 0,  // 腾讯第 7 列为成交额
    }));
  } catch {
    return [];
  }
}

export async function fetchEastmoneyKLine(
  code: string,
  days: number = 250,
  options: { requestText?: (url: string, timeoutMs: number) => Promise<string | null> } = {},
): Promise<StockKLine[]> {
  // Try Tencent first
  const tcCode = tencentCodeForKline(code);
  const requestText = options.requestText ?? xhrGet;

  // Approach 0: same-origin Sina proxy (Vite proxy locally, Vercel rewrite in production)
  try {
    const proxyUrl = '/api/market/kline?symbol=' + tcCode + '&scale=240&ma=no&datalen=' + Math.min(days, 300);
    const proxyText = await requestText(proxyUrl, 12000);
    if (proxyText) {
      const data = JSON.parse(proxyText);
      if (Array.isArray(data) && data.length > 0) {
        return data.map((row: any) => ({
          date: row.day || '',
          open: parseFloat(row.open) || 0,
          close: parseFloat(row.close) || 0,
          high: parseFloat(row.high) || 0,
          low: parseFloat(row.low) || 0,
          volume: parseFloat(row.volume) || 0,
          amount: 0,
        }));
      }
    }
  } catch {}

  // Approach 1: Tencent K-line
  try {
    const url1 = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tcCode},day,,,${days},qfq`;
    const text1 = await requestText(url1, 10000);
    if (text1) {
      const result = parseTencentKLineResponse(text1, tcCode);
      if (result.length > 0) return result;
    }
  } catch {}

  // Approach 2: Sina K-line (public, no auth needed)
  try {
    const sinaCode = (code.startsWith('6') ? 'sh' : 'sz') + code;
    const url2 = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaCode}&scale=240&ma=no&datalen=${Math.min(days, 300)}`;
    const text2 = await requestText(url2, 10000);
    if (text2) {
      const data = JSON.parse(text2);
      if (Array.isArray(data) && data.length > 0) {
        return data.map((row: any) => ({
          date: row.day || '',
          open: parseFloat(row.open) || 0,
          close: parseFloat(row.close) || 0,
          high: parseFloat(row.high) || 0,
          low: parseFloat(row.low) || 0,
          volume: parseFloat(row.volume) || 0,
          amount: 0,
        }));
      }
    }
  } catch {}

  return [];
}

function xhrGet(url: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.onload = () => { clearTimeout(timer); resolve(xhr.responseText); };
    xhr.onerror = () => { clearTimeout(timer); resolve(null); };
    xhr.ontimeout = () => { clearTimeout(timer); resolve(null); };
    xhr.send();
  });
}

// ── 东方财富基本面数据 ──
//
// 字段映射已对照 efinance 库的 EASTMONEY_STOCK_BASE_INFO_FIELDS 并用真实 API
// 响应验证（2026-08，贵州茅台）：
//   f162=市盈率(动) f164=市盈率(TTM) f167=市净率 f173=ROE
//   f186=毛利率% f187=净利率% f116=总市值(元) f117=流通市值(元)
// 必须带 fltt=2&invt=2，否则返回放大 100 倍的整数。
// 增长率/负债率/流动比率 push2 不提供，由 F10 财务接口补充（见下方）。

function localToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export async function fetchEastmoneyBasic(code: string): Promise<DailyBasicData | null> {
  const secid = emSecid(code);
  const fields = 'f162,f164,f167,f173,f186,f187,f116,f117';
  const N = (v: any) => Number(v) || 0;

  // push2 在部分网络环境下不可达，回退到延迟镜像 push2delay（基本面为季度数据，延迟无影响）
  let d: any = null;
  for (const host of ['push2.eastmoney.com', 'push2delay.eastmoney.com']) {
    try {
      const text = await xhrGet(`https://${host}/api/qt/stock/get?secid=${secid}&fltt=2&invt=2&fields=${fields}`, 6000);
      if (!text) continue;
      const parsed = JSON.parse(text)?.data;
      if (parsed) { d = parsed; break; }
    } catch { /* try next host */ }
  }
  if (!d) return null;

  try {
    const basic: DailyBasicData = {
      code,
      date: localToday(),
      pe: N(d.f162),               // 市盈率(动)
      peTTM: N(d.f164),            // 市盈率(TTM)
      pb: N(d.f167),               // 市净率
      ps: 0,                       // push2 不提供
      pcf: 0,                      // push2 不提供
      roe: N(d.f173),              // ROE（最近报告期）
      roa: 0,                      // 由 F10 补充
      grossMargin: N(d.f186),      // 毛利率%
      netMargin: N(d.f187),        // 净利率%
      revenueGrowth: 0,            // 由 F10 补充
      profitGrowth: 0,             // 由 F10 补充
      debtRatio: 0,                // 由 F10 补充
      currentRatio: 0,             // 由 F10 补充
      dividendPerShare: 0,         // 由 F10 分红融资补充
      totalCap: N(d.f116) / 1e8,   // 总市值（元→亿）
      floatCap: N(d.f117) / 1e8,   // 流通市值（元→亿）
    };

    await enrichWithF10Indicators(code, basic);
    await enrichWithF10Dividend(code, basic);
    return basic;
  } catch {
    return null;
  }
}

// 东财 F10 主要财务指标（最新报告期）。emweb 无 CORS 头，必须走同源代理：
// 开发环境走 vite proxy，生产环境走 vercel rewrite（均为 /api/emf10）。
// 失败时静默跳过，push2 已提供的字段不受影响。
async function enrichWithF10Indicators(code: string, basic: DailyBasicData): Promise<void> {
  const N = (v: any) => Number(v) || 0;
  try {
    const prefix = code.startsWith('6') ? 'SH' : 'SZ';
    const url = `/api/emf10/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${prefix}${code}`;
    const text = await xhrGet(url, 8000);
    if (!text) return;
    const rows = JSON.parse(text)?.data;
    if (!Array.isArray(rows) || rows.length === 0) return;
    const latest = rows[0];

    basic.revenueGrowth = N(latest.TOTALOPERATEREVETZ);  // 营业总收入同比%
    basic.profitGrowth = N(latest.PARENTNETPROFITTZ);    // 归母净利润同比%
    basic.debtRatio = N(latest.ZCFZL);                   // 资产负债率%
    basic.currentRatio = N(latest.LD);                   // 流动比率
    basic.roa = N(latest.ZZCJLL);                        // 总资产净利率%
  } catch { /* F10 不可用时不影响已有字段 */ }
}

// 东财 F10 分红融资 fhyx：统计近 12 个月（按除权除息日）已实施分红的每股派息合计。
// "10派X元" + ASSIGN_PROGRESS=实施方案 才算已派发；预披露/预案不计入。
export function sumF10TrailingDividendPerShare(rows: readonly unknown[], today: string): number {
  const nowMs = new Date(today + 'T00:00:00+08:00').getTime();
  const twelveMonthsAgoMs = nowMs - 365 * 24 * 60 * 60 * 1000;
  let total = 0;
  for (const raw of rows) {
    const row = raw as Record<string, unknown> | null;
    if (!row || row.ASSIGN_PROGRESS !== '实施方案') continue;   // 实施方案
    const exDate = String(row.EX_DIVIDEND_DATE ?? '');
    if (!exDate) continue;
    const exMs = new Date(exDate.slice(0, 10) + 'T00:00:00+08:00').getTime();
    if (exMs < twelveMonthsAgoMs || exMs > nowMs) continue;
    const match = String(row.IMPL_PLAN_PROFILE ?? '').match(/10派([\d.]+)元/);
    if (!match) continue;
    total += parseFloat(match[1]) / 10;
  }
  return total;
}

// 东财 F10 分红融资接口。emweb 无 CORS 头，必须走同源代理 /api/emf10。
// 失败时静默跳过，股息率由评分器用现价折算，缺省走回退分支。
async function enrichWithF10Dividend(code: string, basic: DailyBasicData): Promise<void> {
  try {
    const prefix = code.startsWith('6') ? 'SH' : 'SZ';
    const url = `/api/emf10/PC_HSF10/BonusFinancing/PageAjax?code=${prefix}${code}`;
    const text = await xhrGet(url, 8000);
    if (!text) return;
    const data = JSON.parse(text) as { fhyx?: unknown[] };
    if (!Array.isArray(data.fhyx) || data.fhyx.length === 0) return;
    const total = sumF10TrailingDividendPerShare(data.fhyx, localToday());
    if (total > 0) basic.dividendPerShare = total;
  } catch { /* F10 不可用时不影响已有字段 */ }
}

export interface AStockDirectoryItem {
  code: string;
  name: string;
  industry: string;
  classificationStatus?: SecurityClassificationStatus;
  classificationStandard?: string | null;
  classificationSource?: string;
  classificationVersion?: string;
  classificationAsOf?: string;
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

export async function fetchAllAStocksResult(
  options: FetchAllAStocksOptions = {},
): Promise<MarketDataResult<AStockDirectoryItem[]>> {
  const {
    pageSize = 500,
    maxPages = 100,
    request = fetchStockDirectoryJson,
    fallbackRequest = fetchStockDirectoryJsonp,
  } = options;
  const stocks = new Map<string, AStockDirectoryItem>();
  let total = Number.POSITIVE_INFINITY;
  let providerError = '';

  for (let page = 1; page <= maxPages && stocks.size < total; page += 1) {
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${A_STOCK_FS}&fields=f12,f14,f100`;
    let payload: any;

    try {
      payload = await request(url);
    } catch {
      try {
        payload = await fallbackRequest(url);
      } catch (error) {
        providerError = error instanceof Error ? error.message : String(error);
        if (stocks.size > 0) break;
        return {
          data: [],
          meta: createMarketDataMeta({
            source: 'Eastmoney A-share directory', mode: 'realtime', status: 'error', error: providerError,
          }),
        };
      }
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
      const rawIndustry = String(row?.f100 ?? '').trim();
      const industry = /^-+$/.test(rawIndustry) ? '' : rawIndustry;
      stocks.set(code, {
        code,
        name,
        industry: industry || '\u672a\u5206\u7c7b',
        classificationStatus: industry ? 'official' : 'unclassified',
        classificationStandard: industry ? 'eastmoney' : null,
        classificationSource: 'eastmoney',
      });
    }

    if (rows.length === 0 || (rows.length < pageSize && stocks.size >= total)) {
      break;
    }
  }

  const data = [...stocks.values()].sort((a, b) => a.code.localeCompare(b.code));
  const incomplete = Number.isFinite(total) && data.length < total;
  const error = providerError || (incomplete ? `Provider returned ${data.length} of ${total} securities` : undefined);
  return {
    data,
    meta: createMarketDataMeta({
      source: 'Eastmoney A-share directory', mode: 'realtime',
      status: data.length === 0 ? 'empty' : error ? 'partial' : 'success',
      asOf: data.length > 0 ? currentMarketDataTime() : undefined,
      error,
    }),
  };
}

export async function fetchAllAStocks(
  options: FetchAllAStocksOptions = {},
): Promise<AStockDirectoryItem[]> {
  return (await fetchAllAStocksResult(options)).data;
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

export function getOfficialIndustries(stocks: AStockDirectoryItem[]): string[] {
  return [...new Set(
    stocks
      .filter((stock) => stock.classificationStatus === 'official' || stock.classificationStatus === 'inferred')
      .map((stock) => stock.industry)
      .filter((industry) => industry && industry !== '\u672a\u5206\u7c7b'),
  )].sort();
}

// ── Stock Directory Loader (local JSON → API → embedded fallback) ──

export interface StockDirectoryData {
  generatedAt: string;
  source: string;
  totalCount: number;
  stocks: AStockDirectoryItem[];
}

export function normalizeStockDirectoryData(data: StockDirectoryData): AStockDirectoryItem[] {
  const usesHeuristicClassification = data.source.toLowerCase().includes('heuristic');
  return data.stocks.map((stock) => {
    const rawIndustry = stock.industry.trim();
    const industry = /^-+$/.test(rawIndustry) ? '' : rawIndustry;
    return {
      ...stock,
      industry: industry || '\u672a\u5206\u7c7b',
      classificationStatus: !industry ? 'unclassified' : usesHeuristicClassification ? 'inferred' : 'official',
      classificationStandard: !industry ? null : usesHeuristicClassification ? 'heuristic' : data.source,
      classificationSource: usesHeuristicClassification ? 'heuristic' : data.source,
      classificationVersion: `${data.source}-${data.generatedAt}`,
      classificationAsOf: data.generatedAt,
    };
  });
}

export function mergeStockDirectories(
  localStocks: AStockDirectoryItem[],
  providerStocks: AStockDirectoryItem[],
): AStockDirectoryItem[] {
  const merged = new Map(
    localStocks.map((stock) => [stock.code, { ...stock }]),
  );

  for (const providerStock of providerStocks) {
    const localStock = merged.get(providerStock.code);
    const providerIndustry = providerStock.industry.trim();
    merged.set(providerStock.code, providerIndustry ? {
      ...localStock,
      ...providerStock,
      name: providerStock.name || localStock?.name || providerStock.code,
      industry: providerIndustry,
      classificationStatus: 'official',
      classificationStandard: providerStock.classificationStandard ?? 'eastmoney',
      classificationSource: providerStock.classificationSource ?? 'eastmoney',
    } : {
      ...localStock,
      code: providerStock.code,
      name: providerStock.name || localStock?.name || providerStock.code,
      industry: localStock?.industry || '\u672a\u5206\u7c7b',
      classificationStatus: localStock?.classificationStatus ?? 'unclassified',
      classificationStandard: localStock?.classificationStandard ?? null,
      classificationSource: localStock?.classificationSource ?? 'unavailable',
    });
  }

  return [...merged.values()].sort((a, b) => a.code.localeCompare(b.code));
}


function enrichStockDirectory(
  stocks: AStockDirectoryItem[],
  provenance: SecurityMasterProvenance,
): AStockDirectoryItem[] {
  return buildSecurityMaster(stocks, provenance).map((record) => ({
    ...record,
    industry: record.industry ?? '\u672a\u5206\u7c7b',
  }));
}

export interface LoadStockDirectoryResultOptions {
  loadLocal?: () => Promise<StockDirectoryData | null>;
  loadProvider?: () => Promise<MarketDataResult<AStockDirectoryItem[]>>;
}

async function loadLocalStockDirectory(): Promise<StockDirectoryData | null> {
  const response = await fetch('/data/a-share-directory.json');
  if (!response.ok) return null;
  const data = await response.json() as StockDirectoryData;
  return data.stocks?.length > 0 ? data : null;
}

export async function loadStockDirectoryResult(
  options: LoadStockDirectoryResultOptions = {},
): Promise<MarketDataResult<AStockDirectoryItem[]>> {
  const loadLocal = options.loadLocal ?? loadLocalStockDirectory;
  const loadProvider = options.loadProvider ?? (() => fetchAllAStocksResult());
  let localData: StockDirectoryData | null = null;
  let localFallback: AStockDirectoryItem[] | null = null;

  try {
    localData = await loadLocal();
    if (localData) {
      localFallback = normalizeStockDirectoryData(localData);
      if (!localData.source.toLowerCase().includes('heuristic')) {
        return {
          data: enrichStockDirectory(localFallback, {
            directorySource: localData.source, classificationSource: localData.source,
            asOf: localData.generatedAt, classificationVersion: `${localData.source}-${localData.generatedAt}`,
          }),
          meta: createMarketDataMeta({
            source: localData.source, mode: 'cached', status: 'success', asOf: localData.generatedAt,
          }),
        };
      }
    }
  } catch { /* provider or embedded fallback can still recover */ }

  let providerResult: MarketDataResult<AStockDirectoryItem[]>;
  try {
    providerResult = await loadProvider();
  } catch (error) {
    providerResult = {
      data: [],
      meta: createMarketDataMeta({
        source: 'Eastmoney A-share directory', mode: 'realtime', status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }

  if (providerResult.data.length > 0) {
    const merged = localFallback
      ? mergeStockDirectories(localFallback, providerResult.data)
      : providerResult.data;
    const asOf = providerResult.meta.asOf ?? currentMarketDataTime();
    return {
      data: enrichStockDirectory(merged, {
        directorySource: localFallback ? 'local-directory + eastmoney' : 'eastmoney',
        classificationSource: 'eastmoney', asOf,
        classificationVersion: `eastmoney-${asOf.slice(0, 10)}`,
      }),
      meta: createMarketDataMeta({
        source: localFallback ? 'Local directory + Eastmoney classification' : 'Eastmoney A-share directory',
        mode: localFallback ? 'cached' : 'realtime',
        status: providerResult.meta.status === 'partial' ? 'partial' : 'success',
        asOf,
        error: providerResult.meta.error,
      }),
    };
  }

  if (localFallback) {
    return {
      data: enrichStockDirectory(localFallback, {
        directorySource: localData?.source ?? 'local-directory', classificationSource: 'heuristic',
        asOf: localData?.generatedAt ?? 'unknown',
        classificationVersion: `${localData?.source ?? 'heuristic'}-${localData?.generatedAt ?? 'unknown'}`,
      }),
      meta: createMarketDataMeta({
        source: 'Local directory (inferred classification)', mode: 'cached', status: 'success',
        asOf: localData?.generatedAt,
      }),
    };
  }

  return {
    data: enrichStockDirectory(EMBEDDED_A_STOCKS, {
      directorySource: 'embedded', classificationSource: 'unavailable',
      asOf: 'unknown', classificationVersion: 'unavailable',
    }),
    meta: createMarketDataMeta({
      source: 'Embedded A-share snapshot', mode: 'static', status: 'stale',
      error: providerResult.meta.error || 'Local and official directories unavailable',
    }),
  };
}

export async function loadStockDirectory(): Promise<AStockDirectoryItem[]> {
  return (await loadStockDirectoryResult()).data;
}
// ── Embedded A-stock directory fallback (100 major stocks) ──

export const EMBEDDED_A_STOCKS: AStockDirectoryItem[] = [
  {code:"000001",name:"平安银行",industry:"银行"},{code:"000002",name:"万科A",industry:"房地产"},{code:"000063",name:"中兴通讯",industry:"通信设备"},{code:"000100",name:"TCL科技",industry:"电子"},{code:"000157",name:"中联重科",industry:"机械设备"},{code:"000333",name:"美的集团",industry:"家电"},{code:"000338",name:"潍柴动力",industry:"汽车"},{code:"000425",name:"徐工机械",industry:"机械设备"},{code:"000538",name:"云南白药",industry:"医药"},{code:"000568",name:"泸州老窖",industry:"白酒"},{code:"000625",name:"长安汽车",industry:"汽车"},{code:"000651",name:"格力电器",industry:"家电"},{code:"000725",name:"京东方A",industry:"电子"},{code:"000776",name:"广发证券",industry:"证券"},{code:"000858",name:"五粮液",industry:"白酒"},{code:"000876",name:"新希望",industry:"农牧"},{code:"000895",name:"双汇发展",industry:"食品"},{code:"002007",name:"华兰生物",industry:"医药"},{code:"002049",name:"紫光国微",industry:"半导体"},{code:"002142",name:"宁波银行",industry:"银行"},{code:"002230",name:"科大讯飞",industry:"人工智能"},{code:"002241",name:"歌尔股份",industry:"电子"},{code:"002304",name:"洋河股份",industry:"白酒"},{code:"002352",name:"顺丰控股",industry:"物流"},{code:"002415",name:"海康威视",industry:"安防"},{code:"002475",name:"立讯精密",industry:"电子"},{code:"002594",name:"比亚迪",industry:"汽车"},{code:"002714",name:"牧原股份",industry:"农牧"},{code:"300015",name:"爱尔眼科",industry:"医疗"},{code:"300059",name:"东方财富",industry:"互联网金融"},{code:"300122",name:"智飞生物",industry:"医药"},{code:"300124",name:"汇川技术",industry:"自动化"},{code:"300274",name:"阳光电源",industry:"光伏"},{code:"300750",name:"宁德时代",industry:"电池"},{code:"600000",name:"浦发银行",industry:"银行"},{code:"600009",name:"上海机场",industry:"交通运输"},{code:"600016",name:"民生银行",industry:"银行"},{code:"600028",name:"中国石化",industry:"石油"},{code:"600030",name:"中信证券",industry:"证券"},{code:"600031",name:"三一重工",industry:"机械设备"},{code:"600036",name:"招商银行",industry:"银行"},{code:"600048",name:"保利发展",industry:"房地产"},{code:"600050",name:"中国联通",industry:"通信"},{code:"600085",name:"同仁堂",industry:"医药"},{code:"600104",name:"上汽集团",industry:"汽车"},{code:"600111",name:"北方稀土",industry:"稀土"},{code:"600150",name:"中国船舶",industry:"船舶"},{code:"600196",name:"复星医药",industry:"医药"},{code:"600276",name:"恒瑞医药",industry:"医药"},{code:"600309",name:"万华化学",industry:"化工"},{code:"600406",name:"国电南瑞",industry:"电力设备"},{code:"600436",name:"片仔癀",industry:"医药"},{code:"600438",name:"通威股份",industry:"光伏"},{code:"600519",name:"贵州茅台",industry:"白酒"},{code:"600570",name:"恒生电子",industry:"金融科技"},{code:"600585",name:"海螺水泥",industry:"建材"},{code:"600588",name:"用友网络",industry:"软件"},{code:"600690",name:"海尔智家",industry:"家电"},{code:"600809",name:"山西汾酒",industry:"白酒"},{code:"600837",name:"海通证券",industry:"证券"},{code:"600887",name:"伊利股份",industry:"食品"},{code:"600893",name:"航发动力",industry:"军工"},{code:"600900",name:"长江电力",industry:"电力"},{code:"601006",name:"大秦铁路",industry:"铁路"},{code:"601012",name:"隆基绿能",industry:"光伏"},{code:"601066",name:"中信建投",industry:"证券"},{code:"601088",name:"中国神华",industry:"煤炭"},{code:"601111",name:"中国国航",industry:"航空"},{code:"601138",name:"工业富联",industry:"电子"},{code:"601166",name:"兴业银行",industry:"银行"},{code:"601211",name:"国泰君安",industry:"证券"},{code:"601288",name:"农业银行",industry:"银行"},{code:"601318",name:"中国平安",industry:"保险"},{code:"601328",name:"交通银行",industry:"银行"},{code:"601390",name:"中国中铁",industry:"建筑"},{code:"601398",name:"工商银行",industry:"银行"},{code:"601601",name:"中国太保",industry:"保险"},{code:"601628",name:"中国人寿",industry:"保险"},{code:"601668",name:"中国建筑",industry:"建筑"},{code:"601688",name:"华泰证券",industry:"证券"},{code:"601728",name:"中国电信",industry:"通信"},{code:"601766",name:"中国中车",industry:"轨交"},{code:"601800",name:"中国交建",industry:"建筑"},{code:"601857",name:"中国石油",industry:"石油"},{code:"601878",name:"浙商证券",industry:"证券"},{code:"601888",name:"中国中免",industry:"旅游"},{code:"601899",name:"紫金矿业",industry:"矿业"},{code:"601919",name:"中远海控",industry:"航运"},{code:"601939",name:"建设银行",industry:"银行"},{code:"601985",name:"中国核电",industry:"核电"},{code:"601988",name:"中国银行",industry:"银行"},{code:"603019",name:"中科曙光",industry:"计算机"},{code:"603259",name:"药明康德",industry:"医药"},{code:"603288",name:"海天味业",industry:"食品"},{code:"603501",name:"韦尔股份",industry:"半导体"},{code:"603986",name:"兆易创新",industry:"半导体"},{code:"688111",name:"金山办公",industry:"软件"},{code:"688981",name:"中芯国际",industry:"半导体"},
];
