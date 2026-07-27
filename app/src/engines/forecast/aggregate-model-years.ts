import {
  AnalysisDecimal,
  canonicalDecimal,
} from '../../domain/analysis/decimal';
import type { TraceStep } from '../../domain/analysis/calculation-trace';
import { DomainContractError } from '../../domain/analysis/value';
import type {
  ForecastCashSummary,
  ModelYearForecast,
  MonthlyForecast,
} from './forecast-types';

const FLOW_FIELDS = [
  'revenue',
  'costOfGoodsSold',
  'grossProfit',
  'salesAndMarketing',
  'researchAndDevelopment',
  'generalAndAdministrative',
  'ebitda',
  'depreciationAndAmortization',
  'ebit',
  'interestExpense',
  'preTaxIncome',
  'incomeTax',
  'netIncome',
  'increaseInNetWorkingCapital',
  'operatingCashFlow',
  'capitalExpenditure',
  'freeCashFlow',
  'fcff',
  'financingInflow',
] as const;

function sum(
  months: readonly MonthlyForecast[],
  field: (typeof FLOW_FIELDS)[number],
): string {
  return canonicalDecimal(months.reduce(
    (total, month) => total.plus(month[field]),
    new AnalysisDecimal(0),
  ));
}

export function aggregateModelYears(
  months: readonly MonthlyForecast[],
): {
  readonly modelYears: readonly ModelYearForecast[];
  readonly cashSummary: ForecastCashSummary;
  readonly steps: readonly TraceStep[];
} {
  if (months.length === 0 || months.length % 12 !== 0) {
    throw new DomainContractError('invalid_dto');
  }

  const modelYears: ModelYearForecast[] = [];
  const steps: TraceStep[] = [];
  for (let offset = 0; offset < months.length; offset += 12) {
    const window = months.slice(offset, offset + 12);
    const first = window[0]!;
    const last = window[11]!;
    const yearNumber = offset / 12 + 1;
    const flows = Object.fromEntries(
      FLOW_FIELDS.map((field) => [field, sum(window, field)]),
    ) as Pick<ModelYearForecast, (typeof FLOW_FIELDS)[number]>;
    const modelYear: ModelYearForecast = {
      period: {
        kind: 'flow',
        id: `model-year-${yearNumber}`,
        startDate: first.period.startDate,
        endDate: last.period.endDate,
        durationMonths: 12,
        granularity: 'year',
      },
      ...flows,
      beginningCash: first.beginningCash,
      preFinancingEndingCash: last.preFinancingEndingCash,
      endingCash: last.endingCash,
    };
    modelYears.push(modelYear);
    steps.push({
      id: `aggregate:model-year-${yearNumber}`,
      operator: 'aggregate-model-year',
      operands: window.map((month) => month.period.id),
      result: modelYear.fcff,
      rule: 'sum-flows-last-stocks',
      outcome: 'passed',
    });
  }

  let minimum = new AnalysisDecimal(months[0]!.preFinancingEndingCash);
  let minimumPeriodId = months[0]!.period.id;
  let firstFinancingPeriodId: string | undefined;
  let financingRequirement = new AnalysisDecimal(0);
  for (const month of months) {
    const preFinancingCash = new AnalysisDecimal(month.preFinancingEndingCash);
    if (preFinancingCash.lessThan(minimum)) {
      minimum = preFinancingCash;
      minimumPeriodId = month.period.id;
    }
    const financing = new AnalysisDecimal(month.financingInflow);
    if (firstFinancingPeriodId === undefined && financing.greaterThan(0)) {
      firstFinancingPeriodId = month.period.id;
    }
    financingRequirement = financingRequirement.plus(financing);
  }
  const cashSummary: ForecastCashSummary = {
    minimumPreFinancingCash: canonicalDecimal(minimum),
    minimumPreFinancingPeriodId: minimumPeriodId,
    ...(firstFinancingPeriodId === undefined ? {} : { firstFinancingPeriodId }),
    minimumFinancingRequirement: canonicalDecimal(financingRequirement),
    finalEndingCash: months.at(-1)!.endingCash,
  };
  steps.push({
    id: 'aggregate:cash-summary',
    operator: 'aggregate-cash-summary',
    operands: months.map((month) => month.period.id),
    result: cashSummary.minimumFinancingRequirement,
    rule: 'earliest-minimum-and-financing-sum',
    outcome: 'passed',
  });
  return { modelYears, cashSummary, steps };
}
