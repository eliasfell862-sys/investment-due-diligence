/**
 * Advanced Manufacturing & Industrial Industry Inference Pack
 *
 * Deep inference rules for industrial/manufacturing companies.
 * Covers: order-to-revenue conversion, capacity & yield margin impact,
 * cyclical & raw material risk, capex & working capital,
 * customer certification & concentration, exit paths.
 */

import type { InferenceNode, ConfirmedFact, KnowledgeKind, ConfidenceBand } from '../../../domain/inference/types';

let nodeIdCounter = 0;
function nid(): string { nodeIdCounter++; return `ind_node_${Date.now()}_${nodeIdCounter}`; }

function factNum(metricId: string, facts: readonly ConfirmedFact[]): number | null {
  const f = facts.find(x => x.metricId === metricId);
  if (!f || typeof f.value !== 'string') return null;
  const n = parseFloat(f.value);
  return isNaN(n) ? null : n;
}

function node(
  metricId: string, kind: KnowledgeKind, value: string | null,
  confidence: ConfidenceBand, deps: string[] = [],
  lower?: string | null, upper?: string | null,
): InferenceNode {
  return { nodeId: nid(), kind, metricId, value, lowerBound: lower || null, upperBound: upper || null, unit: null, period: null, confidence, sourceEvidenceIds: [], dependencyNodeIds: deps, ruleIds: [], assumptionIds: [], conflictIds: [], reversibleByQuestionIds: [] };
}

// ── Rule 1: Order-to-Revenue Pipeline ──

export function assessIndustrialOrderPipeline(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const backlog = factNum('order_backlog', facts);
  const revenue = factNum('revenue', facts);
  const growth = factNum('revenue_growth', facts);

  if (backlog !== null && revenue !== null && revenue > 0) {
    const coverage = backlog / revenue;
    if (coverage >= 1.5) {
      nodes.push(node('order_coverage', 'inference', `在手订单覆盖${(coverage*100).toFixed(0)}%年收入 — 收入可见度极高`, 'high', ['order_backlog', 'revenue']));
    } else if (coverage >= 0.8) {
      nodes.push(node('order_coverage', 'inference', `在手订单覆盖${(coverage*100).toFixed(0)}%年收入 — 可见度良好`, 'medium', ['order_backlog', 'revenue']));
    } else if (coverage >= 0.3) {
      nodes.push(node('order_coverage', 'inference', `在手订单仅覆盖${(coverage*100).toFixed(0)}%年收入 — 需持续获新单`, 'medium', ['order_backlog', 'revenue']));
    } else {
      nodes.push(node('order_coverage', 'inference', `在手订单覆盖${(coverage*100).toFixed(0)}%年收入 — 收入可见度不足`, 'high', ['order_backlog', 'revenue']));
    }
  }

  if (growth !== null && backlog !== null && backlog > 0) {
    const impliedGrowth = growth;
    if (impliedGrowth > 50 && backlog < (revenue || 1) * 0.5) {
      nodes.push(node('growth_sustainability', 'inference', `增速${growth}%但订单覆盖不足 — 高增长可能不可持续`, 'medium', ['revenue_growth', 'order_backlog']));
    }
  }

  return nodes;
}

// ── Rule 2: Capacity & Yield Impact on Margin ──

export function assessIndustrialCapacity(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const utilization = factNum('capacity_utilization', facts);
  const yieldRate = factNum('yield_rate', facts);
  const grossMargin = factNum('gross_margin', facts);

  if (utilization !== null) {
    if (utilization >= 90) {
      nodes.push(node('capacity_utilization', 'inference', `产能利用率${utilization}% — 接近满产，需扩产投资否则增长受限`, 'high', ['capacity_utilization'], '90', '100'));
    } else if (utilization >= 70) {
      nodes.push(node('capacity_utilization', 'inference', `产能利用率${utilization}% — 合理水平（70-90%）`, 'medium', ['capacity_utilization'], '70', '90'));
    } else if (utilization >= 50) {
      nodes.push(node('capacity_utilization', 'inference', `产能利用率${utilization}% — 偏低（50-70%），存在闲置产能`, 'medium', ['capacity_utilization'], '50', '70'));
    } else {
      nodes.push(node('capacity_utilization', 'inference', `产能利用率${utilization}% — 严重偏低（<50%），固定成本压力大`, 'high', ['capacity_utilization'], '0', '50'));
    }
  }

  if (yieldRate !== null) {
    if (yieldRate >= 95) {
      nodes.push(node('yield_quality', 'inference', `良率${yieldRate}% — 优秀（≥95%），制造能力成熟`, 'high', ['yield_rate']));
    } else if (yieldRate >= 85) {
      nodes.push(node('yield_quality', 'inference', `良率${yieldRate}% — 正常（85-95%）`, 'medium', ['yield_rate']));
    } else {
      nodes.push(node('yield_quality', 'inference', `良率${yieldRate}% — 偏低（<85%），爬坡中或工艺不稳定`, 'high', ['yield_rate']));
    }
  }

  // Yield → margin linkage
  if (yieldRate !== null && grossMargin !== null) {
    if (yieldRate < 85 && grossMargin < 25) {
      nodes.push(node('yield_margin_link', 'inference', '低良率+低毛利 — 制造效率是利润的核心瓶颈', 'high', ['yield_rate', 'gross_margin']));
    }
  }

  return nodes;
}

// ── Rule 3: Cost Structure & Cyclical Risk ──

export function assessIndustrialCostRisk(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const materialPct = factNum('material_cost_pct', facts);
  const grossMargin = factNum('gross_margin', facts);
  const debt = factNum('debt_level', facts);
  const ebitda = factNum('ebitda', facts);

  if (materialPct !== null) {
    if (materialPct > 60) {
      nodes.push(node('material_cost_exposure', 'inference', `原材料占成本${materialPct}% — 对大宗商品价格高度敏感`, 'high', ['material_cost_pct']));
    } else if (materialPct > 35) {
      nodes.push(node('material_cost_exposure', 'inference', `原材料占成本${materialPct}% — 有一定周期风险`, 'medium', ['material_cost_pct']));
    }
  }

  // Operating leverage
  if (grossMargin !== null && grossMargin < 20) {
    nodes.push(node('operating_leverage', 'inference', `毛利率${grossMargin}% — 经营杠杆低，利润对收入敏感`, 'medium', ['gross_margin']));
  }

  // Debt burden
  if (debt !== null && ebitda !== null && ebitda > 0) {
    const leverage = debt / ebitda;
    if (leverage > 6) {
      nodes.push(node('debt_burden', 'inference', `债务/EBITDA = ${leverage.toFixed(1)}x — 严重偏高（>6x），财务风险大`, 'high', ['debt_level', 'ebitda']));
    } else if (leverage > 3) {
      nodes.push(node('debt_burden', 'inference', `债务/EBITDA = ${leverage.toFixed(1)}x — 中等（3-6x）`, 'medium', ['debt_level', 'ebitda']));
    } else {
      nodes.push(node('debt_burden', 'inference', `债务/EBITDA = ${leverage.toFixed(1)}x — 健康（<3x）`, 'medium', ['debt_level', 'ebitda']));
    }
  }

  return nodes;
}

// ── Rule 4: Customer Concentration & Certification ──

export function assessIndustrialCustomerRisk(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const concentration = factNum('customer_concentration', facts);
  const certCount = factNum('certification_count', facts);
  const receivablesDays = factNum('receivables_days', facts);

  if (concentration !== null) {
    if (concentration > 60) {
      nodes.push(node('customer_concentration', 'inference', `前三大客户占${concentration}% — 极度集中，单客流失可致命`, 'high', ['customer_concentration']));
    } else if (concentration > 40) {
      nodes.push(node('customer_concentration', 'inference', `前三大客户占${concentration}% — 偏高（40-60%），需分散`, 'medium', ['customer_concentration']));
    }
  }

  if (certCount !== null) {
    if (certCount >= 5) {
      nodes.push(node('certification_moat', 'inference', `${certCount}项认证 — 进入壁垒较高`, 'medium', ['certification_count']));
    }
  }

  if (receivablesDays !== null) {
    if (receivablesDays > 180) {
      nodes.push(node('receivables_risk', 'inference', `应收账款周转${receivablesDays}天 — 回款极慢，占用大量资金`, 'high', ['receivables_days']));
    } else if (receivablesDays > 90) {
      nodes.push(node('receivables_risk', 'inference', `应收账款周转${receivablesDays}天 — 偏慢（90-180天）`, 'medium', ['receivables_days']));
    }
  }

  return nodes;
}

// ── Rule 5: Capex & Working Capital ──

export function assessIndustrialCapex(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const capex = factNum('capex', facts);
  const revenue = factNum('revenue', facts);
  const depreciation = factNum('depreciation', facts);

  if (capex !== null && revenue !== null && revenue > 0) {
    const capexRatio = capex / revenue;
    if (capexRatio > 0.3) {
      nodes.push(node('capex_intensity', 'inference', `资本开支占收入${(capexRatio*100).toFixed(0)}% — 资本密集度高，扩张需大量资金`, 'high', ['capex', 'revenue']));
    } else if (capexRatio > 0.1) {
      nodes.push(node('capex_intensity', 'inference', `资本开支占收入${(capexRatio*100).toFixed(0)}% — 中等资本密集度`, 'medium', ['capex', 'revenue']));
    }
  }

  if (depreciation !== null && capex !== null && capex > 0) {
    const maintCapexRatio = depreciation / capex;
    if (maintCapexRatio > 0.8) {
      nodes.push(node('capex_composition', 'inference', `折旧/CapEx = ${(maintCapexRatio*100).toFixed(0)}% — 大部分资本开支用于维持而非扩张`, 'medium', ['depreciation', 'capex']));
    }
  }

  return nodes;
}

// ── Rule 6: Valuation & Exit ──

export function assessIndustrialValuation(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const valuation = factNum('valuation', facts);
  const ebitda = factNum('ebitda', facts);
  const utilization = factNum('capacity_utilization', facts);

  if (valuation !== null && ebitda !== null && ebitda > 0) {
    const evEbitda = valuation / ebitda;
    if (evEbitda > 15) {
      nodes.push(node('valuation_multiples', 'inference', `EV/EBITDA ${evEbitda.toFixed(1)}x — 偏高（>15x），隐含高增长预期`, 'medium', ['valuation', 'ebitda']));
    } else if (evEbitda > 8) {
      nodes.push(node('valuation_multiples', 'inference', `EV/EBITDA ${evEbitda.toFixed(1)}x — 合理（8-15x）`, 'low', ['valuation', 'ebitda']));
    } else {
      nodes.push(node('valuation_multiples', 'inference', `EV/EBITDA ${evEbitda.toFixed(1)}x — 偏低（<8x），可能周期底部或被低估`, 'low', ['valuation', 'ebitda']));
    }
  }

  // Strategic value factors
  if (utilization !== null && utilization >= 90) {
    nodes.push(node('strategic_value', 'inference', '满产状态+稀缺产能 — 对产业买家具有战略溢价', 'medium', ['capacity_utilization']));
  }

  return nodes;
}

export function assessIndustrialExit(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const revenue = factNum('revenue', facts);
  const ebitda = factNum('ebitda', facts);
  const certCount = factNum('certification_count', facts);
  const concentration = factNum('customer_concentration', facts);

  if (ebitda !== null && ebitda > 0 && revenue !== null) {
    if (ebitda > 500 && revenue > 5000) {
      nodes.push(node('exit_ipo', 'inference', '规模达标 — 接近A股制造业IPO门槛', 'low', ['revenue', 'ebitda']));
    }
  }

  if (certCount !== null && certCount >= 5) {
    nodes.push(node('exit_ma_cert', 'inference', `${certCount}项认证 — 对需要通过收购进入市场的买家有吸引力`, 'medium', ['certification_count']));
  }

  if (concentration !== null && concentration > 60) {
    nodes.push(node('exit_concentration_blocker', 'inference', `客户集中度${concentration}% — 可能成为IPO/并购障碍`, 'high', ['customer_concentration']));
  }

  return nodes;
}

// ── Aggregate ──

export function runIndustrialPackRules(facts: readonly ConfirmedFact[]): InferenceNode[] {
  return [
    ...assessIndustrialOrderPipeline(facts),
    ...assessIndustrialCapacity(facts),
    ...assessIndustrialCostRisk(facts),
    ...assessIndustrialCustomerRisk(facts),
    ...assessIndustrialCapex(facts),
    ...assessIndustrialValuation(facts),
    ...assessIndustrialExit(facts),
  ];
}

// ── Golden Cases ──

export interface GoldenCase {
  readonly caseId: string;
  readonly description: string;
  readonly facts: readonly ConfirmedFact[];
  readonly expectedJudgments: readonly string[];
}

const f = (id: string, metricId: string, value: string, unit?: string): ConfirmedFact => ({
  factId: id, metricId, value, unit: unit || null, period: null,
  evidenceIds: [], confirmedBy: 'test', confirmedAt: '2026-01-01',
});

export const INDUSTRIAL_GOLDEN_CASES: GoldenCase[] = [
  {
    caseId: 'industrial_golden_strong_backlog',
    description: '订单饱满+高良率+合理负债 — 优质制造业标的',
    facts: [
      f('i1', 'company_name', 'PrecisionMfg'), f('i2', 'revenue', '60000', '万元'),
      f('i3', 'revenue_growth', '25', '%'), f('i4', 'gross_margin', '38', '%'),
      f('i5', 'order_backlog', '90000', '万元'), f('i6', 'capacity_utilization', '88', '%'),
      f('i7', 'yield_rate', '96', '%'), f('i8', 'ebitda', '12000', '万元'),
      f('i9', 'debt_level', '15000', '万元'), f('i10', 'capex', '8000', '万元'),
      f('i11', 'customer_concentration', '25', '%'), f('i12', 'certification_count', '8', '项'),
      f('i13', 'valuation', '120000', '万元'), f('i14', 'cash_balance', '20000', '万元'),
    ],
    expectedJudgments: ['收入可见度极高', '良率.*优秀', '债务/EBITDA.*健康', '进入壁垒较高'],
  },
  {
    caseId: 'industrial_golden_capacity_crunch',
    description: '满产但无力扩产 — 增长受限于资金',
    facts: [
      f('j1', 'company_name', 'FullCapLtd'), f('j2', 'revenue', '30000', '万元'),
      f('j3', 'revenue_growth', '10', '%'), f('j4', 'gross_margin', '22', '%'),
      f('j5', 'order_backlog', '15000', '万元'), f('j6', 'capacity_utilization', '95', '%'),
      f('j7', 'yield_rate', '88', '%'), f('j8', 'ebitda', '4500', '万元'),
      f('j9', 'debt_level', '40000', '万元'), f('j10', 'capex', '3000', '万元'),
      f('j11', 'depreciation', '2800', '万元'), f('j12', 'cash_balance', '3000', '万元'),
      f('j13', 'valuation', '50000', '万元'),
    ],
    expectedJudgments: ['接近满产', '债务/EBITDA.*严重偏高', '大部分资本开支用于维持', '扩产投资否则增长受限'],
  },
  {
    caseId: 'industrial_golden_customer_loss',
    description: '大客户高度集中+低良率 — 双重风险',
    facts: [
      f('k1', 'company_name', 'SingleClient'), f('k2', 'revenue', '20000', '万元'),
      f('k3', 'revenue_growth', '15', '%'), f('k4', 'gross_margin', '18', '%'),
      f('k5', 'order_backlog', '5000', '万元'), f('k6', 'capacity_utilization', '55', '%'),
      f('k7', 'yield_rate', '75', '%'), f('k8', 'customer_concentration', '70', '%'),
      f('k9', 'receivables_days', '210', '天'), f('k10', 'material_cost_pct', '65', '%'),
      f('k11', 'valuation', '25000', '万元'),
    ],
    expectedJudgments: ['极度集中', '良率.*偏低', '收入可见度不足', '回款极慢', '产能利用率.*严重偏低'],
  },
];
