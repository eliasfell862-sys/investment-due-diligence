import { describe, expect, it } from 'vitest';

import {
  AnalysisDecimal,
  canonicalDecimal,
} from '../../domain/analysis/decimal';
import { vcInput } from './valuation-test-fixtures';
import { calculateVcMethod } from './calculate-vc-method';

function expectOk(input = vcInput()) {
  const result = calculateVcMethod(input);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error('Expected VC method result');
  return result;
}

function expectedValues(exitEquityValue: string, irr = '0.25') {
  const input = vcInput();
  const targetMoic = AnalysisDecimal.pow(
    new AnalysisDecimal(1).plus(irr),
    input.holdingYears,
  );
  const targetExitProceeds = new AnalysisDecimal(exitEquityValue)
    .times(input.targetOwnership)
    .times(new AnalysisDecimal(1).minus(input.expectedDilution));
  const maximumInvestment = targetExitProceeds.dividedBy(targetMoic);
  const maximumPreMoney = maximumInvestment
    .times(new AnalysisDecimal(1).minus(input.targetOwnership))
    .dividedBy(input.targetOwnership);
  return { targetMoic, targetExitProceeds, maximumInvestment, maximumPreMoney };
}

describe('calculateVcMethod', () => {
  it('derives target MOIC from IRR and reverses exit proceeds to maximum pre-money', () => {
    const result = expectOk();
    const expected = expectedValues('10000');

    expect(result.value.targetMoic).toBe(canonicalDecimal(expected.targetMoic));
    expect(result.value.targetExitProceeds.midpoint).toBe(
      canonicalDecimal(expected.targetExitProceeds),
    );
    expect(result.value.maximumInvestment.midpoint).toBe(
      canonicalDecimal(expected.maximumInvestment),
    );
    expect(result.value.range.midpoint).toBe(
      canonicalDecimal(expected.maximumPreMoney),
    );
    expect(result.value.range).toMatchObject({
      currency: 'CNY',
      valuationDate: '2026-03-31',
      basis: 'pre-money-equity',
    });
  });

  it('accepts MOIC-only input and consistent dual target inputs', () => {
    const moicOnly = { ...vcInput(), targetMoic: '3.0517578125' };
    delete (moicOnly as Partial<typeof moicOnly>).targetIrr;
    const first = expectOk(moicOnly);
    const second = expectOk({
      ...vcInput(),
      targetMoic: '3.0517578125',
    });

    expect(first.value.targetMoic).toBe('3.0517578125');
    expect(second.value.targetMoic).toBe('3.0517578125');
    expect(first.value.range).toEqual(second.value.range);
  });

  it('blocks inconsistent IRR and MOIC inputs', () => {
    const result = calculateVcMethod({ ...vcInput(), targetMoic: '3' });

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'inconsistent_target_return',
            path: 'targetMoic',
          }),
        ]),
      );
    }
  });

  it('produces a monotonic low/base/high valuation range', () => {
    const result = expectOk();
    const low = expectedValues('8000').maximumPreMoney;
    const midpoint = expectedValues('10000').maximumPreMoney;
    const high = expectedValues('12000').maximumPreMoney;

    expect(result.value.range.low).toBe(canonicalDecimal(low));
    expect(result.value.range.midpoint).toBe(canonicalDecimal(midpoint));
    expect(result.value.range.high).toBe(canonicalDecimal(high));
  });

  it('populates a full exit-value ? target-IRR matrix with an exact center cell', () => {
    const result = expectOk();
    const matrix = result.value.sensitivityMatrix;

    expect(matrix.matrixRef).toBe('vc-exit-equity-target-irr@1');
    expect(matrix.values).toHaveLength(5);
    expect(matrix.values.every((row) => row.length === 5)).toBe(true);
    expect(matrix.values[2][2]).toBe(result.value.range.midpoint);
    expect(new AnalysisDecimal(matrix.values[4][2]).greaterThan(matrix.values[0][2])).toBe(true);
    expect(new AnalysisDecimal(matrix.values[2][0]).greaterThan(matrix.values[2][4])).toBe(true);
  });

  it('accepts IRR above 100% when it remains greater than -1', () => {
    const input = vcInput({
      targetIrr: '1.5',
      sensitivity: {
        exitEquityValue: ['8000', '9000', '10000', '11000', '12000'],
        targetIrr: ['1.3', '1.4', '1.5', '1.6', '1.7'],
      },
    });
    const result = expectOk(input);

    expect(result.value.targetMoic).toBe(
      canonicalDecimal(AnalysisDecimal.pow('2.5', '5')),
    );
  });

  it.each([
    ['full dilution', { expectedDilution: '1' }],
    ['100% target ownership', { targetOwnership: '1' }],
  ])('blocks a non-positive pre-money result for %s', (_label, overrides) => {
    const result = calculateVcMethod(vcInput(overrides));

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toBe('not-meaningful');
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_valuation_range',
            path: 'maximumPreMoney',
          }),
        ]),
      );
    }
  });

  it('is deterministic, deeply frozen, and leaves the input untouched', () => {
    const input = vcInput();
    const before = JSON.stringify(input);
    const first = calculateVcMethod(input);
    const second = calculateVcMethod(vcInput());

    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
    if (first.status === 'ok') {
      expect(Object.isFrozen(first.value.sensitivityMatrix.values[0])).toBe(true);
      expect(first.trace.valuationRef).toBe('vc-method@1');
    }
  });
});
