import { fetchEastmoneyKLine, type StockKLine } from './stock-api';
import { requestWithEastmoneyFailover } from './eastmoney-host-failover';

export type CalibrationTurnoverMode = 'direct' | 'proxy';

export interface CalibrationHistoryRow extends StockKLine {
  amplitude: number | null;
  changePct: number;
  change: number;
  turnover: number | null;
}

export interface CalibrationHistoryResult {
  rows: CalibrationHistoryRow[];
  turnoverMode: CalibrationTurnoverMode;
  source: string;
  warnings: string[];
}

export interface WatchlistCalibrationHistoryDependencies {
  requestJson?: (url: string, timeoutMs: number) => Promise<unknown>;
  fallbackKline?: (code: string, days: number) => Promise<StockKLine[]>;
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseCalibrationHistoryResponse(payload: unknown): CalibrationHistoryRow[] {
  const data = payload && typeof payload === 'object'
    ? (payload as { data?: { klines?: unknown } }).data
    : undefined;
  if (!Array.isArray(data?.klines)) return [];

  return data.klines.flatMap(value => {
    const parts = String(value).split(',');
    if (parts.length < 11 || !parts[0]) return [];
    const open = finiteOrNull(parts[1]);
    const close = finiteOrNull(parts[2]);
    const high = finiteOrNull(parts[3]);
    const low = finiteOrNull(parts[4]);
    const volume = finiteOrNull(parts[5]);
    const amount = finiteOrNull(parts[6]);
    if ([open, close, high, low, volume, amount].some(item => item === null)) return [];
    return [{
      date: parts[0], open: open!, close: close!, high: high!, low: low!,
      volume: volume!, amount: amount!, amplitude: finiteOrNull(parts[7]),
      changePct: finiteOrNull(parts[8]) ?? 0, change: finiteOrNull(parts[9]) ?? 0,
      turnover: finiteOrNull(parts[10]),
    }];
  });
}

export function estimateProxyTurnover(
  currentVolume: number,
  priorRows: ReadonlyArray<Pick<StockKLine, 'volume'>>,
): number | null {
  const volumes = priorRows.slice(-20).map(row => row.volume).filter(value => value > 0);
  if (volumes.length < 10 || !Number.isFinite(currentVolume) || currentVolume <= 0) return null;
  const mean = volumes.reduce((sum, value) => sum + value, 0) / volumes.length;
  if (!(mean > 0)) return null;
  return Math.round(Math.min(20, Math.max(0.1, currentVolume / mean * 3)) * 100) / 100;
}

function xhrJson(url: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      try { resolve(JSON.parse(xhr.responseText)); }
      catch { reject(new Error('invalid calibration history json')); }
    };
    xhr.onerror = () => reject(new Error('calibration history request failed'));
    xhr.ontimeout = () => reject(new Error('calibration history request timed out'));
    xhr.send();
  });
}

function proxyRows(rows: StockKLine[]): CalibrationHistoryRow[] {
  return rows.map((row, index) => {
    const previousClose = rows[index - 1]?.close ?? row.open;
    const change = row.close - previousClose;
    return {
      ...row,
      amplitude: null,
      changePct: previousClose > 0 ? change / previousClose * 100 : 0,
      change,
      turnover: estimateProxyTurnover(row.volume, rows.slice(Math.max(0, index - 20), index)),
    };
  });
}

export async function fetchWatchlistCalibrationHistory(
  code: string,
  days = 500,
  dependencies: WatchlistCalibrationHistoryDependencies = {},
): Promise<CalibrationHistoryResult> {
  const requestJson = dependencies.requestJson ?? xhrJson;
  const fallbackKline = dependencies.fallbackKline ?? fetchEastmoneyKLine;
  const secid = (code.startsWith('6') ? '1.' : '0.') + code;
  const limit = Math.min(500, Math.max(1, Math.floor(days)));
  const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid
    + '&klt=101&fqt=1&lmt=' + limit
    + '&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';

  let directRows: CalibrationHistoryRow[] = [];
  try {
    directRows = parseCalibrationHistoryResponse(
      await requestWithEastmoneyFailover(url, requestJson, 12_000),
    );
  } catch {
    directRows = [];
  }

  if (directRows.length > 0
    && directRows.every(row => row.turnover !== null && row.turnover >= 0)) {
    return {
      rows: directRows,
      turnoverMode: 'direct',
      source: '东方财富校准专用历史日线',
      warnings: [],
    };
  }

  const fallbackRows = await fallbackKline(code, limit);
  const baseRows: StockKLine[] = fallbackRows.length > 0
    ? fallbackRows
    : directRows.map(({ date, open, close, high, low, volume, amount }) => (
      { date, open, close, high, low, volume, amount }
    ));
  return {
    rows: proxyRows(baseRows.map(row => ({ ...row }))),
    turnoverMode: 'proxy',
    source: fallbackRows.length > 0 ? '现有历史 K 线校准代理口径' : '东方财富历史日线校准代理口径',
    warnings: ['历史换手率不可完整获取，已使用校准专用代理口径'],
  };
}

