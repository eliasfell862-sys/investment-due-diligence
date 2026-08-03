/**
 * K-line Pattern Recognition — TypeScript port of InStock/TA-Lib patterns.
 * 10 most important A-share candlestick patterns.
 */

export interface PatternResult {
  name: string;        // 中文名
  type: 'bullish' | 'bearish' | 'neutral';
  strength: '强' | '中' | '弱';
  description: string;
  position: number;    // K-line index where pattern was found
}

type KBar = { open: number; high: number; low: number; close: number };

// ── Helpers ──

function realBody(k: KBar): number { return Math.abs(k.close - k.open); }
function upperShadow(k: KBar): number { return k.high - Math.max(k.open, k.close); }
function lowerShadow(k: KBar): number { return Math.min(k.open, k.close) - k.low; }
function isRed(k: KBar): boolean { return k.close > k.open; }
function isGreen(k: KBar): boolean { return k.close < k.open; }

// ── 1. 锤头 (Hammer) — bullish reversal ──

function isHammer(k: KBar, prevTrend: 'up' | 'down'): boolean {
  if (prevTrend !== 'down') return false;
  const body = realBody(k);
  const lower = lowerShadow(k);
  const upper = upperShadow(k);
  if (body === 0) return false;
  return lower >= body * 2 && upper <= body * 0.3;
}

// ── 2. 倒锤头 (Inverted Hammer) — bullish reversal ──

function isInvertedHammer(k: KBar, prevTrend: 'up' | 'down'): boolean {
  if (prevTrend !== 'down') return false;
  const body = realBody(k);
  const upper = upperShadow(k);
  const lower = lowerShadow(k);
  if (body === 0) return false;
  return upper >= body * 2 && lower <= body * 0.3;
}

// ── 3. 射击之星 (Shooting Star) — bearish reversal ──

function isShootingStar(k: KBar, prevTrend: 'up' | 'down'): boolean {
  if (prevTrend !== 'up') return false;
  const body = realBody(k);
  const upper = upperShadow(k);
  const lower = lowerShadow(k);
  if (body === 0) return false;
  return upper >= body * 2 && lower <= body * 0.3;
}

// ── 4. 十字星 (Doji) — indecision ──

function isDoji(k: KBar): boolean {
  const body = realBody(k);
  const range = k.high - k.low;
  if (range === 0) return false;
  return body <= range * 0.1;
}

// ── 5. 穿头破脚 (Engulfing) — bullish/bearish ──

function isBullishEngulfing(curr: KBar, prev: KBar): boolean {
  return isGreen(prev) && isRed(curr) &&
    curr.open <= prev.close && curr.close >= prev.open &&
    realBody(curr) > realBody(prev);
}
function isBearishEngulfing(curr: KBar, prev: KBar): boolean {
  return isRed(prev) && isGreen(curr) &&
    curr.open >= prev.close && curr.close <= prev.open &&
    realBody(curr) > realBody(prev);
}

// ── 6. 早晨之星 (Morning Star) — 3-bar bullish reversal ──

function isMorningStar(k1: KBar, k2: KBar, k3: KBar, prevTrend: 'up' | 'down'): boolean {
  if (prevTrend !== 'down') return false;
  return isGreen(k1) && realBody(k1) > realBody(k3) * 0.3 &&  // Day 1: big red
    realBody(k2) < realBody(k1) * 0.3 &&                         // Day 2: small body
    isRed(k3) && k3.close > (k1.open + k1.close) / 2;           // Day 3: green, closes above midpoint
}

// ── 7. 黄昏之星 (Evening Star) — 3-bar bearish reversal ──

function isEveningStar(k1: KBar, k2: KBar, k3: KBar, prevTrend: 'up' | 'down'): boolean {
  if (prevTrend !== 'up') return false;
  return isRed(k1) && realBody(k1) > realBody(k3) * 0.3 &&
    realBody(k2) < realBody(k1) * 0.3 &&
    isGreen(k3) && k3.close < (k1.open + k1.close) / 2;
}

// ── 8. 三只乌鸦 (Three Black Crows) — 3-bar bearish ──

function isThreeBlackCrows(k1: KBar, k2: KBar, k3: KBar): boolean {
  return isGreen(k1) && isGreen(k2) && isGreen(k3) &&
    k1.close < k1.open && k2.close < k2.open && k3.close < k3.open &&
    k2.open < k1.open && k2.open > k1.close &&
    k3.open < k2.open && k3.open > k2.close &&
    k3.close < k1.close;
}

// ── 9. 乌云盖顶 (Dark Cloud Cover) — 2-bar bearish reversal ──

function isDarkCloudCover(curr: KBar, prev: KBar): boolean {
  return isRed(prev) && realBody(prev) > 0 &&
    curr.open > prev.high &&                                    // Gap up
    isGreen(curr) &&                                             // Close red
    curr.close < (prev.open + prev.close) / 2 &&                // Below midpoint
    curr.close > prev.open;                                      // Not below prev open
}

// ── 10. 曙光初现 (Piercing Pattern) — 2-bar bullish reversal ──

function isPiercingPattern(curr: KBar, prev: KBar): boolean {
  return isGreen(prev) && realBody(prev) > 0 &&
    curr.open < prev.low &&                                      // Gap down
    isRed(curr) &&                                                // Close green
    curr.close > (prev.open + prev.close) / 2 &&                 // Above midpoint
    curr.close < prev.open;                                       // Not above prev open
}

// ── Trend Detection ──

function detectTrend(klines: KBar[], index: number, lookback: number = 5): 'up' | 'down' {
  if (index < lookback) return 'down';
  let ups = 0;
  for (let i = index - lookback + 1; i <= index; i++) {
    if (klines[i].close > klines[i - 1].close) ups++;
  }
  return ups >= lookback / 2 ? 'up' : 'down';
}

// ── Main Pattern Scanner ──

export function scanPatterns(klines: KBar[]): PatternResult[] {
  const results: PatternResult[] = [];
  const n = klines.length;
  if (n < 3) return results;

  const last = n - 1;
  const prev = n - 2;
  const prev2 = n - 3;

  const trend = detectTrend(klines, last);

  // Single-bar patterns
  if (isHammer(klines[last], trend)) {
    results.push({ name: '锤头', type: 'bullish', strength: '中', description: '下影线≥实体2倍，空方衰竭信号，可能反转上涨', position: last });
  }
  if (isInvertedHammer(klines[last], trend)) {
    results.push({ name: '倒锤头', type: 'bullish', strength: '中', description: '上影线≥实体2倍，出现在下跌趋势中，次日收阳确认反转', position: last });
  }
  if (isShootingStar(klines[last], trend)) {
    results.push({ name: '射击之星', type: 'bearish', strength: '中', description: '上影线≥实体2倍，出现在上涨趋势中，可能见顶回落', position: last });
  }
  if (isDoji(klines[last])) {
    results.push({ name: '十字星', type: 'neutral', strength: '弱', description: '实体极小，多空平衡，次日方向决定短期走势', position: last });
  }

  // Two-bar patterns
  if (isBullishEngulfing(klines[last], klines[prev])) {
    results.push({ name: '穿头破脚(看多)', type: 'bullish', strength: '强', description: '阳线实体完全吞没前一根阴线，多头强势反击', position: last });
  }
  if (isBearishEngulfing(klines[last], klines[prev])) {
    results.push({ name: '穿头破脚(看空)', type: 'bearish', strength: '强', description: '阴线实体完全吞没前一根阳线，空头强势反击', position: last });
  }
  if (isDarkCloudCover(klines[last], klines[prev])) {
    results.push({ name: '乌云盖顶', type: 'bearish', strength: '中', description: '高开低走，收盘低于前日中点，上涨趋势可能终结', position: last });
  }
  if (isPiercingPattern(klines[last], klines[prev])) {
    results.push({ name: '曙光初现', type: 'bullish', strength: '中', description: '低开高走，收盘高于前日中点，下跌趋势可能终结', position: last });
  }

  // Three-bar patterns
  if (n >= 3) {
    if (isMorningStar(klines[prev2], klines[prev], klines[last], detectTrend(klines, prev2))) {
      results.push({ name: '早晨之星', type: 'bullish', strength: '强', description: '三日反转形态：大阴+小星+大阳，底部反转信号', position: last });
    }
    if (isEveningStar(klines[prev2], klines[prev], klines[last], detectTrend(klines, prev2))) {
      results.push({ name: '黄昏之星', type: 'bearish', strength: '强', description: '三日反转形态：大阳+小星+大阴，顶部反转信号', position: last });
    }
    if (isThreeBlackCrows(klines[prev2], klines[prev], klines[last])) {
      results.push({ name: '三只乌鸦', type: 'bearish', strength: '强', description: '连续三根阴线，每根开盘在前一日实体之内，持续看跌', position: last });
    }
  }

  // Sort: strongest first, limited to most recent bars
  return results.filter(r => r.position >= last - 3).sort((a, b) => {
    const strength = { '强': 3, '中': 2, '弱': 1 };
    return (strength[b.strength] || 0) - (strength[a.strength] || 0);
  });
}
