import Decimal from 'decimal.js';
import type { TraceStep } from '../../domain/analysis/calculation-trace';
import { AnalysisDecimal, canonicalDecimal, parseDecimalString } from '../../domain/analysis/decimal';
import type { EngineIssue } from '../../domain/analysis/engine-result';
import { DomainContractError } from '../../domain/analysis/value';
import { FORMULA_IDS, type FormulaAst } from './formula-types';

export type AstEvaluation =
  | { readonly status: 'ok'; readonly value: string; readonly steps: readonly TraceStep[] }
  | { readonly status: 'blocked'; readonly issue: EngineIssue; readonly steps: readonly TraceStep[] };

type Node =
  | { readonly kind: 'literal'; readonly value: string; readonly children: readonly object[] }
  | { readonly kind: 'operand'; readonly operandId: string; readonly children: readonly object[] }
  | { readonly kind: 'formula-ref'; readonly formulaId: string; readonly children: readonly object[] }
  | { readonly kind: 'add' | 'multiply'; readonly children: readonly object[] }
  | { readonly kind: 'subtract' | 'power'; readonly children: readonly [object, object] }
  | { readonly kind: 'divide'; readonly rule: 'positive'; readonly children: readonly [object, object] };

interface Frame {
  readonly node: object;
  readonly info: Node;
  readonly values: Decimal[];
  nextChild: number;
}

const MAX_DEPTH = 128;
const MAX_NODES = 4096;
const formulaIds = new Set<string>(FORMULA_IDS);

function invalid(): never {
  throw new DomainContractError('invalid_formula_definition');
}

function record(input: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Object.getPrototypeOf(input) !== Object.prototype) {
    return invalid();
  }
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.length !== keys.length || ownKeys.some(
    (key) => typeof key !== 'string' || !keys.includes(key),
  )) return invalid();

  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return invalid();
    }
    output[key] = descriptor.value;
  }
  return output;
}

function kindOf(input: unknown): string {
  if (typeof input !== 'object' || input === null || Object.getPrototypeOf(input) !== Object.prototype) {
    return invalid();
  }
  const descriptor = Reflect.getOwnPropertyDescriptor(input, 'kind');
  return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor &&
      typeof descriptor.value === 'string'
    ? descriptor.value
    : invalid();
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : invalid();
}

function objectValue(value: unknown): object {
  return typeof value === 'object' && value !== null ? value : invalid();
}

function arrayValue(value: unknown): readonly object[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined || !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' || !Number.isInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1
  ) return invalid();
  const length = lengthDescriptor.value;
  if (Reflect.ownKeys(value).length !== length + 1) return invalid();

  const output: object[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) return invalid();
    output.push(objectValue(descriptor.value));
  }
  return output;
}

function inspect(input: unknown): Node {
  const kind = kindOf(input);
  switch (kind) {
    case 'literal': {
      const dto = record(input, ['kind', 'value']);
      return { kind, value: stringValue(dto.value), children: [] };
    }
    case 'operand': {
      const dto = record(input, ['kind', 'operandId']);
      return { kind, operandId: stringValue(dto.operandId), children: [] };
    }
    case 'formula-ref': {
      const dto = record(input, ['kind', 'formulaId', 'version']);
      const formulaId = stringValue(dto.formulaId);
      if (!formulaIds.has(formulaId) || dto.version !== '1') return invalid();
      return { kind, formulaId, children: [] };
    }
    case 'add':
    case 'multiply': {
      const dto = record(input, ['kind', 'values']);
      return { kind, children: arrayValue(dto.values) };
    }
    case 'subtract': {
      const dto = record(input, ['kind', 'left', 'right']);
      return { kind, children: [objectValue(dto.left), objectValue(dto.right)] };
    }
    case 'divide': {
      const dto = record(input, ['kind', 'numerator', 'denominator', 'rule']);
      if (dto.rule !== 'positive') return invalid();
      return {
        kind,
        rule: 'positive',
        children: [objectValue(dto.numerator), objectValue(dto.denominator)],
      };
    }
    case 'power': {
      const dto = record(input, ['kind', 'base', 'exponent']);
      return { kind, children: [objectValue(dto.base), objectValue(dto.exponent)] };
    }
    default:
      return invalid();
  }
}

function validate(ast: unknown): { readonly root: object; readonly nodes: WeakMap<object, Node> } {
  const root = objectValue(ast);
  const nodes = new WeakMap<object, Node>();
  const seen = new WeakSet<object>();
  const pending: Array<{ readonly node: object; readonly depth: number }> = [{ node: root, depth: 0 }];
  let count = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > MAX_DEPTH || seen.has(current.node) || ++count > MAX_NODES) return invalid();
    seen.add(current.node);
    const info = inspect(current.node);
    nodes.set(current.node, info);
    for (let index = info.children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: info.children[index]!, depth: current.depth + 1 });
    }
  }
  return { root, nodes };
}

function decimals(input: unknown): ReadonlyMap<string, Decimal> {
  if (typeof input !== 'object' || input === null || Object.getPrototypeOf(input) !== Map.prototype) {
    return invalid();
  }
  const output = new Map<string, Decimal>();
  for (const [key, value] of Map.prototype.entries.call(input) as MapIterator<[unknown, unknown]>) {
    if (
      typeof key !== 'string' || typeof value !== 'object' || value === null ||
      (Object.getPrototypeOf(value) !== Decimal.prototype &&
        Object.getPrototypeOf(value) !== AnalysisDecimal.prototype) ||
      !Decimal.isDecimal(value)
    ) return invalid();
    output.set(key, new AnalysisDecimal(canonicalDecimal(value as Decimal)));
  }
  return output;
}

function info(nodes: WeakMap<object, Node>, node: object): Node {
  return nodes.get(node) ?? invalid();
}

function lookup(values: ReadonlyMap<string, Decimal>, key: string): Decimal {
  const value = values.get(key);
  return value === undefined ? invalid() : new AnalysisDecimal(canonicalDecimal(value));
}

function blocked(
  id: string,
  code: 'division_by_zero' | 'non_positive_denominator',
  operands: readonly string[],
  steps: TraceStep[],
): AstEvaluation {
  steps.push({ id, operator: 'divide', operands, rule: 'positive', outcome: 'blocked' });
  return {
    status: 'blocked',
    issue: {
      code,
      path: id,
      message: code === 'division_by_zero'
        ? 'Formula denominator is zero.'
        : 'Formula denominator must be positive.',
      details: { rule: 'positive' },
    },
    steps,
  };
}

function calculate(kind: 'add' | 'subtract' | 'multiply' | 'divide' | 'power', values: readonly Decimal[]): Decimal {
  switch (kind) {
    case 'add':
      return values.reduce((total, value) => total.plus(value), new AnalysisDecimal(0));
    case 'subtract':
      return values[0]!.minus(values[1]!);
    case 'multiply':
      return values.reduce((product, value) => product.times(value), new AnalysisDecimal(1));
    case 'divide':
      return values[0]!.dividedBy(values[1]!);
    case 'power':
      return AnalysisDecimal.pow(values[0]!, values[1]!);
  }
}

function run(
  root: object,
  nodes: WeakMap<object, Node>,
  operands: ReadonlyMap<string, Decimal>,
  dependencies: ReadonlyMap<string, Decimal>,
): AstEvaluation {
  const steps: TraceStep[] = [];
  let sequence = 0;
  const stack: Frame[] = [{ node: root, info: info(nodes, root), values: [], nextChild: 0 }];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.nextChild < frame.info.children.length) {
      const child = frame.info.children[frame.nextChild++]!;
      stack.push({ node: child, info: info(nodes, child), values: [], nextChild: 0 });
      continue;
    }

    let value: Decimal;
    switch (frame.info.kind) {
      case 'literal':
        value = new AnalysisDecimal(canonicalDecimal(parseDecimalString(frame.info.value)));
        break;
      case 'operand':
        value = lookup(operands, frame.info.operandId);
        break;
      case 'formula-ref':
        value = lookup(dependencies, `${frame.info.formulaId}@1`);
        break;
      default: {
        const id = `${frame.info.kind}:${++sequence}`;
        const operandStrings = frame.values.map(canonicalDecimal);
        if (frame.info.kind === 'divide') {
          const denominator = frame.values[1]!;
          if (denominator.isZero()) return blocked(id, 'division_by_zero', operandStrings, steps);
          if (denominator.isNegative()) {
            return blocked(id, 'non_positive_denominator', operandStrings, steps);
          }
        }
        value = calculate(frame.info.kind, frame.values);
        const result = canonicalDecimal(value);
        steps.push(frame.info.kind === 'divide'
          ? { id, operator: frame.info.kind, operands: operandStrings, result, rule: frame.info.rule, outcome: 'passed' }
          : { id, operator: frame.info.kind, operands: operandStrings, result });
        value = new AnalysisDecimal(result);
      }
    }

    stack.pop();
    if (stack.length === 0) return { status: 'ok', value: canonicalDecimal(value), steps };
    stack[stack.length - 1]!.values.push(value);
  }
  return invalid();
}

export function evaluateAst(
  ast: FormulaAst,
  operands: ReadonlyMap<string, Decimal>,
  dependencies: ReadonlyMap<string, Decimal>,
): AstEvaluation {
  try {
    const safeOperands = decimals(operands);
    const safeDependencies = decimals(dependencies);
    const validated = validate(ast);
    return run(validated.root, validated.nodes, safeOperands, safeDependencies);
  } catch {
    return invalid();
  }
}
