import type {
  TraceStep,
  ValuationCalculationTrace,
} from '../../domain/analysis/calculation-trace';
import {
  AnalysisDecimal,
  canonicalDecimal,
  type DecimalString,
} from '../../domain/analysis/decimal';
import {
  blockedResult,
  okResult,
} from '../../domain/analysis/engine-result';
import { validateVcInput } from './validate-valuation-input';
import type {
  DecimalRangeInput,
  FiveByFiveDecimalMatrix,
  FivePointDecimalTuple,
  SensitivityMatrix,
  ValuationEngineResult,
  VcMethodInput,
  VcMethodResult,
} from './valuation-types';

interface VcPoint {
  readonly targetExitProceeds: DecimalString;
  readonly maximumInvestment: DecimalString;
  readonly maximumPreMoney: DecimalString;
}

function trace(
  inputs: ValuationCalculationTrace['inputs'],
  steps: readonly TraceStep[],
): ValuationCalculationTrace {
  return {
    engine: 'valuation',
    valuationRef: 'vc-method@1',
    inputs,
    steps,
  };
}

function targetMoic(input: VcMethodInput): DecimalString {
  if (input.targetMoic !== undefined) return input.targetMoic;
  return canonicalDecimal(
    AnalysisDecimal.pow(
      new AnalysisDecimal(1).plus(input.targetIrr!),
      input.holdingYears,
    ),
  );
}

function point(
  exitEquityValue: DecimalString,
  ownership: DecimalString,
  dilution: DecimalString,
  moic: DecimalString,
): VcPoint {
  const targetExitProceeds = new AnalysisDecimal(exitEquityValue)
    .times(ownership)
    .times(new AnalysisDecimal(1).minus(dilution));
  const maximumInvestment = targetExitProceeds.dividedBy(moic);
  const maximumPreMoney = maximumInvestment
    .times(new AnalysisDecimal(1).minus(ownership))
    .dividedBy(ownership);
  return {
    targetExitProceeds: canonicalDecimal(targetExitProceeds),
    maximumInvestment: canonicalDecimal(maximumInvestment),
    maximumPreMoney: canonicalDecimal(maximumPreMoney),
  };
}

function rangeFromPoints(
  low: VcPoint,
  midpoint: VcPoint,
  high: VcPoint,
  field: keyof VcPoint,
): DecimalRangeInput {
  return {
    low: low[field],
    midpoint: midpoint[field],
    high: high[field],
  };
}

function matrixValues(
  input: VcMethodInput,
): FiveByFiveDecimalMatrix {
  return input.sensitivity.exitEquityValue.map((exitValue) =>
    input.sensitivity.targetIrr.map((irr) => {
      const moic = canonicalDecimal(
        AnalysisDecimal.pow(
          new AnalysisDecimal(1).plus(irr),
          input.holdingYears,
        ),
      );
      return point(
        exitValue,
        input.targetOwnership,
        input.expectedDilution,
        moic,
      ).maximumPreMoney;
    }) as unknown as FivePointDecimalTuple
  ) as unknown as FiveByFiveDecimalMatrix;
}

function sensitivityMatrix(
  input: VcMethodInput,
  values: FiveByFiveDecimalMatrix,
): SensitivityMatrix {
  return {
    matrixRef: 'vc-exit-equity-target-irr@1',
    rowAxis: {
      axisId: 'exit-equity-value',
      label: 'Exit Equity Value',
      unit: 'currency',
      values: input.sensitivity.exitEquityValue,
    },
    columnAxis: {
      axisId: 'target-irr',
      label: 'Target IRR',
      unit: 'rate',
      values: input.sensitivity.targetIrr,
    },
    currency: input.currency,
    valuationDate: input.valuationDate,
    basis: 'pre-money-equity',
    values,
  };
}

export function calculateVcMethod(
  input: unknown,
): ValuationEngineResult<VcMethodResult> {
  const validation = validateVcInput(input);
  if (validation.status === 'blocked') {
    return blockedResult(
      validation.reason,
      validation.issues,
      trace(validation.traceInputs, []),
    );
  }

  const normalized = validation.input;
  const moic = targetMoic(normalized);
  const low = point(
    normalized.exitEquityValue.low,
    normalized.targetOwnership,
    normalized.expectedDilution,
    moic,
  );
  const midpoint = point(
    normalized.exitEquityValue.midpoint,
    normalized.targetOwnership,
    normalized.expectedDilution,
    moic,
  );
  const high = point(
    normalized.exitEquityValue.high,
    normalized.targetOwnership,
    normalized.expectedDilution,
    moic,
  );

  if (!new AnalysisDecimal(midpoint.maximumPreMoney).greaterThan(0)) {
    return blockedResult(
      'not-meaningful',
      [{
        code: 'invalid_valuation_range',
        path: 'maximumPreMoney',
        message: 'The maximum acceptable pre-money valuation must be positive.',
        details: {
          targetOwnership: normalized.targetOwnership,
          expectedDilution: normalized.expectedDilution,
          midpoint: midpoint.maximumPreMoney,
        },
      }],
      trace(validation.traceInputs, [{
        id: 'vc:maximum-pre-money',
        operator: 'ownership-bridge',
        operands: [
          normalized.exitEquityValue.midpoint,
          normalized.targetOwnership,
          normalized.expectedDilution,
          moic,
        ],
        result: midpoint.maximumPreMoney,
        rule: 'maximum-investment*(1-ownership)/ownership',
        outcome: 'blocked',
      }]),
    );
  }

  const values = matrixValues(normalized);
  const steps: TraceStep[] = [
    {
      id: 'vc:target-moic',
      operator: normalized.targetIrr === undefined ? 'input' : 'power',
      operands: normalized.targetIrr === undefined
        ? [moic]
        : ['1', normalized.targetIrr, normalized.holdingYears],
      result: moic,
      rule: '(1+irr)^holding-years',
      outcome: 'passed',
    },
    {
      id: 'vc:target-exit-proceeds',
      operator: 'multiply',
      operands: [
        normalized.exitEquityValue.midpoint,
        normalized.targetOwnership,
        canonicalDecimal(new AnalysisDecimal(1).minus(normalized.expectedDilution)),
      ],
      result: midpoint.targetExitProceeds,
      outcome: 'passed',
    },
    {
      id: 'vc:maximum-investment',
      operator: 'divide',
      operands: [midpoint.targetExitProceeds, moic],
      result: midpoint.maximumInvestment,
      outcome: 'passed',
    },
    {
      id: 'vc:maximum-pre-money',
      operator: 'ownership-bridge',
      operands: [midpoint.maximumInvestment, normalized.targetOwnership],
      result: midpoint.maximumPreMoney,
      rule: 'maximum-investment*(1-ownership)/ownership',
      outcome: 'passed',
    },
  ];

  return okResult(
    {
      version: normalized.version,
      methodId: 'vc-method',
      targetMoic: moic,
      targetExitProceeds: rangeFromPoints(low, midpoint, high, 'targetExitProceeds'),
      maximumInvestment: rangeFromPoints(low, midpoint, high, 'maximumInvestment'),
      range: {
        ...rangeFromPoints(low, midpoint, high, 'maximumPreMoney'),
        currency: normalized.currency,
        valuationDate: normalized.valuationDate,
        basis: 'pre-money-equity',
      },
      sensitivityMatrix: sensitivityMatrix(normalized, values),
    },
    validation.warnings,
    trace(validation.traceInputs, steps),
  );
}
