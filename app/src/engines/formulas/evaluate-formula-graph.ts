import type {
  CalculationTrace,
  TraceInput,
  TraceStep,
} from '../../domain/analysis/calculation-trace';
import {
  blockedResult,
  okResult,
  type EngineIssue,
  type EngineResult,
} from '../../domain/analysis/engine-result';
import { DomainContractError } from '../../domain/analysis/value';
import { createFormulaEvaluationSession, type FormulaSuccess } from './evaluate-metric';
import { FORMULA_IDS, getFormulaDependencies } from './formula-registry';
import type {
  FormulaGraphInput,
  FormulaGraphResult,
  MetricCalculation,
} from './formula-types';

type MutableRecord = Record<string, unknown>;

interface GraphRequest {
  readonly formulaId: string;
  readonly version: string;
}

interface GraphSnapshot {
  readonly requests: readonly GraphRequest[];
  readonly observations: readonly unknown[];
}

interface SnapshotContext {
  readonly active: WeakSet<object>;
  readonly memo: WeakMap<object, object>;
  nodeCount: number;
  arraySlots: number;
  propertyCount: number;
  stringCharacters: number;
}

const GRAPH_REF = 'formula_graph@1';
const MAX_DTO_NODES = 4096;
const MAX_DTO_DEPTH = 64;
const MAX_ARRAY_LENGTH = 4096;
const MAX_TOTAL_ARRAY_SLOTS = 32768;
const MAX_OBJECT_PROPERTIES = 4096;
const MAX_TOTAL_PROPERTIES = 32768;
const MAX_STRING_LENGTH = 65536;
const MAX_TOTAL_STRING_CHARACTERS = 1048576;
const MAX_GRAPH_NODES = 512;
const MAX_GRAPH_DEPTH = 48;
const formulaOrder: ReadonlyMap<string, number> = new Map(
  FORMULA_IDS.map((formulaId, index) => [formulaId, index]),
);

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
      arraySlots: 0,
      propertyCount: 0,
      stringCharacters: 0,
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
  if (typeof value === 'string') {
    context.stringCharacters += value.length;
    if (
      value.length > MAX_STRING_LENGTH ||
      context.stringCharacters > MAX_TOTAL_STRING_CHARACTERS
    ) return invalidDto();
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
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
  if (
    length === undefined || !('value' in length) ||
    typeof length.value !== 'number' || !Number.isInteger(length.value) || length.value < 0
  ) return invalidDto();
  context.arraySlots += length.value;
  if (
    length.value > MAX_ARRAY_LENGTH ||
    context.arraySlots > MAX_TOTAL_ARRAY_SLOTS
  ) return invalidDto();

  const keys = Reflect.ownKeys(value);
  if (keys.length !== length.value + 1) return invalidDto();

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
  const keys = Reflect.ownKeys(value);
  context.propertyCount += keys.length;
  if (
    keys.length > MAX_OBJECT_PROPERTIES ||
    context.propertyCount > MAX_TOTAL_PROPERTIES
  ) return invalidDto();

  const output = Object.create(null) as MutableRecord;
  context.memo.set(value, output);
  for (const key of keys) {
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

function exactKeys(record: MutableRecord, expected: readonly string[]): void {
  const keys = Object.keys(record);
  if (
    keys.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(record, key)) ||
    keys.some((key) => !expected.includes(key))
  ) return invalidDto();
}

function snapshotGraph(input: unknown): GraphSnapshot {
  const snapshot = snapshotJsonDto(input);
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    return invalidDto();
  }
  const graph = snapshot as MutableRecord;
  exactKeys(graph, ['requests', 'observations']);
  if (!Array.isArray(graph.requests) || !Array.isArray(graph.observations)) return invalidDto();

  const requests = graph.requests.map((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidDto();
    const request = value as MutableRecord;
    exactKeys(request, ['formulaId', 'version']);
    if (typeof request.formulaId !== 'string' || typeof request.version !== 'string') {
      return invalidDto();
    }
    return { formulaId: request.formulaId, version: request.version };
  });
  return { requests, observations: graph.observations };
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

function compareRequests(left: GraphRequest, right: GraphRequest): number {
  const leftIndex = formulaOrder.get(left.formulaId);
  const rightIndex = formulaOrder.get(right.formulaId);
  if (leftIndex !== undefined || rightIndex !== undefined) {
    if (leftIndex === undefined) return 1;
    if (rightIndex === undefined) return -1;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  }
  return compareUnicodeCodePoints(left.formulaId, right.formulaId) ||
    compareUnicodeCodePoints(left.version, right.version);
}

function sortedRoots(requests: readonly GraphRequest[]): readonly GraphRequest[] {
  const unique = new Map<string, Map<string, GraphRequest>>();
  for (const request of requests) {
    let versions = unique.get(request.formulaId);
    if (versions === undefined) {
      versions = new Map<string, GraphRequest>();
      unique.set(request.formulaId, versions);
    }
    if (!versions.has(request.version)) versions.set(request.version, request);
  }
  return [...unique.values()]
    .flatMap((versions) => [...versions.values()])
    .sort(compareRequests);
}

function formulaRef(request: GraphRequest): string {
  return `${request.formulaId}@${request.version}`;
}

function canonicalCycle(cycle: readonly string[]): string {
  if (cycle.length === 0) return invalidDefinition();
  let minimum = 0;
  for (let index = 1; index < cycle.length; index += 1) {
    if (compareUnicodeCodePoints(cycle[index]!, cycle[minimum]!) < 0) minimum = index;
  }
  const rotated = [...cycle.slice(minimum), ...cycle.slice(0, minimum)];
  return [...rotated, rotated[0]!].join('>');
}

function circularIssue(root: GraphRequest, cycle: string): EngineIssue {
  const reference = formulaRef(root);
  return {
    code: 'circular_dependency',
    path: `formula.${reference}`,
    message: `${reference}: circular_dependency`,
    details: { cycle },
  };
}

function detectCycle(roots: readonly GraphRequest[]): { readonly root: GraphRequest; readonly cycle: string } | undefined {
  const completed = new Set<string>();
  let nodes = 0;

  for (const root of roots) {
    const stack: string[] = [];
    const visiting = new Map<string, number>();
    const visit = (request: GraphRequest, depth: number): string | undefined => {
      if (depth > MAX_GRAPH_DEPTH || ++nodes > MAX_GRAPH_NODES) return invalidDefinition();
      const reference = formulaRef(request);
      const activeIndex = visiting.get(reference);
      if (activeIndex !== undefined) return canonicalCycle(stack.slice(activeIndex));
      if (completed.has(reference)) return undefined;

      visiting.set(reference, stack.length);
      stack.push(reference);
      const dependencies = getFormulaDependencies(request.formulaId, request.version);
      for (const dependency of dependencies) {
        const cycle = visit(dependency, depth + 1);
        if (cycle !== undefined) return cycle;
      }
      stack.pop();
      visiting.delete(reference);
      completed.add(reference);
      return undefined;
    };

    const cycle = visit(root, 0);
    if (cycle !== undefined) return { root, cycle };
  }
  return undefined;
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  return `{${Object.keys(value as object)
    .sort(compareUnicodeCodePoints)
    .map((key) => `${JSON.stringify(key)}:${stableValue((value as MutableRecord)[key])}`)
    .join(',')}}`;
}

function uniqueWarnings(results: readonly FormulaSuccess[]): readonly EngineIssue[] {
  const seen = new Set<string>();
  const warnings: EngineIssue[] = [];
  for (const result of results) {
    for (const warning of result.warnings) {
      const key = stableValue(warning);
      if (!seen.has(key)) {
        seen.add(key);
        warnings.push(warning);
      }
    }
  }
  return warnings;
}

function mergeInputs(traces: readonly CalculationTrace[]): readonly TraceInput[] {
  const byRef = new Map<string, TraceInput>();
  const signatures = new Map<string, string>();
  for (const trace of traces) {
    for (const input of trace.inputs) {
      const signature = stableValue(input);
      const existing = signatures.get(input.valueRef);
      if (existing !== undefined && existing !== signature) return invalidDefinition();
      signatures.set(input.valueRef, signature);
      byRef.set(input.valueRef, input);
    }
  }
  return [...byRef.values()].sort((left, right) =>
    compareUnicodeCodePoints(left.valueRef, right.valueRef)
  );
}

function mergeNodeSteps(traces: readonly CalculationTrace[]): readonly TraceStep[] {
  const steps: TraceStep[] = [];
  const signatures = new Map<string, string>();
  for (const trace of traces) {
    for (const step of trace.steps) {
      const signature = stableValue(step);
      const existing = signatures.get(step.id);
      if (existing !== undefined) {
        if (existing !== signature) return invalidDefinition();
        continue;
      }
      signatures.set(step.id, signature);
      steps.push(step);
    }
  }
  return steps;
}

function evaluationSteps(calculations: readonly MetricCalculation[]): readonly TraceStep[] {
  return calculations.map((calculation, index) => ({
    id: `${GRAPH_REF}:evaluate:${index + 1}`,
    operator: 'evaluate',
    operands: [`${calculation.formulaId}@${calculation.version}`],
    result: calculation.value.value,
  }));
}

function graphTrace(
  completed: readonly FormulaSuccess[],
  additionalTrace?: CalculationTrace,
): CalculationTrace {
  const calculations = completed.map((result) => result.value);
  const traces = [
    ...completed.map((result) => result.trace),
    ...(additionalTrace === undefined ? [] : [additionalTrace]),
  ];
  const inputs = mergeInputs(traces);
  const steps = [...mergeNodeSteps(traces), ...evaluationSteps(calculations)];
  const output = calculations.at(-1)?.value;
  return {
    engine: 'formula',
    formulaRef: GRAPH_REF,
    inputs,
    steps,
    ...(output === undefined ? {} : { output }),
  };
}

export function evaluateFormulaGraph(
  input: FormulaGraphInput,
): EngineResult<FormulaGraphResult> {
  const graph = snapshotGraph(input);
  const roots = sortedRoots(graph.requests);
  const circular = detectCycle(roots);
  if (circular !== undefined) {
    return blockedResult('invalid-input', [circularIssue(circular.root, circular.cycle)], {
      engine: 'formula', formulaRef: GRAPH_REF, inputs: [], steps: [],
    });
  }

  const session = createFormulaEvaluationSession(graph.observations);
  for (const root of roots) {
    const result = session.evaluate(root.formulaId, root.version);
    if (result.status === 'blocked') {
      return blockedResult(result.reason, result.issues, graphTrace(
        session.completedResults(),
        result.trace,
      ));
    }
  }

  const completed = session.completedResults();
  return okResult(
    { calculations: completed.map((result) => result.value) },
    uniqueWarnings(completed),
    graphTrace(completed),
  );
}
