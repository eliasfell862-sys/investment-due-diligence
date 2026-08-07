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
  topN: number = 10,
): Promise<StockRecommendation[]> {
  // ── Phase 1: Quick scoring from quote data (fast, all candidates) ──
  const quickScores: { q: StockQuote; score: number; signals: string[] }[] = [];

  for (const q of quotes) {
    if (q.price <= 0) continue;
    let score = 50;
    const signals: string[] = [];

    if (q.changePct > 2) { score += 10; signals.push('今日涨幅>2%'); }
    else if (q.changePct > 0) { score += 5; signals.push('今日收涨'); }
    else if (q.changePct < -3) { score -= 10; }

    if (q.pe > 0 && q.pe < 15) { score += 8; signals.push('PE<15'); }
    else if (q.pe > 0 && q.pe < 25) { score += 4; }
    else if (q.pe > 50) { score -= 5; }

    if (q.turnover > 3 && q.turnover < 15) { score += 5; signals.push('换手率活跃'); }
    if (q.totalCap > 500) { score += 5; }
    if (q.price > q.open && q.open > 0) { score += 3; }

    quickScores.push({ q, score, signals });
  }

  quickScores.sort((a, b) => b.score - a.score);

  // ── Phase 2: Full K-line analysis for top 200 (8-way bounded concurrency) ──
  const topCandidates = quickScores.slice(0, 200);
  const concurrency = 8;

  async function enrich(item: { q: StockQuote; score: number; signals: string[] }) {
    try {
      const klines = await fetchKLineSync(item.q.code);
      if (klines.length >= 20) {
        const { calcAllIndicators } = await import('./technical-indicators');
        calcAllIndicators(klines);
        const last = klines[klines.length - 1] as any;
        const prev = klines[klines.length - 2] as any;

        if (last?.macd && prev?.macd) {
          if (last.macd.bar > 0 && prev.macd.bar <= 0) { item.score += 8; item.signals.push('MACD红柱出现'); }
          if (prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea) { item.score += 10; item.signals.push('MACD金叉'); }
          if (last.macd.dif > last.macd.dea) { item.score += 4; }
        }
        if (last?.kdj) {
          if (last.kdj.j < 20) { item.score += 8; item.signals.push('KDJ超卖'); }
          if (prev?.kdj && prev.kdj.k <= prev.kdj.d && last.kdj.k > last.kdj.d) { item.score += 6; item.signals.push('KDJ金叉'); }
        }
        if (last?.ma && last?.close) {
          if (last.close > last.ma.ma20) { item.score += 5; item.signals.push('站上MA20'); }
          if (last.ma?.ma5 > last.ma?.ma20) { item.score += 4; }
        }
        if (last?.boll && last?.close && last.close <= last.boll.lower * 1.02) { item.score += 7; item.signals.push('接近布林下轨'); }
        if (last?.volume && prev?.volume && last.volume > prev.volume * 1.5) { item.score += 4; item.signals.push('放量'); }
      }
    } catch { /* skip K-line */ }
    item.score = Math.max(0, Math.min(100, Math.round(item.score)));
  }

  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, topCandidates.length) }, async () => {
    while (nextIndex < topCandidates.length) {
      const index = nextIndex;
      nextIndex += 1;
      await enrich(topCandidates[index]!);
    }
  });
  await Promise.all(workers);

  // Sort by final score
  topCandidates.sort((a, b) => b.score - a.score);

  return topCandidates.slice(0, topN).map(item => {
    let summary = '';
    if (item.score >= 80) summary = '强烈推荐 — 多指标共振看多';
    else if (item.score >= 65) summary = '推荐关注 — 技术面偏多';
    else if (item.score >= 50) summary = '中性偏多 — 可跟踪观察';
    else if (item.score >= 35) summary = '暂不建议 — 等待信号明朗';
    else summary = '回避 — 技术面偏空';

    return {
      code: item.q.code, name: item.q.name, price: item.q.price,
      changePct: item.q.changePct, score: item.score,
      signals: item.signals.slice(0, 6), summary,
    };
  });
}
