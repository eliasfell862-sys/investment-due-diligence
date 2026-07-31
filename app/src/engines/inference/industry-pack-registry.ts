/**
 * Industry Inference Pack Registry
 *
 * Standard contract for industry-specific inference logic.
 * Each pack provides metric definitions, inference rules, risk chains,
 * forecast configs, valuation profiles, and monitoring metrics.
 */

import type { IndustryPackManifest } from '../../domain/inference/types';

// ── Registry ──

const registry = new Map<string, IndustryPackManifest>();

export function registerPack(manifest: IndustryPackManifest): void {
  registry.set(manifest.packId, manifest);
}

export function getPack(packId: string): IndustryPackManifest | undefined {
  return registry.get(packId);
}

export function listPacks(): readonly IndustryPackManifest[] {
  return [...registry.values()];
}

// ── SaaS Growth Pack ──

const SAAS_GROWTH_PACK: IndustryPackManifest = {
  packId: 'saas_growth',
  version: '1.0.0',
  strategy: 'growth_equity',
  supportedArchetypes: ['enterprise_software', 'model_saas', 'stage_growth', 'stage_early_growth'],
  requiredMetricIds: [
    'company_name', 'business_description', 'industry',
    'revenue', 'revenue_growth', 'gross_margin',
    'arr', 'nrr', 'customer_count', 'cac', 'ltv',
    'cash_balance', 'burn_rate',
    'valuation', 'funding_round',
  ],
  optionalMetricIds: [
    'mrr', 'grr', 'logo_churn', 'expansion_revenue',
    'cac_payback_months', 'sales_efficiency',
    'customer_concentration', 'contract_duration',
    'implementation_revenue', 'rule_of_40',
    'employee_count', 'rd_headcount',
    'tam', 'market_growth', 'competitor_count',
  ],
  ruleIds: [
    'saas_revenue_quality', 'saas_growth_sustainability',
    'saas_unit_economics', 'saas_cash_runway',
    'saas_valuation_multiples', 'saas_exit_paths',
  ],
  fatalFlawIds: [
    'nrr_below_80', 'customer_concentration_over_50',
    'cash_runway_under_6_months', 'cac_payback_over_24_months',
  ],
  questionIds: [
    'saas_q_arr_growth_drivers', 'saas_q_customer_retention',
    'saas_q_sales_efficiency', 'saas_q_competitive_position',
    'saas_q_cash_needs',
  ],
  forecastProfileId: 'saas_growth_default',
  valuationProfileIds: ['saas_ev_revenue', 'saas_dcf', 'saas_vc_method'],
  exitProfileIds: ['saas_ipo', 'saas_strategic_ma', 'saas_secondary'],
  clauseProfileIds: ['saas_valuation_adjustment', 'saas_staged_funding', 'saas_info_rights'],
  monitoringMetricIds: [
    'arr', 'nrr', 'gross_margin', 'cac_payback_months',
    'cash_runway_months', 'revenue_growth', 'customer_count',
  ],
  goldenCaseIds: ['saas_golden_high_price', 'saas_golden_churn_risk', 'saas_golden_cash_crunch'],
};

// ── Consumer Retail Pack ──

const CONSUMER_RETAIL_PACK: IndustryPackManifest = {
  packId: 'consumer_retail',
  version: '1.0.0',
  strategy: 'growth_equity',
  supportedArchetypes: ['consumer_brand', 'model_ecommerce', 'stage_growth'],
  requiredMetricIds: [
    'company_name', 'business_description', 'industry',
    'revenue', 'revenue_growth', 'gross_margin',
    'store_count', 'same_store_growth', 'repurchase_rate',
    'inventory_turnover', 'cash_balance',
    'valuation', 'funding_round',
  ],
  optionalMetricIds: [
    'sku_count', 'avg_order_value', 'channel_mix',
    'platform_fee_rate', 'cac', 'customer_ltv',
    'return_rate', 'cash_conversion_cycle',
    'store_investment', 'store_payback_months',
    'expansion_plan', 'brand_awareness',
  ],
  ruleIds: [
    'consumer_brand_growth', 'consumer_channel_risk',
    'consumer_inventory_health', 'consumer_store_economics',
    'consumer_valuation', 'consumer_exit',
  ],
  fatalFlawIds: [
    'same_store_declining', 'platform_dependency_over_70',
    'inventory_over_12_months', 'cash_conversion_over_180_days',
  ],
  questionIds: [
    'consumer_q_growth_source', 'consumer_q_channel_dependency',
    'consumer_q_store_model', 'consumer_q_brand_strength',
    'consumer_q_working_capital',
  ],
  forecastProfileId: 'consumer_retail_default',
  valuationProfileIds: ['consumer_ev_revenue', 'consumer_dcf', 'consumer_store_dcf'],
  exitProfileIds: ['consumer_strategic_ma', 'consumer_ipo', 'consumer_pe_secondary'],
  clauseProfileIds: ['consumer_budget_approval', 'consumer_expansion_milestone', 'consumer_info_rights'],
  monitoringMetricIds: [
    'revenue', 'same_store_growth', 'gross_margin', 'inventory_turnover',
    'repurchase_rate', 'store_count', 'cash_balance',
  ],
  goldenCaseIds: ['consumer_golden_strong_brand', 'consumer_golden_channel_risk', 'consumer_golden_inventory_crisis'],
};

// ── Industrial Manufacturing Pack ──

const INDUSTRIAL_PACK: IndustryPackManifest = {
  packId: 'industrial_manufacturing',
  version: '1.0.0',
  strategy: 'growth_equity',
  supportedArchetypes: ['advanced_manufacturing', 'model_manufacturing', 'stage_growth'],
  requiredMetricIds: [
    'company_name', 'business_description', 'industry',
    'revenue', 'revenue_growth', 'gross_margin',
    'order_backlog', 'capacity_utilization', 'yield_rate',
    'capex', 'cash_balance', 'debt_level',
    'valuation', 'funding_round',
  ],
  optionalMetricIds: [
    'unit_cost', 'material_cost_pct', 'customer_concentration',
    'receivables_days', 'inventory_turnover', 'depreciation',
    'expansion_plan', 'tech_level', 'certification_count',
    'supplier_count', 'employee_count',
  ],
  ruleIds: [
    'industrial_order_to_revenue', 'industrial_margin_drivers',
    'industrial_capex_cycle', 'industrial_working_capital',
    'industrial_valuation', 'industrial_exit',
  ],
  fatalFlawIds: [
    'customer_concentration_over_60', 'capacity_under_50_pct',
    'debt_to_ebitda_over_6', 'order_decline_3_quarters',
  ],
  questionIds: [
    'industrial_q_order_visibility', 'industrial_q_capacity_expansion',
    'industrial_q_cost_structure', 'industrial_q_customer_certification',
    'industrial_q_tech_moat',
  ],
  forecastProfileId: 'industrial_default',
  valuationProfileIds: ['industrial_ev_ebitda', 'industrial_dcf', 'industrial_asset_based'],
  exitProfileIds: ['industrial_strategic_ma', 'industrial_ipo', 'industrial_pe_secondary'],
  clauseProfileIds: ['industrial_capex_covenant', 'industrial_customer_condition', 'industrial_debt_covenant'],
  monitoringMetricIds: [
    'revenue', 'order_backlog', 'gross_margin', 'capacity_utilization',
    'yield_rate', 'capex', 'cash_balance',
  ],
  goldenCaseIds: ['industrial_golden_order_growth', 'industrial_golden_capacity_crunch', 'industrial_golden_customer_loss'],
};

// ── Registration ──

registerPack(SAAS_GROWTH_PACK);
registerPack(CONSUMER_RETAIL_PACK);
registerPack(INDUSTRIAL_PACK);

// ── Supplemental Packs (lightweight) ──

const SUPPLEMENTAL_PACKS: IndustryPackManifest[] = [
  {
    packId: 'tech_valuation', version: '1.0.0', strategy: 'growth_equity',
    supportedArchetypes: ['enterprise_software'],
    requiredMetricIds: [], optionalMetricIds: [],
    ruleIds: ['tech_multiples'], fatalFlawIds: [],
    questionIds: [], forecastProfileId: '', valuationProfileIds: ['saas_ev_revenue'],
    exitProfileIds: [], clauseProfileIds: [], monitoringMetricIds: [],
    goldenCaseIds: [],
  },
  {
    packId: 'data_compliance', version: '1.0.0', strategy: 'growth_equity',
    supportedArchetypes: ['enterprise_software', 'fintech'],
    requiredMetricIds: [], optionalMetricIds: [],
    ruleIds: ['data_compliance_check'], fatalFlawIds: ['data_compliance_violation'],
    questionIds: [], forecastProfileId: '', valuationProfileIds: [],
    exitProfileIds: [], clauseProfileIds: ['compliance_remediation'], monitoringMetricIds: [],
    goldenCaseIds: [],
  },
  {
    packId: 'healthcare_regulatory', version: '1.0.0', strategy: 'growth_equity',
    supportedArchetypes: ['healthcare'],
    requiredMetricIds: [], optionalMetricIds: [],
    ruleIds: ['healthcare_license_check'], fatalFlawIds: ['missing_required_license'],
    questionIds: [], forecastProfileId: '', valuationProfileIds: [],
    exitProfileIds: [], clauseProfileIds: ['regulatory_approval_condition'], monitoringMetricIds: [],
    goldenCaseIds: [],
  },
  {
    packId: 'fintech_regulatory', version: '1.0.0', strategy: 'growth_equity',
    supportedArchetypes: ['fintech'],
    requiredMetricIds: [], optionalMetricIds: [],
    ruleIds: ['fintech_license_check'], fatalFlawIds: ['missing_financial_license'],
    questionIds: [], forecastProfileId: '', valuationProfileIds: [],
    exitProfileIds: [], clauseProfileIds: ['regulatory_approval_condition'], monitoringMetricIds: [],
    goldenCaseIds: [],
  },
  {
    packId: 'credit_risk', version: '1.0.0', strategy: 'growth_equity',
    supportedArchetypes: ['fintech'],
    requiredMetricIds: [], optionalMetricIds: [],
    ruleIds: ['credit_risk_assessment'], fatalFlawIds: ['default_rate_over_threshold'],
    questionIds: [], forecastProfileId: '', valuationProfileIds: [],
    exitProfileIds: [], clauseProfileIds: [], monitoringMetricIds: ['default_rate', 'provision_coverage'],
    goldenCaseIds: [],
  },
  {
    packId: 'supply_chain_risk', version: '1.0.0', strategy: 'growth_equity',
    supportedArchetypes: ['advanced_manufacturing'],
    requiredMetricIds: [], optionalMetricIds: [],
    ruleIds: ['supply_chain_concentration'], fatalFlawIds: ['single_supplier_dependency'],
    questionIds: [], forecastProfileId: '', valuationProfileIds: [],
    exitProfileIds: [], clauseProfileIds: ['supply_chain_covenant'], monitoringMetricIds: [],
    goldenCaseIds: [],
  },
];

for (const pack of SUPPLEMENTAL_PACKS) {
  registerPack(pack);
}

// ── Composed pack resolution ──

export interface ResolvedPacks {
  readonly primary: IndustryPackManifest;
  readonly supplemental: readonly IndustryPackManifest[];
  readonly allMetricIds: readonly string[];
  readonly allFatalFlaws: readonly string[];
  readonly allMonitoringMetrics: readonly string[];
}

export function resolvePacks(primaryPackId: string, supplementalPackIds: readonly string[]): ResolvedPacks {
  const primary = getPack(primaryPackId);
  if (!primary) throw new Error(`Industry pack not found: ${primaryPackId}`);

  const supplemental = supplementalPackIds
    .map(id => getPack(id))
    .filter((p): p is IndustryPackManifest => !!p);

  const metricSet = new Set<string>([...primary.requiredMetricIds, ...primary.optionalMetricIds]);
  const flawSet = new Set<string>([...primary.fatalFlawIds]);
  const monitorSet = new Set<string>([...primary.monitoringMetricIds]);

  for (const p of supplemental) {
    for (const m of p.requiredMetricIds) metricSet.add(m);
    for (const m of p.optionalMetricIds) metricSet.add(m);
    for (const f of p.fatalFlawIds) flawSet.add(f);
    for (const m of p.monitoringMetricIds) monitorSet.add(m);
  }

  return {
    primary,
    supplemental,
    allMetricIds: [...metricSet],
    allFatalFlaws: [...flawSet],
    allMonitoringMetrics: [...monitorSet],
  };
}
