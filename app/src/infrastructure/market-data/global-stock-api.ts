/**
 * Global Stock Market API
 *
 * US, HK, and other global stocks via Sina + Yahoo Finance proxies.
 */

export interface GlobalStock {
  symbol: string;
  name: string;
  market: 'us' | 'hk' | 'cn';
  exchange: string;
  sector: string;
  industry: string;
  currency: string;
  price: number;
  changePct: number;
  marketCap: number;   // 亿 (local currency)
}

// ── Major US Stocks (S&P 500 top constituents snapshot) ──

const US_MAJOR: GlobalStock[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '消费电子', currency: 'USD', price: 0, changePct: 0, marketCap: 280000 },
  { symbol: 'MSFT', name: 'Microsoft Corporation', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '软件', currency: 'USD', price: 0, changePct: 0, marketCap: 250000 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', market: 'us', exchange: 'NASDAQ', sector: '通信服务', industry: '互联网', currency: 'USD', price: 0, changePct: 0, marketCap: 180000 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', market: 'us', exchange: 'NASDAQ', sector: '可选消费', industry: '电商', currency: 'USD', price: 0, changePct: 0, marketCap: 170000 },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '半导体', currency: 'USD', price: 0, changePct: 0, marketCap: 160000 },
  { symbol: 'META', name: 'Meta Platforms Inc.', market: 'us', exchange: 'NASDAQ', sector: '通信服务', industry: '互联网', currency: 'USD', price: 0, changePct: 0, marketCap: 120000 },
  { symbol: 'TSLA', name: 'Tesla Inc.', market: 'us', exchange: 'NASDAQ', sector: '可选消费', industry: '汽车', currency: 'USD', price: 0, changePct: 0, marketCap: 80000 },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', market: 'us', exchange: 'NYSE', sector: '金融', industry: '保险', currency: 'USD', price: 0, changePct: 0, marketCap: 78000 },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', market: 'us', exchange: 'NYSE', sector: '金融', industry: '银行', currency: 'USD', price: 0, changePct: 0, marketCap: 50000 },
  { symbol: 'V', name: 'Visa Inc.', market: 'us', exchange: 'NYSE', sector: '金融', industry: '支付', currency: 'USD', price: 0, changePct: 0, marketCap: 48000 },
  { symbol: 'JNJ', name: 'Johnson & Johnson', market: 'us', exchange: 'NYSE', sector: '医疗健康', industry: '制药', currency: 'USD', price: 0, changePct: 0, marketCap: 45000 },
  { symbol: 'WMT', name: 'Walmart Inc.', market: 'us', exchange: 'NYSE', sector: '日常消费', industry: '零售', currency: 'USD', price: 0, changePct: 0, marketCap: 44000 },
  { symbol: 'UNH', name: 'UnitedHealth Group', market: 'us', exchange: 'NYSE', sector: '医疗健康', industry: '保险', currency: 'USD', price: 0, changePct: 0, marketCap: 43000 },
  { symbol: 'XOM', name: 'Exxon Mobil Corp.', market: 'us', exchange: 'NYSE', sector: '能源', industry: '石油', currency: 'USD', price: 0, changePct: 0, marketCap: 42000 },
  { symbol: 'BAC', name: 'Bank of America Corp.', market: 'us', exchange: 'NYSE', sector: '金融', industry: '银行', currency: 'USD', price: 0, changePct: 0, marketCap: 30000 },
  { symbol: 'DIS', name: 'Walt Disney Company', market: 'us', exchange: 'NYSE', sector: '通信服务', industry: '娱乐', currency: 'USD', price: 0, changePct: 0, marketCap: 18000 },
  { symbol: 'NFLX', name: 'Netflix Inc.', market: 'us', exchange: 'NASDAQ', sector: '通信服务', industry: '流媒体', currency: 'USD', price: 0, changePct: 0, marketCap: 25000 },
  { symbol: 'AMD', name: 'Advanced Micro Devices', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '半导体', currency: 'USD', price: 0, changePct: 0, marketCap: 20000 },
  { symbol: 'INTC', name: 'Intel Corporation', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '半导体', currency: 'USD', price: 0, changePct: 0, marketCap: 12000 },
  { symbol: 'BA', name: 'Boeing Company', market: 'us', exchange: 'NYSE', sector: '工业', industry: '航空航天', currency: 'USD', price: 0, changePct: 0, marketCap: 11000 },
];

// ── Hong Kong Stocks ──

const HK_MAJOR: GlobalStock[] = [
  { symbol: '00700', name: '腾讯控股', market: 'hk', exchange: 'HKEX', sector: '信息技术', industry: '互联网', currency: 'HKD', price: 0, changePct: 0, marketCap: 35000 },
  { symbol: '09988', name: '阿里巴巴-SW', market: 'hk', exchange: 'HKEX', sector: '可选消费', industry: '电商', currency: 'HKD', price: 0, changePct: 0, marketCap: 18000 },
  { symbol: '00941', name: '中国移动', market: 'hk', exchange: 'HKEX', sector: '通信服务', industry: '电信', currency: 'HKD', price: 0, changePct: 0, marketCap: 15000 },
  { symbol: '00388', name: '香港交易所', market: 'hk', exchange: 'HKEX', sector: '金融', industry: '交易所', currency: 'HKD', price: 0, changePct: 0, marketCap: 5000 },
  { symbol: '03690', name: '美团-W', market: 'hk', exchange: 'HKEX', sector: '可选消费', industry: '本地生活', currency: 'HKD', price: 0, changePct: 0, marketCap: 8000 },
  { symbol: '09999', name: '网易-S', market: 'hk', exchange: 'HKEX', sector: '通信服务', industry: '游戏', currency: 'HKD', price: 0, changePct: 0, marketCap: 5000 },
  { symbol: '01299', name: '友邦保险', market: 'hk', exchange: 'HKEX', sector: '金融', industry: '保险', currency: 'HKD', price: 0, changePct: 0, marketCap: 8000 },
  { symbol: '02318', name: '中国平安', market: 'hk', exchange: 'HKEX', sector: '金融', industry: '保险', currency: 'HKD', price: 0, changePct: 0, marketCap: 7000 },
  { symbol: '09618', name: '京东集团-SW', market: 'hk', exchange: 'HKEX', sector: '可选消费', industry: '电商', currency: 'HKD', price: 0, changePct: 0, marketCap: 4000 },
  { symbol: '09888', name: '百度集团-SW', market: 'hk', exchange: 'HKEX', sector: '通信服务', industry: '互联网', currency: 'HKD', price: 0, changePct: 0, marketCap: 3000 },
];

// ── Fetch realtime prices via Sina (supports US/HK) ──

export async function fetchGlobalQuotes(stocks: GlobalStock[]): Promise<GlobalStock[]> {
  try {
    const codes = stocks.map(s => {
      if (s.market === 'us') return `gb_${s.symbol.toLowerCase()}`; // 美股
      if (s.market === 'hk') return `rt_hk${s.symbol}`;               // 港股
      return s.symbol;
    }).join(',');

    const resp = await fetch(`https://hq.sinajs.cn/list=${codes}`, {
      headers: { Referer: 'https://finance.sina.com.cn' },
    });
    const text = await resp.text();
    const lines = text.split('\n').filter(Boolean);

    return stocks.map((stock, i) => {
      const line = lines[i] || '';
      const match = line.match(/"([^"]+)"/);
      if (!match) return stock;
      const parts = match[1].split(',');
      if (parts.length < 4) return stock;

      const price = parseFloat(parts[1]) || 0;
      const prevClose = parseFloat(parts[2]) || price;

      return {
        ...stock,
        price,
        changePct: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
      };
    });
  } catch {
    return stocks;
  }
}

export function getGlobalStocks(market?: 'us' | 'hk' | 'all'): GlobalStock[] {
  const all = [...US_MAJOR, ...HK_MAJOR];
  if (!market || market === 'all') return all;
  return all.filter(s => s.market === market);
}

export function getGlobalSectors(): string[] {
  return [...new Set([...US_MAJOR, ...HK_MAJOR].map(s => s.sector))];
}
