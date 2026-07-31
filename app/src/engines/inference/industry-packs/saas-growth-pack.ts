/**
 * SaaS Growth Equity Industry Inference Pack
 *
 * Deep inference rules specific to SaaS/enterprise software companies.
 * Covers: revenue quality, unit economics, growth sustainability,
 * competitive moat, valuation, exit, risk chains, and golden cases.
 */

import type { InferenceNode, ConfirmedFact, CandidateFact, KnowledgeKind, ConfidenceBand } from '../../../domain/inference/types';

// ── Helpers ──

let nodeIdCounter = 0;
function nid(): string { nodeIdCounter++; return `saas_node_${Date.now()}_${nodeIdCounter}`; }

function findFact(metricId: string, facts: readonly ConfirmedFact[]): ConfirmedFact | undefined {
  return facts.find(f => f.metricId === metricId);
}

function factNum(metricId: string, facts: readonly ConfirmedFact[]): number | null {
  const f = findFact(metricId, facts);
  if (!f || typeof f.value !== 'string') return null;
  const n = parseFloat(f.value);
  return isNaN(n) ? null : n;
}

function makeNode(
  metricId: string, kind: KnowledgeKind,
  value: string | null, confidence: ConfidenceBand,
  deps: string[] = [], lowerBound?: string | null, upperBound?: string | null,
): InferenceNode {
  return {
    nodeId: nid(), kind, metricId, value,
    lowerBound: lowerBound || null, upperBound: upperBound || null,
    unit: null, period: null, confidence,
    sourceEvidenceIds: [], dependencyNodeIds: deps,
    ruleIds: [], assumptionIds: [], conflictIds: [], reversibleByQuestionIds: [],
  };
}

// ── Rule 1: Revenue Quality ──

export function assessSaaSRevenueQuality(
  facts: readonly ConfirmedFact[],
): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const arr = factNum('arr', facts);
  const nrr = factNum('nrr', facts);
  const revGrowth = factNum('revenue_growth', facts);
  const expansionRev = factNum('expansion_revenue', facts);

  // NRR quality
  if (nrr !== null) {
    if (nrr >= 120) {
      nodes.push(makeNode('nrr_quality', 'inference', `NRR ${nrr}% — 卓越（≥120%），现有客户群在强劲扩张`, 'high', ['arr', 'nrr'], '120', '200'));
    } else if (nrr >= 110) {
      nodes.push(makeNode('nrr_quality', 'inference', `NRR ${nrr}% — 优秀（≥110%），客户持续增购`, 'high', ['arr', 'nrr'], '110', '120'));
    } else if (nrr >= 100) {
      nodes.push(makeNode('nrr_quality', 'inference', `NRR ${nrr}% — 健康（≥100%），客户不萎缩`, 'medium', ['arr', 'nrr'], '100', '110'));
    } else if (nrr >= 90) {
      nodes.push(makeNode('nrr_quality', 'inference', `NRR ${nrr}% — 警示（<100%），存在客户收缩`, 'medium', ['arr', 'nrr'], '90', '100'));
    } else {
      nodes.push(makeNode('nrr_quality', 'inference', `NRR ${nrr}% — 危险（<90%），客户正在快速流失`, 'high', ['arr', 'nrr'], '0', '90'));
    }
  } else {
    nodes.push(makeNode('nrr_quality', 'inference', null, 'low', ['arr', 'nrr']));
  }

  // Revenue recurrence quality
  if (arr !== null && factNum('revenue', facts) !== null) {
    const revenue = factNum('revenue', facts)!;
    const arrPct = arr / revenue * 100;
    if (arrPct >= 90) {
      nodes.push(makeNode('revenue_recurrence', 'inference', `经常性收入占比 ${arrPct.toFixed(0)}% — 收入质量高`, 'high', ['arr', 'revenue']));
    } else if (arrPct >= 70) {
      nodes.push(makeNode('revenue_recurrence', 'inference', `经常性收入占比 ${arrPct.toFixed(0)}% — 有一定非经常性收入`, 'medium', ['arr', 'revenue']));
    } else if (arrPct > 0) {
      nodes.push(makeNode('revenue_recurrence', 'inference', `经常性收入仅占 ${arrPct.toFixed(0)}% — 业务模式非纯SaaS`, 'low', ['arr', 'revenue']));
    }
  }

  // Growth quality: expansion vs new customers
  if (expansionRev !== null && revGrowth !== null) {
    if (expansionRev > 30) {
      nodes.push(makeNode('growth_quality', 'inference', `增购收入占比>30% — 增长以内生扩张驱动，质量高`, 'high', ['expansion_revenue', 'revenue_growth']));
    } else {
      nodes.push(makeNode('growth_quality', 'inference', '增长主要靠新客获取，需关注销售效率', 'medium', ['expansion_revenue', 'revenue_growth']));
    }
  }

  return nodes;
}

// ── Rule 2: Unit Economics ──

export function assessSaaSUnitEconomics(
  facts: readonly ConfirmedFact[],
): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const cac = factNum('cac', facts);
  const ltv = factNum('ltv', facts);
  const cacPayback = factNum('cac_payback_months', facts);
  const grossMargin = factNum('gross_margin', facts);
  const customerCount = factNum('customer_count', facts);
  const arr = factNum('arr', facts);

  // LTV/CAC
  if (ltv !== null && cac !== null && cac > 0) {
    const ratio = ltv / cac;
    if (ratio >= 5) {
      nodes.push(makeNode('ltv_cac_quality', 'inference', `LTV/CAC = ${ratio.toFixed(1)}x — 卓越（≥5x），获客效率极高`, 'high', ['ltv', 'cac'], '5', '20'));
    } else if (ratio >= 3) {
      nodes.push(makeNode('ltv_cac_quality', 'inference', `LTV/CAC = ${ratio.toFixed(1)}x — 健康（≥3x），获客有正回报`, 'high', ['ltv', 'cac'], '3', '5'));
    } else if (ratio >= 1) {
      nodes.push(makeNode('ltv_cac_quality', 'inference', `LTV/CAC = ${ratio.toFixed(1)}x — 警示（<3x），获客效率不足`, 'medium', ['ltv', 'cac'], '1', '3'));
    } else {
      nodes.push(makeNode('ltv_cac_quality', 'inference', `LTV/CAC = ${ratio.toFixed(1)}x — 危险（<1x），每获一客亏钱`, 'high', ['ltv', 'cac'], '0', '1'));
    }
  }

  // CAC Payback
  if (cacPayback !== null) {
    if (cacPayback <= 12) {
      nodes.push(makeNode('cac_payback_quality', 'inference', `CAC回收期 ${cacPayback}个月 — 健康（≤12月）`, 'high', ['cac_payback_months']));
    } else if (cacPayback <= 24) {
      nodes.push(makeNode('cac_payback_quality', 'inference', `CAC回收期 ${cacPayback}个月 — 偏长（12-24月），占用了较多现金`, 'medium', ['cac_payback_months']));
    } else {
      nodes.push(makeNode('cac_payback_quality', 'inference', `CAC回收期 ${cacPayback}个月 — 危险（>24月），增长不可持续`, 'high', ['cac_payback_months']));
    }
  }

  // Unit margin
  if (grossMargin !== null) {
    if (grossMargin >= 80) {
      nodes.push(makeNode('unit_margin_quality', 'inference', `毛利率 ${grossMargin}% — 顶级SaaS水平（≥80%）`, 'high', ['gross_margin']));
    } else if (grossMargin >= 60) {
      nodes.push(makeNode('unit_margin_quality', 'inference', `毛利率 ${grossMargin}% — 健康（60-80%）`, 'medium', ['gross_margin']));
    } else {
      nodes.push(makeNode('unit_margin_quality', 'inference', `毛利率 ${grossMargin}% — 偏低（<60%），服务/实施成本高`, 'medium', ['gross_margin']));
    }
  }

  // Average revenue per customer
  if (arr !== null && customerCount !== null && customerCount > 0) {
    const avgArr = arr / customerCount;
    if (avgArr >= 100) {
      nodes.push(makeNode('customer_quality', 'inference', `客均ARR ${avgArr.toFixed(0)}万元 — 大客为主，客户质量高`, 'medium', ['arr', 'customer_count']));
    } else if (avgArr >= 10) {
      nodes.push(makeNode('customer_quality', 'inference', `客均ARR ${avgArr.toFixed(0)}万元 — 中客为主`, 'medium', ['arr', 'customer_count']));
    } else {
      nodes.push(makeNode('customer_quality', 'inference', `客均ARR ${avgArr.toFixed(0)}万元 — SMB为主，客户流失风险较高`, 'medium', ['arr', 'customer_count']));
    }
  }

  return nodes;
}

// ── Rule 3: Cash & Survival ──

export function assessSaaSCashPosition(
  facts: readonly ConfirmedFact[],
): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const cash = factNum('cash_balance', facts);
  const burn = factNum('burn_rate', facts);
  const revGrowth = factNum('revenue_growth', facts);

  if (cash !== null && burn !== null && burn > 0) {
    const runway = cash / burn;
    if (runway >= 24) {
      nodes.push(makeNode('cash_runway', 'inference', `现金跑道 ${runway.toFixed(0)}个月 — 充裕（≥24月）`, 'high', ['cash_balance', 'burn_rate']));
    } else if (runway >= 12) {
      nodes.push(makeNode('cash_runway', 'inference', `现金跑道 ${runway.toFixed(0)}个月 — 安全（12-24月）`, 'medium', ['cash_balance', 'burn_rate']));
    } else if (runway >= 6) {
      nodes.push(makeNode('cash_runway', 'inference', `现金跑道 ${runway.toFixed(0)}个月 — 紧张（6-12月），12个月内需融资`, 'medium', ['cash_balance', 'burn_rate']));
    } else {
      nodes.push(makeNode('cash_runway', 'inference', `现金跑道 ${runway.toFixed(0)}个月 — 危机（<6月），必须立即融资`, 'high', ['cash_balance', 'burn_rate']));
    }
  }

  // Rule of 40
  if (revGrowth !== null && factNum('gross_margin', facts) !== null) {
    const gm = factNum('gross_margin', facts)!;
    const marginProxy = gm - 30; // rough EBITDA margin proxy for SaaS
    const ruleOf40 = revGrowth + Math.max(0, marginProxy);
    if (ruleOf40 >= 40) {
      nodes.push(makeNode('rule_of_40', 'inference', `Rule of 40 = ${ruleOf40.toFixed(0)}% — 达标（≥40%）`, 'high', ['revenue_growth', 'gross_margin']));
    } else if (ruleOf40 >= 20) {
      nodes.push(makeNode('rule_of_40', 'inference', `Rule of 40 = ${ruleOf40.toFixed(0)}% — 接近达标`, 'medium', ['revenue_growth', 'gross_margin']));
    } else {
      nodes.push(makeNode('rule_of_40', 'inference', `Rule of 40 = ${ruleOf40.toFixed(0)}% — 未达标，增长和盈利均需改善`, 'low', ['revenue_growth', 'gross_margin']));
    }
  }

  return nodes;
}

// ── Rule 4: Competitive Moat ──

export function assessSaaSMoat(
  facts: readonly ConfirmedFact[],
): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const nrr = factNum('nrr', facts);
  const grossMargin = factNum('gross_margin', facts);
  const customerConc = factNum('customer_concentration', facts);

  // Switching cost moat (proxied by NRR)
  if (nrr !== null && nrr >= 110) {
    nodes.push(makeNode('switching_cost_moat', 'inference', '高NRR暗示强切换成本护城河', 'medium', ['nrr']));
  }

  // Pricing power (proxied by gross margin)
  if (grossMargin !== null && grossMargin >= 80) {
    nodes.push(makeNode('pricing_power', 'inference', '高毛利率暗示强定价权', 'medium', ['gross_margin']));
  }

  // Customer concentration risk
  if (customerConc !== null) {
    if (customerConc > 50) {
      nodes.push(makeNode('customer_concentration_risk', 'inference', `前三大客户占${customerConc}% — 重大集中度风险`, 'high', ['customer_concentration']));
    } else if (customerConc > 30) {
      nodes.push(makeNode('customer_concentration_risk', 'inference', `前三大客户占${customerConc}% — 需关注`, 'medium', ['customer_concentration']));
    } else {
      nodes.push(makeNode('customer_concentration_risk', 'inference', `客户集中度${customerConc}% — 健康`, 'medium', ['customer_concentration']));
    }
  }

  return nodes;
}

// ── Rule 5: Valuation Context ──

export function assessSaaSValuation(
  facts: readonly ConfirmedFact[],
): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const valuation = factNum('valuation', facts);
  const arr = factNum('arr', facts);
  const revenue = factNum('revenue', facts);
  const revGrowth = factNum('revenue_growth', facts);
  const nrr = factNum('nrr', facts);

  if (valuation !== null && arr !== null && arr > 0) {
    const multiple = valuation / arr;
    const growthAdj = revGrowth !== null ? revGrowth : 30;
    const nrrAdj = nrr !== null ? nrr : 100;
    // Simple heuristic: fair EV/ARR ≈ growth_rate × 0.5 × (NRR/100)
    const fairMultiple = growthAdj * 0.5 * (nrrAdj / 100);

    if (multiple > fairMultiple * 1.5) {
      nodes.push(makeNode('valuation_vs_fair', 'inference', `EV/ARR ${multiple.toFixed(1)}x vs 公允 ${fairMultiple.toFixed(1)}x — 显著高估`, 'medium', ['valuation', 'arr']));
    } else if (multiple > fairMultiple * 1.0) {
      nodes.push(makeNode('valuation_vs_fair', 'inference', `EV/ARR ${multiple.toFixed(1)}x vs 公允 ${fairMultiple.toFixed(1)}x — 略高`, 'low', ['valuation', 'arr']));
    } else if (multiple > 0) {
      nodes.push(makeNode('valuation_vs_fair', 'inference', `EV/ARR ${multiple.toFixed(1)}x vs 公允 ${fairMultiple.toFixed(1)}x — 合理/低估`, 'low', ['valuation', 'arr']));
    }
  } else if (valuation !== null && revenue !== null && revenue > 0) {
    const ps = valuation / revenue;
    if (ps > 20) {
      nodes.push(makeNode('valuation_ps', 'inference', `P/S ${ps.toFixed(1)}x — 偏高（>20x）`, 'medium', ['valuation', 'revenue']));
    } else if (ps > 8) {
      nodes.push(makeNode('valuation_ps', 'inference', `P/S ${ps.toFixed(1)}x — 中等（8-20x）`, 'low', ['valuation', 'revenue']));
    } else {
      nodes.push(makeNode('valuation_ps', 'inference', `P/S ${ps.toFixed(1)}x — 较低（<8x）`, 'low', ['valuation', 'revenue']));
    }
  }

  return nodes;
}

// ── Rule 6: Exit Path Assessment ──

export function assessSaaSExit(
  facts: readonly ConfirmedFact[],
): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const arr = factNum('arr', facts);
  const revGrowth = factNum('revenue_growth', facts);
  const nrr = factNum('nrr', facts);
  const grossMargin = factNum('gross_margin', facts);

  if (arr !== null && revGrowth !== null) {
    // Strategic M&A likelihood
    if (arr >= 100 && nrr !== null && nrr >= 110 && (grossMargin === null || grossMargin >= 70)) {
      nodes.push(makeNode('exit_strategic_ma', 'inference', '具备战略并购吸引力（ARR规模+高NRR+高毛利）', 'medium', ['arr', 'nrr', 'gross_margin']));
    }

    // IPO readiness
    if (arr >= 300 && revGrowth >= 30 && (grossMargin === null || grossMargin >= 60)) {
      nodes.push(makeNode('exit_ipo', 'inference', '接近IPO门槛（ARR≥3亿+增速≥30%+毛利≥60%）', 'medium', ['arr', 'revenue_growth', 'gross_margin']));
    }

    // Secondary sale
    if (arr < 100 || revGrowth < 20) {
      nodes.push(makeNode('exit_secondary', 'inference', '短期IPO/并购难度较大，老股转让可能是主要退出路径', 'low', ['arr', 'revenue_growth']));
    }
  }

  return nodes;
}

// ── Aggregate ──

export function runSaaSPackRules(
  facts: readonly ConfirmedFact[],
): InferenceNode[] {
  return [
    ...assessSaaSRevenueQuality(facts),
    ...assessSaaSUnitEconomics(facts),
    ...assessSaaSCashPosition(facts),
    ...assessSaaSMoat(facts),
    ...assessSaaSValuation(facts),
    ...assessSaaSExit(facts),
  ];
}

// ── Golden Cases ──

export interface GoldenCase {
  readonly caseId: string;
  readonly description: string;
  readonly facts: readonly ConfirmedFact[];
  readonly expectedJudgments: readonly string[];
  readonly expectedRiskFlags: readonly string[];
}

export const SAAS_GOLDEN_CASES: GoldenCase[] = [
  {
    caseId: 'saas_golden_strong_expensive',
    description: '优质SaaS公司但估值过高——应该输出"好公司但不是好价格"',
    facts: [
      { factId: 'f1', metricId: 'company_name', value: 'CloudERP', unit: null, period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f2', metricId: 'arr', value: '50000', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f3', metricId: 'nrr', value: '125', unit: '%', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f4', metricId: 'revenue_growth', value: '60', unit: '%', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f5', metricId: 'gross_margin', value: '82', unit: '%', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f6', metricId: 'valuation', value: '1000000', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f7', metricId: 'cash_balance', value: '100000', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f8', metricId: 'burn_rate', value: '3000', unit: '万元/月', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
    ],
    expectedJudgments: ['估值偏高', 'EV/ARR'],
    expectedRiskFlags: [],
  },
  {
    caseId: 'saas_golden_churn_crisis',
    description: '表面增长好但NRR低——应检测到客户流失危机',
    facts: [
      { factId: 'f1', metricId: 'company_name', value: 'ChurnSaaS', unit: null, period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f2', metricId: 'arr', value: '10000', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f3', metricId: 'nrr', value: '75', unit: '%', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f4', metricId: 'revenue_growth', value: '40', unit: '%', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f5', metricId: 'gross_margin', value: '70', unit: '%', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f6', metricId: 'valuation', value: '150000', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f7', metricId: 'cac', value: '50', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f8', metricId: 'ltv', value: '80', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
    ],
    expectedJudgments: ['NRR.*危险', 'LTV/CAC.*危险'],
    expectedRiskFlags: ['客户正在快速流失'],
  },
  {
    caseId: 'saas_golden_cash_crunch',
    description: '高增长但现金即将耗尽——应检测到融资紧迫性',
    facts: [
      { factId: 'f1', metricId: 'company_name', value: 'BurnFast', unit: null, period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f2', metricId: 'arr', value: '3000', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f3', metricId: 'nrr', value: '105', unit: '%', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f4', metricId: 'revenue_growth', value: '100', unit: '%', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f5', metricId: 'gross_margin', value: '75', unit: '%', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f6', metricId: 'cash_balance', value: '1800', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f7', metricId: 'burn_rate', value: '500', unit: '万元/月', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
      { factId: 'f8', metricId: 'valuation', value: '30000', unit: '万元', period: null, evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01' },
    ],
    expectedJudgments: ['现金跑道.*个月.*危机', '必须立即融资'],
    expectedRiskFlags: ['现金跑道'],
  },
];
