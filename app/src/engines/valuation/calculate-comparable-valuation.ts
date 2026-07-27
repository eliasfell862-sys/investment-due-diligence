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
import { validateComparableInput } from './validate-valuation-input';
import type {
  ComparableMethodResult,
  ComparablePeer,
  ComparableValuationInput,
  ComparableValuationResult,
  DecimalRangeInput,
  FootballFieldRow,
  ValuationEngineResult,
} from './valuation-types';

interface MultipleDefinition {
  readonly methodId: ComparableMethodResult['methodId'];
  readonly label: string;
  readonly warningPath: string;
  readonly subjectPath: 'revenue' | 'ebitda' | 'netIncome';
  readonly numerator: 'enterpriseValue' | 'equityValue';
  readonly denominator: 'revenue' | 'ebitda' | 'netIncome';
  readonly bridge: 'enterprise-to-equity' | 'equity';
}

interface MultipleSample {
  readonly companyId: string;
  readonly multiple: Decimal;
}

const definitions: readonly MultipleDefinition[] = [
  {
    methodId: 'comparable-ev-revenue',
    label: 'EV / Revenue',
    warningPath: 'peers.evRevenue',
    subjectPath: 'revenue',
    numerator: 'enterpriseValue',
    denominator: 'revenue',
    bridge: 'enterprise-to-equity',
  },
  {
    methodId: 'comparable-ev-ebitda',
    label: 'EV / EBITDA',
    warningPath: 'peers.evEbitda',
    subjectPath: 'ebitda',
    numerator: 'enterpriseValue',
    denominator: 'ebitda',
    bridge: 'enterprise-to-equity',
  },
  {
    methodId: 'comparable-pe',
    label: 'P / E',
    warningPath: 'peers.pe',
    subjectPath: 'netIncome',
    numerator: 'equityValue',
    denominator: 'netIncome',
    bridge: 'equity',
  },
];

function trace(
  inputs: ValuationCalculationTrace['inputs'],
  steps: readonly TraceStep[],
): ValuationCalculationTrace {
  return {
    engine: 'valuation',
    valuationRef: 'comparable-valuation@1',
    inputs,
    steps,
  };
}

function clamp(value: Decimal, low: Decimal.Value, high: Decimal.Value): Decimal {
  return AnalysisDecimal.min(AnalysisDecimal.max(value, low), high);
}

function totalAdjustment(input: ComparableValuationInput): Decimal {
  const components = [
    input.adjustments.growth,
    input.adjustments.profitability,
    input.adjustments.size,
    input.adjustments.liquidity,
  ];
  return clamp(
    components.reduce(
      (total, component) => total.plus(clamp(new AnalysisDecimal(component), '-0.5', '0.5')),
      new AnalysisDecimal(0),
    ),
    '-0.5',
    '0.5',
  );
}

function samplesFor(
  peers: readonly ComparablePeer[],
  definition: MultipleDefinition,
): readonly MultipleSample[] {
  return peers
    .filter((peer) => new AnalysisDecimal(peer[definition.denominator]).greaterThan(0))
    .map((peer) => ({
      companyId: peer.companyId.trim().toLowerCase(),
      multiple: new AnalysisDecimal(peer[definition.numerator])
        .dividedBy(peer[definition.denominator]),
    }))
    .sort((left, right) => {
      const comparison = left.multiple.comparedTo(right.multiple);
      return comparison === 0
        ? left.companyId.localeCompare(right.companyId)
        : comparison;
    });
}

function quantile(
  samples: readonly MultipleSample[],
  probability: Decimal.Value,
): Decimal {
  const position = new AnalysisDecimal(samples.length - 1).times(probability);
  const lowerIndex = position.floor().toNumber();
  const upperIndex = position.ceil().toNumber();
  const gamma = position.minus(lowerIndex);
  const lower = samples[lowerIndex]!.multiple;
  const upper = samples[upperIndex]!.multiple;
  return lower.plus(upper.minus(lower).times(gamma));
}

function quantileRange(samples: readonly MultipleSample[]): DecimalRangeInput {
  return {
    low: canonicalDecimal(quantile(samples, '0.25')),
    midpoint: canonicalDecimal(quantile(samples, '0.5')),
    high: canonicalDecimal(quantile(samples, '0.75')),
  };
}

function adjustedRange(
  raw: DecimalRangeInput,
  adjustment: Decimal,
): DecimalRangeInput {
  const factor = new AnalysisDecimal(1).plus(adjustment);
  return {
    low: canonicalDecimal(new AnalysisDecimal(raw.low).times(factor)),
    midpoint: canonicalDecimal(new AnalysisDecimal(raw.midpoint).times(factor)),
    high: canonicalDecimal(new AnalysisDecimal(raw.high).times(factor)),
  };
}

function equityRange(
  multipleRange: DecimalRangeInput,
  subjectValue: DecimalString,
  netDebt: Decimal,
  definition: MultipleDefinition,
  input: ComparableValuationInput,
): ComparableMethodResult['range'] {
  const calculate = (multiple: DecimalString): DecimalString => {
    const indicated = new AnalysisDecimal(subjectValue).times(multiple);
    const equity = definition.bridge === 'enterprise-to-equity'
      ? indicated.minus(netDebt)
      : indicated;
    return canonicalDecimal(equity);
  };
  return {
    low: calculate(multipleRange.low),
    midpoint: calculate(multipleRange.midpoint),
    high: calculate(multipleRange.high),
    currency: input.currency,
    valuationDate: input.valuationDate,
    basis: 'pre-money-equity',
  };
}

function insufficientWarning(
  definition: MultipleDefinition,
  available: number,
): EngineIssue {
  return {
    code: 'insufficient_comparables',
    path: definition.warningPath,
    message: `${definition.label} requires at least three valid peers.`,
    details: { available, required: 3 },
  };
}

function subjectWarning(definition: MultipleDefinition): EngineIssue {
  return {
    code: 'non_positive_denominator',
    path: `subject.${definition.subjectPath}`,
    message: `${definition.label} is not meaningful for a non-positive subject metric.`,
    details: { methodId: definition.methodId },
  };
}

export function calculateComparableValuation(
  input: unknown,
): ValuationEngineResult<ComparableValuationResult> {
  const validation = validateComparableInput(input);
  if (validation.status === 'blocked') {
    return blockedResult(
      validation.reason,
      validation.issues,
      trace(validation.traceInputs, []),
    );
  }

  const normalized = validation.input;
  const adjustment = totalAdjustment(normalized);
  const netDebt = new AnalysisDecimal(normalized.subject.interestBearingDebt)
    .minus(normalized.subject.cashAndCashEquivalents);
  const methods: ComparableMethodResult[] = [];
  const warnings: EngineIssue[] = [...validation.warnings];
  const steps: TraceStep[] = [];

  for (const definition of definitions) {
    const subjectValue = normalized.subject[definition.subjectPath];
    if (!new AnalysisDecimal(subjectValue).greaterThan(0)) {
      warnings.push(subjectWarning(definition));
      continue;
    }

    const samples = samplesFor(normalized.peers, definition);
    if (samples.length < 3) {
      warnings.push(insufficientWarning(definition, samples.length));
      continue;
    }

    const rawMultipleRange = quantileRange(samples);
    const adjustedMultipleRange = adjustedRange(rawMultipleRange, adjustment);
    const range = equityRange(
      adjustedMultipleRange,
      subjectValue,
      netDebt,
      definition,
      normalized,
    );
    methods.push({
      methodId: definition.methodId,
      label: definition.label,
      validSampleCount: samples.length,
      rawMultipleRange,
      totalAdjustment: canonicalDecimal(adjustment),
      adjustedMultipleRange,
      range,
    });
    steps.push({
      id: `comparable:${definition.methodId}:quantiles`,
      operator: 'type-7-quantiles',
      operands: samples.map(({ companyId, multiple }) =>
        `${companyId}:${canonicalDecimal(multiple)}`
      ),
      result: rawMultipleRange.midpoint,
      rule: 'p25-median-p75',
      outcome: 'passed',
    });
    steps.push({
      id: `comparable:${definition.methodId}:equity-range`,
      operator: definition.bridge,
      operands: [
        subjectValue,
        adjustedMultipleRange.low,
        adjustedMultipleRange.midpoint,
        adjustedMultipleRange.high,
        canonicalDecimal(netDebt),
      ],
      result: range.midpoint,
      outcome: 'passed',
    });
  }

  if (methods.length === 0) {
    const onlyInsufficient = warnings.length > 0 &&
      warnings.every(({ code }) => code === 'insufficient_comparables');
    return blockedResult(
      onlyInsufficient ? 'insufficient-data' : 'not-meaningful',
      warnings,
      trace(validation.traceInputs, steps),
    );
  }

  const footballField: FootballFieldRow[] = methods.map((method) => ({
    methodId: method.methodId,
    label: method.label,
    low: method.range.low,
    midpoint: method.range.midpoint,
    high: method.range.high,
  }));

  return okResult(
    {
      version: normalized.version,
      methods,
      footballField,
    },
    warnings,
    trace(validation.traceInputs, steps),
  );
}
