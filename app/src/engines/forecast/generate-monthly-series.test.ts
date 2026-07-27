import { describe, expect, it } from 'vitest';

import {
  AnalysisDecimal,
  canonicalDecimal,
} from '../../domain/analysis/decimal';
import type { NormalizedGeneratedValueRule } from './forecast-types';
import {
  createForecastPeriods,
  expandModelYearRates,
  generateMonthlyValues,
} from './generate-monthly-series';

const MONTHLY_SEASONALITY = [
  '0.8', '0.9', '1', '1.1', '1.2', '1.1',
  '1', '0.9', '0.8', '0.9', '1.1', '1.2',
] as const;

function rule(
  startingValue: string,
  monthlyGrowthRate: string,
  multipliers?: readonly [
    string, string, string, string, string, string,
    string, string, string, string, string, string,
  ],
): NormalizedGeneratedValueRule {
  return {
    startingValue: {
      valueRef: 'start',
      metricId: 'metric',
      value: startingValue,
      unit: { kind: 'currency', currency: 'CNY' },
      sourceRefs: ['assumption:start'],
      conflict: { status: 'none' },
    },
    monthlyGrowthRate: {
      valueRef: 'growth',
      metricId: 'metric_growth',
      value: monthlyGrowthRate,
      unit: { kind: 'ratio', rateKind: 'signed-rate' },
      sourceRefs: ['assumption:growth'],
      conflict: { status: 'none' },
    },
    ...(multipliers === undefined
      ? {}
      : {
          seasonality: {
            valueRef: 'seasonality',
            sourceRefs: ['assumption:seasonality'],
            multipliers,
          },
        }),
  };
}

describe('createForecastPeriods', () => {
  it('creates continuous real calendar months from a non-January start', () => {
    const periods = createForecastPeriods('2026-04', 36);

    expect(periods).toHaveLength(36);
    expect(periods[0]).toEqual({
      kind: 'flow',
      id: 'forecast-2026-04',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      durationMonths: 1,
      granularity: 'month',
    });
    expect(periods[11]?.id).toBe('forecast-2027-03');
    expect(periods[35]?.id).toBe('forecast-2029-03');
  });

  it('uses the real leap-year February month end', () => {
    const periods = createForecastPeriods('2028-02', 36);
    expect(periods[0]?.endDate).toBe('2028-02-29');
  });
});

describe('generateMonthlyValues', () => {
  it('keeps month one exact and applies each calendar multiplier directly', () => {
    const periods = createForecastPeriods('2026-04', 36);
    const result = generateMonthlyValues(
      rule('110', '0.1', MONTHLY_SEASONALITY),
      periods,
      { nonNegative: true },
    );

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.values[0]).toBe('110');
      const expectedMay = canonicalDecimal(
        new AnalysisDecimal('110')
          .dividedBy('1.1')
          .times('1.1')
          .times('1.2'),
      );
      expect(result.values[1]).toBe(expectedMay);
      const expectedNextApril = canonicalDecimal(
        new AnalysisDecimal('110')
          .dividedBy('1.1')
          .times(AnalysisDecimal.pow('1.1', 12))
          .times('1.1'),
      );
      expect(result.values[12]).toBe(expectedNextApril);
    }
  });

  it('handles the December to January season switch without chaining', () => {
    const periods = createForecastPeriods('2026-12', 36);
    const result = generateMonthlyValues(
      rule('120', '0', MONTHLY_SEASONALITY),
      periods,
      { nonNegative: true },
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.values.slice(0, 2)).toEqual(['120', '80']);
    }
  });

  it('does not drift across 60 months and uses identity seasonality when omitted', () => {
    const periods = createForecastPeriods('2026-04', 60);
    const seasonal = generateMonthlyValues(
      rule('110', '0', MONTHLY_SEASONALITY),
      periods,
      { nonNegative: true },
    );
    const plain = generateMonthlyValues(rule('10', '0.01'), periods, {
      nonNegative: true,
    });

    expect(seasonal.status).toBe('ok');
    expect(plain.status).toBe('ok');
    if (seasonal.status === 'ok' && plain.status === 'ok') {
      expect(seasonal.values[0]).toBe(seasonal.values[12]);
      expect(seasonal.values[0]).toBe(seasonal.values[48]);
      expect(plain.values[0]).toBe('10');
      expect(plain.values[1]).toBe('10.1');
    }
  });

  it('allows a -1 growth boundary and blocks generated negative values', () => {
    const periods = createForecastPeriods('2026-04', 36);
    const zeroed = generateMonthlyValues(rule('10', '-1'), periods, {
      nonNegative: true,
    });
    const negative = generateMonthlyValues(rule('-1', '0'), periods, {
      nonNegative: true,
    });

    expect(zeroed.status).toBe('ok');
    if (zeroed.status === 'ok') {
      expect(zeroed.values.slice(0, 3)).toEqual(['10', '0', '0']);
    }
    expect(negative).toMatchObject({
      status: 'blocked',
      issues: [{ code: 'value_out_of_range' }],
    });
  });

  it('does not mutate the normalized rule', () => {
    const input = rule('110', '0.1', MONTHLY_SEASONALITY);
    const before = JSON.stringify(input);
    generateMonthlyValues(input, createForecastPeriods('2026-04', 36), {
      nonNegative: true,
    });
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('expandModelYearRates', () => {
  it('switches rates exactly at each 12-month boundary', () => {
    const values = expandModelYearRates(['0.4', '0.35', '0.3', '0.25', '0.2'], 60);

    expect(values).toHaveLength(60);
    expect(values[0]).toBe('0.4');
    expect(values[11]).toBe('0.4');
    expect(values[12]).toBe('0.35');
    expect(values[24]).toBe('0.3');
    expect(values[36]).toBe('0.25');
    expect(values[48]).toBe('0.2');
  });
});
