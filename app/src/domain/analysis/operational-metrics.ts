/**
 * Derives investment-relevant metrics from operational data modules
 * (sales, procurement, financing history, contracts).
 * These feed into risk scoring, financial quality, and decision engines.
 */
/* ── Operational Metrics ── */
// Pure computation from raw operational data. No Decimal needed for basic arithmetic.

export interface CustomerConcentration {
  top1Pct: string;      // 第一大客户收入占比
  top3Pct: string;      // 前三大客户收入占比
  top5Pct: string;      // 前五大客户收入占比
  customerCount: number;
  herfindahlIndex: string; // HHI 指数
  risk: 'low' | 'medium' | 'high'; // 客户集中度风险
}

export interface RevenueGrowth {
  cagr: string;         // 复合年增长率
  yoy2024: string;      // 2024 同比增长
  yoy2025: string;      // 2025 同比增长
  trend: 'accelerating' | 'stable' | 'decelerating' | 'volatile';
  risk: 'low' | 'medium' | 'high';
}

export function computeCustomerConcentration(
  sales: Array<{ name: string; revenue2025: string; revenue2024: string; revenue2023: string }>,
): CustomerConcentration | null {
  if (sales.length === 0) return null;

  const withRev = sales.map(s => ({
    name: s.name,
    rev25: parseFloat(s.revenue2025) || 0,
  })).filter(s => s.rev25 > 0);

  if (withRev.length === 0) return null;

  const sorted = [...withRev].sort((a, b) => b.rev25 - a.rev25);
  const total = sorted.reduce((sum, s) => sum + s.rev25, 0);
  if (total === 0) return null;

  const top1 = sorted[0]!.rev25 / total;
  const top3 = sorted.slice(0, 3).reduce((s, c) => s + c.rev25, 0) / total;
  const top5 = sorted.slice(0, 5).reduce((s, c) => s + c.rev25, 0) / total;

  // HHI = sum of squared market shares (as ratios)
  const hhi = sorted.reduce((sum, s) => sum + Math.pow(s.rev25 / total, 2), 0) * 10000;

  const risk = top1 > 0.5 ? 'high' : top3 > 0.7 ? 'medium' : 'low';

  return {
    top1Pct: (top1 * 100).toFixed(1),
    top3Pct: (top3 * 100).toFixed(1),
    top5Pct: (top5 * 100).toFixed(1),
    customerCount: sorted.length,
    herfindahlIndex: Math.round(hhi).toString(),
    risk,
  };
}

export function computeRevenueGrowth(
  sales: Array<{ revenue2025: string; revenue2024: string; revenue2023: string }>,
): RevenueGrowth | null {
  const r23 = sales.reduce((s, c) => s + (parseFloat(c.revenue2023) || 0), 0);
  const r24 = sales.reduce((s, c) => s + (parseFloat(c.revenue2024) || 0), 0);
  const r25 = sales.reduce((s, c) => s + (parseFloat(c.revenue2025) || 0), 0);

  if (r23 === 0 && r24 === 0 && r25 === 0) return null;

  const yoy24 = r23 > 0 ? (r24 - r23) / r23 : null;
  const yoy25 = r24 > 0 ? (r25 - r24) / r24 : null;

  // CAGR from earliest non-zero year
  let cagr = 0;
  if (r23 > 0 && r25 > 0) {
    cagr = Math.pow(r25 / r23, 1/2) - 1;
  } else if (r24 > 0 && r25 > 0) {
    cagr = (r25 - r24) / r24;
  }

  const trend: RevenueGrowth['trend'] =
    yoy24 !== null && yoy25 !== null
      ? (yoy25 > yoy24 * 1.1 ? 'accelerating' : yoy25 < yoy24 * 0.9 ? 'decelerating' : 'stable')
      : 'stable';

  const risk: RevenueGrowth['risk'] =
    cagr < 0 ? 'high' : cagr < 0.1 ? 'medium' : 'low';

  return {
    cagr: (cagr * 100).toFixed(1),
    yoy2024: yoy24 !== null ? (yoy24 * 100).toFixed(1) : '-',
    yoy2025: yoy25 !== null ? (yoy25 * 100).toFixed(1) : '-',
    trend,
    risk,
  };
}

/* ── Procurement Analysis ── */

export interface SupplierConcentration {
  topSupplierPct: string;
  top3SupplierPct: string;
  supplierCount: number;
  largestCategory: string;
  largestCategoryPct: string;
  risk: 'low' | 'medium' | 'high';
}

export function computeSupplierConcentration(
  procurement: Array<{ name: string; category: string; amount2025: string }>,
): SupplierConcentration | null {
  if (procurement.length === 0) return null;

  const withAmt = procurement.map(p => ({
    name: p.name,
    category: p.category,
    amt25: parseFloat(p.amount2025) || 0,
  })).filter(p => p.amt25 > 0);

  if (withAmt.length === 0) return null;

  const sorted = [...withAmt].sort((a, b) => b.amt25 - a.amt25);
  const total = sorted.reduce((s, p) => s + p.amt25, 0);
  if (total === 0) return null;

  const top1 = sorted[0]!.amt25 / total;
  const top3 = sorted.slice(0, 3).reduce((s, p) => s + p.amt25, 0) / total;

  // By category
  const byCat: Record<string, number> = {};
  for (const p of withAmt) {
    byCat[p.category] = (byCat[p.category] || 0) + p.amt25;
  }
  let largestCat = '';
  let largestAmt = 0;
  for (const [cat, amt] of Object.entries(byCat)) {
    if (amt > largestAmt) { largestCat = cat; largestAmt = amt; }
  }

  const risk = top1 > 0.5 ? 'high' : top3 > 0.7 ? 'medium' : 'low';

  return {
    topSupplierPct: (top1 * 100).toFixed(1),
    top3SupplierPct: (top3 * 100).toFixed(1),
    supplierCount: sorted.length,
    largestCategory: largestCat,
    largestCategoryPct: ((largestAmt / total) * 100).toFixed(1),
    risk,
  };
}

/* ── Financing History ── */

export interface ValuationTrajectory {
  roundCount: number;
  latestPreMoney: string;
  latestPostMoney: string;
  valuationGrowth: string;  // CAGR of valuation
  trend: 'up' | 'flat' | 'down';
}

export function computeValuationTrajectory(
  rounds: Array<{ date: string; preMoneyVal: string; postMoneyVal: string }>,
): ValuationTrajectory | null {
  if (rounds.length === 0) return null;

  const sorted = [...rounds].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1]!;

  let valuationGrowth = '0';
  if (sorted.length >= 2) {
    const first = parseFloat(sorted[0]!.postMoneyVal) || 0;
    const last = parseFloat(latest.postMoneyVal) || 0;
    if (first > 0 && last > 0) {
      const years = Math.max(1, (new Date(latest.date).getTime() - new Date(sorted[0]!.date).getTime()) / (365 * 86400000));
      valuationGrowth = ((Math.pow(last / first, 1 / years) - 1) * 100).toFixed(1);
    }
  }

  const trend = parseFloat(latest.postMoneyVal) > parseFloat(sorted[0]!.postMoneyVal || '0') ? 'up' : 'flat';

  return {
    roundCount: sorted.length,
    latestPreMoney: latest.preMoneyVal || '-',
    latestPostMoney: latest.postMoneyVal || '-',
    valuationGrowth,
    trend,
  };
}

/* ── Contract Coverage ── */

export interface ContractCoverage {
  totalContractValue: string;
  contractCount: number;
  avgContractSize: string;
  coverageRatio: string;  // contract value / latest revenue
}

export function computeContractCoverage(
  contracts: Array<{ amount: string }>,
  latestRevenue: number,
): ContractCoverage | null {
  if (contracts.length === 0) return null;

  const total = contracts.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
  const avg = total / contracts.length;

  return {
    totalContractValue: total.toLocaleString(),
    contractCount: contracts.length,
    avgContractSize: Math.round(avg).toLocaleString(),
    coverageRatio: latestRevenue > 0 ? (total / latestRevenue).toFixed(1) : '-',
  };
}
