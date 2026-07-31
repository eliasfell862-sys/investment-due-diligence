/**
 * Stock Recommendation Engine — Technical + Fundamental Bullish Scoring
 *
 * Scores stocks by bullish signal strength across 6 dimensions:
 * MACD, KDJ, RSI, MA trend, BOLL position, Volume
 * Returns top N recommendations with detailed reasoning.
 */

import type { StockQuote } from '../../infrastructure/market-data/stock-api';
import type { StockKLine } from '../../infrastructure/market-data/stock-api';

export interface StockRecommendation {
  code: string;
  name: string;
  price: number;
  changePct: number;
  score: number;       // 0-100 composite bullish score
  signals: string[];   // individual bullish signals found
  summary: string;     // one-line recommendation
}

function fetchKLineSync(_code: string): Promise<StockKLine[]> {
  // Will be called for each stock — use the same API as StockDetailPanel
  return import('../../infrastructure/market-data/stock-api').then(m =>
    m.fetchEastmoneyKLine(_code, 60)
  );
}

export async function recommendStocks(
  quotes: StockQuote[],
  topN: number = 5,
): Promise<StockRecommendation[]> {
  const results: StockRecommendation[] = [];

  // Score each stock based on available quote data + async K-line analysis
  for (const q of quotes) {
    let score = 50; // neutral baseline
    const signals: string[] = [];

    // ── Price & Trend Signals (from quote data) ──

    // Positive momentum (today up)
    if (q.changePct > 2) { score += 10; signals.push('今日涨幅>2%，短期动能强'); }
    else if (q.changePct > 0) { score += 5; signals.push('今日收涨'); }
    else if (q.changePct < -3) { score -= 10; signals.push('今日跌幅>3%，短期承压'); }

    // PE valuation check
    if (q.pe > 0 && q.pe < 15) { score += 8; signals.push('PE<15，估值偏低'); }
    else if (q.pe > 0 && q.pe < 25) { score += 4; signals.push('PE在合理区间'); }
    else if (q.pe > 50) { score -= 5; signals.push('PE>50，估值偏高'); }

    // Turnover — healthy activity
    if (q.turnover > 3 && q.turnover < 15) { score += 5; signals.push('换手率活跃'); }
    else if (q.turnover > 15) { score -= 3; signals.push('换手率过高，需警惕'); }

    // Market cap preference (mid-large cap for stability)
    if (q.totalCap > 500) { score += 3; }
    if (q.totalCap > 1000) { score += 2; }

    // Price relative to open (intraday strength)
    if (q.price > q.open && q.open > 0) { score += 3; signals.push('日内走强（收盘>开盘）'); }

    // ── Try K-line indicator analysis ──
    try {
      const klines = await fetchKLineSync(q.code);
      if (klines.length >= 20) {
        // Use dynamic import to compute indicators
        const { calcAllIndicators } = await import('./technical-indicators');
        calcAllIndicators(klines);

        const last = klines[klines.length - 1] as any;
        const prev = klines[klines.length - 2] as any;

        // MACD
        if (last?.macd && prev?.macd) {
          if (last.macd.bar > 0 && prev.macd.bar <= 0) { score += 8; signals.push('MACD红柱刚出现'); }
          if (prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea) { score += 10; signals.push('MACD金叉'); }
          if (last.macd.dif > last.macd.dea) { score += 4; signals.push('MACD多头排列'); }
        }

        // KDJ
        if (last?.kdj) {
          if (last.kdj.j < 20) { score += 8; signals.push('KDJ超卖区域，反弹概率大'); }
          if (prev?.kdj && prev.kdj.k <= prev.kdj.d && last.kdj.k > last.kdj.d) { score += 6; signals.push('KDJ金叉'); }
        }

        // MA trend
        if (last?.ma && last?.close) {
          if (last.close > last.ma.ma20) { score += 5; signals.push('站上MA20均线'); }
          if (last.ma.ma5 > last.ma.ma20) { score += 4; signals.push('MA5>MA20，短期多头'); }
          if (last.ma.ma10 > last.ma.ma20) { score += 3; }
        }

        // BOLL
        if (last?.boll && last?.close) {
          if (last.close <= last.boll.lower * 1.02) { score += 7; signals.push('接近布林下轨，超跌'); }
          const bollWidth = (last.boll.upper - last.boll.lower) / last.boll.mid;
          if (bollWidth < 0.1) { score += 3; signals.push('布林带收窄，可能变盘'); }
        }

        // Volume increase
        if (last?.volume && prev?.volume) {
          if (last.volume > prev.volume * 1.5) { score += 4; signals.push('放量'); }
        }
      }
    } catch { /* K-line analysis failed, continue with quote-only score */ }

    // Clamp score
    score = Math.max(0, Math.min(100, Math.round(score)));

    // Generate summary
    let summary = '';
    if (score >= 80) summary = '强烈推荐 — 多指标共振看多';
    else if (score >= 65) summary = '推荐关注 — 技术面偏多';
    else if (score >= 50) summary = '中性偏多 — 可跟踪观察';
    else if (score >= 35) summary = '暂不建议 — 等待信号明朗';
    else summary = '回避 — 技术面偏空';

    results.push({ code: q.code, name: q.name, price: q.price, changePct: q.changePct, score, signals: signals.slice(0, 6), summary });
  }

  // Sort by score descending, take top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}
