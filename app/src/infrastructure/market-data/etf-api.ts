/**
 * ETF Market Data API
 *
 * A-share ETFs via 东方财富, global ETFs via Yahoo Finance CSV.
 * Uses shared infrastructure from common.ts.
 */

import { emGetList } from './common';

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

export async function fetchAStockETFs(): Promise<ETFItem[]> {
  // Read local database first
  try {
    const resp = await fetch('/data/a-share-etfs.json');
    if (resp.ok) {
      const data = await resp.json();
      if (data.etfs?.length > 0) {
        return data.etfs.map((e: any) => ({
          code: e.code, name: e.name, issuer: e.issuer || '',
          underlying: e.underlying || '', category: e.category || '',
          price: 0, changePct: 0, volume: 0, fundSize: e.size || 0,
          expenseRatio: 0, premium: 0,
        }));
      }
    }
  } catch {}
  return [];
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

// ── Global ETF List (snapshot — 80+ ETFs across all major categories) ──

export interface GlobalETF {
  symbol: string;
  name: string;
  category: string;
  family: string;      // e.g. BlackRock, Vanguard, State Street
  exchange: string;
  currency: string;
  aum: number;         // in millions USD
  yahooSymbol?: string; // Yahoo Finance ticker for live quotes (auto-computed if absent)
  price?: number;       // live price (populated by fetchGlobalETFQuotes)
  changePct?: number;   // live change percent (populated by fetchGlobalETFQuotes)
}

/** Derive the Yahoo Finance ticker from exchange + symbol. */
export function toYahooSymbol(etf: GlobalETF): string {
  if (etf.yahooSymbol) return etf.yahooSymbol;
  switch (etf.exchange) {
    case 'HKEX': return `${etf.symbol}.HK`;
    case 'SSE':  return `${etf.symbol}.SS`;
    case 'SZSE': return `${etf.symbol}.SZ`;
    default:     return etf.symbol;
  }
}

const GLOBAL_ETF_SNAPSHOT: GlobalETF[] = [
  // ═══════════════════════════════════════════════════════
  // US Major Equity ETFs
  // ═══════════════════════════════════════════════════════
  { symbol: 'SPY',  name: 'SPDR S&P 500 ETF',                      category: '大盘股',   family: 'State Street', exchange: 'NYSE',   currency: 'USD', aum: 500000 },
  { symbol: 'IVV',  name: 'iShares Core S&P 500 ETF',              category: '大盘股',   family: 'BlackRock',    exchange: 'NYSE',   currency: 'USD', aum: 450000 },
  { symbol: 'VOO',  name: 'Vanguard S&P 500 ETF',                  category: '大盘股',   family: 'Vanguard',     exchange: 'NYSE',   currency: 'USD', aum: 420000 },
  { symbol: 'VTI',  name: 'Vanguard Total Stock Market ETF',       category: '全市场',   family: 'Vanguard',     exchange: 'NYSE',   currency: 'USD', aum: 380000 },
  { symbol: 'QQQ',  name: 'Invesco QQQ Trust',                     category: '科技股',   family: 'Invesco',      exchange: 'NASDAQ', currency: 'USD', aum: 250000 },
  { symbol: 'DIA',  name: 'SPDR Dow Jones Industrial Average ETF', category: '大盘股',   family: 'State Street', exchange: 'NYSE',   currency: 'USD', aum: 35000 },
  { symbol: 'IWM',  name: 'iShares Russell 2000 ETF',              category: '小盘股',   family: 'BlackRock',    exchange: 'NYSE',   currency: 'USD', aum: 65000 },
  { symbol: 'MDY',  name: 'SPDR S&P MidCap 400 ETF',               category: '中盘股',   family: 'State Street', exchange: 'NYSE',   currency: 'USD', aum: 22000 },

  // ═══════════════════════════════════════════════════════
  // Developed Markets (ex-US)
  // ═══════════════════════════════════════════════════════
  { symbol: 'VEA',  name: 'Vanguard FTSE Developed Markets ETF',   category: '发达市场', family: 'Vanguard',     exchange: 'NYSE',   currency: 'USD', aum: 180000 },
  { symbol: 'IEFA', name: 'iShares Core MSCI EAFE ETF',            category: '发达市场', family: 'BlackRock',    exchange: 'NYSE',   currency: 'USD', aum: 120000 },
  { symbol: 'SCHF', name: 'Schwab International Equity ETF',       category: '发达市场', family: 'Charles Schwab', exchange: 'NYSE', currency: 'USD', aum: 40000 },

  // ═══════════════════════════════════════════════════════
  // Emerging Markets
  // ═══════════════════════════════════════════════════════
  { symbol: 'VWO',  name: 'Vanguard FTSE Emerging Markets ETF',       category: '新兴市场', family: 'Vanguard',       exchange: 'NYSE', currency: 'USD', aum: 100000 },
  { symbol: 'IEMG', name: 'iShares Core MSCI Emerging Markets ETF',   category: '新兴市场', family: 'BlackRock',      exchange: 'NYSE', currency: 'USD', aum: 85000 },
  { symbol: 'EEM',  name: 'iShares MSCI Emerging Markets ETF',        category: '新兴市场', family: 'BlackRock',      exchange: 'NYSE', currency: 'USD', aum: 25000 },
  { symbol: 'SCHE', name: 'Schwab Emerging Markets Equity ETF',       category: '新兴市场', family: 'Charles Schwab',  exchange: 'NYSE', currency: 'USD', aum: 9000 },

  // ═══════════════════════════════════════════════════════
  // European ETFs
  // ═══════════════════════════════════════════════════════
  { symbol: 'VGK',  name: 'Vanguard FTSE Europe ETF',             category: '欧洲市场', family: 'Vanguard',     exchange: 'NYSE', currency: 'USD', aum: 25000 },
  { symbol: 'EZU',  name: 'iShares MSCI Eurozone ETF',            category: '欧洲市场', family: 'BlackRock',    exchange: 'NYSE', currency: 'USD', aum: 8000 },
  { symbol: 'FEZ',  name: 'SPDR EURO STOXX 50 ETF',               category: '欧洲市场', family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 5000 },
  { symbol: 'IEUR', name: 'iShares Core MSCI Europe ETF',         category: '欧洲市场', family: 'BlackRock',    exchange: 'NYSE', currency: 'USD', aum: 6000 },

  // ═══════════════════════════════════════════════════════
  // Japanese ETFs
  // ═══════════════════════════════════════════════════════
  { symbol: 'EWJ',  name: 'iShares MSCI Japan ETF',                category: '日本市场', family: 'BlackRock',         exchange: 'NYSE', currency: 'USD', aum: 15000 },
  { symbol: 'DXJ',  name: 'WisdomTree Japan Hedged Equity ETF',    category: '日本市场', family: 'WisdomTree',        exchange: 'NYSE', currency: 'USD', aum: 5000 },
  { symbol: 'BBJP', name: 'JPMorgan BetaBuilders Japan ETF',       category: '日本市场', family: 'JPMorgan',          exchange: 'NYSE', currency: 'USD', aum: 12000 },
  { symbol: 'FLJP', name: 'Franklin FTSE Japan ETF',               category: '日本市场', family: 'Franklin Templeton', exchange: 'NYSE', currency: 'USD', aum: 2000 },

  // ═══════════════════════════════════════════════════════
  // Bonds (broad, treasuries, corporates, munis, TIPS, HY, EM)
  // ═══════════════════════════════════════════════════════
  { symbol: 'BND',  name: 'Vanguard Total Bond Market ETF',                     category: '债券型', family: 'Vanguard',     exchange: 'NASDAQ', currency: 'USD', aum: 110000 },
  { symbol: 'AGG',  name: 'iShares Core US Aggregate Bond ETF',                 category: '债券型', family: 'BlackRock',    exchange: 'NYSE',   currency: 'USD', aum: 105000 },
  { symbol: 'TLT',  name: 'iShares 20+ Year Treasury Bond ETF',                 category: '债券型', family: 'BlackRock',    exchange: 'NASDAQ', currency: 'USD', aum: 50000 },
  { symbol: 'LQD',  name: 'iShares iBoxx Inv Grade Corporate Bond ETF',         category: '债券型', family: 'BlackRock',    exchange: 'NYSE',   currency: 'USD', aum: 35000 },
  { symbol: 'HYG',  name: 'iShares iBoxx High Yield Corporate Bond ETF',        category: '债券型', family: 'BlackRock',    exchange: 'NYSE',   currency: 'USD', aum: 18000 },
  { symbol: 'SHY',  name: 'iShares 1-3 Year Treasury Bond ETF',                 category: '债券型', family: 'BlackRock',    exchange: 'NASDAQ', currency: 'USD', aum: 25000 },
  { symbol: 'TIP',  name: 'iShares TIPS Bond ETF',                              category: '债券型', family: 'BlackRock',    exchange: 'NYSE',   currency: 'USD', aum: 20000 },
  { symbol: 'BNDX', name: 'Vanguard Total International Bond ETF',              category: '债券型', family: 'Vanguard',     exchange: 'NASDAQ', currency: 'USD', aum: 15000 },
  { symbol: 'EMB',  name: 'iShares JP Morgan USD Emerging Markets Bond ETF',    category: '债券型', family: 'BlackRock',    exchange: 'NASDAQ', currency: 'USD', aum: 15000 },
  { symbol: 'JNK',  name: 'SPDR Bloomberg High Yield Bond ETF',                 category: '债券型', family: 'State Street', exchange: 'NYSE',   currency: 'USD', aum: 9000 },
  { symbol: 'MUB',  name: 'iShares National Muni Bond ETF',                     category: '债券型', family: 'BlackRock',    exchange: 'NYSE',   currency: 'USD', aum: 20000 },

  // ═══════════════════════════════════════════════════════
  // Commodities (gold, silver, oil, natgas, copper, wheat, broad basket)
  // ═══════════════════════════════════════════════════════
  { symbol: 'GLD',  name: 'SPDR Gold Trust',                      category: '商品型', family: 'State Street',        exchange: 'NYSE', currency: 'USD', aum: 65000 },
  { symbol: 'IAU',  name: 'iShares Gold Trust',                   category: '商品型', family: 'BlackRock',           exchange: 'NYSE', currency: 'USD', aum: 30000 },
  { symbol: 'SLV',  name: 'iShares Silver Trust',                 category: '商品型', family: 'BlackRock',           exchange: 'NYSE', currency: 'USD', aum: 12000 },
  { symbol: 'USO',  name: 'United States Oil Fund',               category: '商品型', family: 'US Commodity Funds',  exchange: 'NYSE', currency: 'USD', aum: 3000 },
  { symbol: 'DBC',  name: 'Invesco DB Commodity Index Tracking',  category: '商品型', family: 'Invesco',             exchange: 'NYSE', currency: 'USD', aum: 2000 },
  { symbol: 'UNG',  name: 'United States Natural Gas Fund',       category: '商品型', family: 'US Commodity Funds',  exchange: 'NYSE', currency: 'USD', aum: 1000 },
  { symbol: 'CPER', name: 'United States Copper Index Fund',      category: '商品型', family: 'US Commodity Funds',  exchange: 'NYSE', currency: 'USD', aum: 200 },
  { symbol: 'WEAT', name: 'Teucrium Wheat ETF',                   category: '商品型', family: 'Teucrium',            exchange: 'NYSE', currency: 'USD', aum: 200 },

  // ═══════════════════════════════════════════════════════
  // Real Estate (REITs)
  // ═══════════════════════════════════════════════════════
  { symbol: 'VNQ',  name: 'Vanguard Real Estate ETF',           category: '房地产', family: 'Vanguard',       exchange: 'NYSE', currency: 'USD', aum: 50000 },
  { symbol: 'IYR',  name: 'iShares U.S. Real Estate ETF',       category: '房地产', family: 'BlackRock',      exchange: 'NYSE', currency: 'USD', aum: 5000 },
  { symbol: 'XLRE', name: 'Real Estate Select Sector SPDR',     category: '房地产', family: 'State Street',   exchange: 'NYSE', currency: 'USD', aum: 5000 },
  { symbol: 'SCHH', name: 'Schwab U.S. REIT ETF',               category: '房地产', family: 'Charles Schwab', exchange: 'NYSE', currency: 'USD', aum: 8000 },

  // ═══════════════════════════════════════════════════════
  // Crypto (Bitcoin, Ethereum trusts & futures-based)
  // ═══════════════════════════════════════════════════════
  { symbol: 'GBTC', name: 'Grayscale Bitcoin Trust',         category: '加密货币', family: 'Grayscale',  exchange: 'NYSE', currency: 'USD', aum: 25000 },
  { symbol: 'BITO', name: 'ProShares Bitcoin Strategy ETF',  category: '加密货币', family: 'ProShares',  exchange: 'NYSE', currency: 'USD', aum: 2000 },
  { symbol: 'ETHE', name: 'Grayscale Ethereum Trust',        category: '加密货币', family: 'Grayscale',  exchange: 'NYSE', currency: 'USD', aum: 8000 },

  // ═══════════════════════════════════════════════════════
  // Leveraged (2x / 3x long)
  // ═══════════════════════════════════════════════════════
  { symbol: 'SSO',  name: 'ProShares Ultra S&P 500 (2x)',                     category: '杠杆型', family: 'ProShares', exchange: 'NYSE',   currency: 'USD', aum: 5000 },
  { symbol: 'UPRO', name: 'ProShares UltraPro S&P 500 (3x)',                   category: '杠杆型', family: 'ProShares', exchange: 'NYSE',   currency: 'USD', aum: 3000 },
  { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ (3x)',                       category: '杠杆型', family: 'ProShares', exchange: 'NASDAQ', currency: 'USD', aum: 20000 },
  { symbol: 'TMF',  name: 'Direxion Daily 20+ Year Treasury Bull 3x',          category: '杠杆型', family: 'Direxion',  exchange: 'NYSE',   currency: 'USD', aum: 2000 },
  { symbol: 'SOXL', name: 'Direxion Daily Semiconductor Bull 3x',              category: '杠杆型', family: 'Direxion',  exchange: 'NYSE',   currency: 'USD', aum: 10000 },

  // ═══════════════════════════════════════════════════════
  // Inverse (-1x / -2x / -3x short)
  // ═══════════════════════════════════════════════════════
  { symbol: 'SH',   name: 'ProShares Short S&P 500 (-1x)',              category: '反向型', family: 'ProShares', exchange: 'NYSE',   currency: 'USD', aum: 2000 },
  { symbol: 'SQQQ', name: 'ProShares UltraPro Short QQQ (-3x)',         category: '反向型', family: 'ProShares', exchange: 'NASDAQ', currency: 'USD', aum: 5000 },
  { symbol: 'SDS',  name: 'ProShares UltraShort S&P 500 (-2x)',         category: '反向型', family: 'ProShares', exchange: 'NYSE',   currency: 'USD', aum: 1000 },
  { symbol: 'TZA',  name: 'Direxion Daily Small Cap Bear 3x',           category: '反向型', family: 'Direxion',  exchange: 'NYSE',   currency: 'USD', aum: 500 },

  // ═══════════════════════════════════════════════════════
  // Dividend / High Yield
  // ═══════════════════════════════════════════════════════
  { symbol: 'VYM',  name: 'Vanguard High Dividend Yield ETF',    category: '红利型', family: 'Vanguard',       exchange: 'NYSE',   currency: 'USD', aum: 60000 },
  { symbol: 'SCHD', name: 'Schwab U.S. Dividend Equity ETF',     category: '红利型', family: 'Charles Schwab',  exchange: 'NYSE',   currency: 'USD', aum: 55000 },
  { symbol: 'DVY',  name: 'iShares Select Dividend ETF',          category: '红利型', family: 'BlackRock',      exchange: 'NASDAQ', currency: 'USD', aum: 20000 },
  { symbol: 'HDV',  name: 'iShares Core High Dividend ETF',       category: '红利型', family: 'BlackRock',      exchange: 'NYSE',   currency: 'USD', aum: 12000 },

  // ═══════════════════════════════════════════════════════
  // ESG / Sustainable
  // ═══════════════════════════════════════════════════════
  { symbol: 'ESGU', name: 'iShares ESG Aware MSCI USA ETF',    category: 'ESG', family: 'BlackRock',          exchange: 'NASDAQ', currency: 'USD', aum: 15000 },
  { symbol: 'SUSA', name: 'iShares MSCI USA ESG Select ETF',   category: 'ESG', family: 'BlackRock',          exchange: 'NYSE',   currency: 'USD', aum: 5000 },
  { symbol: 'VEGN', name: 'US Vegan Climate ETF',              category: 'ESG', family: 'Vegan Investment',   exchange: 'NYSE',   currency: 'USD', aum: 100 },
  { symbol: 'ICLN', name: 'iShares Global Clean Energy ETF',   category: 'ESG', family: 'BlackRock',          exchange: 'NASDAQ', currency: 'USD', aum: 3000 },

  // ═══════════════════════════════════════════════════════
  // Sector ETFs (S&P Select Sectors)
  // ═══════════════════════════════════════════════════════
  { symbol: 'XLF', name: 'Financial Select Sector SPDR',                category: '行业-金融',      family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 40000 },
  { symbol: 'XLK', name: 'Technology Select Sector SPDR',               category: '行业-科技',      family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 70000 },
  { symbol: 'XLE', name: 'Energy Select Sector SPDR',                   category: '行业-能源',      family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 40000 },
  { symbol: 'XLV', name: 'Health Care Select Sector SPDR',              category: '行业-医疗',      family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 40000 },
  { symbol: 'XLI', name: 'Industrial Select Sector SPDR',               category: '行业-工业',      family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 20000 },
  { symbol: 'XLY', name: 'Consumer Discretionary Select Sector SPDR',   category: '行业-消费',      family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 20000 },
  { symbol: 'XLP', name: 'Consumer Staples Select Sector SPDR',         category: '行业-必需消费',  family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 15000 },
  { symbol: 'XLU', name: 'Utilities Select Sector SPDR',                category: '行业-公用事业',  family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 15000 },
  { symbol: 'XLB', name: 'Materials Select Sector SPDR',                category: '行业-材料',      family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 6000 },
  { symbol: 'XLC', name: 'Communication Services Select Sector SPDR',   category: '行业-通信',      family: 'State Street', exchange: 'NYSE', currency: 'USD', aum: 20000 },

  // ═══════════════════════════════════════════════════════
  // Global / Total World
  // ═══════════════════════════════════════════════════════
  { symbol: 'VT',   name: 'Vanguard Total World Stock ETF',  category: '全球市场', family: 'Vanguard',  exchange: 'NYSE',   currency: 'USD', aum: 40000 },
  { symbol: 'ACWI', name: 'iShares MSCI ACWI ETF',           category: '全球市场', family: 'BlackRock', exchange: 'NASDAQ', currency: 'USD', aum: 20000 },

  // ═══════════════════════════════════════════════════════
  // Thematic / Innovation
  // ═══════════════════════════════════════════════════════
  { symbol: 'ARKK', name: 'ARK Innovation ETF',              category: '主动管理', family: 'ARK Invest', exchange: 'NYSE', currency: 'USD', aum: 8000 },
  { symbol: 'ARKG', name: 'ARK Genomic Revolution ETF',      category: '主动管理', family: 'ARK Invest', exchange: 'NYSE', currency: 'USD', aum: 2000 },

  // ═══════════════════════════════════════════════════════
  // HK ETFs
  // ═══════════════════════════════════════════════════════
  { symbol: '2800', name: '盈富基金',                         category: '大盘股', family: 'State Street', exchange: 'HKEX', currency: 'HKD', aum: 150000 },
  { symbol: '2828', name: '恒生中国企业指数ETF',              category: '中资股', family: '恒生投资',      exchange: 'HKEX', currency: 'HKD', aum: 30000 },
  { symbol: '2823', name: 'iShares 安硕富时A50 ETF',          category: 'A股',   family: 'BlackRock',    exchange: 'HKEX', currency: 'HKD', aum: 20000 },
  { symbol: '3067', name: 'iShares 安硕恒生科技ETF',          category: '科技股', family: 'BlackRock',    exchange: 'HKEX', currency: 'HKD', aum: 10000 },

  // ═══════════════════════════════════════════════════════
  // CN Major A-Share ETFs
  // ═══════════════════════════════════════════════════════
  { symbol: '510300', name: '沪深300ETF',   category: '大盘股', family: '华泰柏瑞', exchange: 'SSE',  currency: 'CNY', aum: 180000 },
  { symbol: '510050', name: '上证50ETF',    category: '大盘股', family: '华夏基金', exchange: 'SSE',  currency: 'CNY', aum: 80000 },
  { symbol: '510500', name: '中证500ETF',   category: '中盘股', family: '南方基金', exchange: 'SSE',  currency: 'CNY', aum: 60000 },
  { symbol: '159915', name: '创业板ETF',    category: '创业板', family: '易方达',   exchange: 'SZSE', currency: 'CNY', aum: 40000 },
  { symbol: '588000', name: '科创50ETF',    category: '科创板', family: '华夏基金', exchange: 'SSE',  currency: 'CNY', aum: 50000 },
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

// ── Global ETF Live Quotes (Yahoo Finance free API) ──

export interface GlobalETFQuote {
  symbol: string;
  price: number;
  changePct: number;
  currency: string;
  updatedAt: number; // Date.now() when fetched
}

const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

/**
 * Fetch a single ETF quote from Yahoo Finance v8 chart API.
 * Returns null on any error (network, CORS, missing data).
 */
async function fetchSingleETFQuote(yahooSym: string, originalSymbol: string): Promise<GlobalETFQuote | null> {
  try {
    const url = `${YAHOO_CHART_BASE}/${encodeURIComponent(yahooSym)}?interval=1d&range=1d`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice == null) return null;
    return {
      symbol: originalSymbol,
      price: meta.regularMarketPrice,
      changePct: meta.regularMarketChangePercent ?? 0,
      currency: meta.currency ?? 'USD',
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch live quotes for a list of GlobalETFs via Yahoo Finance.
 * Fetches concurrently in batches of 15 to stay API-friendly.
 * Returns a Map keyed by the original ETF symbol.
 */
export async function fetchGlobalETFQuotes(etfs: GlobalETF[]): Promise<Map<string, GlobalETFQuote>> {
  const results = new Map<string, GlobalETFQuote>();
  const BATCH = 15;

  for (let i = 0; i < etfs.length; i += BATCH) {
    const batch = etfs.slice(i, i + BATCH);
    const promises = batch.map(etf =>
      fetchSingleETFQuote(toYahooSymbol(etf), etf.symbol)
    );
    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) {
        results.set(s.value.symbol, s.value);
      }
    }
  }

  return results;
}

/**
 * Merge live quotes back into an array of GlobalETFs (mutates the provided array or a clone).
 * Returns a new array with price/changePct populated where quotes exist.
 */
export function mergeGlobalETFQuotes(etfs: GlobalETF[], quotes: Map<string, GlobalETFQuote>): GlobalETF[] {
  return etfs.map(etf => {
    const q = quotes.get(etf.symbol);
    if (!q) return etf;
    return { ...etf, price: q.price, changePct: q.changePct };
  });
}
