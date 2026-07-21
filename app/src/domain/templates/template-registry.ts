import type { MetricDefinition } from '../metrics/metric-definition';
import type {
  ComposedIndustryTemplate,
  IndustryTemplate,
} from './industry-template';

export const industryTemplates: Record<string, IndustryTemplate> = {
  saas: {
    id: 'saas',
    name: 'SaaS / 软件',
    metrics: [
      { id: 'arr', label: 'ARR', unit: 'currency', direction: 'higher_is_better', inputKind: 'imported', description: '年度经常性收入' },
      { id: 'nrr', label: 'NRR', unit: 'percent', direction: 'higher_is_better', inputKind: 'formula', description: '净收入留存率' },
      { id: 'revenue_churn', label: 'Revenue Churn', unit: 'percent', direction: 'lower_is_better', inputKind: 'formula', description: '收入流失率' },
      { id: 'cac_payback_months', label: 'CAC 毛利回收月数', unit: 'months', direction: 'lower_is_better', inputKind: 'formula', description: 'CAC ÷ 单客月度新增毛利' },
      { id: 'burn_multiple', label: 'Burn Multiple', unit: 'multiple', direction: 'lower_is_better', inputKind: 'formula', description: '净现金消耗 ÷ 净新增 ARR' },
    ],
  },
  consumer: {
    id: 'consumer',
    name: '消费品',
    metrics: [
      { id: 'repeat_purchase_rate', label: '复购率', unit: 'percent', direction: 'higher_is_better', inputKind: 'imported', description: '指定周期内重复购买客户比例' },
      { id: 'sku_concentration', label: 'SKU 集中度', unit: 'percent', direction: 'lower_is_better', inputKind: 'formula', description: '头部 SKU 收入占比' },
      { id: 'channel_concentration', label: '渠道依赖度', unit: 'percent', direction: 'lower_is_better', inputKind: 'formula', description: '最大渠道收入占比' },
      { id: 'inventory_turnover_days', label: '库存周转天数', unit: 'days', direction: 'lower_is_better', inputKind: 'formula', description: '平均库存对应销售成本天数' },
    ],
  },
  hardtech_manufacturing: {
    id: 'hardtech_manufacturing',
    name: '硬科技 / 制造',
    metrics: [
      { id: 'technology_readiness_level', label: '技术就绪度 TRL', unit: 'level', direction: 'higher_is_better', inputKind: 'manual', description: 'TRL 1-9' },
      { id: 'yield_rate', label: '良率', unit: 'percent', direction: 'higher_is_better', inputKind: 'imported', description: '合格产出占总产出比例' },
      { id: 'capacity_utilization', label: '产能利用率', unit: 'percent', direction: 'higher_is_better', inputKind: 'formula', description: '实际产量 ÷ 设计产能' },
      { id: 'order_backlog', label: '在手订单', unit: 'currency', direction: 'higher_is_better', inputKind: 'imported', description: '已签署但尚未确认收入的订单金额' },
    ],
  },
};

export const composeIndustryTemplates = (
  templateIds: string[],
  customMetrics: MetricDefinition[] = [],
): ComposedIndustryTemplate => {
  const metrics = templateIds.flatMap(
    (templateId) => industryTemplates[templateId]?.metrics ?? [],
  );
  const uniqueMetrics = new Map(
    [...metrics, ...customMetrics].map((metric) => [metric.id, metric]),
  );

  return {
    selectedTemplateIds: templateIds,
    metrics: [...uniqueMetrics.values()],
  };
};
