import type Decimal from 'decimal.js';
import {
  AnalysisDecimal,
  canonicalDecimal,
  parseDecimalString,
  parseMultipleString,
  parseNonNegativeRateString,
  parseSignedRateString,
  parseUnitIntervalString,
} from '../../domain/analysis/decimal';
import type { EngineIssue } from '../../domain/analysis/engine-result';
import type { AsOfPeriod, FlowPeriod } from '../../domain/analysis/period';
import { validateAnalysisPeriodValue } from '../../domain/analysis/period';
import type { AnalysisUnit, MetricValue } from '../../domain/analysis/value';
import { DomainContractError } from '../../domain/analysis/value';
import { deepFreeze } from '../../domain/deep-freeze';
import type {
  CalculationPeriod,
  EffectivePeriodSpan,
  FormulaDefinition,
  FormulaNumericDomain,
  FormulaOperandSpec,
} from './formula-types';

export type FormulaValidationStage =
  | 'missing'
  | 'decimal-range'
  | 'unit-currency-period';

export type FormulaInputConflict =
  | { readonly status: 'none' | 'resolved' }
  | { readonly status: 'blocking' }
  | {
      readonly status: 'conservative-selected';
      readonly selectionReason: string;
    };

export interface ValidatedFormulaObservation {
  readonly valueRef: string;
  readonly metricId: string;
  readonly value: MetricValue;
  readonly period: FlowPeriod | AsOfPeriod;
  readonly sourceRefs: readonly string[];
  readonly conflict: FormulaInputConflict;
  readonly label?: string;
}

export interface ValidatedFormulaInput {
  readonly spec: FormulaOperandSpec;
  readonly observation: ValidatedFormulaObservation;
  /** Canonical decimal string. Decimal instances never cross this public boundary. */
  readonly value: string;
}

export type FormulaInputValidation =
  | {
      readonly status: 'valid';
      readonly inputs: readonly ValidatedFormulaInput[];
      readonly warnings: readonly EngineIssue[];
      readonly derivedOperands: Readonly<Record<string, string>>;
      readonly currency?: string;
      readonly effectivePeriod: CalculationPeriod;
      readonly periodRefs: readonly string[];
    }
  | {
      readonly status: 'blocked';
      readonly reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful';
      readonly issue: EngineIssue;
    };

export type FormulaInputStageValidation =
  | FormulaInputValidation
  | { readonly status: 'continue' };

interface SnapshotContext {
  readonly active: WeakSet<object>;
  readonly memo: WeakMap<object, object>;
  nodeCount: number;
}

interface PreparedInputs {
  readonly observations: readonly ValidatedFormulaObservation[];
  readonly byMetricId: ReadonlyMap<string, ValidatedFormulaObservation>;
}

interface ParsedInputs {
  readonly byOperandId: ReadonlyMap<string, Decimal>;
}

interface PeriodValidation {
  readonly effectivePeriod: CalculationPeriod;
  readonly derivedOperands: Readonly<Record<string, string>>;
}

type MutableRecord = Record<string, unknown>;

const MAX_DTO_NODES = 16384;
const MAX_DTO_DEPTH = 64;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const CONTINUE = deepFreeze({ status: 'continue' as const });
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

function invalidDto(): never {
  throw new DomainContractError('invalid_dto');
}

function issue(
  code: EngineIssue['code'],
  definition: FormulaDefinition,
  operand: FormulaOperandSpec | undefined,
  details: Readonly<Record<string, string | number | boolean | null>> = {},
): EngineIssue {
  const operandId = operand?.operandId;
  return {
    code,
    path: operandId === undefined
      ? `formula.${definition.formulaId}`
      : `formula.${definition.formulaId}.operands.${operandId}`,
    message: operandId === undefined
      ? `${definition.formulaId}: ${code}`
      : `${definition.formulaId}.${operandId}: ${code}`,
    details: {
      formulaId: definition.formulaId,
      ...(operandId === undefined ? {} : { operandId, metricId: operand!.metricId }),
      ...details,
    },
  };
}

function blocked(
  reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful',
  engineIssue: EngineIssue,
): Extract<FormulaInputValidation, { readonly status: 'blocked' }> {
  return deepFreeze({ status: 'blocked' as const, reason, issue: engineIssue });
}

function snapshotJsonDto(input: unknown): unknown {
  try {
    return snapshotJsonValue(input, {
      active: new WeakSet<object>(),
      memo: new WeakMap<object, object>(),
      nodeCount: 0,
    }, 0);
  } catch {
    return invalidDto();
  }
}

function snapshotJsonValue(
  value: unknown,
  context: SnapshotContext,
  depth: number,
): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : invalidDto();
  }
  if (typeof value !== 'object' || depth > MAX_DTO_DEPTH) return invalidDto();
  if (context.active.has(value)) return invalidDto();
  const cached = context.memo.get(value);
  if (cached !== undefined) return cached;

  context.nodeCount += 1;
  if (context.nodeCount > MAX_DTO_NODES) return invalidDto();

  context.active.add(value);
  try {
    return Array.isArray(value)
      ? snapshotArray(value, context, depth)
      : snapshotObject(value, context, depth);
  } finally {
    context.active.delete(value);
  }
}

function snapshotArray(
  value: unknown[],
  context: SnapshotContext,
  depth: number,
): unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) return invalidDto();
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
  const keys = Reflect.ownKeys(value);
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    keys.length !== lengthDescriptor.value + 1
  ) return invalidDto();

  const output: unknown[] = [];
  context.memo.set(value, output);
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return invalidDto();
    }
    output.push(snapshotJsonValue(descriptor.value, context, depth + 1));
  }
  return output;
}

function snapshotObject(
  value: object,
  context: SnapshotContext,
  depth: number,
): MutableRecord {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidDto();
  const output = Object.create(null) as MutableRecord;
  context.memo.set(value, output);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return invalidDto();
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return invalidDto();
    }
    Object.defineProperty(output, key, {
      value: snapshotJsonValue(descriptor.value, context, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return output;
}

function asRecord(value: unknown): MutableRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as MutableRecord
    : invalidDto();
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalidDto();
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : invalidDto();
}

function exactKeys(record: MutableRecord, required: readonly string[], optional: readonly string[] = []): void {
  const keys = Object.keys(record);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) invalidDto();
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function parseStringArray(value: unknown): readonly string[] {
  const values = asArray(value);
  return values
    .map((item) => asString(item))
    .sort(compareUnicodeCodePoints);
}

function parseUnit(value: unknown): AnalysisUnit {
  const record = asRecord(value);
  const kind = asString(record.kind);
  switch (kind) {
    case 'currency': {
      exactKeys(record, ['kind', 'currency']);
      const currency = asString(record.currency);
      return CURRENCY_PATTERN.test(currency) ? { kind, currency } : invalidDto();
    }
    case 'ratio': {
      exactKeys(record, ['kind', 'rateKind']);
      const rateKind = asString(record.rateKind);
      if (
        rateKind !== 'unit-interval' && rateKind !== 'non-negative-rate' &&
        rateKind !== 'signed-rate' && rateKind !== 'return-rate'
      ) return invalidDto();
      return { kind, rateKind };
    }
    case 'multiple':
      exactKeys(record, ['kind']);
      return { kind };
    case 'duration': {
      exactKeys(record, ['kind', 'durationUnit']);
      const durationUnit = asString(record.durationUnit);
      if (durationUnit !== 'months' && durationUnit !== 'days' && durationUnit !== 'years') {
        return invalidDto();
      }
      return { kind, durationUnit };
    }
    case 'count': {
      exactKeys(record, ['kind', 'countKind']);
      return { kind, countKind: parseCountKind(record.countKind) };
    }
    case 'currency-per-count': {
      exactKeys(record, ['kind', 'currency', 'countKind'], ['perPeriod']);
      const currency = asString(record.currency);
      if (!CURRENCY_PATTERN.test(currency)) return invalidDto();
      const countKind = parseCountKind(record.countKind);
      if (!Object.hasOwn(record, 'perPeriod')) return { kind, currency, countKind };
      const perPeriod = asString(record.perPeriod);
      if (perPeriod !== 'month' && perPeriod !== 'year') return invalidDto();
      return { kind, currency, countKind, perPeriod };
    }
    default:
      return invalidDto();
  }
}

function parseCountKind(value: unknown): 'customer' | 'user' | 'unit' | 'share' | 'order' {
  const countKind = asString(value);
  if (
    countKind !== 'customer' && countKind !== 'user' && countKind !== 'unit' &&
    countKind !== 'share' && countKind !== 'order'
  ) return invalidDto();
  return countKind;
}

function parsePeriod(value: unknown): FlowPeriod | AsOfPeriod {
  const record = asRecord(value);
  const kind = asString(record.kind);
  if (kind === 'as-of') {
    exactKeys(record, ['kind', 'id', 'date']);
    return { kind, id: asString(record.id), date: asString(record.date) };
  }
  if (kind !== 'flow') return invalidDto();
  exactKeys(record, ['kind', 'id', 'startDate', 'endDate', 'durationMonths', 'granularity']);
  const durationMonths = record.durationMonths;
  if (typeof durationMonths !== 'number') return invalidDto();
  const granularity = asString(record.granularity);
  if (granularity !== 'month' && granularity !== 'year') return invalidDto();
  return {
    kind,
    id: asString(record.id),
    startDate: asString(record.startDate),
    endDate: asString(record.endDate),
    durationMonths,
    granularity,
  };
}

function parseConflict(value: unknown): FormulaInputConflict {
  const record = asRecord(value);
  const status = asString(record.status);
  if (status === 'conservative-selected') {
    exactKeys(record, ['status', 'selectionReason']);
    const selectionReason = asString(record.selectionReason);
    if (selectionReason.length === 0) return invalidDto();
    return { status, selectionReason };
  }
  if (status !== 'none' && status !== 'resolved' && status !== 'blocking') {
    return invalidDto();
  }
  exactKeys(record, ['status']);
  return { status };
}

function parseObservation(value: unknown): ValidatedFormulaObservation {
  const record = asRecord(value);
  exactKeys(
    record,
    ['valueRef', 'metricId', 'value', 'period', 'sourceRefs', 'conflict'],
    ['label'],
  );
  const metricValue = asRecord(record.value);
  exactKeys(metricValue, ['value', 'unit']);
  const label = Object.hasOwn(record, 'label') ? asString(record.label) : undefined;
  return {
    valueRef: asString(record.valueRef),
    metricId: asString(record.metricId),
    value: { value: asString(metricValue.value), unit: parseUnit(metricValue.unit) },
    period: parsePeriod(record.period),
    sourceRefs: parseStringArray(record.sourceRefs),
    conflict: parseConflict(record.conflict),
    ...(label === undefined ? {} : { label }),
  };
}

function prepareInputs(input: unknown): PreparedInputs {
  const snapshot = asArray(snapshotJsonDto(input));
  const observations = snapshot.map(parseObservation);
  const byMetricId = new Map<string, ValidatedFormulaObservation>();
  for (const observation of observations) {
    if (byMetricId.has(observation.metricId)) return invalidDto();
    byMetricId.set(observation.metricId, observation);
  }
  return { observations, byMetricId };
}

export function prepareFormulaObservations(
  input: unknown,
): readonly ValidatedFormulaObservation[] {
  return deepFreeze(prepareInputs(input).observations);
}

function missingStage(
  definition: FormulaDefinition,
  prepared: PreparedInputs,
): FormulaInputStageValidation {
  for (const operand of definition.operands) {
    if (!prepared.byMetricId.has(operand.metricId)) {
      return blocked('insufficient-data', issue('missing_input', definition, operand));
    }
  }
  return CONTINUE;
}

function parsePresentDecimals(
  definition: FormulaDefinition,
  prepared: PreparedInputs,
): ParsedInputs | Extract<FormulaInputValidation, { readonly status: 'blocked' }> {
  const byOperandId = new Map<string, Decimal>();
  for (const operand of definition.operands) {
    const observation = prepared.byMetricId.get(operand.metricId);
    if (observation === undefined) continue;
    try {
      byOperandId.set(operand.operandId, parseDecimalString(observation.value.value));
    } catch {
      return blocked('invalid-input', issue('invalid_decimal', definition, operand, {
        valueRef: observation.valueRef,
      }));
    }
  }
  return { byOperandId };
}

function parseNumericDomain(value: string, domain: FormulaNumericDomain): Decimal {
  switch (domain) {
    case 'decimal':
      return parseDecimalString(value);
    case 'unit-interval':
      return parseUnitIntervalString(value);
    case 'non-negative-rate':
      return parseNonNegativeRateString(value);
    case 'signed-rate':
      return parseSignedRateString(value);
    case 'multiple':
      return parseMultipleString(value);
  }
}

function decimalRangeStage(
  definition: FormulaDefinition,
  prepared: PreparedInputs,
): FormulaInputStageValidation {
  const parsed = parsePresentDecimals(definition, prepared);
  if ('status' in parsed) return parsed;

  for (const operand of definition.operands) {
    const value = parsed.byOperandId.get(operand.operandId);
    const observation = prepared.byMetricId.get(operand.metricId);
    if (value === undefined || observation === undefined) continue;
    try {
      parseNumericDomain(observation.value.value, operand.numericDomain);
    } catch {
      return blocked('invalid-input', issue('value_out_of_range', definition, operand));
    }
    if (operand.nonNegative === true && value.isNegative()) {
      return blocked('invalid-input', issue('value_out_of_range', definition, operand));
    }
    if (operand.notGreaterThanOperand !== undefined) {
      const upper = parsed.byOperandId.get(operand.notGreaterThanOperand);
      if (upper !== undefined && value.greaterThan(upper)) {
        return blocked('invalid-input', issue('value_out_of_range', definition, operand, {
          notGreaterThanOperand: operand.notGreaterThanOperand,
        }));
      }
    }
  }

  for (const constraint of definition.constraints ?? []) {
    const left = sumOperands(constraint.left, parsed.byOperandId);
    const right = sumOperands(constraint.right, parsed.byOperandId);
    if (left !== undefined && right !== undefined && left.greaterThan(right)) {
      return blocked('invalid-input', issue('value_out_of_range', definition, undefined, {
        constraint: constraint.kind,
      }));
    }
  }
  return CONTINUE;
}

function sumOperands(ids: readonly string[], values: ReadonlyMap<string, Decimal>): Decimal | undefined {
  let sum = new AnalysisDecimal(0);
  for (const id of ids) {
    const value = values.get(id);
    if (value === undefined) return undefined;
    sum = sum.plus(value);
  }
  return sum;
}

function unitStructureMatches(actual: AnalysisUnit, expected: AnalysisUnit): boolean {
  if (actual.kind !== expected.kind) return false;
  switch (expected.kind) {
    case 'currency':
      return true;
    case 'currency-per-count':
      return actual.kind === 'currency-per-count' &&
        actual.countKind === expected.countKind && actual.perPeriod === expected.perPeriod;
    case 'count':
      return actual.kind === 'count' && actual.countKind === expected.countKind;
    case 'ratio':
      return actual.kind === 'ratio' && actual.rateKind === expected.rateKind;
    case 'duration':
      return actual.kind === 'duration' && actual.durationUnit === expected.durationUnit;
    case 'multiple':
      return actual.kind === 'multiple';
  }
}

function currencyOf(unit: AnalysisUnit): string | undefined {
  return unit.kind === 'currency' || unit.kind === 'currency-per-count'
    ? unit.currency
    : undefined;
}

function unitCurrencyPeriodStage(
  definition: FormulaDefinition,
  prepared: PreparedInputs,
): FormulaInputStageValidation {
  const present: Array<readonly [FormulaOperandSpec, ValidatedFormulaObservation]> = [];
  for (const operand of definition.operands) {
    const observation = prepared.byMetricId.get(operand.metricId);
    if (observation === undefined) continue;
    present.push([operand, observation]);
    if (!unitStructureMatches(observation.value.unit, operand.expectedUnit)) {
      return blocked('invalid-input', issue('unit_mismatch', definition, operand));
    }
  }

  let currency: string | undefined;
  for (const [operand, observation] of present) {
    const candidate = currencyOf(observation.value.unit);
    if (candidate === undefined) continue;
    if (currency === undefined) currency = candidate;
    else if (currency !== candidate) {
      return blocked('invalid-input', issue('currency_mismatch', definition, operand, {
        expectedCurrency: currency,
        actualCurrency: candidate,
      }));
    }
  }

  if (present.length !== definition.operands.length) return CONTINUE;
  const periodValidation = validatePeriods(definition, present);
  if (periodValidation === undefined) {
    return blocked('invalid-input', issue('period_mismatch', definition, undefined));
  }

  for (const [operand, observation] of present) {
    if (observation.conflict.status === 'blocking') {
      return blocked('invalid-input', issue('unresolved_conflict', definition, operand, {
        valueRef: observation.valueRef,
      }));
    }
  }

  return CONTINUE;
}

function buildValid(
  definition: FormulaDefinition,
  prepared: PreparedInputs,
): Extract<FormulaInputValidation, { readonly status: 'valid' }> {
  const present = definition.operands.map((spec) => [
    spec,
    prepared.byMetricId.get(spec.metricId)!,
  ] as const);
  const parsed = parsePresentDecimals(definition, prepared);
  if ('status' in parsed) return invalidDto();
  const periodValidation = validatePeriods(definition, present);
  if (periodValidation === undefined) return invalidDto();

  const warnings: EngineIssue[] = [];
  for (const [operand, observation] of present) {
    if (observation.conflict.status === 'conservative-selected') {
      warnings.push(issue('unresolved_conflict', definition, operand, {
        valueRef: observation.valueRef,
        selectionReason: observation.conflict.selectionReason,
      }));
    }
  }
  const inputs = present.map(([spec, observation]) => ({
    spec: cloneOperandSpec(spec),
    observation,
    value: canonicalDecimal(parsed.byOperandId.get(spec.operandId)!),
  }));
  const periodRefs = Array.from(new Set(present.map(([, observation]) => observation.period.id)));
  const currency = present
    .map(([, observation]) => currencyOf(observation.value.unit))
    .find((candidate) => candidate !== undefined);
  return deepFreeze({
    status: 'valid' as const,
    inputs,
    warnings,
    derivedOperands: periodValidation.derivedOperands,
    ...(currency === undefined ? {} : { currency }),
    effectivePeriod: periodValidation.effectivePeriod,
    periodRefs,
  });
}

function cloneOperandSpec(spec: FormulaOperandSpec): FormulaOperandSpec {
  return {
    operandId: spec.operandId,
    metricId: spec.metricId,
    expectedUnit: { ...spec.expectedUnit },
    periodRole: spec.periodRole,
    numericDomain: spec.numericDomain,
    ...(spec.nonNegative === undefined ? {} : { nonNegative: spec.nonNegative }),
    ...(spec.notGreaterThanOperand === undefined ? {} : {
      notGreaterThanOperand: spec.notGreaterThanOperand,
    }),
  };
}

function validatePeriods(
  definition: FormulaDefinition,
  present: readonly (readonly [FormulaOperandSpec, ValidatedFormulaObservation])[],
): PeriodValidation | undefined {
  for (const [, observation] of present) {
    if (validateAnalysisPeriodValue(observation.period).status !== 'valid') return undefined;
  }
  switch (definition.periodRule) {
    case 'same-flow-period':
      return validateSameFlow(present);
    case 'same-as-of':
      return validateSameAsOf(present);
    case 'ordered-as-of-endpoints':
      return validateOrderedEndpoints(definition, present);
    case 'mixed-stock-flow':
      return validateMixed(definition, present);
  }
}

function validateSameFlow(
  present: readonly (readonly [FormulaOperandSpec, ValidatedFormulaObservation])[],
): PeriodValidation | undefined {
  let reference: FlowPeriod | undefined;
  for (const [operand, observation] of present) {
    const period = observation.period;
    if (period.kind !== 'flow') return undefined;
    if (operand.periodRole !== 'flow' && operand.periodRole !== 'representative-month') return undefined;
    if (
      operand.periodRole === 'representative-month' &&
      (period.granularity !== 'month' || period.durationMonths !== 1)
    ) return undefined;
    if (reference === undefined) reference = period;
    else if (!sameFlowPeriod(reference, period)) return undefined;
  }
  return reference === undefined ? undefined : {
    effectivePeriod: spanFromFlow(reference),
    derivedOperands: {},
  };
}

function validateSameAsOf(
  present: readonly (readonly [FormulaOperandSpec, ValidatedFormulaObservation])[],
): PeriodValidation | undefined {
  let reference: AsOfPeriod | undefined;
  for (const [operand, observation] of present) {
    if (operand.periodRole !== 'as-of' || observation.period.kind !== 'as-of') return undefined;
    if (reference === undefined) reference = observation.period;
    else if (!sameAsOfPeriod(reference, observation.period)) return undefined;
  }
  return reference === undefined ? undefined : {
    effectivePeriod: { ...reference },
    derivedOperands: {},
  };
}

function validateOrderedEndpoints(
  definition: FormulaDefinition,
  present: readonly (readonly [FormulaOperandSpec, ValidatedFormulaObservation])[],
): PeriodValidation | undefined {
  const begin = present.find(([operand]) => operand.periodRole === 'as-of-begin')?.[1].period;
  const end = present.find(([operand]) => operand.periodRole === 'as-of-end')?.[1].period;
  if (begin?.kind !== 'as-of' || end?.kind !== 'as-of') return undefined;
  const startDate = nextUtcDay(begin.date);
  if (startDate === undefined || compareIsoDates(begin.date, end.date) >= 0) return undefined;
  const durationMonths = endpointDurationMonths(begin.date, end.date);
  if (durationMonths === undefined || !durationMonths.isPositive()) return undefined;
  const canonicalMonths = canonicalDecimal(durationMonths);
  const normalizedMonths = parseDecimalString(canonicalMonths);
  const derivedOperands: Readonly<Record<string, string>> =
    definition.formulaId === 'revenue_cagr'
      ? { __duration_years: canonicalDecimal(normalizedMonths.dividedBy(12)) }
      : {};
  return {
    effectivePeriod: {
      kind: 'span',
      startDate,
      endDate: end.date,
      durationMonths: normalizedMonths.toNumber(),
    },
    derivedOperands,
  };
}

function validateMixed(
  definition: FormulaDefinition,
  present: readonly (readonly [FormulaOperandSpec, ValidatedFormulaObservation])[],
): PeriodValidation | undefined {
  let referenceFlow: FlowPeriod | undefined;
  for (const [operand, observation] of present) {
    if (operand.periodRole === 'flow' || operand.periodRole === 'representative-month') {
      if (observation.period.kind !== 'flow') return undefined;
      if (
        operand.periodRole === 'representative-month' &&
        (observation.period.granularity !== 'month' || observation.period.durationMonths !== 1)
      ) return undefined;
      if (referenceFlow === undefined) referenceFlow = observation.period;
      else if (!sameFlowPeriod(referenceFlow, observation.period)) return undefined;
    }
  }
  if (referenceFlow === undefined) return undefined;

  for (const [operand, observation] of present) {
    if (operand.periodRole === 'flow' || operand.periodRole === 'representative-month') continue;
    if (observation.period.kind !== 'as-of') return undefined;
    if (
      operand.periodRole === 'as-of-begin' &&
      compareIsoDates(observation.period.date, referenceFlow.startDate) >= 0
    ) return undefined;
    if (
      (operand.periodRole === 'as-of-end' || operand.periodRole === 'as-of') &&
      observation.period.date !== referenceFlow.endDate
    ) return undefined;
  }

  const derivedOperands: Readonly<Record<string, string>> =
    definition.formulaId === 'inventory_turnover_days'
      ? { __period_days: String(inclusiveDayCount(referenceFlow.startDate, referenceFlow.endDate)) }
      : {};
  return {
    effectivePeriod: spanFromFlow(referenceFlow),
    derivedOperands,
  };
}

function sameFlowPeriod(left: FlowPeriod, right: FlowPeriod): boolean {
  return left.kind === right.kind && left.id === right.id &&
    left.startDate === right.startDate && left.endDate === right.endDate &&
    left.durationMonths === right.durationMonths && left.granularity === right.granularity;
}

function sameAsOfPeriod(left: AsOfPeriod, right: AsOfPeriod): boolean {
  return left.kind === right.kind && left.id === right.id && left.date === right.date;
}

function spanFromFlow(period: FlowPeriod): EffectivePeriodSpan {
  return {
    kind: 'span',
    startDate: period.startDate,
    endDate: period.endDate,
    durationMonths: period.durationMonths,
  };
}

function parseUtcDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return undefined;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]) ? date : undefined;
}

function formatUtcDate(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function nextUtcDay(value: string): string | undefined {
  const date = parseUtcDate(value);
  if (date === undefined) return undefined;
  date.setUTCDate(date.getUTCDate() + 1);
  return formatUtcDate(date);
}

function compareIsoDates(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function daysInUtcMonth(date: Date): number {
  const lastDay = new Date(0);
  lastDay.setUTCHours(0, 0, 0, 0);
  lastDay.setUTCFullYear(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  lastDay.setUTCDate(0);
  return lastDay.getUTCDate();
}

function addUtcMonthsClamped(date: Date, months: number): Date {
  const target = new Date(0);
  target.setUTCHours(0, 0, 0, 0);
  target.setUTCFullYear(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
  target.setUTCDate(Math.min(date.getUTCDate(), daysInUtcMonth(target)));
  return target;
}

function utcDayDistance(begin: Date, end: Date): number {
  return (end.getTime() - begin.getTime()) / DAY_MILLISECONDS;
}

function endpointDurationMonths(
  beginValue: string,
  endValue: string,
): Decimal | undefined {
  const begin = parseUtcDate(beginValue);
  const end = parseUtcDate(endValue);
  if (begin === undefined || end === undefined || begin.getTime() >= end.getTime()) {
    return undefined;
  }

  let wholeMonths = (end.getUTCFullYear() - begin.getUTCFullYear()) * 12 +
    end.getUTCMonth() - begin.getUTCMonth();
  let anchor = addUtcMonthsClamped(begin, wholeMonths);
  if (anchor.getTime() > end.getTime()) {
    wholeMonths -= 1;
    anchor = addUtcMonthsClamped(begin, wholeMonths);
  }
  const nextAnchor = addUtcMonthsClamped(begin, wholeMonths + 1);
  const intervalDays = utcDayDistance(anchor, nextAnchor);
  const fractionalDays = utcDayDistance(anchor, end);
  return new AnalysisDecimal(wholeMonths).plus(
    new AnalysisDecimal(fractionalDays).dividedBy(intervalDays),
  );
}

function inclusiveDayCount(startValue: string, endValue: string): number {
  const start = parseUtcDate(startValue)!;
  const end = parseUtcDate(endValue)!;
  return Math.round((end.getTime() - start.getTime()) / DAY_MILLISECONDS) + 1;
}

function runStage(
  definition: FormulaDefinition,
  prepared: PreparedInputs,
  stage: FormulaValidationStage,
): FormulaInputStageValidation {
  switch (stage) {
    case 'missing':
      return missingStage(definition, prepared);
    case 'decimal-range':
      return decimalRangeStage(definition, prepared);
    case 'unit-currency-period':
      return unitCurrencyPeriodStage(definition, prepared);
  }
}

export function validateFormulaInputStage(
  definition: FormulaDefinition,
  observations: unknown,
  stage: FormulaValidationStage,
): FormulaInputStageValidation {
  return runStage(definition, prepareInputs(observations), stage);
}

export function validateFormulaInputs(
  definition: FormulaDefinition,
  observations: unknown,
): FormulaInputValidation {
  const prepared = prepareInputs(observations);
  for (const stage of ['missing', 'decimal-range', 'unit-currency-period'] as const) {
    const result = runStage(definition, prepared, stage);
    if (result.status !== 'continue') return result;
  }
  return buildValid(definition, prepared);
}
