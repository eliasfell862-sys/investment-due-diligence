import type { StockKLine, StockQuote } from '../src/infrastructure/market-data/stock-api';
import { parseTencentKLineResponse } from '../src/infrastructure/market-data/stock-api';

export interface QuoteBatchResult {
  quotes: Record<string, StockQuote>;
  failures: Record<string, string>;
  quoteAt: string;
}

export interface NodeMarketDataProvider {
  fetchQuotes(codes: string[]): Promise<QuoteBatchResult>;
  fetchHistory(code: string, days?: number): Promise<StockKLine[]>;
}

export interface NodeMarketDataDependencies {
  requestText?: (url: string, timeoutMs: number) => Promise<string>;
  now?: () => Date;
}

function marketCode(code: string): string {
  return `${code.startsWith('6') ? 'sh' : 'sz'}${code}`;
}

function uniqueValidCodes(codes: string[]): string[] {
  return [...new Set(codes.map(code => code.trim()).filter(code => /^\d{6}$/.test(code)))].sort();
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function defaultRequestText(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'investment-dd-cloud-signal-worker/1.0' },
  });
  if (!response.ok) throw new Error(`Market data HTTP ${response.status}`);
  return response.text();
}

function parseQuote(text: string, code: string): StockQuote | null {
  const matched = text.match(new RegExp(`v_${marketCode(code)}="([^"]*)"`));
  if (!matched) return null;
  const parts = matched[1].split('~');
  const price = Number.parseFloat(parts[3] ?? '');
  if (parts.length < 30 || !Number.isFinite(price) || price <= 0) return null;
  const preClose = Number.parseFloat(parts[4] ?? '') || price;
  const change = price - preClose;
  return {
    code,
    name: parts[1] || code,
    market: code.startsWith('6') ? 'sh' : 'sz',
    price,
    change,
    changePct: preClose > 0 ? change / preClose * 100 : 0,
    open: Number.parseFloat(parts[5] ?? '') || price,
    high: Number.parseFloat(parts[33] ?? '') || price,
    low: Number.parseFloat(parts[34] ?? '') || price,
    volume: Number.parseFloat(parts[6] ?? '') || 0,
    amount: Number.parseFloat(parts[37] ?? '') || 0,
    preClose,
    turnover: Number.parseFloat(parts[38] ?? '') || 0,
    pe: Number.parseFloat(parts[39] ?? '') || 0,
    pb: Number.parseFloat(parts[46] ?? '') || 0,
    totalShares: 0,
    floatShares: 0,
    totalCap: Number.parseFloat(parts[45] ?? '') || 0,
    floatCap: 0,
  };
}

export function createNodeMarketDataProvider(
  dependencies: NodeMarketDataDependencies = {},
): NodeMarketDataProvider {
  const requestText = dependencies.requestText ?? defaultRequestText;
  const now = dependencies.now ?? (() => new Date());
  return {
    async fetchQuotes(inputCodes) {
      const codes = uniqueValidCodes(inputCodes);
      const quotes: Record<string, StockQuote> = {};
      const failures: Record<string, string> = {};
      for (const batch of chunks(codes, 80)) {
        try {
          const url = `https://qt.gtimg.cn/?q=${batch.map(marketCode).join(',')}`;
          const text = await requestText(url, 12_000);
          for (const code of batch) {
            const quote = parseQuote(text, code);
            if (quote) quotes[code] = quote;
            else failures[code] = 'Missing or invalid real-time quote';
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          for (const code of batch) failures[code] = message;
        }
      }
      return { quotes, failures, quoteAt: now().toISOString() };
    },

    async fetchHistory(code, days = 250) {
      const tcCode = marketCode(code);
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tcCode},day,,,${Math.min(days, 300)},qfq`;
      const text = await requestText(url, 12_000);
      return parseTencentKLineResponse(text, tcCode);
    },
  };
}
