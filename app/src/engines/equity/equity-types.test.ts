import { describe, expect, expectTypeOf, it } from 'vitest';

import type { EquityCalculationTrace } from '../../domain/analysis/calculation-trace';
import type {
  DecimalString,
  ProbabilityString,
} from '../../domain/analysis/decimal';
import type { CurrencyCode } from '../../domain/analysis/value';
import {
  capTableInput,
  investorReturnInput,
  waterfallInput,
} from './equity-test-fixtures';
import type {
  CapTableModel,
  CapTableModelInput,
  CapTablePosition,
  EquityEngineResult,
  InvestorReturnInput,
  InvestorReturnSet,
  LiquidationWaterfall,
  LiquidationWaterfallInput,
  SecurityPosition,
} from './equity-types';

type CapTableEntryPoint = (input: unknown) => EquityEngineResult<CapTableModel>;
type WaterfallEntryPoint = (
  input: unknown,
) => EquityEngineResult<LiquidationWaterfall>;
type ReturnsEntryPoint = (
  input: unknown,
) => EquityEngineResult<InvestorReturnSet>;

describe('equity engine contracts', () => {
  it('locks hostile-safe public entry points and equity traces', () => {
    expectTypeOf<CapTableEntryPoint>().parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf<WaterfallEntryPoint>().parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf<ReturnsEntryPoint>().parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf<EquityEngineResult<CapTableModel>['trace']>().toEqualTypeOf<
      EquityCalculationTrace
    >();
  });

  it('locks fully diluted security positions as the source of ownership', () => {
    expectTypeOf<SecurityPosition>().toEqualTypeOf<{
      readonly securityId: string;
      readonly holderId: string;
      readonly securityType: 'common' | 'preferred' | 'esop';
      readonly shares: DecimalString;
      readonly investedCapital: DecimalString;
      readonly acquisitionDate: string;
      readonly liquidationPreference?: {
        readonly participation: 'non-participating' | 'participating';
        readonly multiple: DecimalString;
        readonly seniorityRank: number;
        readonly capMultiple?: DecimalString;
      };
    }>();
    expectTypeOf<CapTablePosition['ownership']>().toEqualTypeOf<DecimalString>();
  });

  it('locks probability-weighted investor return outputs', () => {
    expectTypeOf<InvestorReturnSet>().toMatchTypeOf<{
      readonly totalInvestedCapital: DecimalString;
      readonly expectedExitProceeds: DecimalString;
      readonly expectedMoic: DecimalString;
      readonly permanentLossProbability: ProbabilityString;
    }>();
  });

  it('provides fresh, complete DTO fixtures', () => {
    const capTable: CapTableModelInput = capTableInput();
    const waterfall: LiquidationWaterfallInput = waterfallInput();
    const returns: InvestorReturnInput = investorReturnInput();

    expect(capTable).toMatchObject({
      version: '1',
      currency: 'CNY',
      asOfDate: '2026-03-31',
    });
    expect(capTable.initialPositions).toHaveLength(3);
    expect(capTable.events).toHaveLength(1);
    expect(waterfall.exitValue).toBe('12000');
    expect(returns.scenarios.map(({ probability }) => probability)).toEqual([
      '0.3',
      '0.5',
      '0.2',
    ]);

    const second = capTableInput();
    expect(second).not.toBe(capTable);
    expect(second.initialPositions).not.toBe(capTable.initialPositions);
    expect(second.initialPositions[0]).not.toBe(capTable.initialPositions[0]);
  });

  it('keeps currency explicit throughout the public boundary', () => {
    expectTypeOf<CapTableModelInput['currency']>().toEqualTypeOf<CurrencyCode>();
  });
});
