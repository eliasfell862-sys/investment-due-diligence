import { describe, expect, expectTypeOf, it } from 'vitest';

import type { AnalysisScalar } from '../../domain/analysis/analysis-scalar';
import type { ForecastMonthTrace } from '../../domain/analysis/calculation-trace';
import type { DecimalString } from '../../domain/analysis/decimal';
import type { FlowPeriod } from '../../domain/analysis/period';
import type { ScenarioId } from '../../domain/analysis/scenario';
import type { AnalysisUnit } from '../../domain/analysis/value';
import {
  forecastAssumptions,
  forecastInput,
  scalar,
} from './forecast-test-fixtures';
import type {
  ForecastDriverValue,
  ForecastEngineResult,
  ForecastHorizonMonths,
  ModelYearForecast,
  MonthlyForecast,
  RevenueModel,
  ScenarioCalculation,
  ScenarioForecast,
  ScenarioForecastSet,
  SeasonalityPattern,
  ThreeScenarioForecastInput,
} from './forecast-types';

type ForecastEntryPoint = (
  input: unknown,
) => ForecastEngineResult<ScenarioForecastSet>;

describe('forecast engine contracts', () => {
  it('locks the supported horizons, revenue models, and seasonality tuple', () => {
    expectTypeOf<ForecastHorizonMonths>().toEqualTypeOf<36 | 48 | 60>();
    expectTypeOf<RevenueModel['kind']>().toEqualTypeOf<
      | 'customer-count-times-average-revenue'
      | 'user-count-times-arpu'
      | 'gmv-times-take-rate'
      | 'unit-sales-times-unit-price'
      | 'custom-product'
    >();
    expectTypeOf<SeasonalityPattern['multipliers']>().toEqualTypeOf<readonly [
      DecimalString,
      DecimalString,
      DecimalString,
      DecimalString,
      DecimalString,
      DecimalString,
      DecimalString,
      DecimalString,
      DecimalString,
      DecimalString,
      DecimalString,
      DecimalString,
    ]>();
  });

  it('locks monthly and model-year financial output fields', () => {
    expectTypeOf<MonthlyForecast>().toEqualTypeOf<{
      readonly period: FlowPeriod;
      readonly driverValues: readonly ForecastDriverValue[];
      readonly revenue: DecimalString;
      readonly costOfGoodsSold: DecimalString;
      readonly grossProfit: DecimalString;
      readonly salesAndMarketing: DecimalString;
      readonly researchAndDevelopment: DecimalString;
      readonly generalAndAdministrative: DecimalString;
      readonly ebitda: DecimalString;
      readonly depreciationAndAmortization: DecimalString;
      readonly ebit: DecimalString;
      readonly interestExpense: DecimalString;
      readonly preTaxIncome: DecimalString;
      readonly incomeTax: DecimalString;
      readonly netIncome: DecimalString;
      readonly increaseInNetWorkingCapital: DecimalString;
      readonly operatingCashFlow: DecimalString;
      readonly capitalExpenditure: DecimalString;
      readonly freeCashFlow: DecimalString;
      readonly fcff: DecimalString;
      readonly beginningCash: DecimalString;
      readonly preFinancingEndingCash: DecimalString;
      readonly financingInflow: DecimalString;
      readonly endingCash: DecimalString;
    }>();
    expectTypeOf<ModelYearForecast>().toEqualTypeOf<{
      readonly period: FlowPeriod;
      readonly revenue: DecimalString;
      readonly costOfGoodsSold: DecimalString;
      readonly grossProfit: DecimalString;
      readonly salesAndMarketing: DecimalString;
      readonly researchAndDevelopment: DecimalString;
      readonly generalAndAdministrative: DecimalString;
      readonly ebitda: DecimalString;
      readonly depreciationAndAmortization: DecimalString;
      readonly ebit: DecimalString;
      readonly interestExpense: DecimalString;
      readonly preTaxIncome: DecimalString;
      readonly incomeTax: DecimalString;
      readonly netIncome: DecimalString;
      readonly increaseInNetWorkingCapital: DecimalString;
      readonly operatingCashFlow: DecimalString;
      readonly capitalExpenditure: DecimalString;
      readonly freeCashFlow: DecimalString;
      readonly fcff: DecimalString;
      readonly beginningCash: DecimalString;
      readonly preFinancingEndingCash: DecimalString;
      readonly financingInflow: DecimalString;
      readonly endingCash: DecimalString;
    }>();
  });

  it('uses shared scenario IDs and readonly forecast arrays', () => {
    expectTypeOf<ScenarioForecast['id']>().toEqualTypeOf<ScenarioId>();
    expectTypeOf<ScenarioForecast['months']>().toEqualTypeOf<readonly MonthlyForecast[]>();
    expectTypeOf<ScenarioForecast['modelYears']>().toEqualTypeOf<readonly ModelYearForecast[]>();
    expectTypeOf<ScenarioForecastSet['scenarios']>().toEqualTypeOf<readonly ScenarioForecast[]>();
    expectTypeOf<ForecastEntryPoint>().parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf<ForecastEntryPoint>().returns.toEqualTypeOf<
      ForecastEngineResult<ScenarioForecastSet>
    >();
  });

  it('keeps single-scenario calculation output below the aggregation layer', () => {
    expectTypeOf<Extract<ScenarioCalculation, { readonly status: 'ok' }>>().toEqualTypeOf<{
      readonly status: 'ok';
      readonly months: readonly MonthlyForecast[];
      readonly monthTraces: readonly ForecastMonthTrace[];
    }>();
  });

  it('provides fresh, complete fixture DTOs in noncanonical scenario order', () => {
    const request: ThreeScenarioForecastInput = forecastInput();
    const secondRequest = forecastInput();

    expect(request).toMatchObject({
      version: '1',
      baseline: {
        currency: 'CNY',
        forecastStartMonth: '2026-04',
        horizonMonths: 36,
        beginningCash: { value: { value: '1000' } },
        minimumCashBalance: { value: { value: '100' } },
      },
    });
    expect(request.scenarios.map(({ id }) => id)).toEqual(['upside', 'downside', 'base']);
    expect(request.scenarios.map(({ probability }) => probability)).toEqual(['0.2', '0.3', '0.5']);
    expect(request.scenarios[0]?.assumptions).not.toBe(request.scenarios[1]?.assumptions);
    expect(request).not.toBe(secondRequest);
    expect(request.baseline).not.toBe(secondRequest.baseline);
    expect(request.scenarios).not.toBe(secondRequest.scenarios);
  });

  it('creates fresh scalar DTOs and applies deterministic nested overrides', () => {
    const unit: AnalysisUnit = { kind: 'currency', currency: 'CNY' };
    const first: AnalysisScalar = scalar('cash', 'cash', '1000', unit);
    const second = scalar('cash', 'cash', '1000', unit);
    const request = forecastInput({
      baseline: {
        horizonMonths: 48,
        beginningCash: { value: { value: '2500' } },
      },
    });

    expect(first).toEqual({
      valueRef: 'cash',
      metricId: 'cash',
      value: { value: '1000', unit },
      sourceRefs: ['assumption:cash'],
      conflict: { status: 'none' },
    });
    expect(first).not.toBe(second);
    expect(first.value).not.toBe(second.value);
    expect(first.sourceRefs).not.toBe(second.sourceRefs);
    expect(request.baseline.horizonMonths).toBe(48);
    expect(request.baseline.beginningCash.value.value).toBe('2500');
    expect(request.baseline.beginningCash.metricId).toBe('beginning_cash');
    expect(request.scenarios).toHaveLength(3);
  });

  it('replaces a changed AnalysisUnit discriminator without retaining stale keys', () => {
    const request = forecastInput({
      baseline: {
        beginningCash: {
          value: {
            unit: { kind: 'ratio', rateKind: 'unit-interval' },
          },
        },
      },
    });

    expect(request.baseline.beginningCash.value.unit).toEqual({
      kind: 'ratio',
      rateKind: 'unit-interval',
    });
    expect(request.baseline.beginningCash.value.unit).not.toHaveProperty('currency');
  });

  it.each([
    [48, 4],
    [60, 5],
  ] as const)('matches annual ratio arrays to a %i-month horizon', (horizonMonths, yearCount) => {
    const request = forecastInput({ baseline: { horizonMonths } });
    const ratioCostKeys = [
      'costOfGoodsSold',
      'salesAndMarketing',
      'researchAndDevelopment',
      'generalAndAdministrative',
    ] as const;

    for (const scenario of request.scenarios) {
      for (const costKey of ratioCostKeys) {
        const cost = scenario.assumptions[costKey];
        expect(cost.kind).toBe('revenue-ratio');
        if (cost.kind === 'revenue-ratio') {
          expect(cost.modelYearRates).toHaveLength(yearCount);
        }
      }
    }
  });

  it('preserves deliberate annual-rate array length overrides', () => {
    const request = forecastInput({
      baseline: { horizonMonths: 60 },
      scenarios: forecastInput().scenarios.map((scenario) => ({
        ...scenario,
        assumptions: {
          ...scenario.assumptions,
          costOfGoodsSold: {
            kind: 'revenue-ratio',
            modelYearRates: [],
          },
        },
      })),
    });

    expect(request.scenarios[0]?.assumptions.costOfGoodsSold).toEqual({
      kind: 'revenue-ratio',
      modelYearRates: [],
    });
  });

  it('returns fresh nested driver and annual-rate objects across calls', () => {
    const first = forecastInput();
    const second = forecastInput();
    const firstAssumptions = first.scenarios[0]?.assumptions;
    const secondAssumptions = second.scenarios[0]?.assumptions;

    expect(firstAssumptions?.revenue).not.toBe(secondAssumptions?.revenue);
    if (
      firstAssumptions?.revenue.kind === 'customer-count-times-average-revenue' &&
      secondAssumptions?.revenue.kind === 'customer-count-times-average-revenue'
    ) {
      expect(firstAssumptions.revenue.customerCount.startingValue.value.unit).not.toBe(
        secondAssumptions.revenue.customerCount.startingValue.value.unit,
      );
    }
    if (
      firstAssumptions?.costOfGoodsSold.kind === 'revenue-ratio' &&
      secondAssumptions?.costOfGoodsSold.kind === 'revenue-ratio'
    ) {
      expect(firstAssumptions.costOfGoodsSold.modelYearRates[0]).not.toBe(
        secondAssumptions.costOfGoodsSold.modelYearRates[0],
      );
    }
  });


  it('replaces changed revenue and operating-cost variants without stale keys', () => {
    const original = forecastAssumptions();
    const replacementRule = original.depreciationAndAmortization.rule;
    const switched = forecastAssumptions({
      revenue: {
        kind: 'custom-product',
        factors: [],
      },
      costOfGoodsSold: {
        kind: 'amount-growth',
        rule: replacementRule,
      },
    });

    expect(switched.revenue).toEqual({
      kind: 'custom-product',
      factors: [],
    });
    expect(switched.revenue).not.toHaveProperty('customerCount');
    expect(switched.revenue).not.toHaveProperty('averageRevenuePerCustomer');
    expect(switched.costOfGoodsSold).toEqual({
      kind: 'amount-growth',
      rule: replacementRule,
    });
    expect(switched.costOfGoodsSold).not.toHaveProperty('modelYearRates');
  });

});
