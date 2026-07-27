import {
  AnalysisDecimal,
  canonicalDecimal,
  parseDecimalString,
} from '../../domain/analysis/decimal';
import type { FlowPeriod } from '../../domain/analysis/period';
import { DomainContractError } from '../../domain/analysis/value';
import { evaluateAst } from '../formulas/evaluate-ast';
import { getFormulaDefinition } from '../formulas/formula-registry';
import { calculateRevenueSeries } from './calculate-revenue';
import {
  expandModelYearRates,
  generateMonthlyValues,
} from './generate-monthly-series';
import type {
  MonthlyForecast,
  NormalizedForecastBaseline,
  NormalizedOperatingCostRule,
  NormalizedScenario,
  ScenarioCalculation,
} from './forecast-types';

interface LineSeries {
  readonly status: 'ok';
  readonly values: readonly string[];
  readonly steps: readonly (readonly import('../../domain/analysis/calculation-trace').TraceStep[])[];
}

function internalError(): never {
  throw new DomainContractError('invalid_formula_definition');
}

function prefixSteps(
  prefix: string,
  steps: readonly import('../../domain/analysis/calculation-trace').TraceStep[],
) {
  return steps.map((step) => ({
    ...step,
    id: `${prefix}:${step.id}`,
  }));
}

function amountSeries(
  name: string,
  rule: Extract<NormalizedOperatingCostRule, { readonly kind: 'amount-growth' }>,
  periods: readonly FlowPeriod[],
  nonNegative: boolean,
): LineSeries | Extract<ScenarioCalculation, { readonly status: 'blocked' }> {
  const generated = generateMonthlyValues(rule.rule, periods, { nonNegative });
  if (generated.status === 'blocked') {
    return {
      status: 'blocked',
      reason: generated.reason,
      issues: generated.issues,
      monthTraces: periods.map((period, index) => ({
        periodId: period.id,
        steps: generated.steps[index] === undefined
          ? []
          : prefixSteps(name, [generated.steps[index]!]),
      })),
    };
  }
  return {
    status: 'ok',
    values: generated.values,
    steps: periods.map((_, index) => {
      const step = generated.steps[index];
      return step === undefined ? [] : prefixSteps(name, [step]);
    }),
  };
}

function operatingSeries(
  name: string,
  rule: NormalizedOperatingCostRule,
  revenue: readonly string[],
  periods: readonly FlowPeriod[],
): LineSeries | Extract<ScenarioCalculation, { readonly status: 'blocked' }> {
  if (rule.kind === 'amount-growth') {
    return amountSeries(name, rule, periods, true);
  }
  const rates = expandModelYearRates(
    rule.modelYearRates.map((rate) => rate.value),
    periods.length as 36 | 48 | 60,
  );
  const values = revenue.map((monthlyRevenue, index) => canonicalDecimal(
    new AnalysisDecimal(parseDecimalString(monthlyRevenue))
      .times(parseDecimalString(rates[index]!)),
  ));
  return {
    status: 'ok',
    values,
    steps: periods.map((period, index) => [{
      id: `${name}:${period.id}`,
      operator: 'revenue-ratio',
      operands: [revenue[index]!, rates[index]!],
      result: values[index]!,
    }]),
  };
}

function isBlocked(
  value: LineSeries | Extract<ScenarioCalculation, { readonly status: 'blocked' }>,
): value is Extract<ScenarioCalculation, { readonly status: 'blocked' }> {
  return value.status === 'blocked';
}

function calculationStep(
  scenarioId: string,
  periodId: string,
  name: string,
  operator: string,
  operands: readonly string[],
  result: string,
) {
  return {
    id: `${scenarioId}:${periodId}:${name}`,
    operator,
    operands,
    result,
  };
}

export function calculateScenario(
  scenario: NormalizedScenario,
  baseline: NormalizedForecastBaseline,
  periods: readonly FlowPeriod[],
): ScenarioCalculation {
  const revenue = calculateRevenueSeries(
    scenario.assumptions.revenue,
    periods,
    baseline.currency,
  );
  if (revenue.status === 'blocked') return revenue;

  const costOfGoodsSold = operatingSeries(
    'costOfGoodsSold',
    scenario.assumptions.costOfGoodsSold,
    revenue.revenue,
    periods,
  );
  if (isBlocked(costOfGoodsSold)) return costOfGoodsSold;
  const salesAndMarketing = operatingSeries(
    'salesAndMarketing',
    scenario.assumptions.salesAndMarketing,
    revenue.revenue,
    periods,
  );
  if (isBlocked(salesAndMarketing)) return salesAndMarketing;
  const researchAndDevelopment = operatingSeries(
    'researchAndDevelopment',
    scenario.assumptions.researchAndDevelopment,
    revenue.revenue,
    periods,
  );
  if (isBlocked(researchAndDevelopment)) return researchAndDevelopment;
  const generalAndAdministrative = operatingSeries(
    'generalAndAdministrative',
    scenario.assumptions.generalAndAdministrative,
    revenue.revenue,
    periods,
  );
  if (isBlocked(generalAndAdministrative)) return generalAndAdministrative;
  const depreciationAndAmortization = amountSeries(
    'depreciationAndAmortization',
    scenario.assumptions.depreciationAndAmortization,
    periods,
    true,
  );
  if (isBlocked(depreciationAndAmortization)) return depreciationAndAmortization;
  const interestExpense = amountSeries(
    'interestExpense',
    scenario.assumptions.interestExpense,
    periods,
    true,
  );
  if (isBlocked(interestExpense)) return interestExpense;
  const capitalExpenditure = amountSeries(
    'capitalExpenditure',
    scenario.assumptions.capitalExpenditure,
    periods,
    true,
  );
  if (isBlocked(capitalExpenditure)) return capitalExpenditure;
  const increaseInNetWorkingCapital = amountSeries(
    'increaseInNetWorkingCapital',
    scenario.assumptions.increaseInNetWorkingCapital,
    periods,
    false,
  );
  if (isBlocked(increaseInNetWorkingCapital)) return increaseInNetWorkingCapital;

  const taxRate = new AnalysisDecimal(
    parseDecimalString(scenario.assumptions.taxRate.value),
  );
  const minimumCash = new AnalysisDecimal(
    parseDecimalString(baseline.minimumCashBalance.value),
  );
  let beginningCash = new AnalysisDecimal(
    parseDecimalString(baseline.beginningCash.value),
  );
  const months: MonthlyForecast[] = [];
  const monthTraces = [];
  const fcfDefinition = getFormulaDefinition('free_cash_flow', '1');

  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index]!;
    const revenueValue = new AnalysisDecimal(revenue.revenue[index]!);
    const cogs = new AnalysisDecimal(costOfGoodsSold.values[index]!);
    const sales = new AnalysisDecimal(salesAndMarketing.values[index]!);
    const research = new AnalysisDecimal(researchAndDevelopment.values[index]!);
    const general = new AnalysisDecimal(generalAndAdministrative.values[index]!);
    const depreciation = new AnalysisDecimal(depreciationAndAmortization.values[index]!);
    const interest = new AnalysisDecimal(interestExpense.values[index]!);
    const capex = new AnalysisDecimal(capitalExpenditure.values[index]!);
    const workingCapital = new AnalysisDecimal(increaseInNetWorkingCapital.values[index]!);

    const grossProfit = revenueValue.minus(cogs);
    const ebitda = grossProfit.minus(sales).minus(research).minus(general);
    const ebit = ebitda.minus(depreciation);
    const preTaxIncome = ebit.minus(interest);
    const incomeTax = AnalysisDecimal.max(preTaxIncome, 0).times(taxRate);
    const netIncome = preTaxIncome.minus(incomeTax);
    const operatingCashFlow = netIncome.plus(depreciation).minus(workingCapital);
    const fcfResult = evaluateAst(
      fcfDefinition.ast,
      new Map([
        ['operating_cash_flow', operatingCashFlow],
        ['capital_expenditure', capex],
      ]),
      new Map(),
    );
    if (fcfResult.status !== 'ok') return internalError();
    const freeCashFlow = new AnalysisDecimal(fcfResult.value);
    const fcff = ebit
      .minus(AnalysisDecimal.max(ebit, 0).times(taxRate))
      .plus(depreciation)
      .minus(capex)
      .minus(workingCapital);
    const preFinancingEndingCash = beginningCash.plus(freeCashFlow);
    const financingInflow = AnalysisDecimal.max(
      minimumCash.minus(preFinancingEndingCash),
      0,
    );
    const endingCash = preFinancingEndingCash.plus(financingInflow);

    const strings = {
      revenue: canonicalDecimal(revenueValue),
      costOfGoodsSold: canonicalDecimal(cogs),
      grossProfit: canonicalDecimal(grossProfit),
      salesAndMarketing: canonicalDecimal(sales),
      researchAndDevelopment: canonicalDecimal(research),
      generalAndAdministrative: canonicalDecimal(general),
      ebitda: canonicalDecimal(ebitda),
      depreciationAndAmortization: canonicalDecimal(depreciation),
      ebit: canonicalDecimal(ebit),
      interestExpense: canonicalDecimal(interest),
      preTaxIncome: canonicalDecimal(preTaxIncome),
      incomeTax: canonicalDecimal(incomeTax),
      netIncome: canonicalDecimal(netIncome),
      increaseInNetWorkingCapital: canonicalDecimal(workingCapital),
      operatingCashFlow: canonicalDecimal(operatingCashFlow),
      capitalExpenditure: canonicalDecimal(capex),
      freeCashFlow: canonicalDecimal(freeCashFlow),
      fcff: canonicalDecimal(fcff),
      beginningCash: canonicalDecimal(beginningCash),
      preFinancingEndingCash: canonicalDecimal(preFinancingEndingCash),
      financingInflow: canonicalDecimal(financingInflow),
      endingCash: canonicalDecimal(endingCash),
    };
    months.push({
      period,
      driverValues: revenue.driverValues[index]!,
      ...strings,
    });

    const fixedSteps = [
      calculationStep(scenario.id, period.id, 'grossProfit', 'subtract', [strings.revenue, strings.costOfGoodsSold], strings.grossProfit),
      calculationStep(scenario.id, period.id, 'ebitda', 'subtract-expenses', [strings.grossProfit, strings.salesAndMarketing, strings.researchAndDevelopment, strings.generalAndAdministrative], strings.ebitda),
      calculationStep(scenario.id, period.id, 'ebit', 'subtract', [strings.ebitda, strings.depreciationAndAmortization], strings.ebit),
      calculationStep(scenario.id, period.id, 'preTaxIncome', 'subtract', [strings.ebit, strings.interestExpense], strings.preTaxIncome),
      calculationStep(scenario.id, period.id, 'incomeTax', 'positive-tax', [strings.preTaxIncome, canonicalDecimal(taxRate)], strings.incomeTax),
      calculationStep(scenario.id, period.id, 'netIncome', 'subtract', [strings.preTaxIncome, strings.incomeTax], strings.netIncome),
      calculationStep(scenario.id, period.id, 'operatingCashFlow', 'cash-flow', [strings.netIncome, strings.depreciationAndAmortization, strings.increaseInNetWorkingCapital], strings.operatingCashFlow),
      ...prefixSteps(
        `${scenario.id}:${period.id}:free_cash_flow@1`,
        fcfResult.steps,
      ),
      calculationStep(scenario.id, period.id, 'fcff', 'fcff', [strings.ebit, canonicalDecimal(taxRate), strings.depreciationAndAmortization, strings.capitalExpenditure, strings.increaseInNetWorkingCapital], strings.fcff),
      calculationStep(scenario.id, period.id, 'preFinancingEndingCash', 'add', [strings.beginningCash, strings.freeCashFlow], strings.preFinancingEndingCash),
      calculationStep(scenario.id, period.id, 'financingInflow', 'minimum-cash-top-up', [canonicalDecimal(minimumCash), strings.preFinancingEndingCash], strings.financingInflow),
      calculationStep(scenario.id, period.id, 'endingCash', 'add', [strings.preFinancingEndingCash, strings.financingInflow], strings.endingCash),
    ];
    monthTraces.push({
      periodId: period.id,
      steps: [
        ...revenue.monthTraces[index]!.steps,
        ...costOfGoodsSold.steps[index]!,
        ...salesAndMarketing.steps[index]!,
        ...researchAndDevelopment.steps[index]!,
        ...generalAndAdministrative.steps[index]!,
        ...depreciationAndAmortization.steps[index]!,
        ...interestExpense.steps[index]!,
        ...capitalExpenditure.steps[index]!,
        ...increaseInNetWorkingCapital.steps[index]!,
        ...fixedSteps,
      ],
    });
    beginningCash = endingCash;
  }

  return { status: 'ok', months, monthTraces };
}
