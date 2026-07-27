import type { AnalysisScalar } from '../../domain/analysis/analysis-scalar';
import type { AnalysisUnit } from '../../domain/analysis/value';
import type {
  AmountGrowthRule,
  ForecastScenarioAssumptions,
  GeneratedValueRule,
  RevenueRatioRule,
  ThreeScenarioForecastInput,
} from './forecast-types';

export type DeepPartial<T> =
  T extends readonly (infer TItem)[]
    ? readonly DeepPartial<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]?: DeepPartial<T[TKey]> }
      : T;

const currencyUnit = (): AnalysisUnit => ({
  kind: 'currency',
  currency: 'CNY',
});

const monthlyCustomerRevenueUnit = (): AnalysisUnit => ({
  kind: 'currency-per-count',
  currency: 'CNY',
  countKind: 'customer',
  perPeriod: 'month',
});

const customerCountUnit = (): AnalysisUnit => ({
  kind: 'count',
  countKind: 'customer',
});

const signedRateUnit = (): AnalysisUnit => ({
  kind: 'ratio',
  rateKind: 'signed-rate',
});

const nonNegativeRateUnit = (): AnalysisUnit => ({
  kind: 'ratio',
  rateKind: 'non-negative-rate',
});

const unitIntervalRateUnit = (): AnalysisUnit => ({
  kind: 'ratio',
  rateKind: 'unit-interval',
});

export function scalar(
  valueRef: string,
  metricId: string,
  value: string,
  unit: AnalysisUnit,
): AnalysisScalar {
  return {
    valueRef,
    metricId,
    value: {
      value,
      unit: cloneValue(unit),
    },
    sourceRefs: [`assumption:${valueRef}`],
    conflict: { status: 'none' },
  };
}

function generatedRule(
  prefix: string,
  metricId: string,
  startingValue: string,
  unit: AnalysisUnit,
): GeneratedValueRule {
  return {
    startingValue: scalar(
      `${prefix}.starting-value`,
      metricId,
      startingValue,
      unit,
    ),
    monthlyGrowthRate: scalar(
      `${prefix}.monthly-growth-rate`,
      `${metricId}_monthly_growth_rate`,
      '0',
      signedRateUnit(),
    ),
  };
}

function amountGrowthRule(
  prefix: string,
  metricId: string,
  startingValue: string,
): AmountGrowthRule {
  return {
    kind: 'amount-growth',
    rule: generatedRule(prefix, metricId, startingValue, currencyUnit()),
  };
}

function revenueRatioRule(
  prefix: string,
  metricId: string,
  rate: string,
  modelYearCount: number,
): RevenueRatioRule {
  return {
    kind: 'revenue-ratio',
    modelYearRates: Array.from({ length: modelYearCount }, (_, index) => scalar(
      `${prefix}.model-year-${index + 1}`,
      metricId,
      rate,
      nonNegativeRateUnit(),
    )),
  };
}

function assumptions(
  scenarioId: 'downside' | 'base' | 'upside',
  customerCount: string,
  averageRevenue: string,
  costOfGoodsSoldRate: string,
  taxRate: string,
  modelYearCount: number,
): ForecastScenarioAssumptions {
  const prefix = `forecast.${scenarioId}`;
  return {
    revenue: {
      kind: 'customer-count-times-average-revenue',
      customerCount: generatedRule(
        `${prefix}.revenue.customer-count`,
        'customer_count',
        customerCount,
        customerCountUnit(),
      ),
      averageRevenuePerCustomer: generatedRule(
        `${prefix}.revenue.average-revenue-per-customer`,
        'average_revenue_per_customer',
        averageRevenue,
        monthlyCustomerRevenueUnit(),
      ),
    },
    costOfGoodsSold: revenueRatioRule(
      `${prefix}.cost-of-goods-sold`,
      'cost_of_goods_sold_ratio',
      costOfGoodsSoldRate,
      modelYearCount,
    ),
    salesAndMarketing: revenueRatioRule(
      `${prefix}.sales-and-marketing`,
      'sales_and_marketing_ratio',
      scenarioId === 'upside' ? '0.18' : scenarioId === 'base' ? '0.2' : '0.22',
      modelYearCount,
    ),
    researchAndDevelopment: revenueRatioRule(
      `${prefix}.research-and-development`,
      'research_and_development_ratio',
      scenarioId === 'upside' ? '0.12' : scenarioId === 'base' ? '0.15' : '0.18',
      modelYearCount,
    ),
    generalAndAdministrative: revenueRatioRule(
      `${prefix}.general-and-administrative`,
      'general_and_administrative_ratio',
      scenarioId === 'upside' ? '0.08' : scenarioId === 'base' ? '0.1' : '0.12',
      modelYearCount,
    ),
    depreciationAndAmortization: amountGrowthRule(
      `${prefix}.depreciation-and-amortization`,
      'depreciation_and_amortization',
      scenarioId === 'upside' ? '8' : scenarioId === 'base' ? '10' : '12',
    ),
    interestExpense: amountGrowthRule(
      `${prefix}.interest-expense`,
      'interest_expense',
      scenarioId === 'upside' ? '2' : scenarioId === 'base' ? '3' : '4',
    ),
    capitalExpenditure: amountGrowthRule(
      `${prefix}.capital-expenditure`,
      'capital_expenditure',
      scenarioId === 'upside' ? '12' : scenarioId === 'base' ? '15' : '18',
    ),
    increaseInNetWorkingCapital: amountGrowthRule(
      `${prefix}.increase-in-net-working-capital`,
      'increase_in_net_working_capital',
      scenarioId === 'upside' ? '6' : scenarioId === 'base' ? '8' : '10',
    ),
    taxRate: scalar(
      `${prefix}.tax-rate`,
      'tax_rate',
      taxRate,
      unitIntervalRateUnit(),
    ),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = cloneValue(item);
  }
  return output as T;
}

function mergeValue<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (override === undefined) {
    return cloneValue(base);
  }
  if (Array.isArray(override)) {
    return cloneValue(override) as T;
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return cloneValue(override) as T;
  }

  if (
    Object.hasOwn(base, 'kind') &&
    Object.hasOwn(override, 'kind') &&
    base.kind !== override.kind
  ) {
    return cloneValue(override) as T;
  }

  const output = cloneValue(base) as Record<string, unknown>;
  for (const [key, item] of Object.entries(override)) {
    output[key] = mergeValue(output[key], item);
  }
  return output as T;
}

function defaultForecastInput(
  horizonMonths: 36 | 48 | 60,
): ThreeScenarioForecastInput {
  const modelYearCount = horizonMonths / 12;
  return {
    version: '1',
    baseline: {
      currency: 'CNY',
      forecastStartMonth: '2026-04',
      horizonMonths,
      beginningCash: scalar(
        'forecast.baseline.beginning-cash',
        'beginning_cash',
        '1000',
        currencyUnit(),
      ),
      minimumCashBalance: scalar(
        'forecast.baseline.minimum-cash-balance',
        'minimum_cash_balance',
        '100',
        currencyUnit(),
      ),
    },
    scenarios: [
      {
        id: 'upside',
        probability: '0.2',
        assumptions: assumptions('upside', '120', '12', '0.35', '0.2', modelYearCount),
      },
      {
        id: 'downside',
        probability: '0.3',
        assumptions: assumptions('downside', '80', '8', '0.55', '0.25', modelYearCount),
      },
      {
        id: 'base',
        probability: '0.5',
        assumptions: assumptions('base', '100', '10', '0.45', '0.25', modelYearCount),
      },
    ],
  };
}

export function forecastInput(
  overrides: DeepPartial<ThreeScenarioForecastInput> = {},
): ThreeScenarioForecastInput {
  const requestedHorizon = overrides.baseline?.horizonMonths;
  const horizonMonths = requestedHorizon === 48 || requestedHorizon === 60
    ? requestedHorizon
    : 36;
  return mergeValue(defaultForecastInput(horizonMonths), overrides);
}

export function forecastAssumptions(
  overrides: DeepPartial<ForecastScenarioAssumptions> = {},
): ForecastScenarioAssumptions {
  return mergeValue(
    assumptions('base', '100', '10', '0.45', '0.25', 3),
    overrides,
  );
}
