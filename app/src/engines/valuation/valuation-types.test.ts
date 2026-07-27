import { describe, expect, expectTypeOf, it } from 'vitest';

import type { ValuationCalculationTrace } from '../../domain/analysis/calculation-trace';
import type { DecimalString } from '../../domain/analysis/decimal';
import type { CurrencyCode } from '../../domain/analysis/value';
import {
  comparableInput,
  dcfInput,
  triangulationInput,
  vcInput,
} from './valuation-test-fixtures';
import type {
  ComparableValuationInput,
  ComparableValuationResult,
  DcfInput,
  DcfResult,
  FootballFieldRow,
  SensitivityMatrix,
  ValuationEngineResult,
  ValuationMethodId,
  ValuationRange,
  ValuationTriangulationInput,
  ValuationTriangulationResult,
  VcMethodInput,
  VcMethodResult,
} from './valuation-types';

type DcfEntryPoint = (input: unknown) => ValuationEngineResult<DcfResult>;
type ComparableEntryPoint = (
  input: unknown,
) => ValuationEngineResult<ComparableValuationResult>;
type VcEntryPoint = (input: unknown) => ValuationEngineResult<VcMethodResult>;
type TriangulationEntryPoint = (
  input: unknown,
) => ValuationEngineResult<ValuationTriangulationResult>;

describe('valuation engine contracts', () => {
  it('locks public entry points to unknown hostile-safe inputs', () => {
    expectTypeOf<DcfEntryPoint>().parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf<ComparableEntryPoint>().parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf<VcEntryPoint>().parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf<TriangulationEntryPoint>().parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf<DcfEntryPoint>().returns.toEqualTypeOf<
      ValuationEngineResult<DcfResult>
    >();
  });

  it('locks method IDs and the pre-money equity range basis', () => {
    expectTypeOf<ValuationMethodId>().toEqualTypeOf<
      | 'dcf'
      | 'comparable-ev-revenue'
      | 'comparable-ev-ebitda'
      | 'comparable-pe'
      | 'vc-method'
    >();
    expectTypeOf<ValuationRange>().toEqualTypeOf<{
      readonly low: DecimalString;
      readonly midpoint: DecimalString;
      readonly high: DecimalString;
      readonly currency: CurrencyCode;
      readonly valuationDate: string;
      readonly basis: 'pre-money-equity';
    }>();
  });

  it('locks five-by-five sensitivity matrices and Football Field rows', () => {
    expectTypeOf<SensitivityMatrix['values']>().toEqualTypeOf<readonly [
      readonly [DecimalString, DecimalString, DecimalString, DecimalString, DecimalString],
      readonly [DecimalString, DecimalString, DecimalString, DecimalString, DecimalString],
      readonly [DecimalString, DecimalString, DecimalString, DecimalString, DecimalString],
      readonly [DecimalString, DecimalString, DecimalString, DecimalString, DecimalString],
      readonly [DecimalString, DecimalString, DecimalString, DecimalString, DecimalString],
    ]>();
    expectTypeOf<SensitivityMatrix['matrixRef']>().toEqualTypeOf<
      | 'dcf-wacc-perpetuity-growth@1'
      | 'dcf-wacc-exit-multiple@1'
      | 'vc-exit-equity-target-irr@1'
    >();
    expectTypeOf<FootballFieldRow['methodId']>().toEqualTypeOf<
      ValuationMethodId | 'triangulated'
    >();
  });

  it('uses a valuation-specific calculation trace', () => {
    expectTypeOf<ValuationEngineResult<DcfResult>['trace']>().toEqualTypeOf<
      ValuationCalculationTrace
    >();
  });

  it('provides fresh complete fixture DTOs', () => {
    const dcf: DcfInput = dcfInput();
    const comparable: ComparableValuationInput = comparableInput();
    const vc: VcMethodInput = vcInput();
    const triangulation: ValuationTriangulationInput = triangulationInput();

    expect(dcf).toMatchObject({
      version: '1',
      currency: 'CNY',
      valuationDate: '2026-03-31',
      discountingConvention: 'year-end',
    });
    expect(dcf.modelYears).toHaveLength(3);
    expect(comparable.peers).toHaveLength(4);
    expect(vc.exitEquityValue).toEqual({
      low: '8000',
      midpoint: '10000',
      high: '12000',
    });
    expect(triangulation.methods).toHaveLength(3);

    const second = dcfInput();
    expect(second).not.toBe(dcf);
    expect(second.modelYears).not.toBe(dcf.modelYears);
    expect(second.modelYears[0]).not.toBe(dcf.modelYears[0]);
  });
});
