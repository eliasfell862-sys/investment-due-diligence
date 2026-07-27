import { describe, expect, it } from 'vitest';

import type { AnalysisUnit } from '../../domain/analysis/value';
import {
  calculateRevenueSeries,
} from './calculate-revenue';
import { createForecastPeriods } from './generate-monthly-series';
import type {
  NormalizedGeneratedValueRule,
  NormalizedRevenueModel,
} from './forecast-types';

function rule(value: string, unit: AnalysisUnit): NormalizedGeneratedValueRule {
  return {
    startingValue: {
      valueRef: `start:${value}:${unit.kind}`,
      metricId: 'driver',
      value,
      unit,
      sourceRefs: ['assumption'],
      conflict: { status: 'none' },
    },
    monthlyGrowthRate: {
      valueRef: `growth:${value}:${unit.kind}`,
      metricId: 'driver_growth',
      value: '0',
      unit: { kind: 'ratio', rateKind: 'signed-rate' },
      sourceRefs: ['assumption'],
      conflict: { status: 'none' },
    },
  };
}

const money = (currency = 'CNY'): AnalysisUnit => ({
  kind: 'currency',
  currency,
});
const ratio: AnalysisUnit = { kind: 'ratio', rateKind: 'non-negative-rate' };
const count = (countKind: 'customer' | 'user' | 'unit'): AnalysisUnit => ({
  kind: 'count',
  countKind,
});
const perCount = (
  countKind: 'customer' | 'user' | 'unit',
  currency = 'CNY',
  perPeriod?: 'month',
): AnalysisUnit => ({
  kind: 'currency-per-count',
  countKind,
  currency,
  ...(perPeriod === undefined ? {} : { perPeriod }),
});

describe('calculateRevenueSeries', () => {
  it.each([
    [
      'customer count',
      {
        kind: 'customer-count-times-average-revenue',
        customerCount: rule('100', count('customer')),
        averageRevenuePerCustomer: rule('10', perCount('customer', 'CNY', 'month')),
      },
    ],
    [
      'user ARPU',
      {
        kind: 'user-count-times-arpu',
        userCount: rule('200', count('user')),
        arpu: rule('5', perCount('user', 'CNY', 'month')),
      },
    ],
    [
      'GMV take rate',
      {
        kind: 'gmv-times-take-rate',
        gmv: rule('5000', money()),
        takeRate: rule('0.2', ratio),
      },
    ],
    [
      'unit sales',
      {
        kind: 'unit-sales-times-unit-price',
        unitsSold: rule('50', count('unit')),
        unitPrice: rule('20', perCount('unit')),
      },
    ],
  ] as const)('calculates %s revenue', (_label, revenue) => {
    const result = calculateRevenueSeries(
      revenue as NormalizedRevenueModel,
      createForecastPeriods('2026-04', 36),
      'CNY',
    );

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.revenue[0]).toBe('1000');
      expect(result.revenue[11]).toBe('1000');
      expect(result.revenue[12]).toBe('1000');
      expect(result.driverValues[0]).toHaveLength(2);
      expect(result.monthTraces[0]?.steps.at(-1)).toMatchObject({
        operator: 'multiply-revenue-factors',
        result: '1000',
      });
      const stepIds = result.monthTraces[0]?.steps.map((step) => step.id) ?? [];
      expect(new Set(stepIds).size).toBe(stepIds.length);
    }
  });

  it('calculates a custom count, price, and ratio product', () => {
    const revenue: NormalizedRevenueModel = {
      kind: 'custom-product',
      factors: [
        { factorId: 'customers', rule: rule('100', count('customer')) },
        { factorId: 'price', rule: rule('20', perCount('customer', 'CNY', 'month')) },
        { factorId: 'discount', rule: rule('0.5', ratio) },
      ],
    };
    const result = calculateRevenueSeries(
      revenue,
      createForecastPeriods('2026-04', 36),
      'CNY',
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.revenue[0]).toBe('1000');
      expect(result.driverValues[0]?.map((value) => value.factorId)).toEqual([
        'customers',
        'price',
        'discount',
      ]);
    }
  });

  it.each([
    [
      'currency mismatch',
      {
        kind: 'custom-product',
        factors: [
          { factorId: 'gmv', rule: rule('100', money('USD')) },
          { factorId: 'rate', rule: rule('0.2', ratio) },
        ],
      },
      'currency_mismatch',
    ],
    [
      'count mismatch',
      {
        kind: 'custom-product',
        factors: [
          { factorId: 'users', rule: rule('100', count('user')) },
          { factorId: 'price', rule: rule('10', perCount('customer')) },
        ],
      },
      'unit_mismatch',
    ],
    [
      'count times count',
      {
        kind: 'custom-product',
        factors: [
          { factorId: 'users', rule: rule('100', count('user')) },
          { factorId: 'customers', rule: rule('10', count('customer')) },
        ],
      },
      'unit_mismatch',
    ],
    [
      'two money factors',
      {
        kind: 'custom-product',
        factors: [
          { factorId: 'one', rule: rule('100', money()) },
          { factorId: 'two', rule: rule('10', money()) },
        ],
      },
      'unit_mismatch',
    ],
    [
      'no currency-producing factor',
      {
        kind: 'custom-product',
        factors: [
          { factorId: 'one', rule: rule('0.2', ratio) },
          { factorId: 'two', rule: rule('0.3', ratio) },
        ],
      },
      'unit_mismatch',
    ],
  ] as const)('blocks %s', (_label, revenue, code) => {
    const result = calculateRevenueSeries(
      revenue as NormalizedRevenueModel,
      createForecastPeriods('2026-04', 36),
      'CNY',
    );
    expect(result).toMatchObject({
      status: 'blocked',
      issues: [{ code }],
    });
  });

  it('blocks invalid custom widths, duplicate factor IDs, and negative factors', () => {
    const invalidModels: NormalizedRevenueModel[] = [
      { kind: 'custom-product', factors: [] },
      {
        kind: 'custom-product',
        factors: Array.from({ length: 6 }, (_, index) => ({
          factorId: `factor-${index}`,
          rule: rule('1', index === 0 ? money() : ratio),
        })),
      },
      {
        kind: 'custom-product',
        factors: [
          { factorId: 'same', rule: rule('100', money()) },
          { factorId: 'same', rule: rule('0.2', ratio) },
        ],
      },
      {
        kind: 'custom-product',
        factors: [
          { factorId: 'money', rule: rule('-1', money()) },
          { factorId: 'rate', rule: rule('0.2', ratio) },
        ],
      },
    ];

    for (const model of invalidModels) {
      expect(calculateRevenueSeries(
        model,
        createForecastPeriods('2026-04', 36),
        'CNY',
      ).status).toBe('blocked');
    }
  });
});
