import {
  AnalysisDecimal,
  canonicalDecimal,
} from '../../domain/analysis/decimal';
import type { EngineIssue } from '../../domain/analysis/engine-result';
import type { FlowPeriod } from '../../domain/analysis/period';
import type { AnalysisUnit, CurrencyCode } from '../../domain/analysis/value';
import { generateMonthlyValues } from './generate-monthly-series';
import type {
  ForecastDriverValue,
  NormalizedGeneratedValueRule,
  NormalizedRevenueModel,
  RevenueCalculation,
  SeriesGeneration,
} from './forecast-types';

interface RevenueFactor {
  readonly factorId: string;
  readonly rule: NormalizedGeneratedValueRule;
}

function issue(
  code: 'invalid_revenue_driver' | 'currency_mismatch' | 'unit_mismatch',
  details: Readonly<Record<string, string | number | boolean | null>> = {},
): EngineIssue {
  return {
    code,
    path: 'forecast.revenue',
    message: `forecast.revenue: ${code}`,
    details,
  };
}

function blocked(
  engineIssue: EngineIssue,
  periods: readonly FlowPeriod[],
): RevenueCalculation {
  return {
    status: 'blocked',
    reason: 'invalid-input',
    issues: [engineIssue],
    monthTraces: periods.map((period) => ({
      periodId: period.id,
      steps: [],
    })),
  };
}

function factors(model: NormalizedRevenueModel): readonly RevenueFactor[] {
  switch (model.kind) {
    case 'customer-count-times-average-revenue':
      return [
        { factorId: 'customerCount', rule: model.customerCount },
        {
          factorId: 'averageRevenuePerCustomer',
          rule: model.averageRevenuePerCustomer,
        },
      ];
    case 'user-count-times-arpu':
      return [
        { factorId: 'userCount', rule: model.userCount },
        { factorId: 'arpu', rule: model.arpu },
      ];
    case 'gmv-times-take-rate':
      return [
        { factorId: 'gmv', rule: model.gmv },
        { factorId: 'takeRate', rule: model.takeRate },
      ];
    case 'unit-sales-times-unit-price':
      return [
        { factorId: 'unitsSold', rule: model.unitsSold },
        { factorId: 'unitPrice', rule: model.unitPrice },
      ];
    case 'custom-product':
      return model.factors;
  }
}

function currencyOf(unit: AnalysisUnit): string | undefined {
  return unit.kind === 'currency' || unit.kind === 'currency-per-count'
    ? unit.currency
    : undefined;
}

function validateFactorUnits(
  revenueFactors: readonly RevenueFactor[],
  currency: CurrencyCode,
): EngineIssue | undefined {
  const units = revenueFactors.map((factor) => factor.rule.startingValue.unit);
  const foreign = units.find((unit) => {
    const factorCurrency = currencyOf(unit);
    return factorCurrency !== undefined && factorCurrency !== currency;
  });
  if (foreign !== undefined) {
    return issue('currency_mismatch', {
      expectedCurrency: currency,
      actualCurrency: currencyOf(foreign) ?? '',
    });
  }

  const moneyUnits = units.filter((unit) => unit.kind === 'currency');
  const counts = units.filter(
    (unit): unit is Extract<AnalysisUnit, { readonly kind: 'count' }> =>
      unit.kind === 'count',
  );
  const perCounts = units.filter(
    (unit): unit is Extract<AnalysisUnit, { readonly kind: 'currency-per-count' }> =>
      unit.kind === 'currency-per-count',
  );
  const supported = units.every((unit) =>
    unit.kind === 'currency' ||
    unit.kind === 'ratio' ||
    unit.kind === 'count' ||
    unit.kind === 'currency-per-count');
  if (!supported) return issue('unit_mismatch');

  const isMoneyProduct =
    moneyUnits.length === 1 &&
    counts.length === 0 &&
    perCounts.length === 0;
  const isCountPriceProduct =
    moneyUnits.length === 0 &&
    counts.length === 1 &&
    perCounts.length === 1 &&
    counts[0]!.countKind === perCounts[0]!.countKind &&
    perCounts[0]!.perPeriod !== 'year';
  return isMoneyProduct || isCountPriceProduct
    ? undefined
    : issue('unit_mismatch');
}

export function calculateRevenueSeries(
  model: NormalizedRevenueModel,
  periods: readonly FlowPeriod[],
  currency: CurrencyCode,
): RevenueCalculation {
  const revenueFactors = factors(model);
  if (
    (model.kind === 'custom-product' &&
      (revenueFactors.length < 2 || revenueFactors.length > 5)) ||
    new Set(revenueFactors.map((factor) => factor.factorId)).size !==
      revenueFactors.length
  ) {
    return blocked(issue('invalid_revenue_driver'), periods);
  }

  const unitProblem = validateFactorUnits(revenueFactors, currency);
  if (unitProblem !== undefined) {
    return blocked(unitProblem, periods);
  }

  const generated: Array<
    Extract<SeriesGeneration, { readonly status: 'ok' }>
  > = [];
  for (const factor of revenueFactors) {
    const result = generateMonthlyValues(factor.rule, periods, {
      nonNegative: true,
    });
    if (result.status === 'blocked') {
      return {
        status: 'blocked',
        reason: result.reason,
        issues: result.issues,
        monthTraces: periods.map((period, index) => ({
          periodId: period.id,
          steps: result.steps[index] === undefined
            ? []
            : [result.steps[index]],
        })),
      };
    }
    generated.push(result);
  }

  const revenue: string[] = [];
  const driverValues: ForecastDriverValue[][] = [];
  const monthTraces = periods.map((period, monthIndex) => {
    let product = new AnalysisDecimal(1);
    const values = revenueFactors.map((factor, factorIndex) => {
      const value = generated[factorIndex]!.values[monthIndex]!;
      product = product.times(value);
      return {
        factorId: factor.factorId,
        value,
        unit: factor.rule.startingValue.unit,
      };
    });
    const result = canonicalDecimal(product);
    revenue.push(result);
    driverValues.push(values);
    return {
      periodId: period.id,
      steps: [
        ...generated.flatMap((series, factorIndex) => {
          const step = series.steps[monthIndex];
          return step === undefined
            ? []
            : [{
                ...step,
                id: `${revenueFactors[factorIndex]!.factorId}:${step.id}`,
              }];
        }),
        {
          id: `revenue:${period.id}`,
          operator: 'multiply-revenue-factors',
          operands: values.map((value) => value.value),
          result,
        },
      ],
    };
  });

  return {
    status: 'ok',
    revenue,
    driverValues,
    monthTraces,
  };
}
