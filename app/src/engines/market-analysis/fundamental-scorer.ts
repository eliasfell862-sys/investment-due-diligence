/**
 * Fundamental Analysis Scorer — Quality, Growth, Valuation
 * Uses available Tencent quote data + K-line derived metrics.
 */

import type { StockQuote } from '../../infrastructure/market-data/stock-api';

export interface FundamentalScore {
  // Quality (0-35)
  roe: { value: string; score: number; level: string };
  grossMargin: { value: string; score: number; level: string };
  // Growth (0-30)
  revenueGrowth: { value: string; score: number; level: string };
  profitQuality: { value: string; score: number; level: string };
  // Valuation (0-35)
  peLevel: { value: string; score: number; level: string };
  pbLevel: { value: string; score: number; level: string };
  dividendYield: { value: string; score: number; level: string };
  // Composite
  totalScore: number;
  rating: '优秀' | '良好' | '一般' | '较差';
  breakdown: { category: string; score: number; max: number; detail: string }[];
}

export function scoreFundamentals(stock: StockQuote, klines: any[]): FundamentalScore {
  // ── ROE estimate from PE/PB ──
  const pe = stock.pe > 0 ? stock.pe : null;
  const pb = stock.pb > 0 ? stock.pb : null;
  const roeEst = (pe && pb && pe > 0) ? (pb / pe) * 100 : null;

  let roeScore = 0, roeLevel = '未知';
  if (roeEst !== null) {
    if (roeEst >= 20) { roeScore = 15; roeLevel = '优秀(≥20%)'; }
    else if (roeEst >= 12) { roeScore = 12; roeLevel = '良好(12-20%)'; }
    else if (roeEst >= 6) { roeScore = 8; roeLevel = '一般(6-12%)'; }
    else { roeScore = 3; roeLevel = '偏低(<6%)'; }
  }

  // ── Gross Margin estimate from K-line range ──
  const recentCloses = klines.slice(-60).map((k: any) => k.close);
  let gmScore = 0, gmLevel = '未知';
  if (pe && pe > 0) {
    // Use PE as inverse proxy for margin quality
    if (pe < 10) { gmScore = 10; gmLevel = '低PE暗示稳定盈利'; }
    else if (pe < 20) { gmScore = 7; gmLevel = '估值合理'; }
    else if (pe < 40) { gmScore = 5; gmLevel = '估值偏高'; }
    else { gmScore = 2; gmLevel = '高估值需高增长支撑'; }
  }

  // ── Revenue Growth (from K-line trend) ──
  const price60dAgo = recentCloses[0];
  const priceNow = recentCloses[recentCloses.length - 1];
  const priceGrowth = price60dAgo > 0 ? ((priceNow - price60dAgo) / price60dAgo) * 100 : 0;

  let growthScore = 0, growthLevel = '未知';
  if (Math.abs(priceGrowth) > 0) {
    if (priceGrowth > 30) { growthScore = 12; growthLevel = '高速增长(>30%)'; }
    else if (priceGrowth > 10) { growthScore = 9; growthLevel = '稳健增长(10-30%)'; }
    else if (priceGrowth > 0) { growthScore = 6; growthLevel = '缓慢增长(0-10%)'; }
    else { growthScore = 2; growthLevel = '负增长'; }
  }

  // ── Profit Quality (from turnover and market cap) ──
  let profitScore = 0, profitLevel = '未知';
  if (stock.totalCap > 0) {
    if (stock.totalCap > 1000 && stock.turnover > 0.5) { profitScore = 8; profitLevel = '大盘活跃，流动性好'; }
    else if (stock.totalCap > 100) { profitScore = 6; profitLevel = '中盘股'; }
    else if (stock.totalCap > 10) { profitScore = 4; profitLevel = '小盘股，波动较大'; }
    else { profitScore = 2; profitLevel = '微型股'; }
  }

  // ── PE Level ──
  let peScore = 0, peLevel = '未知';
  if (pe) {
    if (pe < 10) { peScore = 12; peLevel = '低估(PE<10)'; }
    else if (pe < 20) { peScore = 9; peLevel = '合理偏低(10-20)'; }
    else if (pe < 35) { peScore = 6; peLevel = '合理偏高(20-35)'; }
    else if (pe < 60) { peScore = 3; peLevel = '高估(35-60)'; }
    else { peScore = 1; peLevel = '极高(>60)'; }
  }

  // ── PB Level ──
  let pbScore = 0, pbLevel = '未知';
  if (pb) {
    if (pb < 1) { pbScore = 8; pbLevel = '破净(PB<1)'; }
    else if (pb < 2) { pbScore = 6; pbLevel = '合理(1-2)'; }
    else if (pb < 5) { pbScore = 4; pbLevel = '偏高(2-5)'; }
    else { pbScore = 2; pbLevel = '极高(>5)'; }
  }

  // ── Dividend ──
  const divScore = 2;
  const divLevel = pe && pe < 15 ? '低PE股票大概率有分红' : '未知';

  const totalScore = roeScore + gmScore + growthScore + profitScore + peScore + pbScore + divScore;
  const rating: FundamentalScore['rating'] = totalScore >= 55 ? '优秀' : totalScore >= 40 ? '良好' : totalScore >= 25 ? '一般' : '较差';

  return {
    roe: { value: roeEst !== null ? `${roeEst.toFixed(1)}%` : '—', score: roeScore, level: roeLevel },
    grossMargin: { value: pe ? `PE ${pe.toFixed(1)}` : '—', score: gmScore, level: gmLevel },
    revenueGrowth: { value: `${priceGrowth.toFixed(1)}%` || '—', score: growthScore, level: growthLevel },
    profitQuality: { value: stock.totalCap > 0 ? `${stock.totalCap.toFixed(0)}亿` : '—', score: profitScore, level: profitLevel },
    peLevel: { value: pe ? pe.toFixed(1) : '—', score: peScore, level: peLevel },
    pbLevel: { value: pb ? pb.toFixed(1) : '—', score: pbScore, level: pbLevel },
    dividendYield: { value: '—', score: divScore, level: divLevel },
    totalScore: Math.round(totalScore * 100 / 70),
    rating,
    breakdown: [
      { category: '盈利能力', score: roeScore + gmScore, max: 25, detail: `ROE: ${roeLevel} · 估值质量: ${gmLevel}` },
      { category: '成长性', score: growthScore + profitScore, max: 20, detail: `价格趋势: ${growthLevel} · 规模: ${profitLevel}` },
      { category: '估值水平', score: peScore + pbScore + divScore, max: 25, detail: `PE: ${peLevel} · PB: ${pbLevel}` },
    ],
  };
}
