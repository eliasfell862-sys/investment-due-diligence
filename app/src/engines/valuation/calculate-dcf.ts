import type Decimal from 'decimal.js';

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
  type EngineIssue,
} from '../../domain/analysis/engine-result';
import { validateDcfInput } from './validate-valuation-input';
import type {
  DcfInput,
  DcfResult,
  DcfTerminalMethodResult,
  FiveByFiveDecimalMatrix,
  FivePointDecimalTuple,
  SensitivityAxis,
  SensitivityMatrix,
  ValuationEngineResult,
} from './valuation-types';

interface ExplicitPresentValue {
  readonly value: Decimal;
  readonly steps: readonly TraceStep[];
}

interface DcfMethodCalculation {
  readonly result: DcfTerminalMethodResult;
  readonly equityValue: Decimal;
}

function trace(
  inputs: ValuationCalculationTrace['inputs'],
  steps: readonly TraceStep[],
): ValuationCalculationTrace {
  return {
    engine: 'valuation',
    valuationRef: 'dcf@1',
    inputs,
    steps,
  };
}

function presentValueOfExplicitFcff(
  input: DcfInput,
  wacc: DecimalString,
  includeSteps: boolean,
): ExplicitPresentValue {
  const onePlusWacc = new AnalysisDecimal(1).plus(wacc);
  let total = new AnalysisDecimal(0);
  const steps: TraceStep[] = [];

  input.modelYears.forEach((year, index) => {
    const exponent = input.discountingConvention === 'mid-year'
      ? new AnalysisDecimal(index).plus('0.5')
      : new AnalysisDecimal(index + 1);
    const discountFactor = AnalysisDecimal.pow(onePlusWacc, exponent);
    const presentValue = new AnalysisDecimal(year.fcff).dividedBy(discountFactor);
    total = total.plus(presentValue);
    if (includeSteps) {
      steps.push({
        id: `dcf:pv-fcff:${year.period.id}`,
        operator: 'discount',
        operands: [year.fcff, wacc, canonicalDecimal(exponent)],
        result: canonicalDecimal(presentValue),
        rule: input.discountingConvention,
        outcome: 'passed',
      });
    }
  });

  return { value: total, steps };
}

function terminalResult(
  method: DcfTerminalMethodResult['method'],
  terminalValue: Decimal,
  explicitPresentValue: Decimal,
  wacc: DecimalString,
  input: DcfInput,
): DcfMethodCalculation {
  const terminalDiscount = AnalysisDecimal.pow(
    new AnalysisDecimal(1).plus(wacc),
    input.modelYears.length,
  );
  const presentValueOfTerminalValue = terminalValue.dividedBy(terminalDiscount);
  const enterpriseValue = explicitPresentValue.plus(presentValueOfTerminalValue);
  const netDebt = new AnalysisDecimal(input.interestBearingDebt)
    .minus(input.cashAndCashEquivalents);
  const equityValue = enterpriseValue.minus(netDebt);
  const terminalValueShareOfEnterpriseValue = enterpriseValue.isZero()
    ? new AnalysisDecimal(0)
    : presentValueOfTerminalValue.dividedBy(enterpriseValue);

  return {
    equityValue,
    result: {
      method,
      terminalValue: canonicalDecimal(terminalValue),
      presentValueOfTerminalValue: canonicalDecimal(presentValueOfTerminalValue),
      enterpriseValue: canonicalDecimal(enterpriseValue),
      equityValue: canonicalDecimal(equityValue),
      terminalValueShareOfEnterpriseValue: canonicalDecimal(
        terminalValueShareOfEnterpriseValue,
      ),
    },
  };
}

function perpetuityCalculation(
  input: DcfInput,
  wacc: DecimalString,
  growthRate: DecimalString,
  explicitPresentValue?: Decimal,
): DcfMethodCalculation {
  const explicit = explicitPresentValue ?? presentValueOfExplicitFcff(
    input,
    wacc,
    false,
  ).value;
  const finalFcff = new AnalysisDecimal(input.modelYears.at(-1)!.fcff);
  const terminalValue = finalFcff
    .times(new AnalysisDecimal(1).plus(growthRate))
    .dividedBy(new AnalysisDecimal(wacc).minus(growthRate));
  return terminalResult('perpetuity-growth', terminalValue, explicit, wacc, input);
}

function exitMultipleCalculation(
  input: DcfInput,
  wacc: DecimalString,
  exitMultiple: DecimalString,
  explicitPresentValue?: Decimal,
): DcfMethodCalculation {
  const explicit = explicitPresentValue ?? presentValueOfExplicitFcff(
    input,
    wacc,
    false,
  ).value;
  const finalYear = input.modelYears.at(-1)!;
  const terminalMetric = input.exitMetric === 'revenue'
    ? finalYear.revenue
    : finalYear.ebitda;
  const terminalValue = new AnalysisDecimal(terminalMetric).times(exitMultiple);
  return terminalResult('exit-multiple', terminalValue, explicit, wacc, input);
}

function matrixValues(
  rowValues: FivePointDecimalTuple,
  columnValues: FivePointDecimalTuple,
  calculate: (row: DecimalString, column: DecimalString) => DecimalString,
): FiveByFiveDecimalMatrix {
  return rowValues.map((row) =>
    columnValues.map((column) => calculate(row, column)) as unknown as FivePointDecimalTuple
  ) as unknown as FiveByFiveDecimalMatrix;
}

function axis(
  axisId: SensitivityAxis['axisId'],
  label: string,
  unit: SensitivityAxis['unit'],
  values: FivePointDecimalTuple,
): SensitivityAxis {
  return { axisId, label, unit, values };
}

function sensitivityMatrix(
  matrixRef: SensitivityMatrix['matrixRef'],
  rowAxis: SensitivityAxis,
  columnAxis: SensitivityAxis,
  values: FiveByFiveDecimalMatrix,
  input: DcfInput,
): SensitivityMatrix {
  return {
    matrixRef,
    rowAxis,
    columnAxis,
    currency: input.currency,
    valuationDate: input.valuationDate,
    basis: 'pre-money-equity',
    values,
  };
}

function warningForTerminalShare(
  method: string,
  share: DecimalString,
): EngineIssue | undefined {
  return new AnalysisDecimal(share).greaterThan('0.75')
    ? {
        code: 'value_out_of_range',
        path: `${method}.terminalValueShareOfEnterpriseValue`,
        message: 'Terminal value exceeds 75% of enterprise value.',
        details: { method, threshold: '0.75', actual: share },
      }
    : undefined;
}

export function calculateDcf(input: unknown): ValuationEngineResult<DcfResult> {
  const validation = validateDcfInput(input);
  if (validation.status === 'blocked') {
    return blockedResult(
      validation.reason,
      validation.issues,
      trace(validation.traceInputs, []),
    );
  }

  const normalized = validation.input;
  const explicit = presentValueOfExplicitFcff(
    normalized,
    normalized.wacc,
    true,
  );
  const perpetuity = perpetuityCalculation(
    normalized,
    normalized.wacc,
    normalized.perpetuityGrowthRate,
    explicit.value,
  );
  const exitMultiple = exitMultipleCalculation(
    normalized,
    normalized.wacc,
    normalized.exitMultiple,
    explicit.value,
  );

  const perpetuityValues = matrixValues(
    normalized.sensitivity.wacc,
    normalized.sensitivity.perpetuityGrowthRate,
    (wacc, growth) => canonicalDecimal(
      perpetuityCalculation(normalized, wacc, growth).equityValue,
    ),
  );
  const exitMultipleValues = matrixValues(
    normalized.sensitivity.wacc,
    normalized.sensitivity.exitMultiple,
    (wacc, multiple) => canonicalDecimal(
      exitMultipleCalculation(normalized, wacc, multiple).equityValue,
    ),
  );
  const matrices: readonly [SensitivityMatrix, SensitivityMatrix] = [
    sensitivityMatrix(
      'dcf-wacc-perpetuity-growth@1',
      axis('wacc', 'WACC', 'rate', normalized.sensitivity.wacc),
      axis(
        'perpetuity-growth',
        'Perpetuity Growth',
        'rate',
        normalized.sensitivity.perpetuityGrowthRate,
      ),
      perpetuityValues,
      normalized,
    ),
    sensitivityMatrix(
      'dcf-wacc-exit-multiple@1',
      axis('wacc', 'WACC', 'rate', normalized.sensitivity.wacc),
      axis(
        'exit-multiple',
        'Exit Multiple',
        'multiple',
        normalized.sensitivity.exitMultiple,
      ),
      exitMultipleValues,
      normalized,
    ),
  ];

  const allValues = matrices.flatMap(({ values }) =>
    values.flat().map((value) => new AnalysisDecimal(value)),
  );
  const weightedMidpoint = perpetuity.equityValue
    .times(normalized.terminalMethodWeights.perpetuityGrowth)
    .plus(
      exitMultiple.equityValue.times(
        normalized.terminalMethodWeights.exitMultiple,
      ),
    );
  const netDebt = new AnalysisDecimal(normalized.interestBearingDebt)
    .minus(normalized.cashAndCashEquivalents);
  const steps: TraceStep[] = [
    ...explicit.steps,
    {
      id: 'dcf:terminal:perpetuity-growth',
      operator: 'terminal-value',
      operands: [
        normalized.modelYears.at(-1)!.fcff,
        normalized.wacc,
        normalized.perpetuityGrowthRate,
      ],
      result: perpetuity.result.terminalValue,
      rule: 'fcff*(1+g)/(wacc-g)',
      outcome: 'passed',
    },
    {
      id: 'dcf:terminal:exit-multiple',
      operator: 'terminal-value',
      operands: [
        normalized.exitMetric,
        normalized.exitMultiple,
      ],
      result: exitMultiple.result.terminalValue,
      rule: 'terminal-metric*exit-multiple',
      outcome: 'passed',
    },
    {
      id: 'dcf:range:weighted-midpoint',
      operator: 'weighted-sum',
      operands: [
        perpetuity.result.equityValue,
        normalized.terminalMethodWeights.perpetuityGrowth,
        exitMultiple.result.equityValue,
        normalized.terminalMethodWeights.exitMultiple,
      ],
      result: canonicalDecimal(weightedMidpoint),
      outcome: 'passed',
    },
  ];
  const warnings = [
    ...validation.warnings,
    warningForTerminalShare(
      'perpetuityGrowth',
      perpetuity.result.terminalValueShareOfEnterpriseValue,
    ),
    warningForTerminalShare(
      'exitMultiple',
      exitMultiple.result.terminalValueShareOfEnterpriseValue,
    ),
  ].filter((value): value is EngineIssue => value !== undefined);

  return okResult(
    {
      version: normalized.version,
      methodId: 'dcf',
      range: {
        low: canonicalDecimal(AnalysisDecimal.min(...allValues)),
        midpoint: canonicalDecimal(weightedMidpoint),
        high: canonicalDecimal(AnalysisDecimal.max(...allValues)),
        currency: normalized.currency,
        valuationDate: normalized.valuationDate,
        basis: 'pre-money-equity',
      },
      presentValueOfExplicitFcff: canonicalDecimal(explicit.value),
      netDebt: canonicalDecimal(netDebt),
      perpetuityGrowth: perpetuity.result,
      exitMultiple: exitMultiple.result,
      sensitivityMatrices: matrices,
    },
    warnings,
    trace(validation.traceInputs, steps),
  );
}
