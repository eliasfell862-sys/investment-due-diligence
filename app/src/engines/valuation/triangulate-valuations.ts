import type {
  TraceStep,
  ValuationCalculationTrace,
} from '../../domain/analysis/calculation-trace';
import {
  AnalysisDecimal,
  canonicalDecimal,
} from '../../domain/analysis/decimal';
import {
  blockedResult,
  okResult,
} from '../../domain/analysis/engine-result';
import { validateTriangulationInput } from './validate-valuation-input';
import type {
  FootballFieldRow,
  SensitivityMatrix,
  ValuationEngineResult,
  ValuationMethodId,
  ValuationTriangulationResult,
  WeightedValuationMethod,
} from './valuation-types';

const methodOrder: Readonly<Record<ValuationMethodId, number>> = {
  dcf: 0,
  'comparable-ev-revenue': 1,
  'comparable-ev-ebitda': 2,
  'comparable-pe': 3,
  'vc-method': 4,
};

function trace(
  inputs: ValuationCalculationTrace['inputs'],
  steps: readonly TraceStep[],
): ValuationCalculationTrace {
  return {
    engine: 'valuation',
    valuationRef: 'valuation-triangulation@1',
    inputs,
    steps,
  };
}

function orderedMethods(
  methods: readonly WeightedValuationMethod[],
): readonly WeightedValuationMethod[] {
  return [...methods].sort((left, right) =>
    methodOrder[left.methodId] - methodOrder[right.methodId],
  );
}

function weightedPoint(
  methods: readonly WeightedValuationMethod[],
  point: 'low' | 'midpoint' | 'high',
): string {
  return canonicalDecimal(methods.reduce(
    (total, method) =>
      total.plus(new AnalysisDecimal(method.range[point]).times(method.weight)),
    new AnalysisDecimal(0),
  ));
}

function footballRows(
  methods: readonly WeightedValuationMethod[],
  combined: {
    readonly low: string;
    readonly midpoint: string;
    readonly high: string;
  },
): readonly FootballFieldRow[] {
  return [
    ...methods.map((method) => ({
      methodId: method.methodId,
      label: method.label,
      low: method.range.low,
      midpoint: method.range.midpoint,
      high: method.range.high,
    })),
    {
      methodId: 'triangulated' as const,
      label: 'Triangulated Valuation',
      low: combined.low,
      midpoint: combined.midpoint,
      high: combined.high,
    },
  ];
}

function flattenedMatrices(
  methods: readonly WeightedValuationMethod[],
): readonly SensitivityMatrix[] {
  return methods
    .flatMap(({ sensitivityMatrices }) => sensitivityMatrices ?? [])
    .sort((left, right) => left.matrixRef.localeCompare(right.matrixRef));
}

export function triangulateValuations(
  input: unknown,
): ValuationEngineResult<ValuationTriangulationResult> {
  const validation = validateTriangulationInput(input);
  if (validation.status === 'blocked') {
    return blockedResult(
      validation.reason,
      validation.issues,
      trace(validation.traceInputs, []),
    );
  }

  const methods = orderedMethods(validation.input.methods);
  const first = methods[0]!;
  const range = {
    low: weightedPoint(methods, 'low'),
    midpoint: weightedPoint(methods, 'midpoint'),
    high: weightedPoint(methods, 'high'),
    currency: first.range.currency,
    valuationDate: first.range.valuationDate,
    basis: 'pre-money-equity' as const,
  };
  const totalWeight = canonicalDecimal(methods.reduce(
    (total, method) => total.plus(method.weight),
    new AnalysisDecimal(0),
  ));
  const steps: TraceStep[] = [
    {
      id: 'triangulation:low',
      operator: 'weighted-sum',
      operands: methods.flatMap((method) => [method.range.low, method.weight]),
      result: range.low,
      outcome: 'passed',
    },
    {
      id: 'triangulation:midpoint',
      operator: 'weighted-sum',
      operands: methods.flatMap((method) => [method.range.midpoint, method.weight]),
      result: range.midpoint,
      outcome: 'passed',
    },
    {
      id: 'triangulation:high',
      operator: 'weighted-sum',
      operands: methods.flatMap((method) => [method.range.high, method.weight]),
      result: range.high,
      outcome: 'passed',
    },
  ];

  return okResult(
    {
      version: validation.input.version,
      range,
      methodCount: methods.length,
      totalWeight,
      methods,
      footballField: footballRows(methods, range),
      sensitivityMatrices: flattenedMatrices(methods),
    },
    validation.warnings,
    trace(validation.traceInputs, steps),
  );
}
