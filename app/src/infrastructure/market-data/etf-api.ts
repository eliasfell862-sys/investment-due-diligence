/**
 * ETF Market Data API
 *
 * A-share ETFs via 东方财富, global ETFs via Yahoo Finance CSV.
 * Uses shared infrastructure from common.ts.
 */

import { emGetList, emFetch } from './common';

export interface ETFItem {
  code: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;       // 成交量(手)
  fundSize: number;     // 基金规模(亿)
  category: string;     // 类型: 股票型/债券型/商品型/跨境型/货币型
  underlying: string;   // 跟踪标的
  issuer: string;       // 基金公司
  expenseRatio: number; // 管理费率%
  premium: number;      // 折溢价率%
}

// ── A-Share ETFs (东方财富) ──

export async function fetchAStockETFs(page: number = 1, pageSize: number = 100): Promise<ETFItem[]> {
  try {
    const list = await emGetList({
      fs: 'b:MK0021',
      fields: 'f12,f14,f2,f3,f5,f20,f21,f22,f40,f112,f115,f169',
      page, pageSize,
      sortField: 'f20',
    });

    return list.map((item: any) => ({
      code: item.f12,
      name: item.f14,
      price: item.f2 || 0,
      changePct: item.f3 || 0,
      volume: item.f5 || 0,
      fundSize: (item.f20 || 0) / 1e8, // 转换为亿
      category: etfCategoryMap(item.f112 || ''),
      underlying: item.f40 || '',
      issuer: item.f115 || '',
      expenseRatio: item.f169 || 0,
      premium: item.f22 || 0, // 折溢价
    }));
  } catch {
    return [];
  }
}

function etfCategoryMap(code: string): string {
  const map: Record<string, string> = {
    '1': '股票型', '2': '债券型', '3': '商品型',
    '4': '跨境型', '5': '货币型', '6': '混合型',
  };
  return map[code] || '其他';
}

// ── ETF Details (持仓) ──

export interface ETFHoldings {
  stockCode: string;
  stockName: string;
  ratio: number; // 权重%
}

export async function fetchETFHoldings(etfCode: string): Promise<ETFHoldings[]> {
  try {
    // ETF holdings via fund API
    const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${etfCode}&deviceid=Wap&plat=WAP&product=EFund&version=2.0.0`;
    const resp = await fetch(url);
    const holdingsData = await resp.json() as any;
    if (!holdingsData?.Datas?.fundStocks) return [];
    return holdingsData.Datas.fundStocks.map((h: any) => ({
      stockCode: h.GPDM || '',
      stockName: h.GPJC || '',
      ratio: parseFloat(h.JZZB) || 0,
    }));
  } catch {
    return [];
  }
}

// ── Global ETF List (from CSV snapshot — major ETFs) ──

export interface GlobalETF {
  symbol: string;
  name: string;
  category: string;
  family: string;      // e.g. BlackRock, Vanguard, State Street
  exchange: string;
  currency: string;
  aum: number;         // in millions
}

const GLOBAL_ETF_SNAPSHOT: GlobalETF[] = [
  // US Major ETFs
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', category: '大盘股', family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 500000 },
  { symbol: 'IVV', name: 'iShares Core S&P 500 ETF', category: '大盘股', family: 'BlackRock', exchange: 'NYSE', currency: 'USD', aum: 450000 },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', category: '大盘股', family: 'Vanguard', exchange: 'NYSE', currency: 'USD', aum: 420000 },
  { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', category: '全市场', family: 'Vanguard', exchange: 'NYSE', currency: 'USD', aum: 380000 },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', category: '科技股', family: 'Invesco', exchange: 'NASDAQ', currency: 'USD', aum: 250000 },
  { symbol: 'VEA', name: 'Vanguard FTSE Developed Markets ETF', category: '发达市场', family: 'Vanguard', exchange: 'NYSE', currency: 'USD', aum: 180000 },
  { symbol: 'IEFA', name: 'iShares Core MSCI EAFE ETF', category: '发达市场', family: 'BlackRock', exchange: 'NYSE', currency: 'USD', aum: 120000 },
  { symbol: 'VWO', name: 'Vanguard FTSE Emerging Markets ETF', category: '新兴市场', family: 'Vanguard', exchange: 'NYSE', currency: 'USD', aum: 100000 },
  { symbol: 'BND', name: 'Vanguard Total Bond Market ETF', category: '债券型', family: 'Vanguard', exchange: 'NASDAQ', currency: 'USD', aum: 110000 },
  { symbol: 'AGG', name: 'iShares Core US Aggregate Bond ETF', category: '债券型', family: 'BlackRock', exchange: 'NYSE', currency: 'USD', aum: 105000 },
  { symbol: 'GLD', name: 'SPDR Gold Trust', category: '商品型', family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 65000 },
  { symbol: 'XLF', name: 'Financial Select Sector SPDR', category: '金融', family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 40000 },
  { symbol: 'ARKK', name: 'ARK Innovation ETF', category: '主动管理', family: 'ARK Invest', exchange: 'NYSE', currency: 'USD', aum: 8000 },
  // HK ETFs
  { symbol: '2800', name: '盈富基金', category: '大盘股', family: 'State Street', exchange: 'HKEX', currency: 'HKD', aum: 150000 },
  { symbol: '2828', name: '恒生中国企业指数ETF', category: '中资股', family: '恒生投资', exchange: 'HKEX', currency: 'HKD', aum: 30000 },
  { symbol: '2823', name: 'iShares 安硕富时A50 ETF', category: 'A股', family: 'BlackRock', exchange: 'HKEX', currency: 'HKD', aum: 20000 },
  // CN Major ETFs
  { symbol: '510300', name: '沪深300ETF', category: '大盘股', family: '华泰柏瑞', exchange: 'SSE', currency: 'CNY', aum: 180000 },
  { symbol: '510050', name: '上证50ETF', category: '大盘股', family: '华夏基金', exchange: 'SSE', currency: 'CNY', aum: 80000 },
  { symbol: '510500', name: '中证500ETF', category: '中盘股', family: '南方基金', exchange: 'SSE', currency: 'CNY', aum: 60000 },
  { symbol: '159915', name: '创业板ETF', category: '创业板', family: '易方达', exchange: 'SZSE', currency: 'CNY', aum: 40000 },
];

export function fetchGlobalETFs(): GlobalETF[] {
  return GLOBAL_ETF_SNAPSHOT;
}

export function filterGlobalETFs(category?: string, family?: string): GlobalETF[] {
  let list = GLOBAL_ETF_SNAPSHOT;
  if (category) list = list.filter(e => e.category === category);
  if (family) list = list.filter(e => e.family === family);
  return list;
}

export function getGlobalETFCategories(): string[] {
  return [...new Set(GLOBAL_ETF_SNAPSHOT.map(e => e.category))];
}

export function getGlobalETFFamilies(): string[] {
  return [...new Set(GLOBAL_ETF_SNAPSHOT.map(e => e.family))];
}
