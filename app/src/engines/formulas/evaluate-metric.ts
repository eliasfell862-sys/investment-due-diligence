import type Decimal from 'decimal.js';
import type { CalculationTrace, TraceInput, TraceStep } from '../../domain/analysis/calculation-trace';
import {
  AnalysisDecimal,
  parseDecimalString,
  parseMultipleString,
  parseNonNegativeRateString,
  parseSignedRateString,
  parseUnitIntervalString,
} from '../../domain/analysis/decimal';
import {
  blockedResult,
  okResult,
  type EngineIssue,
  type EngineResult,
} from '../../domain/analysis/engine-result';
import type { AnalysisUnit, MetricValue } from '../../domain/analysis/value';
import { DomainContractError } from '../../domain/analysis/value';
import { deepFreeze } from '../../domain/deep-freeze';
import { evaluateAst } from './evaluate-ast';
import { FORMULA_IDS, resolveFormulaDefinition } from './formula-registry';
import type {
  CalculationPeriod,
  FormulaAst,
  FormulaDefinition,
  FormulaNumericDomain,
  MetricCalculation,
  MetricEvaluationInput,
} from './formula-types';
import {
  validateFormulaInputs,
  validateFormulaInputStage,
  type FormulaInputValidation,
  type ValidatedFormulaInput,
} from './validate-formula-inputs';

export type FormulaSuccess = Extract<EngineResult<MetricCalculation>, { status: 'ok' }>;

export interface FormulaEvaluationSession {
  evaluate(formulaId: string, version: string): EngineResult<MetricCalculation>;
  completedResults(): readonly FormulaSuccess[];
}

type Validated = Extract<FormulaInputValidation, { status: 'valid' }>;
type MutableRecord = Record<string, unknown>;

interface SnapshotContext {
  readonly active: WeakSet<object>;
  readonly memo: WeakMap<object, object>;
  nodeCount: number;
}

interface Closure {
  readonly definitions: readonly FormulaDefinition[];
  readonly byRef: ReadonlyMap<string, FormulaDefinition>;
}

const MAX_DTO_NODES = 4096;
const MAX_DTO_DEPTH = 64;
const MAX_FORMULA_DEPTH = 48;
const MAX_FORMULA_NODES = 512;
const VALIDATION_STAGES = [
  'missing',
  'decimal-range',
  'unit-currency-period',
] as const;

function invalidDto(): never {
  throw new DomainContractError('invalid_dto');
}

function invalidDefinition(): never {
  throw new DomainContractError('invalid_formula_definition');
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
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : invalidDto();
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
  const length = Reflect.getOwnPropertyDescriptor(value, 'length');
  const keys = Reflect.ownKeys(value);
  if (
    length === undefined || !('value' in length) ||
    typeof length.value !== 'number' || !Number.isInteger(length.value) || length.value < 0 ||
    keys.length !== length.value + 1
  ) return invalidDto();

  const output: unknown[] = [];
  context.memo.set(value, output);
  for (let index = 0; index < length.value; index += 1) {
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

function snapshotRequest(input: unknown): MetricEvaluationInput {
  const snapshot = snapshotJsonDto(input);
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return invalidDto();
  const record = snapshot as MutableRecord;
  const keys = Object.keys(record);
  if (
    keys.length !== 3 ||
    !Object.hasOwn(record, 'formulaId') ||
    !Object.hasOwn(record, 'version') ||
    !Object.hasOwn(record, 'observations') ||
    typeof record.formulaId !== 'string' ||
    typeof record.version !== 'string' ||
    !Array.isArray(record.observations)
  ) return invalidDto();
  return record as unknown as MetricEvaluationInput;
}

function snapshotObservations(input: unknown): readonly unknown[] {
  const snapshot = snapshotJsonDto(input);
  return Array.isArray(snapshot) ? deepFreeze(snapshot) : invalidDto();
}

function formulaRef(definition: Pick<FormulaDefinition, 'formulaId' | 'version'>): string {
  return `${definition.formulaId}@${definition.version}`;
}

function emptyTrace(reference: string): CalculationTrace {
  return { engine: 'formula', formulaRef: reference, inputs: [], steps: [] };
}

function issue(
  code: EngineIssue['code'],
  reference: string,
  details: Readonly<Record<string, string | number | boolean | null>> = {},
): EngineIssue {
  return {
    code,
    path: `formula.${reference}`,
    message: `${reference}: ${code}`,
    details,
  };
}

function unsupported(formulaId: string, version: string): EngineResult<MetricCalculation> {
  const reference = `${formulaId}@${version}`;
  return blockedResult('invalid-input', [
    issue('unsupported_formula', reference, { formulaId, version }),
  ], emptyTrace(reference));
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function directReferences(ast: FormulaAst): readonly string[] {
  const references = new Set<string>();
  const pending: Array<{ readonly ast: FormulaAst; readonly depth: number }> = [{ ast, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > MAX_FORMULA_DEPTH || ++nodes > MAX_FORMULA_NODES) return invalidDefinition();
    switch (current.ast.kind) {
      case 'literal':
      case 'operand':
        break;
      case 'formula-ref':
        references.add(`${current.ast.formulaId}@${current.ast.version}`);
        break;
      case 'add':
      case 'multiply':
        for (let index = current.ast.values.length - 1; index >= 0; index -= 1) {
          pending.push({ ast: current.ast.values[index]!, depth: current.depth + 1 });
        }
        break;
      case 'subtract':
        pending.push({ ast: current.ast.right, depth: current.depth + 1 });
        pending.push({ ast: current.ast.left, depth: current.depth + 1 });
        break;
      case 'divide':
        pending.push({ ast: current.ast.denominator, depth: current.depth + 1 });
        pending.push({ ast: current.ast.numerator, depth: current.depth + 1 });
        break;
      case 'power':
        pending.push({ ast: current.ast.exponent, depth: current.depth + 1 });
        pending.push({ ast: current.ast.base, depth: current.depth + 1 });
        break;
    }
  }
  return [...references];
}

function collectClosure(root: FormulaDefinition): Closure | undefined {
  const byRef = new Map<string, FormulaDefinition>();
  const visiting = new Set<string>();
  let circular = false;

  const visit = (definition: FormulaDefinition, depth: number): void => {
    const reference = formulaRef(definition);
    if (depth > MAX_FORMULA_DEPTH || visiting.has(reference)) {
      circular = true;
      return;
    }
    if (byRef.has(reference)) return;
    visiting.add(reference);
    byRef.set(reference, definition);
    for (const dependencyRef of directReferences(definition.ast)) {
      const separator = dependencyRef.lastIndexOf('@');
      const resolution = resolveFormulaDefinition(
        dependencyRef.slice(0, separator),
        dependencyRef.slice(separator + 1),
      );
      if (resolution.status !== 'supported') return invalidDefinition();
      visit(resolution.definition, depth + 1);
    }
    visiting.delete(reference);
  };

  visit(root, 0);
  if (circular) return undefined;
  const definitions = [
    root,
    ...FORMULA_IDS
      .filter((formulaId) => formulaId !== root.formulaId)
      .map((formulaId) => byRef.get(`${formulaId}@1`))
      .filter((definition): definition is FormulaDefinition => definition !== undefined),
  ];
  return { definitions, byRef };
}

function preflight(
  root: FormulaDefinition,
  closure: Closure,
  observations: readonly unknown[],
): EngineResult<MetricCalculation> | ReadonlyMap<string, Validated> {
  for (const stage of VALIDATION_STAGES) {
    for (const definition of closure.definitions) {
      const result = validateFormulaInputStage(definition, observations, stage);
      if (result.status === 'blocked') {
        return blockedResult(result.reason, [result.issue], emptyTrace(formulaRef(root)));
      }
    }
  }

  const validated = new Map<string, Validated>();
  for (const definition of closure.definitions) {
    const result = validateFormulaInputs(definition, observations);
    if (result.status === 'blocked') {
      return blockedResult(result.reason, [result.issue], emptyTrace(formulaRef(root)));
    }
    validated.set(formulaRef(definition), result);
  }
  return validated;
}

function isEngineResult(
  value: EngineResult<MetricCalculation> | ReadonlyMap<string, Validated>,
): value is EngineResult<MetricCalculation> {
  return !(value instanceof Map);
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  return `{${Object.keys(value as object)
    .sort(compareUnicodeCodePoints)
    .map((key) => `${JSON.stringify(key)}:${stableValue((value as MutableRecord)[key])}`)
    .join(',')}}`;
}

function uniqueWarnings(warnings: readonly EngineIssue[]): readonly EngineIssue[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = stableValue(warning);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cloneUnit(unit: AnalysisUnit, currency: string | undefined): AnalysisUnit {
  switch (unit.kind) {
    case 'currency':
      return currency === undefined ? invalidDefinition() : { kind: unit.kind, currency };
    case 'currency-per-count':
      return currency === undefined ? invalidDefinition() : {
        kind: unit.kind,
        currency,
        countKind: unit.countKind,
        ...(unit.perPeriod === undefined ? {} : { perPeriod: unit.perPeriod }),
      };
    case 'ratio':
      return { kind: unit.kind, rateKind: unit.rateKind };
    case 'multiple':
      return { kind: unit.kind };
    case 'duration':
      return { kind: unit.kind, durationUnit: unit.durationUnit };
    case 'count':
      return { kind: unit.kind, countKind: unit.countKind };
  }
}

function outputDomain(definition: FormulaDefinition): FormulaNumericDomain {
  if (definition.outputNumericDomain !== undefined) return definition.outputNumericDomain;
  switch (definition.outputUnit.kind) {
    case 'ratio':
      switch (definition.outputUnit.rateKind) {
        case 'unit-interval':
          return 'unit-interval';
        case 'non-negative-rate':
          return 'non-negative-rate';
        case 'signed-rate':
        case 'return-rate':
          return 'signed-rate';
      }
    case 'multiple':
      return 'multiple';
    default:
      return 'decimal';
  }
}

function validateOutput(value: string, domain: FormulaNumericDomain): void {
  parseDecimalString(value);
  switch (domain) {
    case 'decimal':
    case 'signed-rate':
      parseSignedRateString(value);
      return;
    case 'unit-interval':
      parseUnitIntervalString(value);
      return;
    case 'non-negative-rate':
      parseNonNegativeRateString(value);
      return;
    case 'multiple':
      parseMultipleString(value);
  }
}

function currencyOf(unit: AnalysisUnit): string | undefined {
  return unit.kind === 'currency' || unit.kind === 'currency-per-count'
    ? unit.currency
    : undefined;
}

function periodsEqual(left: CalculationPeriod, right: CalculationPeriod): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'as-of') return right.kind === 'as-of' && left.date === right.date;
  return right.kind === 'span' &&
    left.startDate === right.startDate &&
    left.endDate === right.endDate &&
    left.durationMonths === right.durationMonths;
}

function dependencyMetadataIssue(
  definition: FormulaDefinition,
  validated: Validated,
  dependency: FormulaSuccess,
): EngineIssue | undefined {
  const actualCurrency = currencyOf(dependency.value.value.unit);
  if (
    validated.currency !== undefined &&
    actualCurrency !== undefined &&
    validated.currency !== actualCurrency
  ) {
    return issue('currency_mismatch', formulaRef(definition), {
      expectedCurrency: validated.currency,
      actualCurrency,
      dependencyFormulaId: dependency.value.formulaId,
    });
  }
  if (!periodsEqual(validated.effectivePeriod, dependency.value.period)) {
    return issue('period_mismatch', formulaRef(definition), {
      dependencyFormulaId: dependency.value.formulaId,
    });
  }
  return undefined;
}

function toTraceInput(input: ValidatedFormulaInput): TraceInput {
  return {
    valueRef: input.observation.valueRef,
    metricId: input.observation.metricId,
    value: input.value,
    unit: { ...input.observation.value.unit },
    periodId: input.observation.period.id,
    sourceRefs: [...input.observation.sourceRefs],
  };
}

function mergeInputs(
  dependencyInputs: readonly TraceInput[],
  currentInputs: readonly ValidatedFormulaInput[],
): readonly TraceInput[] {
  const byRef = new Map<string, TraceInput>();
  for (const input of dependencyInputs) byRef.set(input.valueRef, input);
  for (const input of currentInputs) byRef.set(input.observation.valueRef, toTraceInput(input));
  return [...byRef.values()].sort((left, right) =>
    compareUnicodeCodePoints(left.valueRef, right.valueRef)
  );
}

function prefixSteps(reference: string, steps: readonly TraceStep[]): readonly TraceStep[] {
  return steps.map((step) => ({ ...step, id: `${reference}:${step.id}` }));
}

function decimalMap(values: readonly ValidatedFormulaInput[], derived: Readonly<Record<string, string>>): Map<string, Decimal> {
  const result = new Map<string, Decimal>();
  for (const input of values) {
    result.set(input.spec.operandId, new AnalysisDecimal(parseDecimalString(input.value)));
  }
  for (const [operandId, value] of Object.entries(derived)) {
    result.set(operandId, new AnalysisDecimal(parseDecimalString(value)));
  }
  return result;
}

class FormulaEvaluationSessionImpl implements FormulaEvaluationSession {
  readonly #observations: readonly unknown[];
  readonly #cache = new Map<string, EngineResult<MetricCalculation>>();
  readonly #completed: FormulaSuccess[] = [];
  readonly #completedRefs = new Set<string>();
  readonly #active = new Set<string>();

  constructor(observations: unknown, alreadySnapshot = false) {
    this.#observations = alreadySnapshot ? deepFreeze(observations as unknown[]) : snapshotObservations(observations);
  }

  evaluate(formulaId: string, version: string): EngineResult<MetricCalculation> {
    const resolution = resolveFormulaDefinition(formulaId, version);
    if (resolution.status === 'unsupported') return unsupported(formulaId, version);
    const root = resolution.definition;
    const reference = formulaRef(root);
    const cached = this.#cache.get(reference);
    if (cached !== undefined) return cached;

    const closure = collectClosure(root);
    if (closure === undefined) {
      const result = blockedResult<MetricCalculation>('invalid-input', [
        issue('circular_dependency', reference, { formulaId: root.formulaId }),
      ], emptyTrace(reference));
      this.#cache.set(reference, result);
      return result;
    }
    const validation = preflight(root, closure, this.#observations);
    if (isEngineResult(validation)) {
      this.#cache.set(reference, validation);
      return validation;
    }
    return this.#evaluateNode(root, closure, validation);
  }

  completedResults(): readonly FormulaSuccess[] {
    return deepFreeze([...this.#completed]);
  }

  #evaluateNode(
    definition: FormulaDefinition,
    closure: Closure,
    validatedByRef: ReadonlyMap<string, Validated>,
  ): EngineResult<MetricCalculation> {
    const reference = formulaRef(definition);
    const cached = this.#cache.get(reference);
    if (cached !== undefined) return cached;
    if (this.#active.has(reference)) {
      const circular = blockedResult<MetricCalculation>('invalid-input', [
        issue('circular_dependency', reference, { formulaId: definition.formulaId }),
      ], emptyTrace(reference));
      this.#cache.set(reference, circular);
      return circular;
    }
    this.#active.add(reference);
    try {
      const validated = validatedByRef.get(reference) ?? invalidDefinition();
      const dependencyResults: FormulaSuccess[] = [];
      const directDependencyRefs = directReferences(definition.ast);
      const orderedDependencyRefs = FORMULA_IDS
        .map((formulaId) => `${formulaId}@1`)
        .filter((dependencyRef) => directDependencyRefs.includes(dependencyRef));
      if (orderedDependencyRefs.length !== directDependencyRefs.length) return invalidDefinition();
      for (const dependencyRef of orderedDependencyRefs) {
        const dependencyDefinition = closure.byRef.get(dependencyRef) ?? invalidDefinition();
        const result = this.#evaluateNode(dependencyDefinition, closure, validatedByRef);
        if (result.status === 'blocked') {
          const blocked = blockedResult<MetricCalculation>(result.reason, result.issues, {
            engine: 'formula',
            formulaRef: reference,
            inputs: result.trace.inputs,
            steps: result.trace.steps,
          });
          this.#cache.set(reference, blocked);
          return blocked;
        }
        dependencyResults.push(result);
      }

      const dependencyInputs = dependencyResults.flatMap((result) => result.trace.inputs);
      const dependencySteps = dependencyResults.flatMap((result) => result.trace.steps);
      const traceInputs = mergeInputs(dependencyInputs, validated.inputs);
      const warnings = uniqueWarnings([
        ...dependencyResults.flatMap((result) => result.warnings),
        ...validated.warnings,
      ]);

      for (const dependency of dependencyResults) {
        const metadataIssue = dependencyMetadataIssue(definition, validated, dependency);
        if (metadataIssue !== undefined) {
          const blocked = blockedResult<MetricCalculation>('invalid-input', [metadataIssue], {
            engine: 'formula', formulaRef: reference, inputs: traceInputs, steps: dependencySteps,
          });
          this.#cache.set(reference, blocked);
          return blocked;
        }
      }

      const dependencies = new Map<string, Decimal>();
      for (const dependency of dependencyResults) {
        dependencies.set(
          `${dependency.value.formulaId}@${dependency.value.version}`,
          new AnalysisDecimal(parseDecimalString(dependency.value.value.value)),
        );
      }
      const astResult = evaluateAst(
        definition.ast,
        decimalMap(validated.inputs, validated.derivedOperands),
        dependencies,
      );
      const currentSteps = prefixSteps(reference, astResult.steps);
      const steps = [...dependencySteps, ...currentSteps];
      if (astResult.status === 'blocked') {
        const blocked = blockedResult<MetricCalculation>('not-meaningful', [astResult.issue], {
          engine: 'formula', formulaRef: reference, inputs: traceInputs, steps,
        });
        this.#cache.set(reference, blocked);
        return blocked;
      }

      try {
        validateOutput(astResult.value, outputDomain(definition));
      } catch {
        const blocked = blockedResult<MetricCalculation>('invalid-input', [
          issue('value_out_of_range', reference, { value: astResult.value }),
        ], { engine: 'formula', formulaRef: reference, inputs: traceInputs, steps });
        this.#cache.set(reference, blocked);
        return blocked;
      }

      const metricValue: MetricValue = {
        value: astResult.value,
        unit: cloneUnit(definition.outputUnit, validated.currency),
      };
      const calculation: MetricCalculation = {
        formulaId: definition.formulaId,
        version: definition.version,
        value: metricValue,
        period: validated.effectivePeriod,
        periodRefs: validated.periodRefs,
        direction: definition.direction,
      };
      const result = okResult(calculation, warnings, {
        engine: 'formula', formulaRef: reference, inputs: traceInputs, steps, output: metricValue,
      });
      this.#cache.set(reference, result);
      if (!this.#completedRefs.has(reference)) {
        this.#completedRefs.add(reference);
        this.#completed.push(result);
      }
      return result;
    } finally {
      this.#active.delete(reference);
    }
  }
}

export function createFormulaEvaluationSession(
  observations: unknown,
): FormulaEvaluationSession {
  return new FormulaEvaluationSessionImpl(observations);
}

export function evaluateMetric(input: MetricEvaluationInput): EngineResult<MetricCalculation> {
  const request = snapshotRequest(input);
  return new FormulaEvaluationSessionImpl(
    deepFreeze(request.observations as unknown[]), true,
  ).evaluate(
    request.formulaId,
    request.version,
  );
}
