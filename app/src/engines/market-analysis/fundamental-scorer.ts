/**
 * Fundamental Analysis Scorer — Quality, Growth, Valuation, Risk.
 * Uses real Eastmoney financial data when available, falls back to estimates.
 */

import type { StockQuote, DailyBasicData } from '../../infrastructure/market-data/stock-api';

export interface FundamentalScore {
  totalScore: number;
  rating: '优秀' | '良好' | '一般' | '较差';
  breakdown: { category: string; score: number; max: number; detail: string }[];
  metrics: { label: string; value: string; score: number; level: string; color: string }[];
}

function levelColor(score: number, max: number): string {
  const ratio = score / max;
  if (ratio >= 0.7) return '#d4a574';
  if (ratio >= 0.4) return '#70b8b0';
  return '#f0b870';
}

export function scoreFundamentals(stock: StockQuote, klines: any[], financial?: DailyBasicData | null): FundamentalScore {
  const N = (v: any) => Number(v) || 0;
  const pe = N(financial?.peTTM) || stock.pe || 0;
  const pb = N(financial?.pb) || stock.pb || 0;
  const roeReal = N(financial?.roe);
  const roaReal = N(financial?.roa);
  const grossMargin = N(financial?.grossMargin);
  const revenueGrowth = N(financial?.revenueGrowth);
  const profitGrowth = N(financial?.profitGrowth);
  const debtRatio = N(financial?.debtRatio);
  const currentRatio = N(financial?.currentRatio);
  const divYield = N(financial?.dividendYield);
  const hasReal = !!financial;

  const recentCloses = klines.slice(-60).map((k: any) => k.close);
  const price60dAgo = recentCloses[0];
  const priceNow = recentCloses[recentCloses.length - 1];
  const priceGrowth = price60dAgo > 0 ? ((priceNow - price60dAgo) / price60dAgo) * 100 : 0;

  // ── Quality (0-30) ──
  let roeScore = 0; let roeLevel = '';
  if (roeReal > 0) {
    if (roeReal >= 20) { roeScore = 15; roeLevel = `优秀 ROE=${roeReal.toFixed(1)}%`; }
    else if (roeReal >= 12) { roeScore = 12; roeLevel = `良好 ROE=${roeReal.toFixed(1)}%`; }
    else if (roeReal >= 6) { roeScore = 8; roeLevel = `一般 ROE=${roeReal.toFixed(1)}%`; }
    else { roeScore = 3; roeLevel = `偏低 ROE=${roeReal.toFixed(1)}%`; }
  } else if (pe > 0 && pb > 0) {
    const roeEst = (pb / pe) * 100;
    if (roeEst >= 20) { roeScore = 12; roeLevel = `估算ROE≈${roeEst.toFixed(1)}%`; }
    else if (roeEst >= 12) { roeScore = 9; roeLevel = `估算ROE≈${roeEst.toFixed(1)}%`; }
    else if (roeEst >= 6) { roeScore = 6; roeLevel = `估算ROE≈${roeEst.toFixed(1)}%`; }
    else { roeScore = 2; roeLevel = `估算ROE≈${roeEst.toFixed(1)}%`; }
  }

  let gmScore = 0; let gmLevel = '';
  if (grossMargin > 0) {
    if (grossMargin >= 60) { gmScore = 15; gmLevel = `高毛利 ${grossMargin.toFixed(1)}%`; }
    else if (grossMargin >= 30) { gmScore = 12; gmLevel = `中等毛利 ${grossMargin.toFixed(1)}%`; }
    else if (grossMargin >= 15) { gmScore = 8; gmLevel = `低毛利 ${grossMargin.toFixed(1)}%`; }
    else { gmScore = 4; gmLevel = `微利 ${grossMargin.toFixed(1)}%`; }
  } else if (pe > 0) {
    if (pe < 10) { gmScore = 8; gmLevel = '低PE暗示盈利稳定'; }
    else if (pe < 25) { gmScore = 6; gmLevel = 'PE合理'; }
    else { gmScore = 3; gmLevel = '高PE待验证'; }
  }

  // ── Growth (0-25) ──
  let growthScore = 0; let growthLevel = '';
  let profitScore = 0; let profitLevel = '';

  if (revenueGrowth !== 0) {
    if (revenueGrowth >= 30) { growthScore = 13; growthLevel = `营收高增 ${revenueGrowth.toFixed(1)}%`; }
    else if (revenueGrowth >= 10) { growthScore = 10; growthLevel = `营收稳增 ${revenueGrowth.toFixed(1)}%`; }
    else if (revenueGrowth >= 0) { growthScore = 6; growthLevel = `营收持平 ${revenueGrowth.toFixed(1)}%`; }
    else { growthScore = 2; growthLevel = `营收下滑 ${revenueGrowth.toFixed(1)}%`; }

    if (profitGrowth >= 50) { profitScore = 12; profitLevel = `利润高增 ${profitGrowth.toFixed(1)}%`; }
    else if (profitGrowth >= 20) { profitScore = 9; profitLevel = `利润稳增 ${profitGrowth.toFixed(1)}%`; }
    else if (profitGrowth >= 0) { profitScore = 5; profitLevel = `利润持平 ${profitGrowth.toFixed(1)}%`; }
    else { profitScore = 2; profitLevel = `利润下滑 ${profitGrowth.toFixed(1)}%`; }
  } else {
    // Fallback: use price trend as growth proxy
    if (priceGrowth > 30) { growthScore = 8; growthLevel = `价格趋势强(${priceGrowth.toFixed(0)}%)`; }
    else if (priceGrowth > 10) { growthScore = 6; growthLevel = `价格趋势稳(${priceGrowth.toFixed(0)}%)`; }
    else if (priceGrowth > 0) { growthScore = 4; growthLevel = `价格横盘(${priceGrowth.toFixed(0)}%)`; }
    else { growthScore = 2; growthLevel = `价格走弱(${priceGrowth.toFixed(0)}%)`; }

    if (stock.totalCap > 1000) { profitScore = 6; profitLevel = `大盘 ${stock.totalCap.toFixed(0)}亿`; }
    else if (stock.totalCap > 100) { profitScore = 4; profitLevel = `中盘 ${stock.totalCap.toFixed(0)}亿`; }
    else { profitScore = 2; profitLevel = `小盘 ${stock.totalCap.toFixed(0)}亿`; }
  }

  // ── Valuation (0-25) ──
  let peScore = 0; let peLevel = '';
  if (pe > 0) {
    if (pe < 10) { peScore = 10; peLevel = `低估 PE=${pe.toFixed(1)}`; }
    else if (pe < 20) { peScore = 8; peLevel = `合理偏低 PE=${pe.toFixed(1)}`; }
    else if (pe < 35) { peScore = 5; peLevel = `合理偏高 PE=${pe.toFixed(1)}`; }
    else if (pe < 60) { peScore = 3; peLevel = `高估 PE=${pe.toFixed(1)}`; }
    else { peScore = 1; peLevel = `极高 PE=${pe.toFixed(1)}`; }
  }

  let pbScore = 0; let pbLevel = '';
  if (pb > 0) {
    if (pb < 1) { pbScore = 8; pbLevel = `破净 PB=${pb.toFixed(2)}`; }
    else if (pb < 2) { pbScore = 6; pbLevel = `合理 PB=${pb.toFixed(2)}`; }
    else if (pb < 5) { pbScore = 4; pbLevel = `偏高 PB=${pb.toFixed(2)}`; }
    else { pbScore = 2; pbLevel = `极高 PB=${pb.toFixed(2)}`; }
  }

  let divScore = 0; let divLevel = '';
  if (divYield > 0) {
    if (divYield >= 4) { divScore = 7; divLevel = `高股息 ${divYield.toFixed(2)}%`; }
    else if (divYield >= 2) { divScore = 5; divLevel = `中等股息 ${divYield.toFixed(2)}%`; }
    else { divScore = 3; divLevel = `低股息 ${divYield.toFixed(2)}%`; }
  } else if (pe > 0 && pe < 15) {
    divScore = 3; divLevel = '低PE通常伴随分红';
  }

  // ── Risk (0-20) ──
  let riskScore = 0; let riskLevel = '';
  if (debtRatio > 0) {
    if (debtRatio < 30) { riskScore = 10; riskLevel = `低负债 ${debtRatio.toFixed(1)}%`; }
    else if (debtRatio < 50) { riskScore = 8; riskLevel = `适中负债 ${debtRatio.toFixed(1)}%`; }
    else if (debtRatio < 70) { riskScore = 5; riskLevel = `偏高负债 ${debtRatio.toFixed(1)}%`; }
    else { riskScore = 2; riskLevel = `高负债 ${debtRatio.toFixed(1)}%`; }
  } else if (stock.totalCap > 0) {
    if (stock.totalCap > 500) { riskScore = 7; riskLevel = '大盘股风险较低'; }
    else if (stock.totalCap > 100) { riskScore = 5; riskLevel = '中盘股风险适中'; }
    else { riskScore = 3; riskLevel = '小盘股波动较大'; }
  }

  const totalScore = roeScore + gmScore + growthScore + profitScore + peScore + pbScore + divScore + riskScore;
  const rating: FundamentalScore['rating'] =
    totalScore >= 65 ? '优秀' : totalScore >= 45 ? '良好' : totalScore >= 28 ? '一般' : '较差';

  const sourceLabel = hasReal ? '📊 东方财富财务数据' : '⚠️ 基于行情估算';

  return {
    totalScore: Math.round(totalScore),
    rating,
    breakdown: [
      { category: '盈利能力', score: roeScore + gmScore, max: 30, detail: `${sourceLabel} · ROE: ${roeLevel} · 毛利: ${gmLevel}` },
      { category: '成长性', score: growthScore + profitScore, max: 25, detail: `营收: ${growthLevel} · 利润: ${profitLevel}` },
      { category: '估值水平', score: peScore + pbScore + divScore, max: 25, detail: `PE: ${peLevel} · PB: ${pbLevel} · 股息: ${divLevel}` },
      { category: '风险质量', score: riskScore, max: 20, detail: `负债: ${riskLevel}${roaReal > 0 ? ` · ROA=${roaReal.toFixed(1)}%` : ''}${currentRatio > 0 ? ` · 流动比=${currentRatio.toFixed(2)}` : ''}` },
    ],
    metrics: [
      { label: 'ROE', value: roeReal > 0 ? `${roeReal.toFixed(1)}%` : '—', score: roeScore, level: roeLevel, color: levelColor(roeScore, 15) },
      { label: '毛利率', value: grossMargin > 0 ? `${grossMargin.toFixed(1)}%` : '—', score: gmScore, level: gmLevel, color: levelColor(gmScore, 15) },
      { label: '营收增速', value: revenueGrowth !== 0 ? `${revenueGrowth.toFixed(1)}%` : '—', score: growthScore, level: growthLevel, color: levelColor(growthScore, 13) },
      { label: '利润增速', value: profitGrowth !== 0 ? `${profitGrowth.toFixed(1)}%` : '—', score: profitScore, level: profitLevel, color: levelColor(profitScore, 12) },
      { label: 'PE(TTM)', value: pe > 0 ? pe.toFixed(1) : '—', score: peScore, level: peLevel, color: levelColor(peScore, 10) },
      { label: 'PB', value: pb > 0 ? pb.toFixed(2) : '—', score: pbScore, level: pbLevel, color: levelColor(pbScore, 8) },
      { label: '负债率', value: debtRatio > 0 ? `${debtRatio.toFixed(1)}%` : '—', score: riskScore, level: riskLevel, color: levelColor(riskScore, 10) },
      { label: '股息率', value: divYield > 0 ? `${divYield.toFixed(2)}%` : '—', score: divScore, level: divLevel, color: levelColor(divScore, 7) },
    ],
  };
}
