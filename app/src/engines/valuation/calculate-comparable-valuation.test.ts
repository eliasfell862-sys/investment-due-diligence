import { describe, expect, it } from 'vitest';

import {
  AnalysisDecimal,
  canonicalDecimal,
} from '../../domain/analysis/decimal';
import {
  comparableInput,
} from './valuation-test-fixtures';
import { calculateComparableValuation } from './calculate-comparable-valuation';

function expectOk(input = comparableInput()) {
  const result = calculateComparableValuation(input);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error('Expected comparable result');
  return result;
}

describe('calculateComparableValuation', () => {
  it('calculates Type 7 EV/Revenue quantiles, adjustment, and net-debt bridge', () => {
    const result = expectOk();
    const method = result.value.methods.find(
      ({ methodId }) => methodId === 'comparable-ev-revenue',
    )!;

    expect(method.validSampleCount).toBe(4);
    expect(method.rawMultipleRange).toEqual({
      low: '5.75',
      midpoint: '6.5',
      high: '7.25',
    });
    expect(method.totalAdjustment).toBe('0.05');
    expect(method.adjustedMultipleRange).toEqual({
      low: '6.0375',
      midpoint: '6.825',
      high: '7.6125',
    });
    expect(method.range).toEqual({
      low: '8652.5',
      midpoint: '9755',
      high: '10857.5',
      currency: 'CNY',
      valuationDate: '2026-03-31',
      basis: 'pre-money-equity',
    });
  });

  it('calculates EV/EBITDA and P/E independently without cross-method averaging', () => {
    const result = expectOk();
    const ebitda = result.value.methods.find(
      ({ methodId }) => methodId === 'comparable-ev-ebitda',
    )!;
    const pe = result.value.methods.find(
      ({ methodId }) => methodId === 'comparable-pe',
    )!;

    expect(ebitda.rawMultipleRange).toEqual({
      low: '23',
      midpoint: '25',
      high: '27',
    });
    const expectedPeMedian = new AnalysisDecimal('7400')
      .dividedBy('220')
      .plus(new AnalysisDecimal('9300').dividedBy('250'))
      .dividedBy(2);
    expect(pe.rawMultipleRange.midpoint).toBe(canonicalDecimal(expectedPeMedian));
    expect(result.value.methods).toHaveLength(3);
    expect(result.value.footballField.map(({ methodId }) => methodId)).toEqual([
      'comparable-ev-revenue',
      'comparable-ev-ebitda',
      'comparable-pe',
    ]);
  });

  it('excludes non-positive EBITDA and net-income peers from their samples', () => {
    const peers = comparableInput().peers.map((peer, index) => {
      if (index === 0) return { ...peer, ebitda: '-1' };
      if (index === 1) return { ...peer, netIncome: '0' };
      return peer;
    });
    const result = expectOk({ ...comparableInput(), peers });
    const ebitda = result.value.methods.find(
      ({ methodId }) => methodId === 'comparable-ev-ebitda',
    )!;
    const pe = result.value.methods.find(
      ({ methodId }) => methodId === 'comparable-pe',
    )!;

    expect(ebitda.validSampleCount).toBe(3);
    expect(pe.validSampleCount).toBe(3);
  });

  it('omits a multiple with fewer than three peers and reports explicit coverage', () => {
    const peers = comparableInput().peers.map((peer, index) =>
      index < 2 ? { ...peer, ebitda: '-1' } : peer,
    );
    const result = expectOk({ ...comparableInput(), peers });

    expect(result.value.methods.map(({ methodId }) => methodId)).not.toContain(
      'comparable-ev-ebitda',
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'insufficient_comparables',
          path: 'peers.evEbitda',
          details: expect.objectContaining({ available: 2, required: 3 }),
        }),
      ]),
    );
  });

  it('clamps each adjustment and then the total adjustment to ?50%', () => {
    const premium = expectOk({
      ...comparableInput(),
      adjustments: {
        growth: '1',
        profitability: '1',
        size: '1',
        liquidity: '1',
      },
    });
    const discount = expectOk({
      ...comparableInput(),
      adjustments: {
        growth: '-1',
        profitability: '-1',
        size: '-1',
        liquidity: '-1',
      },
    });

    expect(premium.value.methods.every(({ totalAdjustment }) => totalAdjustment === '0.5')).toBe(true);
    expect(discount.value.methods.every(({ totalAdjustment }) => totalAdjustment === '-0.5')).toBe(true);
  });

  it('omits methods whose subject denominator is non-positive', () => {
    const result = expectOk({
      ...comparableInput(),
      subject: {
        ...comparableInput().subject,
        ebitda: '-10',
        netIncome: '0',
      },
    });

    expect(result.value.methods.map(({ methodId }) => methodId)).toEqual([
      'comparable-ev-revenue',
    ]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'non_positive_denominator',
          path: 'subject.ebitda',
        }),
        expect.objectContaining({
          code: 'non_positive_denominator',
          path: 'subject.netIncome',
        }),
      ]),
    );
  });

  it('blocks when no multiple is meaningful instead of returning zeroes', () => {
    const result = calculateComparableValuation({
      ...comparableInput(),
      subject: {
        ...comparableInput().subject,
        revenue: '0',
        ebitda: '0',
        netIncome: '0',
      },
    });

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toBe('not-meaningful');
      expect(result.issues).toHaveLength(3);
    }
  });

  it('is deterministic, frozen, and does not mutate peers', () => {
    const input = comparableInput();
    const before = JSON.stringify(input);
    const first = calculateComparableValuation(input);
    const reordered = calculateComparableValuation({
      ...comparableInput(),
      peers: [...comparableInput().peers].reverse(),
    });

    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(first)).toBe(JSON.stringify(reordered));
    expect(Object.isFrozen(first)).toBe(true);
    if (first.status === 'ok') {
      expect(Object.isFrozen(first.value.methods)).toBe(true);
      expect(first.trace.valuationRef).toBe('comparable-valuation@1');
    }
  });
});
