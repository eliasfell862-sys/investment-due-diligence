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

// ── Major US Stocks (50 stocks covering all 11 GICS sectors) ──

const US_MAJOR: GlobalStock[] = [
  // ── 信息技术 Information Technology ──
  { symbol: 'AAPL', name: 'Apple Inc.', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '消费电子', currency: 'USD', price: 0, changePct: 0, marketCap: 280000 },
  { symbol: 'MSFT', name: 'Microsoft Corporation', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '软件', currency: 'USD', price: 0, changePct: 0, marketCap: 250000 },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '半导体', currency: 'USD', price: 0, changePct: 0, marketCap: 160000 },
  { symbol: 'AMD', name: 'Advanced Micro Devices', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '半导体', currency: 'USD', price: 0, changePct: 0, marketCap: 20000 },
  { symbol: 'INTC', name: 'Intel Corporation', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '半导体', currency: 'USD', price: 0, changePct: 0, marketCap: 12000 },
  { symbol: 'CRM', name: 'Salesforce Inc.', market: 'us', exchange: 'NYSE', sector: '信息技术', industry: '软件', currency: 'USD', price: 0, changePct: 0, marketCap: 25000 },
  { symbol: 'CSCO', name: 'Cisco Systems Inc.', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '网络设备', currency: 'USD', price: 0, changePct: 0, marketCap: 20000 },
  { symbol: 'ORCL', name: 'Oracle Corporation', market: 'us', exchange: 'NYSE', sector: '信息技术', industry: '软件', currency: 'USD', price: 0, changePct: 0, marketCap: 35000 },
  { symbol: 'ADBE', name: 'Adobe Inc.', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '软件', currency: 'USD', price: 0, changePct: 0, marketCap: 22000 },
  { symbol: 'QCOM', name: 'Qualcomm Inc.', market: 'us', exchange: 'NASDAQ', sector: '信息技术', industry: '半导体', currency: 'USD', price: 0, changePct: 0, marketCap: 18000 },

  // ── 通信服务 Communication Services ──
  { symbol: 'GOOGL', name: 'Alphabet Inc.', market: 'us', exchange: 'NASDAQ', sector: '通信服务', industry: '互联网', currency: 'USD', price: 0, changePct: 0, marketCap: 180000 },
  { symbol: 'META', name: 'Meta Platforms Inc.', market: 'us', exchange: 'NASDAQ', sector: '通信服务', industry: '互联网', currency: 'USD', price: 0, changePct: 0, marketCap: 120000 },
  { symbol: 'DIS', name: 'Walt Disney Company', market: 'us', exchange: 'NYSE', sector: '通信服务', industry: '娱乐', currency: 'USD', price: 0, changePct: 0, marketCap: 18000 },
  { symbol: 'NFLX', name: 'Netflix Inc.', market: 'us', exchange: 'NASDAQ', sector: '通信服务', industry: '流媒体', currency: 'USD', price: 0, changePct: 0, marketCap: 25000 },
  { symbol: 'T', name: 'AT&T Inc.', market: 'us', exchange: 'NYSE', sector: '通信服务', industry: '电信', currency: 'USD', price: 0, changePct: 0, marketCap: 14000 },
  { symbol: 'VZ', name: 'Verizon Communications Inc.', market: 'us', exchange: 'NYSE', sector: '通信服务', industry: '电信', currency: 'USD', price: 0, changePct: 0, marketCap: 17000 },

  // ── 可选消费 Consumer Discretionary ──
  { symbol: 'AMZN', name: 'Amazon.com Inc.', market: 'us', exchange: 'NASDAQ', sector: '可选消费', industry: '电商', currency: 'USD', price: 0, changePct: 0, marketCap: 170000 },
  { symbol: 'TSLA', name: 'Tesla Inc.', market: 'us', exchange: 'NASDAQ', sector: '可选消费', industry: '汽车', currency: 'USD', price: 0, changePct: 0, marketCap: 80000 },
  { symbol: 'HD', name: 'Home Depot Inc.', market: 'us', exchange: 'NYSE', sector: '可选消费', industry: '家装零售', currency: 'USD', price: 0, changePct: 0, marketCap: 35000 },
  { symbol: 'MCD', name: "McDonald's Corporation", market: 'us', exchange: 'NYSE', sector: '可选消费', industry: '餐饮', currency: 'USD', price: 0, changePct: 0, marketCap: 21000 },
  { symbol: 'NKE', name: 'Nike Inc.', market: 'us', exchange: 'NYSE', sector: '可选消费', industry: '服装', currency: 'USD', price: 0, changePct: 0, marketCap: 15000 },
  { symbol: 'SBUX', name: 'Starbucks Corporation', market: 'us', exchange: 'NASDAQ', sector: '可选消费', industry: '餐饮', currency: 'USD', price: 0, changePct: 0, marketCap: 12000 },

  // ── 金融 Financials ──
  { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', market: 'us', exchange: 'NYSE', sector: '金融', industry: '保险', currency: 'USD', price: 0, changePct: 0, marketCap: 78000 },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', market: 'us', exchange: 'NYSE', sector: '金融', industry: '银行', currency: 'USD', price: 0, changePct: 0, marketCap: 50000 },
  { symbol: 'V', name: 'Visa Inc.', market: 'us', exchange: 'NYSE', sector: '金融', industry: '支付', currency: 'USD', price: 0, changePct: 0, marketCap: 48000 },
  { symbol: 'BAC', name: 'Bank of America Corp.', market: 'us', exchange: 'NYSE', sector: '金融', industry: '银行', currency: 'USD', price: 0, changePct: 0, marketCap: 30000 },
  { symbol: 'MA', name: 'Mastercard Inc.', market: 'us', exchange: 'NYSE', sector: '金融', industry: '支付', currency: 'USD', price: 0, changePct: 0, marketCap: 42000 },
  { symbol: 'GS', name: 'Goldman Sachs Group Inc.', market: 'us', exchange: 'NYSE', sector: '金融', industry: '投行', currency: 'USD', price: 0, changePct: 0, marketCap: 16000 },

  // ── 医疗健康 Health Care ──
  { symbol: 'JNJ', name: 'Johnson & Johnson', market: 'us', exchange: 'NYSE', sector: '医疗健康', industry: '制药', currency: 'USD', price: 0, changePct: 0, marketCap: 45000 },
  { symbol: 'UNH', name: 'UnitedHealth Group', market: 'us', exchange: 'NYSE', sector: '医疗健康', industry: '保险', currency: 'USD', price: 0, changePct: 0, marketCap: 43000 },
  { symbol: 'PFE', name: 'Pfizer Inc.', market: 'us', exchange: 'NYSE', sector: '医疗健康', industry: '制药', currency: 'USD', price: 0, changePct: 0, marketCap: 17000 },
  { symbol: 'ABBV', name: 'AbbVie Inc.', market: 'us', exchange: 'NYSE', sector: '医疗健康', industry: '生物技术', currency: 'USD', price: 0, changePct: 0, marketCap: 28000 },
  { symbol: 'MRK', name: 'Merck & Co. Inc.', market: 'us', exchange: 'NYSE', sector: '医疗健康', industry: '制药', currency: 'USD', price: 0, changePct: 0, marketCap: 30000 },

  // ── 日常消费 Consumer Staples ──
  { symbol: 'WMT', name: 'Walmart Inc.', market: 'us', exchange: 'NYSE', sector: '日常消费', industry: '零售', currency: 'USD', price: 0, changePct: 0, marketCap: 44000 },
  { symbol: 'PG', name: 'Procter & Gamble Co.', market: 'us', exchange: 'NYSE', sector: '日常消费', industry: '日化', currency: 'USD', price: 0, changePct: 0, marketCap: 39000 },
  { symbol: 'KO', name: 'Coca-Cola Company', market: 'us', exchange: 'NYSE', sector: '日常消费', industry: '饮料', currency: 'USD', price: 0, changePct: 0, marketCap: 27000 },
  { symbol: 'PEP', name: 'PepsiCo Inc.', market: 'us', exchange: 'NASDAQ', sector: '日常消费', industry: '饮料', currency: 'USD', price: 0, changePct: 0, marketCap: 24000 },
  { symbol: 'COST', name: 'Costco Wholesale Corp.', market: 'us', exchange: 'NASDAQ', sector: '日常消费', industry: '仓储零售', currency: 'USD', price: 0, changePct: 0, marketCap: 37000 },

  // ── 能源 Energy ──
  { symbol: 'XOM', name: 'Exxon Mobil Corp.', market: 'us', exchange: 'NYSE', sector: '能源', industry: '石油', currency: 'USD', price: 0, changePct: 0, marketCap: 42000 },
  { symbol: 'CVX', name: 'Chevron Corporation', market: 'us', exchange: 'NYSE', sector: '能源', industry: '石油', currency: 'USD', price: 0, changePct: 0, marketCap: 29000 },
  { symbol: 'COP', name: 'ConocoPhillips', market: 'us', exchange: 'NYSE', sector: '能源', industry: '石油', currency: 'USD', price: 0, changePct: 0, marketCap: 13000 },

  // ── 工业 Industrials ──
  { symbol: 'BA', name: 'Boeing Company', market: 'us', exchange: 'NYSE', sector: '工业', industry: '航空航天', currency: 'USD', price: 0, changePct: 0, marketCap: 11000 },
  { symbol: 'CAT', name: 'Caterpillar Inc.', market: 'us', exchange: 'NYSE', sector: '工业', industry: '工程机械', currency: 'USD', price: 0, changePct: 0, marketCap: 16000 },
  { symbol: 'GE', name: 'General Electric Company', market: 'us', exchange: 'NYSE', sector: '工业', industry: '综合工业', currency: 'USD', price: 0, changePct: 0, marketCap: 18000 },
  { symbol: 'UNP', name: 'Union Pacific Corporation', market: 'us', exchange: 'NYSE', sector: '工业', industry: '铁路', currency: 'USD', price: 0, changePct: 0, marketCap: 14000 },
  { symbol: 'HON', name: 'Honeywell International Inc.', market: 'us', exchange: 'NASDAQ', sector: '工业', industry: '综合工业', currency: 'USD', price: 0, changePct: 0, marketCap: 13000 },

  // ── 原材料 Materials ──
  { symbol: 'LIN', name: 'Linde plc', market: 'us', exchange: 'NASDAQ', sector: '原材料', industry: '工业气体', currency: 'USD', price: 0, changePct: 0, marketCap: 22000 },
  { symbol: 'FCX', name: 'Freeport-McMoRan Inc.', market: 'us', exchange: 'NYSE', sector: '原材料', industry: '矿业', currency: 'USD', price: 0, changePct: 0, marketCap: 6500 },
  { symbol: 'NEM', name: 'Newmont Corporation', market: 'us', exchange: 'NYSE', sector: '原材料', industry: '黄金矿业', currency: 'USD', price: 0, changePct: 0, marketCap: 5000 },

  // ── 公用事业 Utilities ──
  { symbol: 'NEE', name: 'NextEra Energy Inc.', market: 'us', exchange: 'NYSE', sector: '公用事业', industry: '电力', currency: 'USD', price: 0, changePct: 0, marketCap: 16000 },
  { symbol: 'SO', name: 'Southern Company', market: 'us', exchange: 'NYSE', sector: '公用事业', industry: '电力', currency: 'USD', price: 0, changePct: 0, marketCap: 9000 },
  { symbol: 'DUK', name: 'Duke Energy Corporation', market: 'us', exchange: 'NYSE', sector: '公用事业', industry: '电力', currency: 'USD', price: 0, changePct: 0, marketCap: 8000 },

  // ── 房地产 Real Estate ──
  { symbol: 'PLD', name: 'Prologis Inc.', market: 'us', exchange: 'NYSE', sector: '房地产', industry: '工业地产', currency: 'USD', price: 0, changePct: 0, marketCap: 11000 },
  { symbol: 'AMT', name: 'American Tower Corporation', market: 'us', exchange: 'NYSE', sector: '房地产', industry: '电信塔', currency: 'USD', price: 0, changePct: 0, marketCap: 10000 },
];

// ── Hong Kong Stocks (20 stocks) ──

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
  // ── 10 additional HK stocks ──
  { symbol: '01810', name: '小米集团-W', market: 'hk', exchange: 'HKEX', sector: '信息技术', industry: '消费电子', currency: 'HKD', price: 0, changePct: 0, marketCap: 6500 },
  { symbol: '02020', name: '安踏体育', market: 'hk', exchange: 'HKEX', sector: '可选消费', industry: '服装', currency: 'HKD', price: 0, changePct: 0, marketCap: 2800 },
  { symbol: '00939', name: '建设银行', market: 'hk', exchange: 'HKEX', sector: '金融', industry: '银行', currency: 'HKD', price: 0, changePct: 0, marketCap: 12000 },
  { symbol: '01398', name: '工商银行', market: 'hk', exchange: 'HKEX', sector: '金融', industry: '银行', currency: 'HKD', price: 0, changePct: 0, marketCap: 15000 },
  { symbol: '02382', name: '舜宇光学科技', market: 'hk', exchange: 'HKEX', sector: '信息技术', industry: '光学器件', currency: 'HKD', price: 0, changePct: 0, marketCap: 800 },
  { symbol: '00175', name: '吉利汽车', market: 'hk', exchange: 'HKEX', sector: '可选消费', industry: '汽车', currency: 'HKD', price: 0, changePct: 0, marketCap: 1200 },
  { symbol: '00883', name: '中国海洋石油', market: 'hk', exchange: 'HKEX', sector: '能源', industry: '石油', currency: 'HKD', price: 0, changePct: 0, marketCap: 9000 },
  { symbol: '01109', name: '华润置地', market: 'hk', exchange: 'HKEX', sector: '房地产', industry: '房地产开发', currency: 'HKD', price: 0, changePct: 0, marketCap: 2000 },
  { symbol: '02688', name: '新奥能源', market: 'hk', exchange: 'HKEX', sector: '公用事业', industry: '燃气供应', currency: 'HKD', price: 0, changePct: 0, marketCap: 1000 },
  { symbol: '02331', name: '李宁', market: 'hk', exchange: 'HKEX', sector: '可选消费', industry: '服装', currency: 'HKD', price: 0, changePct: 0, marketCap: 600 },
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

// ── Yahoo Finance quote result ──

export interface YahooQuote {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  change: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  marketCap: number;
  currency: string;
  exchange: string;
}

// ── Fetch a single stock quote from Yahoo Finance (US/HK) ──

export async function fetchYahooQuote(symbol: string, market: 'us' | 'hk'): Promise<YahooQuote | null> {
  try {
    // Yahoo Finance ticker: US = raw symbol, HK = 4-digit code + ".HK"
    const yahooSymbol = market === 'hk'
      ? `${String(symbol).padStart(4, '0')}.HK`
      : symbol;

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1d`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!resp.ok) return null;

    const json = await resp.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const price = meta?.regularMarketPrice ?? 0;
    const prevClose = meta?.chartPreviousClose ?? meta?.previousClose ?? price;
    const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

    return {
      symbol: meta?.symbol ?? yahooSymbol,
      name: meta?.longName ?? meta?.shortName ?? symbol,
      price,
      changePct,
      change: price - prevClose,
      prevClose,
      open: meta?.regularMarketOpen ?? 0,
      high: meta?.regularMarketDayHigh ?? 0,
      low: meta?.regularMarketDayLow ?? 0,
      volume: meta?.regularMarketVolume ?? 0,
      marketCap: meta?.marketCap ?? 0,
      currency: meta?.currency ?? (market === 'hk' ? 'HKD' : 'USD'),
      exchange: meta?.exchangeName ?? (market === 'hk' ? 'HKEX' : 'NYSE'),
    };
  } catch {
    return null;
  }
}

// ── Fetch multiple quotes from Yahoo (parallel) ──

export async function fetchYahooQuotes(
  stocks: { symbol: string; market: 'us' | 'hk' }[]
): Promise<Map<string, YahooQuote>> {
  const results = await Promise.all(
    stocks.map(s => fetchYahooQuote(s.symbol, s.market).catch(() => null))
  );
  const map = new Map<string, YahooQuote>();
  results.forEach((r, i) => {
    if (r) map.set(stocks[i].symbol, r);
  });
  return map;
}

export function getGlobalStocks(market?: 'us' | 'hk' | 'all'): GlobalStock[] {
  const all = [...US_MAJOR, ...HK_MAJOR];
  if (!market || market === 'all') return all;
  return all.filter(s => s.market === market);
}

export function getGlobalSectors(): string[] {
  return [...new Set([...US_MAJOR, ...HK_MAJOR].map(s => s.sector))];
}
