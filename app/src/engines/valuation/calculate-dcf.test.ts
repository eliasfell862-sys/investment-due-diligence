import { describe, expect, it } from 'vitest';

import {
  AnalysisDecimal,
  canonicalDecimal,
} from '../../domain/analysis/decimal';
import { dcfInput } from './valuation-test-fixtures';
import { calculateDcf } from './calculate-dcf';

function yearEndExplicitPv(wacc: string): string {
  const input = dcfInput();
  return canonicalDecimal(input.modelYears.reduce(
    (total, year, index) =>
      total.plus(
        new AnalysisDecimal(year.fcff).dividedBy(
          AnalysisDecimal.pow(new AnalysisDecimal(1).plus(wacc), index + 1),
        ),
      ),
    new AnalysisDecimal(0),
  ));
}

function expectOk(input = dcfInput()) {
  const result = calculateDcf(input);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error('Expected ok DCF result');
  return result;
}

describe('calculateDcf', () => {
  it('calculates year-end FCFF present values and both terminal methods', () => {
    const input = dcfInput();
    const result = expectOk(input);
    const explicitPv = new AnalysisDecimal(yearEndExplicitPv(input.wacc));
    const terminalFcff = new AnalysisDecimal(input.modelYears.at(-1)!.fcff);
    const perpetuityTv = terminalFcff
      .times(new AnalysisDecimal(1).plus(input.perpetuityGrowthRate))
      .dividedBy(
        new AnalysisDecimal(input.wacc).minus(input.perpetuityGrowthRate),
      );
    const exitTv = new AnalysisDecimal(input.modelYears.at(-1)!.ebitda)
      .times(input.exitMultiple);
    const terminalDiscount = AnalysisDecimal.pow(
      new AnalysisDecimal(1).plus(input.wacc),
      input.modelYears.length,
    );
    const netDebt = new AnalysisDecimal(input.interestBearingDebt)
      .minus(input.cashAndCashEquivalents);
    const perpetuityEv = explicitPv.plus(perpetuityTv.dividedBy(terminalDiscount));
    const exitEv = explicitPv.plus(exitTv.dividedBy(terminalDiscount));

    expect(result.value.presentValueOfExplicitFcff).toBe(canonicalDecimal(explicitPv));
    expect(result.value.netDebt).toBe('-200');
    expect(result.value.perpetuityGrowth.terminalValue).toBe(canonicalDecimal(perpetuityTv));
    expect(result.value.perpetuityGrowth.enterpriseValue).toBe(canonicalDecimal(perpetuityEv));
    expect(result.value.perpetuityGrowth.equityValue).toBe(
      canonicalDecimal(perpetuityEv.minus(netDebt)),
    );
    expect(result.value.exitMultiple.terminalValue).toBe(canonicalDecimal(exitTv));
    expect(result.value.exitMultiple.equityValue).toBe(
      canonicalDecimal(exitEv.minus(netDebt)),
    );
  });

  it('uses mid-year discounting only for annual FCFF and year N for terminal value', () => {
    const input = dcfInput({ discountingConvention: 'mid-year' });
    const result = expectOk(input);
    const onePlusWacc = new AnalysisDecimal(1).plus(input.wacc);
    const expectedExplicit = input.modelYears.reduce(
      (total, year, index) =>
        total.plus(
          new AnalysisDecimal(year.fcff).dividedBy(
            AnalysisDecimal.pow(onePlusWacc, new AnalysisDecimal(index).plus('0.5')),
          ),
        ),
      new AnalysisDecimal(0),
    );
    const expectedTerminalPv = new AnalysisDecimal(
      result.value.perpetuityGrowth.terminalValue,
    ).dividedBy(AnalysisDecimal.pow(onePlusWacc, input.modelYears.length));

    expect(result.value.presentValueOfExplicitFcff).toBe(
      canonicalDecimal(expectedExplicit),
    );
    expect(result.value.perpetuityGrowth.presentValueOfTerminalValue).toBe(
      canonicalDecimal(expectedTerminalPv),
    );
  });

  it('populates two full 5x5 matrices with exact base-case center cells', () => {
    const result = expectOk();

    expect(result.value.sensitivityMatrices).toHaveLength(2);
    for (const matrix of result.value.sensitivityMatrices) {
      expect(matrix.values).toHaveLength(5);
      expect(matrix.values.every((row) => row.length === 5)).toBe(true);
    }
    expect(result.value.sensitivityMatrices[0].values[2][2]).toBe(
      result.value.perpetuityGrowth.equityValue,
    );
    expect(result.value.sensitivityMatrices[1].values[2][2]).toBe(
      result.value.exitMultiple.equityValue,
    );
  });

  it('uses declared terminal weights for the midpoint and all cells for low/high', () => {
    const input = dcfInput({
      terminalMethodWeights: {
        perpetuityGrowth: '0.25',
        exitMultiple: '0.75',
      },
    });
    const result = expectOk(input);
    const expectedMidpoint = new AnalysisDecimal(
      result.value.perpetuityGrowth.equityValue,
    )
      .times('0.25')
      .plus(new AnalysisDecimal(result.value.exitMultiple.equityValue).times('0.75'));
    const allCells = result.value.sensitivityMatrices.flatMap(({ values }) =>
      values.flat(),
    ).map((value) => new AnalysisDecimal(value));
    const expectedLow = AnalysisDecimal.min(...allCells);
    const expectedHigh = AnalysisDecimal.max(...allCells);

    expect(result.value.range.midpoint).toBe(canonicalDecimal(expectedMidpoint));
    expect(result.value.range.low).toBe(canonicalDecimal(expectedLow));
    expect(result.value.range.high).toBe(canonicalDecimal(expectedHigh));
    expect(result.value.range).toMatchObject({
      currency: 'CNY',
      valuationDate: '2026-03-31',
      basis: 'pre-money-equity',
    });
  });

  it('recalculates nonlinear sensitivity cells with monotonic behavior', () => {
    const result = expectOk();
    const perpetuity = result.value.sensitivityMatrices[0].values;
    const exit = result.value.sensitivityMatrices[1].values;

    expect(new AnalysisDecimal(perpetuity[0][2]).greaterThan(perpetuity[4][2])).toBe(true);
    expect(new AnalysisDecimal(perpetuity[2][4]).greaterThan(perpetuity[2][0])).toBe(true);
    expect(new AnalysisDecimal(exit[0][2]).greaterThan(exit[4][2])).toBe(true);
    expect(new AnalysisDecimal(exit[2][4]).greaterThan(exit[2][0])).toBe(true);
  });

  it('reports terminal-value shares and preserves net-cash uplift', () => {
    const result = expectOk();
    const perpetuity = result.value.perpetuityGrowth;
    const expectedShare = new AnalysisDecimal(perpetuity.presentValueOfTerminalValue)
      .dividedBy(perpetuity.enterpriseValue);

    expect(perpetuity.terminalValueShareOfEnterpriseValue).toBe(
      canonicalDecimal(expectedShare),
    );
    expect(
      new AnalysisDecimal(perpetuity.equityValue).greaterThan(
        perpetuity.enterpriseValue,
      ),
    ).toBe(true);
  });

  it('returns validator blocks without inventing values', () => {
    const result = calculateDcf(
      dcfInput({ perpetuityGrowthRate: '0.1' }),
    );

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toBe('invalid-input');
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_terminal_value',
            path: 'perpetuityGrowthRate',
          }),
        ]),
      );
    }
  });

  it('does not mutate input and returns deeply frozen deterministic JSON', () => {
    const input = dcfInput();
    const before = JSON.stringify(input);
    const first = calculateDcf(input);
    const second = calculateDcf(dcfInput());

    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
    if (first.status === 'ok') {
      expect(Object.isFrozen(first.value)).toBe(true);
      expect(Object.isFrozen(first.value.sensitivityMatrices[0].values[0])).toBe(true);
      expect(first.trace.valuationRef).toBe('dcf@1');
      expect(first.trace.steps.length).toBeGreaterThan(0);
    }
  });
});
