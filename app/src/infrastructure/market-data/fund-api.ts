/**
 * Fund Market Data API
 *
 * JSONP-based fund valuation from 天天基金/东方财富/新浪.
 * CORS-free — uses <script> tag injection.
 * Inspired by real-time-fund (hzm0321).
 */

import { jsonp, loadJson, saveJson } from './common';

export interface FundValuation {
  code: string;           // 基金代码 6位
  name: string;           // 基金名称
  nav: number;            // 单位净值
  accNav: number;         // 累计净值
  estimatedNav: number;   // 估算净值
  estimatedChange: number; // 估算涨跌%
  navDate: string;        // 净值日期
  valuationTime: string;  // 估值时间
  type: string;           // 基金类型
}

export interface FundHolding {
  stockCode: string;
  stockName: string;
  ratio: number;          // 占净值比%
  change: number;         // 涨跌幅%
  price: number;          // 最新价
}

export interface FundSearchResult {
  code: string;
  name: string;
  type: string;
}

export interface FundNAVHistory {
  date: string;
  nav: number;
  accNav: number;
  change: number; // 日涨跌%
}

export interface FundPosition {
  code: string;
  shares: number;
  costNav: number;    // 成本净值
  totalCost: number;  // 总成本
}

export interface FundTransaction {
  id: string;
  code: string;
  date: string;
  type: 'buy' | 'sell';
  shares: number;
  nav: number;
  amount: number;
  fee: number;
}

// ── 腾讯基金实时行情 (XHR — CORS-free) ──

export async function fetchFundValuations(codes: string[]): Promise<FundValuation[]> {
  if (codes.length === 0) return [];
  try {
    const tcCodes = codes.map(c => `jj${c}`).join(',');
    const url = `https://qt.gtimg.cn/q=${tcCodes}`;

    const text = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 10000);
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.onload = () => { clearTimeout(timer); resolve(xhr.responseText); };
      xhr.onerror = () => { clearTimeout(timer); reject(new Error('xhr error')); };
      xhr.ontimeout = () => { clearTimeout(timer); reject(new Error('timeout')); };
      xhr.send();
    });

    const results: FundValuation[] = [];
    for (const code of codes) {
      const pattern = new RegExp(`v_jj${code}="([^"]*)"`);
      const match = text.match(pattern);
      if (!match) continue;
      const parts = match[1].split('~');
      // Format: code~name~price~change~empty~nav~accNav~estChange~navDate~
      results.push({
        code,
        name: parts[1] || '',
        nav: parseFloat(parts[5]) || 0,
        accNav: parseFloat(parts[6]) || 0,
        estimatedNav: parseFloat(parts[5]) || 0,
        estimatedChange: parseFloat(parts[7]) || 0,
        navDate: parts[8] || '',
        valuationTime: '',
        type: '',
      });
    }
    return results;
  } catch {
    return [];
  }
}

// ── 东方财富基金搜索 ──

export async function searchFunds(keyword: string): Promise<FundSearchResult[]> {
  try {
    const data = await jsonp<any>(`https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(keyword)}`);
    if (!data || !Array.isArray(data.Datas)) return [];
    return data.Datas.slice(0, 20).map((d: any) => ({
      code: d.CODE,
      name: d.NAME,
      type: d.FundType || '',
    }));
  } catch {
    return [];
  }
}

// ── 东方财富基金持仓 ──

export async function fetchFundHoldings(code: string): Promise<FundHolding[]> {
  try {
    const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${code}&deviceid=Wap&plat=WAP&product=EFund&version=2.0.0`;
    const resp = await fetch(url);
    const data = await resp.json() as any;
    if (!data || data.ErrCode !== 0) return [];
    const holdings = data.Datas?.fundStocks || [];
    return holdings.map((h: any) => ({
      stockCode: h.GPDM || '',
      stockName: h.GPJC || '',
      ratio: parseFloat(h.JZZB) || 0,
      change: 0,
      price: 0,
    }));
  } catch {
    return [];
  }
}

// ── 腾讯行情批量获取 (用于持仓股实时涨跌) ──

export async function fetchTencentQuotes(stockCodes: string[]): Promise<Record<string, { price: number; change: number }>> {
  if (stockCodes.length === 0) return {};
  try {
    // Convert codes: 000001 -> sz000001, 600519 -> sh600519
    const qtCodes = stockCodes.map(c => (c.startsWith('6') ? 'sh' : 'sz') + c).join(',');
    const data = await jsonp<any>(`https://qt.gtimg.cn/q=${qtCodes}&_t=${Date.now()}`);
    const result: Record<string, { price: number; change: number }> = {};
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      const match = line.match(/v_s[hz](\d+)="([^"]+)"/);
      if (!match) continue;
      const parts = match[2].split('~');
      result[match[1]] = {
        price: parseFloat(parts[3]) || 0,
        change: parseFloat(parts[32]) || 0,
      };
    }
    return result;
  } catch {
    return {};
  }
}

// ── 东方财富基金净值历史 (pingzhongdata) ──

export async function fetchFundNAVHistory(code: string): Promise<FundNAVHistory[]> {
  try {
    const data = await jsonp<any>(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`);
    const text = typeof data === 'string' ? data : '';
    // Extract from: var Data_netWorthTrend = [...];
    const match = text.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) return [];
    const raw = JSON.parse(match[1]) as any[];
    return raw.map((d: any) => ({
      date: d.x ? new Date(d.x).toISOString().slice(0, 10) : '',
      nav: d.y || 0,
      accNav: d.equityReturn || 0,
      change: d.equityReturnChange || 0,
    })).filter(d => d.date);
  } catch {
    return [];
  }
}

// ── 天天基金基本信息 ──

export async function fetchFundBaseInfo(code: string): Promise<{ name: string; type: string; scale: string; manager: string } | null> {
  try {
    const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNBaseInfo?FCODE=${code}&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=fund_${Date.now()}`;
    const resp = await fetch(url);
    const data = await resp.json() as any;
    if (!data || data.ErrCode !== 0) return null;
    const d = data.Datas;
    return {
      name: d.FULLNAME || d.SHORTNAME || '',
      type: d.FTYPE || '',
      scale: d.FSCALE || '',
      manager: d.MANAGERNAME || '',
    };
  } catch {
    return null;
  }
}

// ── 持仓管理 (localStorage) ──

const POSITIONS_KEY = 'fund_positions';
const TRANSACTIONS_KEY = 'fund_transactions';

export function loadPositions(): FundPosition[] {
  return loadJson<FundPosition[]>(POSITIONS_KEY, []);
}

export function savePositions(positions: FundPosition[]): void {
  saveJson(POSITIONS_KEY, positions);
}

export function upsertPosition(code: string, shares: number, costNav: number): void {
  const positions = loadPositions();
  const idx = positions.findIndex(p => p.code === code);
  const totalCost = shares * costNav;
  if (idx >= 0) {
    positions[idx] = { code, shares, costNav, totalCost };
  } else {
    positions.push({ code, shares, costNav, totalCost });
  }
  savePositions(positions);
}

export function loadTransactions(code?: string): FundTransaction[] {
  const all = loadJson<FundTransaction[]>(TRANSACTIONS_KEY, []);
  return code ? all.filter(t => t.code === code) : all;
}

export function saveTransactions(transactions: FundTransaction[]): void {
  saveJson(TRANSACTIONS_KEY, transactions);
}

export function addTransaction(code: string, type: 'buy' | 'sell', shares: number, nav: number, fee: number = 0): void {
  const txs = loadTransactions();
  txs.push({
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    code,
    date: new Date().toISOString().slice(0, 10),
    type, shares, nav,
    amount: shares * nav,
    fee,
  });
  saveTransactions(txs);

  // Update position
  const positions = loadPositions();
  const idx = positions.findIndex(p => p.code === code);
  if (type === 'buy') {
    const existing = idx >= 0 ? positions[idx] : { code, shares: 0, costNav: 0, totalCost: 0 };
    const totalShares = existing.shares + shares;
    const totalCost = existing.totalCost + shares * nav;
    const avgCost = totalShares > 0 ? totalCost / totalShares : 0;
    if (idx >= 0) {
      positions[idx] = { code, shares: totalShares, costNav: avgCost, totalCost };
    } else {
      positions.push({ code, shares: totalShares, costNav: avgCost, totalCost });
    }
  } else if (type === 'sell' && idx >= 0) {
    const remaining = positions[idx].shares - shares;
    if (remaining <= 0) {
      positions.splice(idx, 1);
    } else {
      positions[idx].shares = remaining;
      positions[idx].totalCost = remaining * positions[idx].costNav;
    }
  }
  savePositions(positions);
}
