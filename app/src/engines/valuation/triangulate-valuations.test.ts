import { describe, expect, it } from 'vitest';

import { AnalysisDecimal } from '../../domain/analysis/decimal';
import { triangulationInput } from './valuation-test-fixtures';
import { triangulateValuations } from './triangulate-valuations';

function expectOk(input = triangulationInput()) {
  const result = triangulateValuations(input);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error('Expected triangulation result');
  return result;
}

describe('triangulateValuations', () => {
  it('calculates pointwise weighted low/mid/high values with explicit weights', () => {
    const result = expectOk();

    expect(result.value.range).toEqual({
      low: '3000',
      midpoint: '4000',
      high: '5000',
      currency: 'CNY',
      valuationDate: '2026-03-31',
      basis: 'pre-money-equity',
    });
    expect(result.value.methodCount).toBe(3);
    expect(result.value.totalWeight).toBe('1');
  });

  it('emits method Football Field rows plus a combined row in canonical order', () => {
    const result = expectOk({
      ...triangulationInput(),
      methods: [...triangulationInput().methods].reverse(),
    });

    expect(result.value.footballField.map(({ methodId }) => methodId)).toEqual([
      'dcf',
      'comparable-ev-revenue',
      'vc-method',
      'triangulated',
    ]);
    expect(result.value.footballField.at(-1)).toEqual({
      methodId: 'triangulated',
      label: 'Triangulated Valuation',
      low: '3000',
      midpoint: '4000',
      high: '5000',
    });
  });

  it('supports degraded two-method coverage when the caller explicitly reweights', () => {
    const methods = triangulationInput().methods.slice(0, 2).map((method) => ({
      ...method,
      weight: '0.5',
    }));
    const result = expectOk({ ...triangulationInput(), methods });

    expect(result.value.methodCount).toBe(2);
    expect(result.value.range).toMatchObject({
      low: '3250',
      midpoint: '4250',
      high: '5250',
    });
  });

  it('blocks one-method coverage rather than fabricating a triangle', () => {
    const result = triangulateValuations({
      ...triangulationInput(),
      methods: [triangulationInput().methods[0]!],
    });

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toBe('insufficient-data');
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'missing_input', path: 'methods' }),
        ]),
      );
    }
  });

  it('blocks incompatible dates, currencies, basis, duplicate IDs, and weights', () => {
    const duplicate = triangulationInput().methods.map((method, index) =>
      index === 1 ? { ...method, methodId: 'dcf' as const } : method,
    );
    const duplicateResult = triangulateValuations({
      ...triangulationInput(),
      methods: duplicate,
    });
    expect(duplicateResult.status).toBe('blocked');

    const wrongWeight = triangulationInput().methods.map((method, index) =>
      index === 0 ? { ...method, weight: '0.5' } : method,
    );
    const weightResult = triangulateValuations({
      ...triangulationInput(),
      methods: wrongWeight,
    });
    expect(weightResult.status).toBe('blocked');

    const mixedCurrency = triangulationInput().methods.map((method, index) =>
      index === 1
        ? { ...method, range: { ...method.range, currency: 'USD' } }
        : method,
    );
    const currencyResult = triangulateValuations({
      ...triangulationInput(),
      methods: mixedCurrency,
    });
    expect(currencyResult.status).toBe('blocked');
    if (currencyResult.status === 'blocked') {
      expect(currencyResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'currency_mismatch',
            path: 'methods[1].range.currency',
          }),
        ]),
      );
    }
  });

  it('carries through and stably sorts method sensitivity matrices', () => {
    const base = triangulationInput();
    const matrix = {
      matrixRef: 'vc-exit-equity-target-irr@1' as const,
      rowAxis: {
        axisId: 'exit-equity-value' as const,
        label: 'Exit Equity Value',
        unit: 'currency' as const,
        values: ['1', '2', '3', '4', '5'] as const,
      },
      columnAxis: {
        axisId: 'target-irr' as const,
        label: 'Target IRR',
        unit: 'rate' as const,
        values: ['0.1', '0.2', '0.3', '0.4', '0.5'] as const,
      },
      currency: 'CNY',
      valuationDate: '2026-03-31',
      basis: 'pre-money-equity' as const,
      values: Array.from(
        { length: 5 },
        (_, row) => Array.from({ length: 5 }, (_, column) =>
          String((row + 1) * (column + 1))
        ),
      ) as unknown as readonly [
        readonly [string, string, string, string, string],
        readonly [string, string, string, string, string],
        readonly [string, string, string, string, string],
        readonly [string, string, string, string, string],
        readonly [string, string, string, string, string],
      ],
    };
    const methods = base.methods.map((method) =>
      method.methodId === 'vc-method'
        ? { ...method, sensitivityMatrices: [matrix] }
        : method,
    );
    const result = expectOk({ ...base, methods });

    expect(result.value.sensitivityMatrices).toEqual([matrix]);
  });

  it('is deterministic across method order and returns deeply frozen output', () => {
    const input = triangulationInput();
    const before = JSON.stringify(input);
    const first = triangulateValuations(input);
    const second = triangulateValuations({
      ...triangulationInput(),
      methods: [...triangulationInput().methods].reverse(),
    });

    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
    if (first.status === 'ok') {
      expect(Object.isFrozen(first.value.footballField)).toBe(true);
      expect(first.trace.valuationRef).toBe('valuation-triangulation@1');
      expect(new AnalysisDecimal(first.value.range.low).lessThanOrEqualTo(
        first.value.range.midpoint,
      )).toBe(true);
    }
  });
});
