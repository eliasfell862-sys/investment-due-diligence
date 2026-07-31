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

// ── 腾讯实时行情 (Script Tag Injection — CORS-free) ──

function tencentCode(code: string): string {
  return (code.startsWith('6') ? 'sh' : 'sz') + code;
}

export async function fetchStockQuotes(codes: string[]): Promise<StockQuote[]> {
  if (codes.length === 0) return [];
  try {
    const tcCodes = codes.map(tencentCode).join(',');
    const url = `https://qt.gtimg.cn/q=${tcCodes}`;

    // Inject script tag — Tencent returns var v_sh600519="..." which sets window globals
    const text = await new Promise<string>((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); reject(new Error('timeout')); }, 12000);
      script.onload = () => { clearTimeout(timer); script.remove(); };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('load error')); };
      // Capture: override script execution to get the text
      const originalSrc = script.setAttribute;
      // Actually, use fetch with no-cors mode as a fallback
      // For now, use the reliable approach: XMLHttpRequest
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.onload = () => { clearTimeout(timer); resolve(xhr.responseText); };
      xhr.onerror = () => { clearTimeout(timer); reject(new Error('xhr error')); };
      xhr.send();
    });

    return parseTencentResponse(text, codes);
  } catch {
    return [];
  }
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

// ── Stock Directory Loader (local JSON → API → embedded fallback) ──

export interface StockDirectoryData {
  generatedAt: string;
  source: string;
  totalCount: number;
  stocks: AStockDirectoryItem[];
}

export async function loadStockDirectory(): Promise<AStockDirectoryItem[]> {
  // Strategy 1: Read local JSON file (BaoStock-generated, no CORS)
  try {
    const resp = await fetch('/data/a-share-directory.json');
    if (resp.ok) {
      const data: StockDirectoryData = await resp.json();
      if (data.stocks?.length > 0) return data.stocks;
    }
  } catch { /* continue */ }

  // Strategy 2: Fetch from Eastmoney API
  try {
    const apiStocks = await fetchAllAStocks({ maxPages: 5 });
    if (apiStocks.length > 0) return apiStocks;
  } catch { /* continue */ }

  // Strategy 3: Embedded fallback
  return EMBEDDED_A_STOCKS;
}

// ── Embedded A-stock directory fallback (100 major stocks) ──

export const EMBEDDED_A_STOCKS: AStockDirectoryItem[] = [
  {code:"000001",name:"平安银行",industry:"银行"},{code:"000002",name:"万科A",industry:"房地产"},{code:"000063",name:"中兴通讯",industry:"通信设备"},{code:"000100",name:"TCL科技",industry:"电子"},{code:"000157",name:"中联重科",industry:"机械设备"},{code:"000333",name:"美的集团",industry:"家电"},{code:"000338",name:"潍柴动力",industry:"汽车"},{code:"000425",name:"徐工机械",industry:"机械设备"},{code:"000538",name:"云南白药",industry:"医药"},{code:"000568",name:"泸州老窖",industry:"白酒"},{code:"000625",name:"长安汽车",industry:"汽车"},{code:"000651",name:"格力电器",industry:"家电"},{code:"000725",name:"京东方A",industry:"电子"},{code:"000776",name:"广发证券",industry:"证券"},{code:"000858",name:"五粮液",industry:"白酒"},{code:"000876",name:"新希望",industry:"农牧"},{code:"000895",name:"双汇发展",industry:"食品"},{code:"002007",name:"华兰生物",industry:"医药"},{code:"002049",name:"紫光国微",industry:"半导体"},{code:"002142",name:"宁波银行",industry:"银行"},{code:"002230",name:"科大讯飞",industry:"人工智能"},{code:"002241",name:"歌尔股份",industry:"电子"},{code:"002304",name:"洋河股份",industry:"白酒"},{code:"002352",name:"顺丰控股",industry:"物流"},{code:"002415",name:"海康威视",industry:"安防"},{code:"002475",name:"立讯精密",industry:"电子"},{code:"002594",name:"比亚迪",industry:"汽车"},{code:"002714",name:"牧原股份",industry:"农牧"},{code:"300015",name:"爱尔眼科",industry:"医疗"},{code:"300059",name:"东方财富",industry:"互联网金融"},{code:"300122",name:"智飞生物",industry:"医药"},{code:"300124",name:"汇川技术",industry:"自动化"},{code:"300274",name:"阳光电源",industry:"光伏"},{code:"300750",name:"宁德时代",industry:"电池"},{code:"600000",name:"浦发银行",industry:"银行"},{code:"600009",name:"上海机场",industry:"交通运输"},{code:"600016",name:"民生银行",industry:"银行"},{code:"600028",name:"中国石化",industry:"石油"},{code:"600030",name:"中信证券",industry:"证券"},{code:"600031",name:"三一重工",industry:"机械设备"},{code:"600036",name:"招商银行",industry:"银行"},{code:"600048",name:"保利发展",industry:"房地产"},{code:"600050",name:"中国联通",industry:"通信"},{code:"600085",name:"同仁堂",industry:"医药"},{code:"600104",name:"上汽集团",industry:"汽车"},{code:"600111",name:"北方稀土",industry:"稀土"},{code:"600150",name:"中国船舶",industry:"船舶"},{code:"600196",name:"复星医药",industry:"医药"},{code:"600276",name:"恒瑞医药",industry:"医药"},{code:"600309",name:"万华化学",industry:"化工"},{code:"600406",name:"国电南瑞",industry:"电力设备"},{code:"600436",name:"片仔癀",industry:"医药"},{code:"600438",name:"通威股份",industry:"光伏"},{code:"600519",name:"贵州茅台",industry:"白酒"},{code:"600570",name:"恒生电子",industry:"金融科技"},{code:"600585",name:"海螺水泥",industry:"建材"},{code:"600588",name:"用友网络",industry:"软件"},{code:"600690",name:"海尔智家",industry:"家电"},{code:"600809",name:"山西汾酒",industry:"白酒"},{code:"600837",name:"海通证券",industry:"证券"},{code:"600887",name:"伊利股份",industry:"食品"},{code:"600893",name:"航发动力",industry:"军工"},{code:"600900",name:"长江电力",industry:"电力"},{code:"601006",name:"大秦铁路",industry:"铁路"},{code:"601012",name:"隆基绿能",industry:"光伏"},{code:"601066",name:"中信建投",industry:"证券"},{code:"601088",name:"中国神华",industry:"煤炭"},{code:"601111",name:"中国国航",industry:"航空"},{code:"601138",name:"工业富联",industry:"电子"},{code:"601166",name:"兴业银行",industry:"银行"},{code:"601211",name:"国泰君安",industry:"证券"},{code:"601288",name:"农业银行",industry:"银行"},{code:"601318",name:"中国平安",industry:"保险"},{code:"601328",name:"交通银行",industry:"银行"},{code:"601390",name:"中国中铁",industry:"建筑"},{code:"601398",name:"工商银行",industry:"银行"},{code:"601601",name:"中国太保",industry:"保险"},{code:"601628",name:"中国人寿",industry:"保险"},{code:"601668",name:"中国建筑",industry:"建筑"},{code:"601688",name:"华泰证券",industry:"证券"},{code:"601728",name:"中国电信",industry:"通信"},{code:"601766",name:"中国中车",industry:"轨交"},{code:"601800",name:"中国交建",industry:"建筑"},{code:"601857",name:"中国石油",industry:"石油"},{code:"601878",name:"浙商证券",industry:"证券"},{code:"601888",name:"中国中免",industry:"旅游"},{code:"601899",name:"紫金矿业",industry:"矿业"},{code:"601919",name:"中远海控",industry:"航运"},{code:"601939",name:"建设银行",industry:"银行"},{code:"601985",name:"中国核电",industry:"核电"},{code:"601988",name:"中国银行",industry:"银行"},{code:"603019",name:"中科曙光",industry:"计算机"},{code:"603259",name:"药明康德",industry:"医药"},{code:"603288",name:"海天味业",industry:"食品"},{code:"603501",name:"韦尔股份",industry:"半导体"},{code:"603986",name:"兆易创新",industry:"半导体"},{code:"688111",name:"金山办公",industry:"软件"},{code:"688981",name:"中芯国际",industry:"半导体"},
];
