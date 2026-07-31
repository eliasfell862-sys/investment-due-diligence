/**
 * Next Best Question Engine
 *
 * Ranks questions by:
 *   Value = P(change_conclusion) × Impact × Uncertainty × P(reliable_answer) / Cost
 *
 * Each question includes: what, why now, affected nodes, expected evidence,
 * answer format, information value, and whether it's blocking.
 */

import type { InferenceNode, NextBestQuestion, ConfirmedFact } from '../../domain/inference/types';
import { getPack } from './industry-pack-registry';

// ── Question Templates by Module ──

interface QuestionTemplate {
  readonly metricId: string;
  readonly promptTemplate: string;
  readonly reasonTemplate: string;
  readonly expectedAnswerType: string;
  readonly unit: string | null;
  readonly affectedOutputs: NextBestQuestion['affectedOutputs'];
  readonly defaultPriority: number; // 0-1 base priority
}

const QUESTION_TEMPLATES: QuestionTemplate[] = [
  // Revenue & Growth
  { metricId: 'revenue', promptTemplate: '请提供{company}最新年度营业收入', reasonTemplate: '收入是估值和预测的基础', expectedAnswerType: 'number', unit: '万元', affectedOutputs: ['forecast', 'valuation', 'decision'], defaultPriority: 0.9 },
  { metricId: 'revenue_growth', promptTemplate: '{company}过去12个月的收入增速是多少？', reasonTemplate: '增速决定增长阶段和估值倍数', expectedAnswerType: 'percentage', unit: null, affectedOutputs: ['forecast', 'valuation'], defaultPriority: 0.85 },
  { metricId: 'gross_margin', promptTemplate: '{company}的毛利率是多少？', reasonTemplate: '毛利率是单位经济和盈利能力的核心指标', expectedAnswerType: 'percentage', unit: null, affectedOutputs: ['forecast', 'valuation', 'risk'], defaultPriority: 0.85 },
  // SaaS specific
  { metricId: 'arr', promptTemplate: '{company}的ARR（年化经常性收入）是多少？', reasonTemplate: 'ARR是SaaS企业估值的核心指标', expectedAnswerType: 'number', unit: '万元', affectedOutputs: ['valuation', 'forecast', 'decision'], defaultPriority: 0.95 },
  { metricId: 'nrr', promptTemplate: '{company}的NRR（净收入留存率）是多少？', reasonTemplate: 'NRR<100%意味着客户在萎缩，是SaaS最关键的预警指标', expectedAnswerType: 'percentage', unit: null, affectedOutputs: ['valuation', 'risk', 'decision'], defaultPriority: 0.95 },
  { metricId: 'cac_payback_months', promptTemplate: '{company}的CAC回收期是几个月？', reasonTemplate: 'CAC回收期决定增长的资本效率', expectedAnswerType: 'number', unit: '月', affectedOutputs: ['forecast', 'risk'], defaultPriority: 0.7 },
  // Cash & Survival
  { metricId: 'cash_balance', promptTemplate: '{company}目前账面现金余额？', reasonTemplate: '现金是生存能力的底线', expectedAnswerType: 'number', unit: '万元', affectedOutputs: ['risk', 'forecast', 'decision'], defaultPriority: 0.9 },
  { metricId: 'burn_rate', promptTemplate: '{company}的月现金消耗（净）是多少？', reasonTemplate: '烧钱速度决定融资紧迫性', expectedAnswerType: 'number', unit: '万元/月', affectedOutputs: ['risk', 'forecast'], defaultPriority: 0.85 },
  // Team
  { metricId: 'founder_background', promptTemplate: '请介绍{company}创始人的背景和行业经验', reasonTemplate: '早期投资中团队是最重要的因素', expectedAnswerType: 'text', unit: null, affectedOutputs: ['decision', 'risk'], defaultPriority: 0.8 },
  { metricId: 'team_completeness', promptTemplate: '{company}还有哪些关键岗位空缺？', reasonTemplate: '关键岗位空缺是组织风险的核心', expectedAnswerType: 'text', unit: null, affectedOutputs: ['risk'], defaultPriority: 0.65 },
  // Competition
  { metricId: 'competitive_position', promptTemplate: '{company}相比主要竞品的差异化优势是什么？', reasonTemplate: '护城河深度直接影响估值和退出前景', expectedAnswerType: 'text', unit: null, affectedOutputs: ['valuation', 'exit', 'decision'], defaultPriority: 0.75 },
  { metricId: 'market_share', promptTemplate: '{company}在目标市场的占有率约为多少？', reasonTemplate: '市场位置影响增长天花板和退出选择', expectedAnswerType: 'percentage', unit: null, affectedOutputs: ['valuation', 'exit'], defaultPriority: 0.6 },
  // Customers
  { metricId: 'customer_concentration', promptTemplate: '{company}前三大客户占收入的比例？', reasonTemplate: '客户集中度过高是重大风险', expectedAnswerType: 'percentage', unit: null, affectedOutputs: ['risk', 'valuation', 'decision'], defaultPriority: 0.85 },
  // Valuation
  { metricId: 'valuation', promptTemplate: '{company}本轮投前估值是多少？', reasonTemplate: '价格是投资决策的最后一道关', expectedAnswerType: 'number', unit: '万元', affectedOutputs: ['valuation', 'decision'], defaultPriority: 0.9 },
  { metricId: 'funding_round', promptTemplate: '{company}历史融资轮次和金额？', reasonTemplate: '融资历史反映企业发展轨迹', expectedAnswerType: 'text', unit: null, affectedOutputs: ['valuation', 'financing'], defaultPriority: 0.55 },
  // Consumer specific
  { metricId: 'same_store_growth', promptTemplate: '{company}的同店增长率是多少？', reasonTemplate: '同店增长区分品牌力和扩张效应', expectedAnswerType: 'percentage', unit: null, affectedOutputs: ['forecast', 'valuation'], defaultPriority: 0.8 },
  { metricId: 'store_count', promptTemplate: '{company}目前有多少家门店？', reasonTemplate: '门店数量是零售企业的核心规模指标', expectedAnswerType: 'number', unit: '家', affectedOutputs: ['forecast', 'valuation'], defaultPriority: 0.75 },
  // Industrial specific
  { metricId: 'order_backlog', promptTemplate: '{company}的在手订单金额是多少？', reasonTemplate: '在手订单是制造业未来收入的可见度', expectedAnswerType: 'number', unit: '万元', affectedOutputs: ['forecast', 'risk'], defaultPriority: 0.85 },
  { metricId: 'capacity_utilization', promptTemplate: '{company}的产能利用率？', reasonTemplate: '产能利用率影响毛利和扩产时机', expectedAnswerType: 'percentage', unit: null, affectedOutputs: ['forecast', 'valuation'], defaultPriority: 0.75 },
];

// ── Question Generation ──

let questionCounter = 0;
function nextQuestionId(): string {
  questionCounter++;
  return `q_${Date.now()}_${questionCounter}`;
}

export function generateQuestions(
  companyName: string,
  nodes: readonly InferenceNode[],
  confirmedFacts: readonly ConfirmedFact[],
  primaryPackId: string,
): NextBestQuestion[] {
  const pack = getPack(primaryPackId);
  const confirmedMetrics = new Set(confirmedFacts.map(f => f.metricId));
  const inferredMetrics = new Set(nodes.filter(n => n.kind === 'inference' && n.confidence !== 'blocked').map(n => n.metricId));

  // Find missing metrics
  const requiredMetrics = pack?.requiredMetricIds || [];
  const missingRequired = requiredMetrics.filter(m => !confirmedMetrics.has(m) && !inferredMetrics.has(m));

  const questions: NextBestQuestion[] = [];

  for (const template of QUESTION_TEMPLATES) {
    const isMissing = missingRequired.includes(template.metricId);
    const isBlocked = nodes.some(n => n.metricId === template.metricId && n.confidence === 'blocked');

    if (!isMissing && !isBlocked) continue;

    // Calculate information value
    const pImpact = template.affectedOutputs.includes('decision') ? 0.9 :
      template.affectedOutputs.includes('valuation') ? 0.8 :
      template.affectedOutputs.includes('risk') ? 0.7 : 0.5;

    const uncertainty = isBlocked ? 1.0 : (confirmedMetrics.has(template.metricId) || inferredMetrics.has(template.metricId) ? 0.3 : 0.7);
    const cost = isBlocked ? 0.2 : 0.5;

    // Information value = P(change) × uncertainty × priority / cost, normalized to 0-1
    const rawValue = (pImpact * uncertainty * template.defaultPriority) / cost;
    const infoValue = Math.min(0.99, rawValue / 3.0); // divide by 3 to spread values across 0-1

    const affectedNodeIds = nodes
      .filter(n => n.metricId === template.metricId || n.dependencyNodeIds.some(d => d.includes(template.metricId)))
      .map(n => n.nodeId);

    questions.push({
      questionId: nextQuestionId(),
      prompt: template.promptTemplate.replace('{company}', companyName),
      reason: isBlocked ? `当前该指标存在阻断性缺失 — ${template.reasonTemplate}` : template.reasonTemplate,
      expectedAnswerType: template.expectedAnswerType,
      unit: template.unit,
      requestedEvidenceTypes: ['document', 'management_interview', 'third_party_report'],
      affectedNodeIds: affectedNodeIds.length > 0 ? affectedNodeIds : [template.metricId],
      affectedOutputs: template.affectedOutputs,
      informationValue: Math.min(1, infoValue).toFixed(4),
      blocking: isBlocked,
    });
  }

  // Sort by information value descending
  questions.sort((a, b) => parseFloat(b.informationValue) - parseFloat(a.informationValue));

  // Return top 5
  return questions.slice(0, 5);
}

// ── Check if we should stop asking questions ──

export function shouldStopAsking(
  overallConfidence: number,
  blockingQuestionsRemaining: boolean,
  institutionThreshold: number = 0.7,
): { stop: boolean; reason: string } {
  if (blockingQuestionsRemaining && overallConfidence < institutionThreshold) {
    return { stop: false, reason: '存在阻断性问题尚未解决' };
  }
  if (overallConfidence >= institutionThreshold) {
    return { stop: true, reason: '置信度已达到机构阈值' };
  }
  if (overallConfidence < 0.3) {
    return { stop: false, reason: '置信度过低，需要更多信息' };
  }
  return { stop: false, reason: '仍有可以提升判断质量的信息' };
}
