/**
 * Enterprise Archetype Classifier
 *
 * Three-axis classification: Industry × Business Model × Stage
 * Classifies companies and selects matching industry inference packs.
 */

import type { CompanyArchetypeResult, ConfirmedFact, CandidateFact } from '../../domain/inference/types';

// ── Archetype Definitions ──

export interface ArchetypeSignature {
  readonly archetypeId: string;
  readonly axis: 'industry' | 'business_model' | 'stage';
  readonly label: string;
  readonly matchPatterns: readonly string[]; // keywords to match
  readonly indicators: readonly string[]; // measurable indicators
  readonly capitalIntensity: 'light' | 'medium' | 'heavy';
  readonly regulatoryIntensity: 'low' | 'medium' | 'high';
  readonly revenueRecurrence: 'subscription' | 'recurring' | 'transactional' | 'project';
  readonly typicalGrossMarginRange: [number, number]; // e.g. [60, 85]
}

// ── Industry Archetypes ──

const INDUSTRY_ARCHETYPES: ArchetypeSignature[] = [
  {
    archetypeId: 'enterprise_software', axis: 'industry',
    label: '企业软件/SaaS',
    matchPatterns: ['SaaS', '软件', '云', '订阅', '平台', 'PaaS', 'IaaS', 'API', '开发者工具', '数据库', '中间件', '安全', '协同', 'CRM', 'ERP', 'HR', '财务软件'],
    indicators: ['ARR', 'NRR', '订阅收入', '客户数', '月活'],
    capitalIntensity: 'light', regulatoryIntensity: 'medium', revenueRecurrence: 'subscription',
    typicalGrossMarginRange: [60, 85],
  },
  {
    archetypeId: 'consumer_brand', axis: 'industry',
    label: '消费品牌/连锁零售',
    matchPatterns: ['消费', '品牌', '零售', '连锁', '餐饮', '服饰', '美妆', '食品', '饮料', '母婴', '宠物', '家居', '电商', 'DTC', '直播'],
    indicators: ['门店数', '同店增长', '复购率', '客单价', 'SKU', '库存'],
    capitalIntensity: 'medium', regulatoryIntensity: 'medium', revenueRecurrence: 'transactional',
    typicalGrossMarginRange: [30, 70],
  },
  {
    archetypeId: 'advanced_manufacturing', axis: 'industry',
    label: '先进制造/工业',
    matchPatterns: ['制造', '工业', '工厂', '产线', '设备', '零部件', '材料', '芯片', '半导体', '电池', '光伏', '机器人', '自动化', '汽车', '航空'],
    indicators: ['订单', '产能', '良率', '利用率', '资本开支', '库存'],
    capitalIntensity: 'heavy', regulatoryIntensity: 'medium', revenueRecurrence: 'transactional',
    typicalGrossMarginRange: [15, 45],
  },
  {
    archetypeId: 'healthcare', axis: 'industry',
    label: '医疗健康',
    matchPatterns: ['医疗', '医院', '医药', '器械', '诊断', '基因', '生物', '制药', 'CRO', 'CDMO', '互联网医疗'],
    indicators: ['批文', '临床', '床位', '患者', '医保'],
    capitalIntensity: 'medium', regulatoryIntensity: 'high', revenueRecurrence: 'transactional',
    typicalGrossMarginRange: [30, 85],
  },
  {
    archetypeId: 'fintech', axis: 'industry',
    label: '金融科技',
    matchPatterns: ['金融', '支付', '信贷', '保险', '理财', '风控', '征信', '区块链', '数字货币', '量化'],
    indicators: ['GMV', '交易量', '坏账率', '牌照'],
    capitalIntensity: 'light', regulatoryIntensity: 'high', revenueRecurrence: 'transactional',
    typicalGrossMarginRange: [40, 70],
  },
  {
    archetypeId: 'general_enterprise', axis: 'industry',
    label: '通用企业',
    matchPatterns: [], // fallback
    indicators: [],
    capitalIntensity: 'medium', regulatoryIntensity: 'medium', revenueRecurrence: 'transactional',
    typicalGrossMarginRange: [20, 50],
  },
];

// ── Business Model Archetypes ──

const MODEL_ARCHETYPES: ArchetypeSignature[] = [
  {
    archetypeId: 'model_saas', axis: 'business_model',
    label: 'SaaS/订阅',
    matchPatterns: ['订阅', '月费', '年费', 'SaaS', 'ARR', 'MRR'],
    indicators: ['ARR', 'MRR', 'NRR', 'churn'],
    capitalIntensity: 'light', regulatoryIntensity: 'medium', revenueRecurrence: 'subscription',
    typicalGrossMarginRange: [60, 85],
  },
  {
    archetypeId: 'model_transactional', axis: 'business_model',
    label: '交易/佣金',
    matchPatterns: ['交易', '佣金', '抽成', 'GMV', '平台', 'marketplace'],
    indicators: ['GMV', 'take rate', '交易量'],
    capitalIntensity: 'light', regulatoryIntensity: 'medium', revenueRecurrence: 'transactional',
    typicalGrossMarginRange: [30, 70],
  },
  {
    archetypeId: 'model_ecommerce', axis: 'business_model',
    label: '电商/零售',
    matchPatterns: ['电商', '零售', '门店', 'SKU', '配送', '快递'],
    indicators: ['GMV', 'SKU', '库存周转', '客单价'],
    capitalIntensity: 'medium', regulatoryIntensity: 'medium', revenueRecurrence: 'transactional',
    typicalGrossMarginRange: [20, 50],
  },
  {
    archetypeId: 'model_manufacturing', axis: 'business_model',
    label: '生产制造',
    matchPatterns: ['生产', '制造', '加工', '组装', 'OEM', 'ODM'],
    indicators: ['产能', '良率', '利用率', 'BOM'],
    capitalIntensity: 'heavy', regulatoryIntensity: 'medium', revenueRecurrence: 'transactional',
    typicalGrossMarginRange: [10, 40],
  },
];

// ── Stage Archetypes ──

const STAGE_ARCHETYPES: ArchetypeSignature[] = [
  {
    archetypeId: 'stage_seed', axis: 'stage',
    label: '种子/天使轮',
    matchPatterns: ['种子', '天使', '预研', 'demo', '原型'],
    indicators: ['产品阶段', '用户数', '融资额'],
    capitalIntensity: 'light', regulatoryIntensity: 'low', revenueRecurrence: 'transactional',
    typicalGrossMarginRange: [0, 100],
  },
  {
    archetypeId: 'stage_early_growth', axis: 'stage',
    label: 'A轮/早期成长',
    matchPatterns: ['A轮', 'Pre-A', '早期', 'PMF', '商业化'],
    indicators: ['收入', '增速', '客户数'],
    capitalIntensity: 'light', regulatoryIntensity: 'low', revenueRecurrence: 'transactional',
    typicalGrossMarginRange: [0, 100],
  },
  {
    archetypeId: 'stage_growth', axis: 'stage',
    label: 'B/C轮/成长期',
    matchPatterns: ['B轮', 'C轮', '成长', '扩张', '规模化'],
    indicators: ['收入', '增速', '毛利率', 'NRR', 'UE'],
    capitalIntensity: 'medium', regulatoryIntensity: 'medium', revenueRecurrence: 'transactional',
    typicalGrossMarginRange: [0, 100],
  },
  {
    archetypeId: 'stage_pre_ipo', axis: 'stage',
    label: 'Pre-IPO/成熟期',
    matchPatterns: ['D轮', 'Pre-IPO', '上市前', '成熟', '盈利'],
    indicators: ['收入', '利润', 'PE', '合规'],
    capitalIntensity: 'medium', regulatoryIntensity: 'high', revenueRecurrence: 'transactional',
    typicalGrossMarginRange: [0, 100],
  },
];

// ── Industry Pack Mappings ──

const PACK_MAPPINGS: Record<string, { primaryPackId: string; supplementalPackIds: string[] }> = {
  'enterprise_software:model_saas': { primaryPackId: 'saas_growth', supplementalPackIds: ['tech_valuation', 'data_compliance'] },
  'enterprise_software:model_transactional': { primaryPackId: 'saas_growth', supplementalPackIds: ['marketplace_metrics'] },
  'enterprise_software:model_ecommerce': { primaryPackId: 'saas_growth', supplementalPackIds: ['ecommerce_metrics'] },
  'consumer_brand:model_ecommerce': { primaryPackId: 'consumer_retail', supplementalPackIds: ['brand_valuation', 'channel_risk'] },
  'consumer_brand:model_transactional': { primaryPackId: 'consumer_retail', supplementalPackIds: ['platform_dependency'] },
  'advanced_manufacturing:model_manufacturing': { primaryPackId: 'industrial_manufacturing', supplementalPackIds: ['capex_analysis', 'supply_chain_risk'] },
  'healthcare:model_saas': { primaryPackId: 'saas_growth', supplementalPackIds: ['healthcare_regulatory'] },
  'healthcare:model_manufacturing': { primaryPackId: 'industrial_manufacturing', supplementalPackIds: ['healthcare_regulatory', 'clinical_metrics'] },
  'fintech:model_saas': { primaryPackId: 'saas_growth', supplementalPackIds: ['fintech_regulatory', 'credit_risk'] },
  'fintech:model_transactional': { primaryPackId: 'fintech_growth', supplementalPackIds: ['fintech_regulatory', 'credit_risk'] },
};

// ── Classification ──

function scoreArchetype(text: string, archetype: ArchetypeSignature): number {
  let score = 0;
  for (const pattern of archetype.matchPatterns) {
    if (text.toLowerCase().includes(pattern.toLowerCase())) score += 1;
  }
  return score;
}

function extractSearchText(facts: readonly ConfirmedFact[], candidates: readonly CandidateFact[]): string {
  const parts: string[] = [];
  for (const f of facts) {
    if (typeof f.value === 'string') parts.push(f.value, f.metricId);
  }
  for (const c of candidates) {
    if (typeof c.proposedValue === 'string') parts.push(c.proposedValue, c.metricId);
  }
  return parts.join(' ');
}

export function classifyCompany(
  facts: readonly ConfirmedFact[],
  candidates: readonly CandidateFact[],
): CompanyArchetypeResult {
  const text = extractSearchText(facts, candidates);

  // Score each axis
  const industryScores = INDUSTRY_ARCHETYPES.map(a => ({ archetype: a, score: scoreArchetype(text, a) }));
  const modelScores = MODEL_ARCHETYPES.map(a => ({ archetype: a, score: scoreArchetype(text, a) }));
  const stageScores = STAGE_ARCHETYPES.map(a => ({ archetype: a, score: scoreArchetype(text, a) }));

  // Best match per axis (exclude general fallback during selection)
  const bestIndustryNonGeneral = industryScores.filter(s => s.archetype.archetypeId !== 'general_enterprise').sort((a, b) => b.score - a.score)[0];
  const fallbackUsed = !bestIndustryNonGeneral || bestIndustryNonGeneral.score === 0;
  const bestIndustry = fallbackUsed
    ? industryScores.find(s => s.archetype.archetypeId === 'general_enterprise')!
    : bestIndustryNonGeneral;
  const bestModel = modelScores.sort((a, b) => b.score - a.score)[0];
  const bestStage = stageScores.sort((a, b) => b.score - a.score)[0];

  const classificationReasons: string[] = [];
  if (!fallbackUsed && bestIndustry.score > 0) classificationReasons.push(`行业匹配"${bestIndustry.archetype.label}"（得分${bestIndustry.score}）`);
  if (fallbackUsed) classificationReasons.push('行业信息不足，使用通用企业分类');
  if (bestModel.score > 0) classificationReasons.push(`商业模式匹配"${bestModel.archetype.label}"（得分${bestModel.score}）`);
  classificationReasons.push(`阶段判定"${bestStage.archetype.label}"`);
  const packKey = `${bestIndustry.archetype.archetypeId}:${bestModel.archetype.archetypeId}`;
  const mapping = PACK_MAPPINGS[packKey];
  const effectiveMapping = mapping || { primaryPackId: 'general_enterprise', supplementalPackIds: [] as string[] };

  // Match score
  const totalPossible = 3 + Math.max(...INDUSTRY_ARCHETYPES.map(a => a.matchPatterns.length));
  const matchScore = Math.min(1, (bestIndustry.score + bestModel.score) / Math.max(1, totalPossible / 3)).toFixed(4);

  const confirmationQuestions: string[] = [];
  if (fallbackUsed) confirmationQuestions.push('请确认公司所属行业');
  if (bestModel.score < 2) confirmationQuestions.push('请确认主要商业模式和收费方式');
  confirmationQuestions.push('请确认当前发展阶段（种子/天使/A/B/C/Pre-IPO）');

  return {
    primaryPackId: effectiveMapping.primaryPackId,
    supplementalPackIds: effectiveMapping.supplementalPackIds,
    matchScore,
    classificationReasons,
    confirmationQuestions,
    fallbackUsed,
  };
}

// ── Extract archetype properties for downstream use ──

export function getArchetypeProperties(facts: readonly ConfirmedFact[], candidates: readonly CandidateFact[]) {
  const text = extractSearchText(facts, candidates);

  const industry = INDUSTRY_ARCHETYPES.filter(a => a.archetypeId !== 'general_enterprise')
    .map(a => ({ a, score: scoreArchetype(text, a) })).sort((a, b) => b.score - a.score)[0]?.a || INDUSTRY_ARCHETYPES[INDUSTRY_ARCHETYPES.length - 1];
  const model = MODEL_ARCHETYPES.map(a => ({ a, score: scoreArchetype(text, a) })).sort((a, b) => b.score - a.score)[0]?.a || MODEL_ARCHETYPES[0];

  return {
    capitalIntensity: industry.capitalIntensity,
    regulatoryIntensity: Math.max(
      industry.regulatoryIntensity === 'high' ? 3 : industry.regulatoryIntensity === 'medium' ? 2 : 1,
      model.regulatoryIntensity === 'high' ? 3 : model.regulatoryIntensity === 'medium' ? 2 : 1,
    ) >= 3 ? 'high' : industry.regulatoryIntensity === 'medium' ? 'medium' : 'low',
    revenueRecurrence: model.revenueRecurrence,
    grossMarginRange: [
      Math.max(industry.typicalGrossMarginRange[0], model.typicalGrossMarginRange[0]),
      Math.min(industry.typicalGrossMarginRange[1], model.typicalGrossMarginRange[1]),
    ] as [number, number],
    industryLabel: industry.label,
    modelLabel: model.label,
  };
}
