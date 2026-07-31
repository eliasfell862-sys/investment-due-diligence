/**
 * Consumer Brand & Retail Industry Inference Pack
 *
 * Deep inference rules for consumer brands and chain retail.
 * Covers: brand vs promotional growth, channel/platform dependency,
 * inventory health, store unit economics, expansion viability,
 * brand valuation, and exit paths.
 */

import type { InferenceNode, ConfirmedFact, KnowledgeKind, ConfidenceBand } from '../../../domain/inference/types';

let nodeIdCounter = 0;
function nid(): string { nodeIdCounter++; return `cons_node_${Date.now()}_${nodeIdCounter}`; }

function factNum(metricId: string, facts: readonly ConfirmedFact[]): number | null {
  const f = facts.find(x => x.metricId === metricId);
  if (!f || typeof f.value !== 'string') return null;
  const n = parseFloat(f.value);
  return isNaN(n) ? null : n;
}

function factStr(metricId: string, facts: readonly ConfirmedFact[]): string | null {
  const f = facts.find(x => x.metricId === metricId);
  if (!f || typeof f.value !== 'string') return null;
  return f.value;
}

function node(
  metricId: string, kind: KnowledgeKind, value: string | null,
  confidence: ConfidenceBand, deps: string[] = [],
  lower?: string | null, upper?: string | null,
): InferenceNode {
  return {
    nodeId: nid(), kind, metricId, value, lowerBound: lower || null,
    upperBound: upper || null, unit: null, period: null, confidence,
    sourceEvidenceIds: [], dependencyNodeIds: deps,
    ruleIds: [], assumptionIds: [], conflictIds: [], reversibleByQuestionIds: [],
  };
}

// ── Rule 1: Revenue & Growth Quality ──

export function assessConsumerGrowthQuality(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const revenue = factNum('revenue', facts);
  const growth = factNum('revenue_growth', facts);
  const sameStore = factNum('same_store_growth', facts);
  const storeCount = factNum('store_count', facts);
  const repurchaseRate = factNum('repurchase_rate', facts);

  // Same-store vs new-store growth decomposition
  if (sameStore !== null && growth !== null && storeCount !== null && storeCount > 0) {
    if (sameStore >= growth) {
      nodes.push(node('growth_source', 'inference',
        `同店增长${sameStore}% ≥ 总增长${growth}% — 增长由现有门店驱动，质量高`, 'high',
        ['same_store_growth', 'revenue_growth']));
    } else if (sameStore > 0) {
      nodes.push(node('growth_source', 'inference',
        `同店增长${sameStore}% < 总增长${growth}% — 增长依赖新开店，需验证新店质量`, 'medium',
        ['same_store_growth', 'revenue_growth']));
    } else {
      nodes.push(node('growth_source', 'inference',
        `同店增长${sameStore}% — 现有门店在萎缩，增长全靠新开店，不可持续`, 'high',
        ['same_store_growth', 'revenue_growth']));
    }
  }

  // Repurchase rate
  if (repurchaseRate !== null) {
    if (repurchaseRate >= 60) {
      nodes.push(node('repurchase_quality', 'inference',
        `复购率${repurchaseRate}% — 优秀（≥60%），强品牌忠诚度`, 'high', ['repurchase_rate']));
    } else if (repurchaseRate >= 30) {
      nodes.push(node('repurchase_quality', 'inference',
        `复购率${repurchaseRate}% — 中等（30-60%），有一定品牌力`, 'medium', ['repurchase_rate']));
    } else {
      nodes.push(node('repurchase_quality', 'inference',
        `复购率${repurchaseRate}% — 偏低（<30%），品牌粘性不足`, 'medium', ['repurchase_rate']));
    }
  } else {
    nodes.push(node('repurchase_quality', 'inference', null, 'low', ['repurchase_rate']));
  }

  return nodes;
}

// ── Rule 2: Channel & Platform Dependency ──

export function assessConsumerChannelRisk(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const platformFee = factNum('platform_fee_rate', facts);
  const channelMix = factStr('channel_mix', facts);
  const grossMargin = factNum('gross_margin', facts);

  if (platformFee !== null) {
    if (platformFee > 25) {
      nodes.push(node('platform_dependency', 'inference',
        `平台费用率${platformFee}% — 高度依赖第三方平台，利润被严重侵蚀`, 'high',
        ['platform_fee_rate', 'gross_margin']));
    } else if (platformFee > 10) {
      nodes.push(node('platform_dependency', 'inference',
        `平台费用率${platformFee}% — 有一定平台依赖`, 'medium',
        ['platform_fee_rate', 'gross_margin']));
    } else {
      nodes.push(node('platform_dependency', 'inference',
        `平台费用率${platformFee}% — 可控`, 'medium', ['platform_fee_rate']));
    }
  }

  // Channel concentration
  if (channelMix) {
    const channels = channelMix.split(/[,，、]/);
    if (channels.length === 1) {
      nodes.push(node('channel_concentration', 'inference',
        `渠道单一（${channelMix}）— 渠道集中度风险高`, 'high', ['channel_mix']));
    } else {
      nodes.push(node('channel_concentration', 'inference',
        `${channels.length}个渠道 — 渠道分散度可接受`, 'medium', ['channel_mix']));
    }
  }

  return nodes;
}

// ── Rule 3: Inventory & Working Capital ──

export function assessConsumerInventory(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const invTurnover = factNum('inventory_turnover', facts);
  const cashConv = factNum('cash_conversion_cycle', facts);
  const returnRate = factNum('return_rate', facts);
  const grossMargin = factNum('gross_margin', facts);

  if (invTurnover !== null) {
    if (invTurnover >= 6) {
      nodes.push(node('inventory_health', 'inference',
        `年周转${invTurnover.toFixed(0)}次 — 库存管理优秀`, 'high', ['inventory_turnover']));
    } else if (invTurnover >= 3) {
      nodes.push(node('inventory_health', 'inference',
        `年周转${invTurnover.toFixed(0)}次 — 正常（3-6次）`, 'medium', ['inventory_turnover']));
    } else {
      nodes.push(node('inventory_health', 'inference',
        `年周转仅${invTurnover.toFixed(0)}次 — 库存周转过慢，存在积压和减值风险`, 'high', ['inventory_turnover']));
    }
  }

  // Cash conversion
  if (cashConv !== null) {
    if (cashConv > 180) {
      nodes.push(node('cash_conversion_risk', 'inference',
        `现金转换周期${cashConv}天 — 过长（>180天），严重占用营运资金`, 'high', ['cash_conversion_cycle']));
    } else if (cashConv > 90) {
      nodes.push(node('cash_conversion_risk', 'inference',
        `现金转换周期${cashConv}天 — 偏长（90-180天）`, 'medium', ['cash_conversion_cycle']));
    }
  }

  // Return rate
  if (returnRate !== null) {
    if (returnRate > 20) {
      nodes.push(node('return_rate_risk', 'inference',
        `退货率${returnRate}% — 偏高（>20%），侵蚀利润`, 'high', ['return_rate', 'gross_margin']));
    }
  }

  return nodes;
}

// ── Rule 4: Store Unit Economics ──

export function assessConsumerStoreEcon(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const storeInvest = factNum('store_investment', facts);
  const storePayback = factNum('store_payback_months', facts);
  const sameStore = factNum('same_store_growth', facts);
  const storeCount = factNum('store_count', facts);

  if (storeInvest !== null && storePayback !== null) {
    if (storePayback <= 12) {
      nodes.push(node('store_economics', 'inference',
        `单店回收期${storePayback}个月 — 优秀（≤12月），单店模型健康`, 'high',
        ['store_investment', 'store_payback_months']));
    } else if (storePayback <= 24) {
      nodes.push(node('store_economics', 'inference',
        `单店回收期${storePayback}个月 — 可接受（12-24月）`, 'medium',
        ['store_investment', 'store_payback_months']));
    } else {
      nodes.push(node('store_economics', 'inference',
        `单店回收期${storePayback}个月 — 过长（>24月），扩张不可持续`, 'high',
        ['store_investment', 'store_payback_months']));
    }
  }

  // Expansion speed vs cash
  if (storeCount !== null && sameStore !== null && storeInvest !== null) {
    const newStores = storeCount * 0.3; // assume ~30% growth
    const annualInvestment = newStores * storeInvest;
    if (annualInvestment > 0) {
      if (sameStore > 5) {
        nodes.push(node('expansion_viability', 'inference',
          `同店增长${sameStore}%支撑扩张，年需投入≈${annualInvestment.toFixed(0)}万元`, 'medium',
          ['same_store_growth', 'store_investment', 'store_count']));
      } else if (sameStore <= 0) {
        nodes.push(node('expansion_viability', 'inference',
          `同店无增长，扩张可能只是"补坑"而非真正增长`, 'high',
          ['same_store_growth', 'store_count']));
      }
    }
  }

  return nodes;
}

// ── Rule 5: Brand Valuation ──

export function assessConsumerValuation(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const valuation = factNum('valuation', facts);
  const revenue = factNum('revenue', facts);
  const grossMargin = factNum('gross_margin', facts);
  const growth = factNum('revenue_growth', facts);
  const repurchase = factNum('repurchase_rate', facts);

  if (valuation !== null && revenue !== null && revenue > 0) {
    const ps = valuation / revenue;
    const gm = grossMargin || 50;
    const g = growth || 20;
    const r = repurchase || 30;

    // Consumer heuristic: fair P/S depends on gross margin, growth, and brand loyalty
    const fairPS = (gm / 100) * (g / 100) * 10 + (r / 100) * 5;

    if (ps > fairPS * 1.8) {
      nodes.push(node('valuation_context', 'inference',
        `P/S ${ps.toFixed(1)}x vs 公允 ${fairPS.toFixed(1)}x — 品牌溢价过高，需验证可持续性`, 'medium',
        ['valuation', 'revenue', 'gross_margin', 'revenue_growth']));
    } else if (ps > fairPS) {
      nodes.push(node('valuation_context', 'inference',
        `P/S ${ps.toFixed(1)}x vs 公允 ${fairPS.toFixed(1)}x — 含合理品牌溢价`, 'low',
        ['valuation', 'revenue']));
    } else {
      nodes.push(node('valuation_context', 'inference',
        `P/S ${ps.toFixed(1)}x vs 公允 ${fairPS.toFixed(1)}x — 估值合理/偏低`, 'low',
        ['valuation', 'revenue']));
    }
  }

  return nodes;
}

// ── Rule 6: Exit Paths ──

export function assessConsumerExit(facts: readonly ConfirmedFact[]): InferenceNode[] {
  const nodes: InferenceNode[] = [];
  const storeCount = factNum('store_count', facts);
  const revenue = factNum('revenue', facts);
  const grossMargin = factNum('gross_margin', facts);
  const repurchase = factNum('repurchase_rate', facts);
  const sameStore = factNum('same_store_growth', facts);

  // Strategic M&A attractiveness for consumer
  if (grossMargin !== null && repurchase !== null && revenue !== null) {
    if (grossMargin >= 60 && repurchase >= 50 && revenue >= 100) {
      nodes.push(node('exit_ma_attractiveness', 'inference',
        '强品牌+高复购+规模 — 对战略买家极具吸引力', 'medium',
        ['gross_margin', 'repurchase_rate', 'revenue']));
    }
  }

  // IPO potential
  if (storeCount !== null && revenue !== null && sameStore !== null) {
    if (storeCount >= 100 && revenue >= 200 && sameStore >= 3) {
      nodes.push(node('exit_ipo_potential', 'inference',
        `门店${storeCount}家+收入${revenue}万+同店增长${sameStore}% — 接近连锁IPO门槛`, 'low',
        ['store_count', 'revenue', 'same_store_growth']));
    }
  }

  // Brand acquisition value
  if (repurchase !== null && repurchase >= 60 && grossMargin !== null && grossMargin >= 70) {
    nodes.push(node('exit_brand_premium', 'inference',
      '高复购率+高毛利 — 品牌具备收购溢价', 'medium',
      ['repurchase_rate', 'gross_margin']));
  }

  return nodes;
}

// ── Aggregate ──

export function runConsumerPackRules(facts: readonly ConfirmedFact[]): InferenceNode[] {
  return [
    ...assessConsumerGrowthQuality(facts),
    ...assessConsumerChannelRisk(facts),
    ...assessConsumerInventory(facts),
    ...assessConsumerStoreEcon(facts),
    ...assessConsumerValuation(facts),
    ...assessConsumerExit(facts),
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

export const CONSUMER_GOLDEN_CASES: GoldenCase[] = [
  {
    caseId: 'consumer_golden_strong_brand',
    description: '强品牌消费品公司——同店增长+高复购+高毛利',
    facts: [
      f('c1', 'company_name', 'BestBrand'), f('c2', 'revenue', '80000', '万元'),
      f('c3', 'revenue_growth', '35', '%'), f('c4', 'gross_margin', '72', '%'),
      f('c5', 'same_store_growth', '15', '%'), f('c6', 'store_count', '200', '家'),
      f('c7', 'repurchase_rate', '65', '%'), f('c8', 'inventory_turnover', '5', '次/年'),
      f('c9', 'store_investment', '150', '万元'), f('c10', 'store_payback_months', '14', '月'),
      f('c11', 'valuation', '400000', '万元'), f('c12', 'cash_balance', '50000', '万元'),
    ],
    expectedJudgments: ['增长由现有门店驱动', '强品牌忠诚度', '对战略买家极具吸引力'],
  },
  {
    caseId: 'consumer_golden_channel_dependent',
    description: '高度依赖平台渠道——低毛利+高平台费',
    facts: [
      f('d1', 'company_name', 'PlatformBrand'), f('d2', 'revenue', '30000', '万元'),
      f('d3', 'revenue_growth', '50', '%'), f('d4', 'gross_margin', '35', '%'),
      f('d5', 'platform_fee_rate', '30', '%'), f('d6', 'channel_mix', '天猫'),
      f('d7', 'repurchase_rate', '20', '%'), f('d8', 'inventory_turnover', '2', '次/年'),
      f('d9', 'cash_conversion_cycle', '200', '天'), f('d10', 'valuation', '150000', '万元'),
    ],
    expectedJudgments: ['高度依赖第三方平台', '渠道单一', '库存周转过慢', '现金转换周期.*过长'],
  },
  {
    caseId: 'consumer_golden_overexpansion',
    description: '快速扩张但同店下滑——增长不可持续',
    facts: [
      f('e1', 'company_name', 'ExpandFast'), f('e2', 'revenue', '50000', '万元'),
      f('e3', 'revenue_growth', '60', '%'), f('e4', 'gross_margin', '55', '%'),
      f('e5', 'same_store_growth', '-8', '%'), f('e6', 'store_count', '300', '家'),
      f('e7', 'store_investment', '200', '万元'), f('e8', 'store_payback_months', '36', '月'),
      f('e9', 'repurchase_rate', '25', '%'), f('c10', 'cash_balance', '8000', '万元'),
    ],
    expectedJudgments: ['现有门店在萎缩', '单店回收期.*过长', '增长全靠新开店'],
  },
];
