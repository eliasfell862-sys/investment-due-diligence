import type { AnalysisScalar } from '../../domain/analysis/analysis-scalar';
import type { AnalysisUnit } from '../../domain/analysis/value';
import type { ConfirmedFact } from '../../domain/inference/types';
import { forecastThreeScenarios } from '../forecast/forecast-three-scenarios';
import type { ForecastScenarioAssumptions, GeneratedValueRule, ThreeScenarioForecastInput } from '../forecast/forecast-types';
import { calculateDcf } from '../valuation/calculate-dcf';
import { modelCapTable } from '../equity/model-cap-table';
import { calculateInvestorReturns } from '../equity/calculate-investor-returns';
import type { SecurityPosition } from '../equity/equity-types';
import { evaluateRisk } from '../risk/evaluate-risk';
import type { FatalFlawId, FatalFlawStatus, RiskItemInput } from '../risk/risk-types';
import { evaluateDecision } from '../decision/evaluate-decision';

export interface AutomaticAnalysisSummary {
  readonly forecastSnapshotRef: string | null;
  readonly valuationSnapshotRef: string | null;
  readonly riskSnapshotRef: string | null;
  readonly equitySnapshotRef: string | null;
  readonly forecast: {
    readonly downsideRevenue: string;
    readonly baseRevenue: string;
    readonly upsideRevenue: string;
    readonly baseFcff: string;
    readonly downsideCashBreak: boolean;
  } | null;
  readonly valuation: { readonly low: string; readonly midpoint: string; readonly high: string } | null;
  readonly marketCap: {
    readonly low: string; readonly midpoint: string; readonly high: string;
    readonly basis: 'listed' | 'post_money' | 'model_implied'; readonly ruleRef: string;
  } | null;
  readonly equity: {
    readonly expectedMoic: string;
    readonly baseIrr: string | null;
    readonly permanentLossProbability: string;
  } | null;
  readonly risk: {
    readonly residualRisk: string | null;
    readonly riskPenalty: string | null;
    readonly permanentLossLower: string;
    readonly permanentLossUpper: string;
    readonly fatalOutcome: 'none' | 'conditional_cap' | 'pause' | 'reject';
    readonly unassessedFatalFlawCount: number;
    readonly clauseTypes: readonly string[];
  } | null;
  readonly decision: { readonly tier: string; readonly rationale: string } | null;
}

function emptySummary(): AutomaticAnalysisSummary {
  return {
    forecastSnapshotRef: null, valuationSnapshotRef: null, riskSnapshotRef: null,
    equitySnapshotRef: null, forecast: null, valuation: null, marketCap: null, equity: null,
    risk: null, decision: null,
  };
}

const currencyUnit: AnalysisUnit = { kind: 'currency', currency: 'CNY' };
const signedRateUnit: AnalysisUnit = { kind: 'ratio', rateKind: 'signed-rate' };
const nonNegativeRateUnit: AnalysisUnit = { kind: 'ratio', rateKind: 'non-negative-rate' };
const unitIntervalRateUnit: AnalysisUnit = { kind: 'ratio', rateKind: 'unit-interval' };

function factNum(metricIds: readonly string[], facts: readonly ConfirmedFact[]): number | null {
  for (const metricId of metricIds) {
    const fact = facts.find(item => item.metricId === metricId);
    if (fact && typeof fact.value === 'string') {
      const value = Number(fact.value);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function decimal(value: number): string {
  return String(Number(value.toFixed(8)));
}

function scalar(valueRef: string, metricId: string, value: number, unit: AnalysisUnit): AnalysisScalar {
  return {
    valueRef,
    metricId,
    value: { value: decimal(value), unit },
    sourceRefs: [`inference:${metricId}`],
    conflict: { status: 'none' },
  };
}

function generatedRule(prefix: string, metricId: string, startingValue: number, monthlyGrowthRate = 0, unit: AnalysisUnit = currencyUnit): GeneratedValueRule {
  return {
    startingValue: scalar(`${prefix}.starting-value`, metricId, startingValue, unit),
    monthlyGrowthRate: scalar(`${prefix}.monthly-growth-rate`, `${metricId}_monthly_growth_rate`, monthlyGrowthRate, signedRateUnit),
  };
}

function ratioRule(prefix: string, metricId: string, rate: number) {
  return {
    kind: 'revenue-ratio' as const,
    modelYearRates: [1, 2, 3].map(year => scalar(`${prefix}.year-${year}`, metricId, rate, nonNegativeRateUnit)),
  };
}

function amountRule(prefix: string, metricId: string, amount: number) {
  return { kind: 'amount-growth' as const, rule: generatedRule(prefix, metricId, amount) };
}

function scenarioAssumptions(
  scenarioId: 'downside' | 'base' | 'upside',
  monthlyRevenue: number,
  monthlyGrowth: number,
  cogsRate: number,
): ForecastScenarioAssumptions {
  const prefix = `automatic.${scenarioId}`;
  const opexFactor = scenarioId === 'downside' ? 1.15 : scenarioId === 'upside' ? 0.9 : 1;
  return {
    revenue: {
      kind: 'custom-product',
      factors: [
        { factorId: 'monthly_revenue', rule: generatedRule(`${prefix}.revenue`, 'monthly_revenue', monthlyRevenue, monthlyGrowth) },
        { factorId: 'scale', rule: generatedRule(`${prefix}.scale`, 'revenue_scale', 1, 0, nonNegativeRateUnit) },
      ],
    },
    costOfGoodsSold: ratioRule(`${prefix}.cogs`, 'cost_of_goods_sold_ratio', Math.min(0.95, cogsRate * opexFactor)),
    salesAndMarketing: ratioRule(`${prefix}.sales`, 'sales_and_marketing_ratio', 0.2 * opexFactor),
    researchAndDevelopment: ratioRule(`${prefix}.rd`, 'research_and_development_ratio', 0.15 * opexFactor),
    generalAndAdministrative: ratioRule(`${prefix}.ga`, 'general_and_administrative_ratio', 0.1 * opexFactor),
    depreciationAndAmortization: amountRule(`${prefix}.da`, 'depreciation_and_amortization', monthlyRevenue * 0.01),
    interestExpense: amountRule(`${prefix}.interest`, 'interest_expense', 0),
    capitalExpenditure: amountRule(`${prefix}.capex`, 'capital_expenditure', monthlyRevenue * 0.02),
    increaseInNetWorkingCapital: amountRule(`${prefix}.nwc`, 'increase_in_net_working_capital', monthlyRevenue * 0.01),
    taxRate: scalar(`${prefix}.tax-rate`, 'tax_rate', 0.25, unitIntervalRateUnit),
  };
}

function monthlyRate(annualPercent: number): number {
  const bounded = Math.max(-90, Math.min(300, annualPercent)) / 100;
  return Math.pow(1 + bounded, 1 / 12) - 1;
}

function nextMonth(asOfDate: string): string {
  const [yearText, monthText] = asOfDate.slice(0, 7).split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

function monthEnd(asOfDate: string): string {
  const [yearText, monthText] = asOfDate.slice(0, 7).split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yearText}-${monthText}-${String(day).padStart(2, '0')}`;
}

function forecastInput(facts: readonly ConfirmedFact[], asOfDate: string): ThreeScenarioForecastInput | null {
  const annualRevenue = factNum(['revenue', 'revenue_2025', 'arr'], facts);
  const grossMarginPercent = factNum(['gross_margin'], facts);
  if (annualRevenue === null || annualRevenue <= 0 || grossMarginPercent === null) return null;

  const growthPercent = factNum(['revenue_growth', 'market_growth'], facts) ?? 15;
  const cash = Math.max(0, factNum(['cash_balance'], facts) ?? 0);
  const monthlyRevenue = annualRevenue / 12;
  const cogsRate = Math.max(0.01, Math.min(0.95, 1 - grossMarginPercent / 100));
  return {
    version: '1',
    baseline: {
      currency: 'CNY',
      forecastStartMonth: nextMonth(asOfDate),
      horizonMonths: 36,
      beginningCash: scalar('automatic.baseline.cash', 'beginning_cash', cash, currencyUnit),
      minimumCashBalance: scalar('automatic.baseline.minimum-cash', 'minimum_cash_balance', cash * 0.1, currencyUnit),
    },
    scenarios: [
      { id: 'downside', probability: '0.25', assumptions: scenarioAssumptions('downside', monthlyRevenue, monthlyRate(growthPercent * 0.5 - 5), cogsRate) },
      { id: 'base', probability: '0.5', assumptions: scenarioAssumptions('base', monthlyRevenue, monthlyRate(growthPercent), cogsRate) },
      { id: 'upside', probability: '0.25', assumptions: scenarioAssumptions('upside', monthlyRevenue, monthlyRate(growthPercent * 1.3 + 5), cogsRate) },
    ],
  };
}

function normalizedRate(value: number | null, fallback: number): number {
  if (value === null) return fallback;
  return value > 1 ? value / 100 : value;
}

function factString(metricId: string, facts: readonly ConfirmedFact[]): string | null {
  const fact = facts.find(item => item.metricId === metricId);
  return fact && typeof fact.value === 'string' ? fact.value : null;
}

const FATAL_IDS: readonly FatalFlawId[] = [
  'material_data_or_business_fraud', 'core_ownership_or_license_unclear',
  'irremediable_major_illegality', 'business_model_unverifiable',
  'pre_close_cash_break', 'founder_integrity_failure',
];

function calculateMarketCap(
  facts: readonly ConfirmedFact[],
  valuation: AutomaticAnalysisSummary['valuation'],
): AutomaticAnalysisSummary['marketCap'] {
  const sharePrice = factNum(['share_price'], facts);
  let dilutedShares = factNum(['fully_diluted_shares', 'total_shares'], facts);
  if (dilutedShares === null) {
    const raw = factString('cap_table_json', facts);
    if (raw) {
      try {
        const rows = JSON.parse(raw);
        if (Array.isArray(rows)) dilutedShares = rows.reduce((sum, row) => sum + (Number(row?.shares) || 0), 0);
      } catch {}
    }
  }
  if (sharePrice !== null && sharePrice >= 0 && dilutedShares !== null && dilutedShares > 0) {
    const marketCap = decimal(sharePrice * dilutedShares);
    return { low: marketCap, midpoint: marketCap, high: marketCap, basis: 'listed', ruleRef: 'listed-market-cap@1' };
  }

  const preMoney = factNum(['valuation', 'entry_valuation'], facts);
  const investment = factNum(['investment_amount'], facts);
  if (preMoney !== null && preMoney > 0 && investment !== null && investment >= 0) {
    const postMoney = decimal(preMoney + investment);
    return { low: postMoney, midpoint: postMoney, high: postMoney, basis: 'post_money', ruleRef: 'post-money-market-cap@1' };
  }

  return valuation
    ? { ...valuation, basis: 'model_implied', ruleRef: 'model-implied-market-cap@1' }
    : null;
}

function addYears(date: string, years: number): string {
  const year = Number(date.slice(0, 4)) + Math.max(1, Math.round(years));
  return `${year}${date.slice(4)}`;
}

function runEquityAnalysis(
  facts: readonly ConfirmedFact[], asOfDate: string, valuation: AutomaticAnalysisSummary['valuation'],
): AutomaticAnalysisSummary['equity'] {
  const raw = factString('cap_table_json', facts);
  const investment = factNum(['investment_amount'], facts);
  const preMoney = factNum(['valuation', 'entry_valuation'], facts);
  const exitValue = factNum(['exit_valuation'], facts);
  if (!raw || investment === null || investment <= 0 || preMoney === null || preMoney <= 0 || exitValue === null || exitValue <= 0) return null;

  let rows: Array<{ name?: string; shares?: string; class_?: string }>;
  try { rows = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  const initialPositions: SecurityPosition[] = rows.flatMap((row, index) => {
    const shares = Number(row.shares);
    if (!Number.isFinite(shares) || shares <= 0) return [];
    const className = String(row.class_ ?? '').toLowerCase();
    const securityType = className.includes('esop')
      ? 'esop' as const
      : (className.includes('preferred') || className.includes('优先'))
        ? 'preferred' as const : 'common' as const;
    return [{
      securityId: `existing-${index}`, holderId: row.name || `holder-${index}`, securityType,
      shares: decimal(shares), investedCapital: '0', acquisitionDate: '2000-01-01',
      ...(securityType === 'preferred' ? { liquidationPreference: { participation: 'non-participating' as const, multiple: '1', seniorityRank: 2 } } : {}),
    }];
  });
  if (initialPositions.length === 0) return null;

  const roundDate = `${nextMonth(asOfDate)}-01`;
  const esopPercent = factNum(['esop_pct'], facts) ?? 0;
  const capTable = modelCapTable({
    version: '1', currency: 'CNY', asOfDate: monthEnd(asOfDate), initialPositions,
    events: [{
      kind: 'priced-round', eventId: 'inference-round', date: roundDate,
      investorHolderId: 'target-investor', securityId: 'target-investor-preferred', securityType: 'preferred',
      preMoneyEquityValue: decimal(preMoney), investmentAmount: decimal(investment),
      liquidationPreference: { participation: 'non-participating', multiple: '1', seniorityRank: 1 },
      ...(esopPercent > 0 ? { esopPoolExpansion: {
        securityId: initialPositions.find(position => position.securityType === 'esop')?.securityId ?? 'inference-esop',
        holderId: 'employees', timing: 'pre-money' as const, targetOwnership: decimal(esopPercent / 100),
      } } : {}),
    }],
  });
  if (capTable.status !== 'ok') return null;

  const holdingYears = factNum(['holding_years'], facts) ?? 5;
  const exitDate = addYears(roundDate, holdingYears);
  const downsideExit = Math.max(investment * 0.25, valuation ? Number(valuation.low) : exitValue * 0.4);
  const upsideExit = Math.max(exitValue, valuation ? Number(valuation.high) * 1.5 : exitValue * 1.8);
  const returns = calculateInvestorReturns({
    version: '1', currency: 'CNY', holderId: 'target-investor',
    capTable: { asOfDate: capTable.value.finalSnapshot.asOfDate, positions: capTable.value.finalSnapshot.positions, investments: capTable.value.investments },
    scenarios: [
      { id: 'downside', probability: '0.25', exitDate, exitValue: decimal(downsideExit) },
      { id: 'base', probability: '0.5', exitDate, exitValue: decimal(exitValue) },
      { id: 'upside', probability: '0.25', exitDate, exitValue: decimal(upsideExit) },
    ],
  });
  if (returns.status !== 'ok') return null;
  return {
    expectedMoic: returns.value.expectedMoic,
    baseIrr: returns.value.scenarios.find(scenario => scenario.id === 'base')?.irr ?? null,
    permanentLossProbability: returns.value.permanentLossProbability,
  };
}

function inferredRiskItems(facts: readonly ConfirmedFact[]): RiskItemInput[] {
  const items: RiskItemInput[] = [];
  const rawItems = factString('risk_items_json', facts);
  if (rawItems) {
    try {
      const parsed = JSON.parse(rawItems);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.riskId && item?.category && item?.title) items.push(item as RiskItemInput);
        }
      }
    } catch {}
  }
  const cash = factNum(['cash_balance'], facts);
  const burn = factNum(['burn_rate'], facts);
  if (cash !== null && burn !== null && burn > 0) {
    const runway = cash / burn;
    items.push({ riskId: 'automatic-cash-runway', category: 'financial', title: `现金跑道约${runway.toFixed(1)}个月`,
      probability: runway < 6 ? '0.85' : runway < 12 ? '0.65' : runway < 18 ? '0.4' : '0.2',
      impact: '0.8', mitigationEffectiveness: '0.15', mitigationDescription: '保持最低现金余额并提前启动融资', evidenceRefs: [], signals: ['cash_runway'] });
  }
  const concentration = factNum(['customer_concentration'], facts);
  if (concentration !== null) items.push({ riskId: 'automatic-customer-concentration', category: 'customer', title: `最大客户收入占比${concentration}%`,
    probability: concentration >= 50 ? '0.8' : concentration >= 30 ? '0.55' : '0.25', impact: '0.7', mitigationEffectiveness: '0.1', mitigationDescription: '客户多元化计划', evidenceRefs: [], signals: ['customer_concentration'] });
  const nrr = factNum(['nrr'], facts);
  if (nrr !== null) items.push({ riskId: 'automatic-revenue-quality', category: 'customer', title: `NRR ${nrr}%`,
    probability: nrr < 90 ? '0.8' : nrr < 100 ? '0.55' : '0.2', impact: '0.75', mitigationEffectiveness: '0.1', mitigationDescription: '续约率与增购率专项改善', evidenceRefs: [], signals: ['revenue_quality'] });
  return items;
}

function runRiskAnalysis(
  facts: readonly ConfirmedFact[], asOfDate: string,
  forecast: AutomaticAnalysisSummary['forecast'], equity: AutomaticAnalysisSummary['equity'],
): AutomaticAnalysisSummary['risk'] {
  const flaws = FATAL_IDS.map(fatalFlawId => {
    const fact = facts.find(item => item.metricId === `fatal_flaw_${fatalFlawId}`);
    const status = fact?.value;
    if (typeof status !== 'string' || !['unassessed', 'clear', 'open', 'covered', 'resolved'].includes(status)) return null;
    return { fatalFlawId, status: status as FatalFlawStatus, evidenceRefs: [...(fact?.evidenceIds ?? [])] };
  });
  if (flaws.some(flaw => flaw === null)) return null;
  const result = evaluateRisk({
    version: '1', asOfDate: monthEnd(asOfDate), riskItems: inferredRiskItems(facts), fatalFlaws: flaws,
    upstreamSnapshots: {
      ...(forecast ? { forecast: { snapshotId: 'automatic-forecast', sourceRef: 'scenario-forecast@1', downsideCashBreak: forecast.downsideCashBreak } } : {}),
      ...(equity ? { investorReturns: { snapshotId: 'automatic-equity', sourceRef: 'investor-returns@1', downsideMoic: equity.expectedMoic } } : {}),
    },
  });
  if (result.status !== 'ok') return null;
  return {
    residualRisk: result.value.overall.residualRisk,
    riskPenalty: result.value.overall.riskPenalty,
    permanentLossLower: result.value.permanentLoss.lower,
    permanentLossUpper: result.value.permanentLoss.upper,
    fatalOutcome: result.value.fatalFlaws.fatalOutcome,
    unassessedFatalFlawCount: result.value.fatalFlaws.checks.filter(check => check.status === 'unassessed').length,
    clauseTypes: result.value.clauseRecommendations.map(clause => clause.clauseType),
  };
}

function score(value: number): string { return decimal(Math.max(0, Math.min(100, value))); }

function runDecisionAnalysis(
  facts: readonly ConfirmedFact[], valuation: AutomaticAnalysisSummary['valuation'],
  equity: AutomaticAnalysisSummary['equity'], risk: AutomaticAnalysisSummary['risk'],
): AutomaticAnalysisSummary['decision'] {
  if (!risk) return null;
  const growth = factNum(['revenue_growth', 'market_growth'], facts) ?? 0;
  const grossMargin = factNum(['gross_margin'], facts) ?? 0;
  const nrr = factNum(['nrr'], facts) ?? 100;
  const teamSize = factNum(['team_size'], facts) ?? 0;
  const result = evaluateDecision({
    version: '1', strategy: 'growth',
    qualityScores: {
      teamAndGovernance: score(45 + Math.min(25, teamSize * 3)),
      marketAndIndustry: score(50 + Math.min(30, Math.max(0, growth))),
      productAndTechnology: score(45 + Math.min(30, Math.max(0, nrr - 90))),
      commercializationAndGrowth: score(50 + Math.min(35, Math.max(-30, growth))),
      financialAndCashFlow: score(35 + Math.min(50, Math.max(0, grossMargin * 0.6))),
      valuationAndReturn: valuation ? '65' : '40',
    },
    overallResidualRisk: risk.residualRisk, riskPenalty: risk.riskPenalty,
    fatalOutcome: risk.fatalOutcome, notCurableByClause: risk.fatalOutcome === 'reject',
    returnMetrics: {
      targetIrr: decimal(normalizedRate(factNum(['target_irr'], facts), 0.25)), targetMoic: '3',
      baseCaseIrr: equity?.baseIrr ?? null, baseCaseMoic: equity?.expectedMoic ?? null,
      permanentLossProbabilityLower: risk.permanentLossLower, permanentLossProbabilityUpper: risk.permanentLossUpper,
    },
    maxAcceptableValuation: valuation?.midpoint ?? null,
    keyAssumptions: ['三情景预测基于已确认经营事实及行业默认成本结构'],
    bearCaseArguments: inferredRiskItems(facts).map(item => item.title),
  });
  return result.status === 'ok' ? { tier: result.value.tier, rationale: result.value.investRationale } : null;
}

export function runAutomaticAnalysisPipeline(
  facts: readonly ConfirmedFact[],
  asOfDate: string,
  sessionHash: string,
): AutomaticAnalysisSummary {
  const input = forecastInput(facts, asOfDate);
  if (input === null) return emptySummary();

  const forecastResult = forecastThreeScenarios(input);
  if (forecastResult.status !== 'ok') return emptySummary();
  const scenarios = new Map(forecastResult.value.scenarios.map(scenario => [scenario.id, scenario]));
  const downside = scenarios.get('downside')!;
  const base = scenarios.get('base')!;
  const upside = scenarios.get('upside')!;
  const finalDownside = downside.modelYears.at(-1)!;
  const finalBase = base.modelYears.at(-1)!;
  const finalUpside = upside.modelYears.at(-1)!;
  const forecast = {
    downsideRevenue: finalDownside.revenue,
    baseRevenue: finalBase.revenue,
    upsideRevenue: finalUpside.revenue,
    baseFcff: finalBase.fcff,
    downsideCashBreak: downside.cashSummary.firstFinancingPeriodId !== undefined,
  };

  const wacc = normalizedRate(factNum(['wacc'], facts), 0.12);
  const terminalGrowth = normalizedRate(factNum(['terminal_growth'], facts), 0.03);
  const exitMultiple = factNum(['exit_multiple', 'ev_ebitda'], facts) ?? 8;
  const cash = Math.max(0, factNum(['cash_balance'], facts) ?? 0);
  const debt = Math.max(0, factNum(['interest_bearing_debt', 'debt'], facts) ?? 0);
  const dcfResult = calculateDcf({
    version: '1', currency: 'CNY', valuationDate: monthEnd(asOfDate), scenarioId: 'base', probability: '0.5',
    modelYears: base.modelYears, discountingConvention: 'year-end', wacc: decimal(wacc),
    perpetuityGrowthRate: decimal(Math.min(terminalGrowth, wacc - 0.01)), exitMultiple: decimal(exitMultiple),
    exitMetric: 'ebitda', interestBearingDebt: decimal(debt), cashAndCashEquivalents: decimal(cash),
    terminalMethodWeights: { perpetuityGrowth: '0.5', exitMultiple: '0.5' },
    sensitivity: {
      wacc: [-0.02, -0.01, 0, 0.01, 0.02].map(delta => decimal(Math.max(0.02, wacc + delta))),
      perpetuityGrowthRate: [-0.02, -0.01, 0, 0.01, 0.02].map(delta => decimal(Math.max(0, terminalGrowth + delta))),
      exitMultiple: [-2, -1, 0, 1, 2].map(delta => decimal(Math.max(1, exitMultiple + delta))),
    },
  });

  const valuation = dcfResult.status === 'ok' ? dcfResult.value.range : null;
  const marketCap = calculateMarketCap(facts, valuation);
  const equity = runEquityAnalysis(facts, asOfDate, valuation);
  const risk = runRiskAnalysis(facts, asOfDate, forecast, equity);
  const decision = runDecisionAnalysis(facts, valuation, equity, risk);

  return {
    forecastSnapshotRef: `forecast_snapshot_${sessionHash}`,
    valuationSnapshotRef: valuation ? `valuation_snapshot_${sessionHash}` : null,
    riskSnapshotRef: risk ? `risk_snapshot_${sessionHash}` : null,
    equitySnapshotRef: equity ? `equity_snapshot_${sessionHash}` : null,
    forecast, valuation, marketCap, equity, risk, decision,
  };
}