import { describe, expect, expectTypeOf, it } from 'vitest';

import type { AnalysisScalar } from '../../domain/analysis/analysis-scalar';
import type { ForecastCalculationTrace } from '../../domain/analysis/calculation-trace';
import type { DecimalString } from '../../domain/analysis/decimal';
import type { EngineResult } from '../../domain/analysis/engine-result';
import type { FlowPeriod } from '../../domain/analysis/period';
import type { ScenarioId } from '../../domain/analysis/scenario';
import type { AnalysisUnit } from '../../domain/analysis/value';
import { forecastInput, scalar } from './forecast-test-fixtures';
import type {
  ForecastDriverValue,
  ForecastHorizonMonths,
  ModelYearForecast,
  MonthlyForecast,
  RevenueModel,
  ScenarioForecast,
  ScenarioForecastSet,
  SeasonalityPattern,
  ThreeScenarioForecastInput,
} from './forecast-types';

type ForecastEntryPoint = (
  input: ThreeScenarioForecastInput,
) => EngineResult<ScenarioForecastSet, ForecastCalculationTrace>;

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
    expectTypeOf<ForecastEntryPoint>().returns.toEqualTypeOf<
      EngineResult<ScenarioForecastSet, ForecastCalculationTrace>
    >();
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
});
