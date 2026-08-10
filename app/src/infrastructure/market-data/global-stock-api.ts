/**
 * Global Stock Reference (minimal — Chinese market focus)
 * 10 US + 5 HK stocks for cross-market reference only.
 */

export interface GlobalStock {
  symbol: string;
  name: string;
  market: 'us' | 'hk';
  sector: string;
  currency: string;
  price: number;
  changePct: number;
  marketCap: number;
}

const US_STOCKS: GlobalStock[] = [
  { symbol: 'AAPL', name: 'Apple', market: 'us', sector: '科技', currency: 'USD', price: 0, changePct: 0, marketCap: 280000 },
  { symbol: 'MSFT', name: 'Microsoft', market: 'us', sector: '科技', currency: 'USD', price: 0, changePct: 0, marketCap: 250000 },
  { symbol: 'NVDA', name: 'NVIDIA', market: 'us', sector: '半导体', currency: 'USD', price: 0, changePct: 0, marketCap: 160000 },
  { symbol: 'GOOGL', name: 'Alphabet', market: 'us', sector: '互联网', currency: 'USD', price: 0, changePct: 0, marketCap: 180000 },
  { symbol: 'AMZN', name: 'Amazon', market: 'us', sector: '电商', currency: 'USD', price: 0, changePct: 0, marketCap: 170000 },
  { symbol: 'META', name: 'Meta', market: 'us', sector: '互联网', currency: 'USD', price: 0, changePct: 0, marketCap: 120000 },
  { symbol: 'TSLA', name: 'Tesla', market: 'us', sector: '汽车', currency: 'USD', price: 0, changePct: 0, marketCap: 80000 },
  { symbol: 'JPM', name: '摩根大通', market: 'us', sector: '金融', currency: 'USD', price: 0, changePct: 0, marketCap: 50000 },
  { symbol: 'JNJ', name: '强生', market: 'us', sector: '医药', currency: 'USD', price: 0, changePct: 0, marketCap: 45000 },
  { symbol: 'BABA', name: '阿里巴巴', market: 'us', sector: '中概股', currency: 'USD', price: 0, changePct: 0, marketCap: 20000 },
];

const HK_STOCKS: GlobalStock[] = [
  { symbol: '00700', name: '腾讯控股', market: 'hk', sector: '互联网', currency: 'HKD', price: 0, changePct: 0, marketCap: 35000 },
  { symbol: '09988', name: '阿里巴巴-SW', market: 'hk', sector: '电商', currency: 'HKD', price: 0, changePct: 0, marketCap: 18000 },
  { symbol: '00941', name: '中国移动', market: 'hk', sector: '电信', currency: 'HKD', price: 0, changePct: 0, marketCap: 15000 },
  { symbol: '00388', name: '香港交易所', market: 'hk', sector: '金融', currency: 'HKD', price: 0, changePct: 0, marketCap: 5000 },
  { symbol: '03690', name: '美团-W', market: 'hk', sector: '本地生活', currency: 'HKD', price: 0, changePct: 0, marketCap: 8000 },
];

export async function fetchGlobalQuotes(stocks: GlobalStock[]): Promise<GlobalStock[]> {
  try {
    const codes = stocks.map(s => {
      if (s.market === 'us') return `gb_${s.symbol.toLowerCase()}`;
      return `rt_hk${s.symbol}`;
    }).join(',');

    // 走同源代理 /api/sina：浏览器发不了新浪要的 Referer 头（forbidden header，setRequestHeader 被忽略），
    // 由 vite 代理 / Vercel 函数在服务端补 `Referer: https://finance.sina.com.cn`，否则 403。
    const resp = await fetch(`/api/sina/list=${codes}`);
    const text = await resp.text();
    const lines = text.split('\n').filter(Boolean);

    return stocks.map((stock, i) => {
      const line = lines[i] || '';
      const match = line.match(/"([^"]+)"/);
      if (!match) return stock;
      const parts = match[1].split(',');
      if (parts.length < 3) return stock;
      const price = parseFloat(parts[1]) || 0;
      const prevClose = parseFloat(parts[2]) || price;
      return { ...stock, price, changePct: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0 };
    });
  } catch { return stocks; }
}

export function getGlobalStocks(market?: 'us' | 'hk' | 'all'): GlobalStock[] {
  const all = [...US_STOCKS, ...HK_STOCKS];
  if (!market || market === 'all') return all;
  return all.filter(s => s.market === market);
}
