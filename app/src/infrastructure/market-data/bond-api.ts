/**
 * Bond Market Data API — 可转债 + 国债
 *
 * Data from 东方财富 datacenter / push2 APIs.
 * Endpoints documented by efinance (Micro-sheep).
 */

import { emFetch } from './common';

export interface ConvertibleBond {
  code: string;           // 债券代码
  name: string;           // 债券名称
  stockCode: string;      // 正股代码
  stockName: string;      // 正股名称
  rating: string;         // 债券评级
  issueSize: number;      // 发行规模(亿)
  listDate: string;       // 上市日期
  maturityDate: string;   // 到期日期
  term: number;           // 期限(年)
  couponRate: string;     // 利率说明
  convertPrice: number;   // 转股价
  price: number;          // 最新价
  changePct: number;      // 涨跌幅%
  volume: number;         // 成交量(手)
  premium: number;        // 转股溢价率%
  stockPrice: number;     // 正股价格
  stockChangePct: number; // 正股涨跌幅%
  yieldToMaturity: number;// 到期收益率%
}

export interface TreasuryBond {
  code: string;
  name: string;
  price: number;
  changePct: number;
  yield: number;          // 收益率%
  term: string;           // 剩余期限
}

// ── 可转债实时行情列表 ──

export async function fetchConvertibleBonds(page: number = 1, pageSize: number = 80): Promise<ConvertibleBond[]> {
  try {
    // 东方财富 datacenter API — CORS-friendly
    const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_BOND_CB_LIST&columns=SECURITY_CODE,SECURITY_NAME_ABBR,CLOSE_PRICE,CHG_PCT,TURNOVER_VOL,CONVERT_STOCK_PRICE,CONVERT_PRICE,PREMIUM_RATIO,YIELD_TO_MATURITY,STOCK_PRICE,STOCK_CHG_PCT&source=WEB&client=WEB&pageSize=${pageSize}&pageNumber=${page}&sortColumns=CHG_PCT&sortTypes=-1`;
    const resp = await fetch(url);
    const data = await resp.json() as any;
    const items = data?.result?.data || [];

    return items.map((item: any) => ({
      code: item.SECURITY_CODE || '',
      name: item.SECURITY_NAME_ABBR || '',
      stockCode: '',
      stockName: '',
      rating: '',
      issueSize: 0,
      listDate: '',
      maturityDate: '',
      term: 0,
      couponRate: '',
      convertPrice: parseFloat(item.CONVERT_PRICE) || 0,
      price: parseFloat(item.CLOSE_PRICE) || 0,
      changePct: parseFloat(item.CHG_PCT) || 0,
      volume: parseFloat(item.TURNOVER_VOL) || 0,
      premium: parseFloat(item.PREMIUM_RATIO) || 0,
      stockPrice: parseFloat(item.STOCK_PRICE) || 0,
      stockChangePct: parseFloat(item.STOCK_CHG_PCT) || 0,
      yieldToMaturity: parseFloat(item.YIELD_TO_MATURITY) || 0,
    }));
  } catch {
    return [];
  }
}

// ── 可转债基本信息 ──

export async function fetchConvertibleBondInfo(code: string): Promise<Partial<ConvertibleBond> | null> {
  try {
    const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_BOND_CB_LIST&columns=ALL&source=WEB&client=WEB&filter=(SECURITY_CODE="${code}")`;
    const data = await emFetch(url);
    if (!data?.result?.data || data.result.data.length === 0) return null;
    const item = data.result.data[0];
    return {
      code: item.SECURITY_CODE,
      name: item.SECURITY_NAME_ABBR,
      stockCode: item.CORRESPONDING_STOCK_CODE || '',
      stockName: item.CORRESPONDING_STOCK_NAME || '',
      rating: item.CREDIT_RATING || '',
      issueSize: parseFloat(item.ISSUE_SCALE) || 0,
      listDate: item.LISTING_DATE || '',
      maturityDate: item.EXPIRE_DATE || '',
      term: parseFloat(item.BOND_TERM) || 0,
      couponRate: item.RATE_EXPLAIN || '',
    };
  } catch {
    return null;
  }
}

// ── 国债收益率 ──

export interface YieldCurvePoint {
  term: string;  // 期限 e.g. '1Y', '5Y', '10Y'
  yield: number; // 收益率%
  change: number;// 变动 bp
}

export async function fetchTreasuryYieldCurve(): Promise<YieldCurvePoint[]> {
  try {
    // 中国国债收益率曲线
    const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_TREASURYYIELD&columns=ALL&source=WEB&client=WEB&sortColumns=TERM&sortTypes=1';
    const data = await emFetch(url);
    const items = data?.result?.data || [];

    return items.map((item: any) => ({
      term: item.TERM || '',
      yield: parseFloat(item.YIELD) || 0,
      change: parseFloat(item.CHANGE) || 0,
    }));
  } catch {
    return [];
  }
}

// ── 国债期货 ──

export interface TreasuryFuture {
  code: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
}

export async function fetchTreasuryFutures(): Promise<TreasuryFuture[]> {
  try {
    const url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:113+t:19&fields=f12,f14,f2,f3,f5';
    const data = await emFetch(url);
    const list = data?.data?.diff || [];

    return list.map((item: any) => ({
      code: item.f12,
      name: item.f14,
      price: item.f2 || 0,
      changePct: item.f3 || 0,
      volume: item.f5 || 0,
    }));
  } catch {
    return [];
  }
}
