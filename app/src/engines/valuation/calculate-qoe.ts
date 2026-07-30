/**
 * Quality of Earnings (QoE) Engine
 *
 * Adjusts reported EBITDA to arrive at Normalized / Sustainable EBITDA.
 * This is a critical PE input — reported figures often include
 * non-recurring items, related-party distortions, and accounting choices
 * that obscure true earning power.
 */

// ── Types ──

export type QoECategory =
  | 'non_recurring_income'
  | 'non_recurring_expense'
  | 'related_party'
  | 'owner_compensation'
  | 'accounting_policy'
  | 'restructuring'
  | 'litigation'
  | 'inventory'
  | 'revenue_recognition'
  | 'other';

export interface QoEAdjustment {
  readonly category: QoECategory;
  readonly description: string;
  readonly amount: number; // positive = add-back to EBITDA, negative = deduction
  readonly confidence: 'high' | 'medium' | 'low';
}

export interface QoEInput {
  readonly reportedEbitda: number;
  readonly reportedRevenue: number;
  readonly adjustments: readonly QoEAdjustment[];
}

export interface QoECategorySummary {
  readonly category: QoECategory;
  readonly label: string;
  readonly total: number;
  readonly count: number;
  readonly items: readonly QoEAdjustment[];
}

export interface QoEResult {
  readonly reportedEbitda: number;
  readonly reportedMargin: number;
  readonly totalAdjustments: number;
  readonly normalizedEbitda: number;
  readonly normalizedMargin: number;
  readonly adjustmentPercent: number; // adjustments as % of reported EBITDA
  readonly byCategory: readonly QoECategorySummary[];
  readonly confidenceScore: number; // 0-100, higher = more confident in normalized figure
  readonly redFlags: readonly string[];
}

// ── Constants ──

export const QOE_CATEGORY_LABELS: Record<QoECategory, string> = {
  non_recurring_income: '非经常性收益',
  non_recurring_expense: '非经常性支出',
  related_party: '关联交易',
  owner_compensation: '股东/管理层薪酬',
  accounting_policy: '会计政策差异',
  restructuring: '重组/整合成本',
  litigation: '诉讼/合规',
  inventory: '存货调整',
  revenue_recognition: '收入确认',
  other: '其他调整',
};

export const QOE_CATEGORY_EXPLANATIONS: Record<QoECategory, string> = {
  non_recurring_income: '一次性资产处置、政府补贴、保险赔付等不可持续收入',
  non_recurring_expense: '一次性搬迁费、注销损失、偶发性咨询费等',
  related_party: '关联方交易的定价偏离市场公允水平',
  owner_compensation: '创始人/管理层薪酬显著偏离市场水平（偏高或偏低）',
  accounting_policy: '折旧方法、坏账计提、收入确认等会计政策与行业惯例的差异',
  restructuring: '裁员补偿、业务关停成本等非持续性重组支出',
  litigation: '未决诉讼的预计负债、历史罚款等',
  inventory: '呆滞库存计提、存货计价方法的合理性',
  revenue_recognition: '收入确认时点、完工百分比法的合理性',
  other: '其他需要调整的一次性或非经营性项目',
};

// ── Pre-built PE adjustment templates ──

export interface QoETemplate {
  readonly label: string;
  readonly description: string;
  readonly items: readonly { category: QoECategory; description: string; typicalAmountHint: string }[];
}

export const PE_QOE_TEMPLATES: readonly QoETemplate[] = [
  {
    label: 'SaaS/软件企业',
    description: '重点关注：收入确认（递延收入）、资本化研发支出、股权激励',
    items: [
      { category: 'revenue_recognition', description: '递延收入确认调整', typicalAmountHint: '通常为ARR的10-20%' },
      { category: 'accounting_policy', description: '研发支出资本化比例调整', typicalAmountHint: '对比行业（通常30-50%）' },
      { category: 'owner_compensation', description: '股权激励费用加回', typicalAmountHint: '占收入5-15%' },
      { category: 'non_recurring_expense', description: '一次性系统迁移/实施费用', typicalAmountHint: '' },
    ],
  },
  {
    label: '制造业企业',
    description: '重点关注：存货计价、折旧政策、关联采购',
    items: [
      { category: 'inventory', description: '呆滞/过期存货计提补足', typicalAmountHint: '占存货余额3-8%' },
      { category: 'accounting_policy', description: '折旧年限对标行业', typicalAmountHint: '' },
      { category: 'related_party', description: '关联采购价格公允性', typicalAmountHint: '' },
      { category: 'non_recurring_income', description: '排除一次性资产处置收益', typicalAmountHint: '' },
      { category: 'owner_compensation', description: '实际控制人薪酬对标市场', typicalAmountHint: '' },
    ],
  },
  {
    label: '消费品企业',
    description: '重点关注：渠道费用确认、促销计提、退货准备',
    items: [
      { category: 'revenue_recognition', description: '渠道返利/退货准备计提', typicalAmountHint: '占收入2-5%' },
      { category: 'non_recurring_expense', description: '一次性品牌重塑/包装更新', typicalAmountHint: '' },
      { category: 'related_party', description: '关联渠道/代工定价调整', typicalAmountHint: '' },
    ],
  },
];

// ── Calculation ──

export function calculateQoE(input: QoEInput): QoEResult {
  const { reportedEbitda, reportedRevenue, adjustments } = input;

  const totalAdjustments = adjustments.reduce((sum, a) => sum + a.amount, 0);
  const normalizedEbitda = reportedEbitda + totalAdjustments;
  const reportedMargin = reportedRevenue > 0 ? (reportedEbitda / reportedRevenue) * 100 : 0;
  const normalizedMargin = reportedRevenue > 0 ? (normalizedEbitda / reportedRevenue) * 100 : 0;
  const adjustmentPercent = reportedEbitda !== 0 ? Math.abs(totalAdjustments / reportedEbitda) * 100 : 0;

  // Group by category
  const byCategory: QoECategorySummary[] = [];
  const catMap = new Map<QoECategory, QoEAdjustment[]>();
  for (const a of adjustments) {
    const list = catMap.get(a.category) || [];
    list.push(a);
    catMap.set(a.category, list);
  }
  for (const [cat, items] of catMap) {
    byCategory.push({
      category: cat,
      label: QOE_CATEGORY_LABELS[cat],
      total: items.reduce((s, i) => s + i.amount, 0),
      count: items.length,
      items,
    });
  }
  byCategory.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  // Confidence score
  let confScore = 100;
  const redFlags: string[] = [];
  const lowConfItems = adjustments.filter(a => a.confidence === 'low');
  const medConfItems = adjustments.filter(a => a.confidence === 'medium');
  confScore -= lowConfItems.length * 15;
  confScore -= medConfItems.length * 5;
  if (adjustmentPercent > 30) { confScore -= 20; redFlags.push('调整金额超报告EBITDA 30%，Normalized EBITDA 可靠性下降'); }
  if (adjustmentPercent > 20) { confScore -= 10; redFlags.push('调整金额超报告EBITDA 20%，建议获取更多佐证材料'); }
  if (adjustments.length === 0) { confScore -= 30; redFlags.push('未做任何盈利质量调整，可能遗漏重要项目'); }
  if (normalizedEbitda < reportedEbitda * 0.7) { redFlags.push('Normalized EBITDA 较报告数下降超30%，盈利质量存在重大隐患'); }
  if (normalizedEbitda > reportedEbitda * 1.3) { redFlags.push('Normalized EBITDA 较报告数上升超30%，管理层加回可能过于激进'); }
  confScore = Math.max(0, Math.min(100, confScore));

  return {
    reportedEbitda,
    reportedMargin: Math.round(reportedMargin * 10) / 10,
    totalAdjustments,
    normalizedEbitda,
    normalizedMargin: Math.round(normalizedMargin * 10) / 10,
    adjustmentPercent: Math.round(adjustmentPercent * 10) / 10,
    byCategory,
    confidenceScore: confScore,
    redFlags,
  };
}
