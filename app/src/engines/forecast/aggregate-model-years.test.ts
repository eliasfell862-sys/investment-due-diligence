import { describe, expect, it } from 'vitest';

import { forecastInput } from './forecast-test-fixtures';
import { aggregateModelYears } from './aggregate-model-years';
import { calculateScenario } from './calculate-scenario';
import { createForecastPeriods } from './generate-monthly-series';
import type {
  ForecastHorizonMonths,
  MonthlyForecast,
  NormalizedForecastInput,
} from './forecast-types';
import { validateForecastInput } from './validate-forecast-input';

function normalized(horizonMonths: ForecastHorizonMonths): NormalizedForecastInput {
  const result = validateForecastInput(forecastInput({
    baseline: { horizonMonths },
  }));
  if (result.status !== 'valid') throw new Error(JSON.stringify(result));
  return result.input;
}

function months(horizonMonths: ForecastHorizonMonths): readonly MonthlyForecast[] {
  const input = normalized(horizonMonths);
  const scenario = input.scenarios.find((candidate) => candidate.id === 'base');
  if (scenario === undefined) throw new Error('Missing base scenario');
  const result = calculateScenario(
    scenario,
    input.baseline,
    createForecastPeriods(input.baseline.forecastStartMonth, horizonMonths),
  );
  if (result.status !== 'ok') throw new Error(JSON.stringify(result));
  return result.months;
}

describe('aggregateModelYears', () => {
  it.each([
    [36, 3],
    [48, 4],
    [60, 5],
  ] as const)('creates %i complete months as %i model years', (horizon, years) => {
    const source = months(horizon);
    const result = aggregateModelYears(source);

    expect(result.modelYears).toHaveLength(years);
    expect(result.modelYears[0]?.period).toEqual({
      kind: 'flow',
      id: 'model-year-1',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      durationMonths: 12,
      granularity: 'year',
    });
    expect(result.modelYears.at(-1)?.period.id).toBe(`model-year-${years}`);
  });

  it('sums flows and uses first/last stock values', () => {
    const source = months(36);
    const result = aggregateModelYears(source);
    const firstYear = result.modelYears[0]!;

    expect(firstYear.revenue).toBe('12000');
    expect(firstYear.freeCashFlow).toBe('627');
    expect(firstYear.beginningCash).toBe(source[0]?.beginningCash);
    expect(firstYear.preFinancingEndingCash).toBe(
      source[11]?.preFinancingEndingCash,
    );
    expect(firstYear.endingCash).toBe(source[11]?.endingCash);
  });

  it('uses the earliest month for tied cash lows and sums financing', () => {
    const source = months(36).map((month, index) => {
      if (index === 1 || index === 2) {
        return {
          ...month,
          preFinancingEndingCash: '50',
          financingInflow: index === 1 ? '50' : '25',
          endingCash: index === 1 ? '100' : '75',
        };
      }
      return month;
    });
    const result = aggregateModelYears(source);

    expect(result.cashSummary).toEqual({
      minimumPreFinancingCash: '50',
      minimumPreFinancingPeriodId: source[1]?.period.id,
      firstFinancingPeriodId: source[1]?.period.id,
      minimumFinancingRequirement: '75',
      finalEndingCash: source.at(-1)?.endingCash,
    });
  });

  it('omits a financing trigger when no financing is needed', () => {
    const result = aggregateModelYears(months(36));
    expect(result.cashSummary.firstFinancingPeriodId).toBeUndefined();
    expect(result.cashSummary.minimumFinancingRequirement).toBe('0');
  });
});
