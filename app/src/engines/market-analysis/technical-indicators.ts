/**
 * Technical Indicators Engine — TypeScript port of InStock's indicator calculations.
 * All formulas aligned with 同花顺/通达信 conventions.
 */
import type { StockKLine } from '../../infrastructure/market-data/stock-api';

export interface IndicatorOutput {
  date: string;
  close: number;
  macd?: { dif: number; dea: number; bar: number };
  kdj?: { k: number; d: number; j: number };
  rsi?: { rsi6: number; rsi12: number; rsi24: number };
  boll?: { upper: number; mid: number; lower: number };
  ma?: { ma5: number; ma10: number; ma20: number; ma60: number };
  obv?: number;
  atr?: number;
}

// ── EMA ──
function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (prev === null) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[i - j];
      prev = sum / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    result.push(prev);
  }
  return result;
}

// ── SMA (reserved for KDJ) ──
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _sma(values: number[], n: number, m: number): (number | null)[] {
  const result: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) { prev = values[i]; result.push(prev); continue; }
    prev = (m * values[i] + (n - m) * prev) / n;
    result.push(prev);
  }
  return result;
}

// ── MACD (12, 26, 9) ──
export function calcMACD(klines: StockKLine[]): void {
  const closes = klines.map(k => k.close);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const difs: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (ema12[i] === null || ema26[i] === null) difs.push(null);
    else difs.push(ema12[i]! - ema26[i]!);
  }
  const difVals = difs.map(d => d ?? 0);
  const dea = ema(difVals, 9);

  for (let i = 0; i < klines.length; i++) {
    const dif = difs[i];
    const d = dea[i];
    if (dif === null || d === null) continue;
    (klines[i] as any).macd = { dif: Math.round(dif * 100) / 100, dea: Math.round(d * 100) / 100, bar: Math.round((dif - d) * 2 * 100) / 100 };
  }
}

// ── KDJ (9, 3, 3) ──
export function calcKDJ(klines: StockKLine[]): void {
  const n = 9;
  let k = 50, d = 50;
  for (let i = 0; i < klines.length; i++) {
    if (i < n - 1) { (klines[i] as any).kdj = { k: 50, d: 50, j: 50 }; continue; }
    let high = -Infinity, low = Infinity;
    for (let j = i - n + 1; j <= i; j++) { high = Math.max(high, klines[j].high); low = Math.min(low, klines[j].low); }
    const rsv = low < high ? ((klines[i].close - low) / (high - low)) * 100 : 50;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    const j = 3 * k - 2 * d;
    (klines[i] as any).kdj = { k: Math.round(k * 100) / 100, d: Math.round(d * 100) / 100, j: Math.round(j * 100) / 100 };
  }
}

// ── RSI (6, 12, 24) ──
export function calcRSI(klines: StockKLine[], periods: number[] = [6, 12, 24]): void {
  for (const n of periods) {
    const gains: number[] = [], losses: number[] = [];
    for (let i = 1; i < klines.length; i++) {
      const diff = klines[i].close - klines[i - 1].close;
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    const avgGain = ema(gains, n);
    const avgLoss = ema(losses, n);
    const key = `rsi${n}` as string;
    for (let i = 0; i < klines.length; i++) {
      const g = avgGain[i], l = avgLoss[i];
      if (g === null || l === null) continue;
      const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      if (!(klines[i] as any).rsi) (klines[i] as any).rsi = {};
      (klines[i] as any).rsi[key] = Math.round(rsi * 100) / 100;
    }
  }
}

// ── BOLL (20, 2) ──
export function calcBOLL(klines: StockKLine[], period: number = 20, multiplier: number = 2): void {
  const closes = klines.map(k => k.close);
  for (let i = period - 1; i < klines.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mid = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += Math.pow(closes[j] - mid, 2);
    const std = Math.sqrt(variance / period);
    (klines[i] as any).boll = {
      mid: Math.round(mid * 100) / 100,
      upper: Math.round((mid + multiplier * std) * 100) / 100,
      lower: Math.round((mid - multiplier * std) * 100) / 100,
    };
  }
}

// ── MA (5, 10, 20, 60) ──
export function calcMA(klines: StockKLine[], periods: number[] = [5, 10, 20, 60]): void {
  const closes = klines.map(k => k.close);
  for (const n of periods) {
    const key = `ma${n}` as string;
    for (let i = 0; i < klines.length; i++) {
      if (i < n - 1) continue;
      let sum = 0;
      for (let j = i - n + 1; j <= i; j++) sum += closes[j];
      if (!(klines[i] as any).ma) (klines[i] as any).ma = {};
      (klines[i] as any).ma[key] = Math.round(sum / n * 100) / 100;
    }
  }
}

// ── OBV ──
export function calcOBV(klines: StockKLine[]): void {
  let obv = 0;
  for (let i = 0; i < klines.length; i++) {
    if (i === 0) { (klines[i] as any).obv = obv; continue; }
    if (klines[i].close > klines[i - 1].close) obv += klines[i].volume;
    else if (klines[i].close < klines[i - 1].close) obv -= klines[i].volume;
    (klines[i] as any).obv = obv;
  }
}

// ── ATR (14) ──
export function calcATR(klines: StockKLine[], period: number = 14): void {
  const trs: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (i === 0) { trs.push(klines[i].high - klines[i].low); continue; }
    trs.push(Math.max(
      klines[i].high - klines[i].low,
      Math.abs(klines[i].high - klines[i - 1].close),
      Math.abs(klines[i].low - klines[i - 1].close)
    ));
  }
  const atrVals = ema(trs, period);
  for (let i = 0; i < klines.length; i++) {
    if (atrVals[i] !== null) (klines[i] as any).atr = Math.round(atrVals[i]! * 100) / 100;
  }
}

// ── All-in-one ──
export function calcAllIndicators(klines: StockKLine[]): void {
  calcMACD(klines);
  calcKDJ(klines);
  calcRSI(klines);
  calcBOLL(klines);
  calcMA(klines);
  calcOBV(klines);
  calcATR(klines);
}
