/**
 * A-Share Market Data API
 *
 * Uses free public endpoints (新浪/东方财富) accessible from browser.
 * No API key required. Rate-limited on client side.
 */

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

// ── 新浪财经 API ──

function sinaCode(code: string): string {
  return (code.startsWith('6') ? 'sh' : 'sz') + code;
}

export async function fetchSinaQuotes(codes: string[]): Promise<StockQuote[]> {
  const sinaCodes = codes.map(sinaCode).join(',');
  const url = `https://hq.sinajs.cn/list=${sinaCodes}`;

  try {
    const resp = await fetch(url, { headers: { Referer: 'https://finance.sina.com.cn' } });
    const text = await resp.text();

    const results: StockQuote[] = [];
    const lines = text.split('\n').filter(Boolean);

    for (let i = 0; i < lines.length && i < codes.length; i++) {
      const line = lines[i];
      const match = line.match(/"([^"]+)"/);
      if (!match) continue;

      const parts = match[1].split(',');
      if (parts.length < 30) continue;

      results.push({
        code: codes[i],
        name: parts[0],
        market: codes[i].startsWith('6') ? 'sh' : 'sz',
        open: parseFloat(parts[1]) || 0,
        preClose: parseFloat(parts[2]) || 0,
        price: parseFloat(parts[3]) || 0,
        high: parseFloat(parts[4]) || 0,
        low: parseFloat(parts[5]) || 0,
        volume: parseFloat(parts[8]) || 0,
        amount: parseFloat(parts[9]) || 0,
        turnover: parseFloat(parts[38]) || 0,
        pe: parseFloat(parts[39]) || 0,
        pb: parseFloat(parts[42]) || 0,
        totalShares: parseFloat(parts[44]) || 0,
        floatShares: parseFloat(parts[45]) || 0,
        totalCap: parseFloat(parts[46]) || 0,
        floatCap: parseFloat(parts[47]) || 0,
        change: (parseFloat(parts[3]) || 0) - (parseFloat(parts[2]) || 0),
        changePct: 0,
      });
      results[i].changePct = results[i].preClose > 0
        ? (results[i].change / results[i].preClose) * 100
        : 0;
    }

    return results;
  } catch {
    return [];
  }
}

// ── 东方财富 K 线 API ──

function eastmoneySecid(code: string): string {
  return (code.startsWith('6') ? '1.' : '0.') + code;
}

export async function fetchEastmoneyKLine(code: string, days: number = 250): Promise<StockKLine[]> {
  const secid = eastmoneySecid(code);
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
  const secid = eastmoneySecid(code);
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
