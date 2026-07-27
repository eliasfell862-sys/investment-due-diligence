import {
  AnalysisDecimal,
  canonicalDecimal,
  parseDecimalString,
} from '../../domain/analysis/decimal';
import type { EngineIssue } from '../../domain/analysis/engine-result';
import type { FlowPeriod } from '../../domain/analysis/period';
import type {
  ForecastHorizonMonths,
  NormalizedGeneratedValueRule,
  SeriesGeneration,
} from './forecast-types';

const ONE = new AnalysisDecimal(1);
const IDENTITY_SEASONALITY = [
  '1', '1', '1', '1', '1', '1',
  '1', '1', '1', '1', '1', '1',
] as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

function isoDate(date: Date): string {
  return `${isoMonth(date)}-${pad(date.getUTCDate())}`;
}

export function createForecastPeriods(
  startMonth: string,
  horizon: ForecastHorizonMonths,
): readonly FlowPeriod[] {
  const [yearText, monthText] = startMonth.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  return Array.from({ length: horizon }, (_, index) => {
    const start = new Date(Date.UTC(year, month - 1 + index, 1));
    const end = new Date(Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + 1,
      0,
    ));
    const monthId = isoMonth(start);
    return {
      kind: 'flow' as const,
      id: `forecast-${monthId}`,
      startDate: `${monthId}-01`,
      endDate: isoDate(end),
      durationMonths: 1,
      granularity: 'month' as const,
    };
  });
}

function generatedValueIssue(periodId: string): EngineIssue {
  return {
    code: 'value_out_of_range',
    path: `forecast.series.${periodId}`,
    message: `forecast.series.${periodId}: value_out_of_range`,
    details: { periodId },
  };
}

export function generateMonthlyValues(
  rule: NormalizedGeneratedValueRule,
  periods: readonly FlowPeriod[],
  options: { readonly nonNegative: boolean },
): SeriesGeneration {
  const startingValue = new AnalysisDecimal(
    parseDecimalString(rule.startingValue.value),
  );
  const growth = new AnalysisDecimal(
    parseDecimalString(rule.monthlyGrowthRate.value),
  );
  const multipliers = rule.seasonality?.multipliers ?? IDENTITY_SEASONALITY;
  const startCalendarMonth = Number(periods[0]?.startDate.slice(5, 7));
  const startSeason = new AnalysisDecimal(
    parseDecimalString(multipliers[startCalendarMonth - 1] ?? '1'),
  );
  const trendBase = startingValue.dividedBy(startSeason);
  const growthBase = ONE.plus(growth);
  const values: string[] = [];
  const steps = [];

  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index]!;
    const calendarMonth = Number(period.startDate.slice(5, 7));
    const season = new AnalysisDecimal(
      parseDecimalString(multipliers[calendarMonth - 1] ?? '1'),
    );
    const value = trendBase
      .times(AnalysisDecimal.pow(growthBase, index))
      .times(season);
    const operands = [
      canonicalDecimal(trendBase),
      canonicalDecimal(growthBase),
      String(index),
      canonicalDecimal(season),
    ];

    if (options.nonNegative && value.isNegative()) {
      steps.push({
        id: `series:${period.id}`,
        operator: 'forecast-series',
        operands,
        rule: 'non-negative',
        outcome: 'blocked' as const,
      });
      return {
        status: 'blocked',
        reason: 'invalid-input',
        issues: [generatedValueIssue(period.id)],
        steps,
      };
    }

    const result = canonicalDecimal(value);
    values.push(result);
    steps.push({
      id: `series:${period.id}`,
      operator: 'forecast-series',
      operands,
      result,
    });
  }

  return { status: 'ok', values, steps };
}

export function expandModelYearRates(
  rates: readonly string[],
  horizon: ForecastHorizonMonths,
): readonly string[] {
  return Array.from(
    { length: horizon },
    (_, index) => rates[Math.floor(index / 12)]!,
  );
}
