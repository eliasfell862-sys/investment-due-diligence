export type MarketDataMode = 'realtime' | 'delayed' | 'cached' | 'static';
export type MarketDataStatus = 'idle' | 'loading' | 'success' | 'partial' | 'empty' | 'stale' | 'error';

export interface MarketDataResult<T> {
  data: T;
  meta: MarketDataMeta;
}

export interface MarketDataMeta {
  source: string;
  mode: MarketDataMode;
  status: MarketDataStatus;
  asOf?: string;
  error?: string;
}

export function createMarketDataMeta(meta: MarketDataMeta): MarketDataMeta {
  return {
    source: meta.source.trim() || '\u672a\u77e5\u6765\u6e90',
    mode: meta.mode,
    status: meta.status,
    asOf: meta.asOf,
    error: meta.error,
  };
}

export function currentMarketDataTime(): string {
  return new Date().toISOString();
}
