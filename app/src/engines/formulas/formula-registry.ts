import { parseDecimalString } from '../../domain/analysis/decimal';
import { DomainContractError } from '../../domain/analysis/value';
import type { AnalysisUnit } from '../../domain/analysis/value';
import { deepFreeze } from '../../domain/deep-freeze';
import { formulaDefinitions } from './formula-definitions';
import { FORMULA_IDS as STABLE_FORMULA_IDS } from './formula-types';
import type {
  FormulaAst,
  FormulaDefinition,
  FormulaId,
  FormulaOperandSpec,
} from './formula-types';

export { FORMULA_IDS } from './formula-types';

export interface UnsupportedFormulaResolution {
  readonly status: 'unsupported';
  readonly formulaId: FormulaId;
  readonly version: string;
}

export type FormulaResolution =
  | { readonly status: 'supported'; readonly definition: FormulaDefinition }
  | UnsupportedFormulaResolution;

type Dimension = ReadonlyMap<string, number>;
type MutableRecord = Record<string, unknown>;

const periodRules = [
  'same-flow-period',
  'same-as-of',
  'ordered-as-of-endpoints',
  'mixed-stock-flow',
] as const;
const directions = ['higher', 'lower'] as const;
const periodRoles = [
  'flow',
  'as-of-begin',
  'as-of-end',
  'as-of',
  'representative-month',
] as const;
const numericDomains = [
  'decimal',
  'unit-interval',
  'non-negative-rate',
  'signed-rate',
  'multiple',
] as const;
const countKinds = ['customer', 'user', 'unit', 'share', 'order'] as const;
const rateKinds = [
  'unit-interval',
  'non-negative-rate',
  'signed-rate',
  'return-rate',
] as const;

function invalidDefinition(): never {
  throw new DomainContractError('invalid_formula_definition');
}

function snapshotJsonDto(input: unknown): unknown {
  const active = new WeakSet<object>();
  return snapshotJsonValue(input, active);
}

function snapshotJsonValue(value: unknown, active: WeakSet<object>): unknown {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (value === null || typeof value !== 'object' || active.has(value)) {
    return invalidDefinition();
  }

  active.add(value);
  try {
    return Array.isArray(value)
      ? snapshotArray(value, active)
      : snapshotObject(value, active);
  } finally {
    active.delete(value);
  }
}

function snapshotArray(value: unknown[], active: WeakSet<object>): unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return invalidDefinition();
  }

  const keys = Reflect.ownKeys(value);
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    keys.length !== lengthDescriptor.value + 1
  ) {
    return invalidDefinition();
  }

  const output: unknown[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      return invalidDefinition();
    }
    output.push(snapshotJsonValue(descriptor.value, active));
  }
  return output;
}

function snapshotObject(value: object, active: WeakSet<object>): MutableRecord {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidDefinition();
  }

  const output: MutableRecord = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      return invalidDefinition();
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      return invalidDefinition();
    }
    Object.defineProperty(output, key, {
      value: snapshotJsonValue(descriptor.value, active),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return output;
}

function asRecord(value: unknown): MutableRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as MutableRecord)
    : invalidDefinition();
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalidDefinition();
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : invalidDefinition();
}

function asBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalidDefinition();
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.some((candidate) => candidate === value);
}

function exactKeys(
  record: MutableRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(record);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    return invalidDefinition();
  }
}

function parseUnit(value: unknown): AnalysisUnit {
  const unit = asRecord(value);
  const kind = asString(unit.kind);
  switch (kind) {
    case 'currency': {
      exactKeys(unit, ['kind', 'currency']);
      const currency = asString(unit.currency);
      if (!/^[A-Z]{3}$/.test(currency)) return invalidDefinition();
      return { kind, currency };
    }
    case 'ratio': {
      exactKeys(unit, ['kind', 'rateKind']);
      const rateKind = asString(unit.rateKind);
      if (!isOneOf(rateKind, rateKinds)) return invalidDefinition();
      return { kind, rateKind };
    }
    case 'multiple':
      exactKeys(unit, ['kind']);
      return { kind };
    case 'duration': {
      exactKeys(unit, ['kind', 'durationUnit']);
      const durationUnit = asString(unit.durationUnit);
      if (durationUnit !== 'months' && durationUnit !== 'days' && durationUnit !== 'years') {
        return invalidDefinition();
      }
      return { kind, durationUnit };
    }
    case 'count': {
      exactKeys(unit, ['kind', 'countKind']);
      const countKind = asString(unit.countKind);
      if (!isOneOf(countKind, countKinds)) return invalidDefinition();
      return { kind, countKind };
    }
    case 'currency-per-count': {
      exactKeys(unit, ['kind', 'currency', 'countKind'], ['perPeriod']);
      const currency = asString(unit.currency);
      const countKind = asString(unit.countKind);
      if (!/^[A-Z]{3}$/.test(currency) || !isOneOf(countKind, countKinds)) {
        return invalidDefinition();
      }
      if (!Object.hasOwn(unit, 'perPeriod')) return { kind, currency, countKind };
      const perPeriod = asString(unit.perPeriod);
      if (perPeriod !== 'month' && perPeriod !== 'year') return invalidDefinition();
      return { kind, currency, countKind, perPeriod };
    }
    default:
      return invalidDefinition();
  }
}

function validateStringArray(value: unknown, allowEmpty = false): readonly string[] {
  const values = asArray(value);
  if ((!allowEmpty && values.length === 0) || values.some((entry) => typeof entry !== 'string')) {
    return invalidDefinition();
  }
  return values as string[];
}

function validateAstStructure(value: unknown): FormulaAst {
  const ast = asRecord(value);
  const kind = asString(ast.kind);
  switch (kind) {
    case 'literal':
      exactKeys(ast, ['kind', 'value']);
      parseDecimalString(asString(ast.value));
      return ast as unknown as FormulaAst;
    case 'operand':
      exactKeys(ast, ['kind', 'operandId']);
      asString(ast.operandId);
      return ast as unknown as FormulaAst;
    case 'formula-ref':
      exactKeys(ast, ['kind', 'formulaId', 'version']);
      asString(ast.formulaId);
      asString(ast.version);
      return ast as unknown as FormulaAst;
    case 'add':
    case 'multiply': {
      exactKeys(ast, ['kind', 'values']);
      const values = asArray(ast.values);
      if (values.length === 0) return invalidDefinition();
      for (const nested of values) validateAstStructure(nested);
      return ast as unknown as FormulaAst;
    }
    case 'subtract':
      exactKeys(ast, ['kind', 'left', 'right']);
      validateAstStructure(ast.left);
      validateAstStructure(ast.right);
      return ast as unknown as FormulaAst;
    case 'divide':
      exactKeys(ast, ['kind', 'numerator', 'denominator', 'rule']);
      if (asString(ast.rule) !== 'positive') return invalidDefinition();
      validateAstStructure(ast.numerator);
      validateAstStructure(ast.denominator);
      return ast as unknown as FormulaAst;
    case 'power':
      exactKeys(ast, ['kind', 'base', 'exponent']);
      validateAstStructure(ast.base);
      validateAstStructure(ast.exponent);
      return ast as unknown as FormulaAst;
    default:
      return invalidDefinition();
  }
}

function validateOperand(value: unknown): FormulaOperandSpec {
  const operand = asRecord(value);
  exactKeys(
    operand,
    ['operandId', 'metricId', 'expectedUnit', 'periodRole', 'numericDomain'],
    ['nonNegative', 'notGreaterThanOperand'],
  );
  const operandId = asString(operand.operandId);
  const metricId = asString(operand.metricId);
  const periodRole = asString(operand.periodRole);
  const numericDomain = asString(operand.numericDomain);
  if (
    operandId.length === 0 ||
    operandId.startsWith('__') ||
    metricId.length === 0 ||
    !isOneOf(periodRole, periodRoles) ||
    !isOneOf(numericDomain, numericDomains)
  ) {
    return invalidDefinition();
  }
  parseUnit(operand.expectedUnit);
  if (Object.hasOwn(operand, 'nonNegative')) asBoolean(operand.nonNegative);
  if (Object.hasOwn(operand, 'notGreaterThanOperand')) {
    asString(operand.notGreaterThanOperand);
  }
  return operand as unknown as FormulaOperandSpec;
}

function validateDefinitionStructure(value: unknown): FormulaDefinition {
  const definition = asRecord(value);
  exactKeys(
    definition,
    ['formulaId', 'version', 'operands', 'outputUnit', 'periodRule', 'direction', 'ast'],
    ['outputNumericDomain', 'constraints'],
  );
  const formulaId = asString(definition.formulaId);
  const version = asString(definition.version);
  const periodRule = asString(definition.periodRule);
  const direction = asString(definition.direction);
  if (
    !isOneOf(formulaId, STABLE_FORMULA_IDS) ||
    version !== '1' ||
    !isOneOf(periodRule, periodRules) ||
    !isOneOf(direction, directions)
  ) {
    return invalidDefinition();
  }

  const operands = asArray(definition.operands).map(validateOperand);
  if (operands.length === 0) return invalidDefinition();
  const operandIds = new Set(operands.map((operand) => operand.operandId));
  const metricIds = new Set(operands.map((operand) => operand.metricId));
  if (operandIds.size !== operands.length || metricIds.size !== operands.length) {
    return invalidDefinition();
  }
  for (const operand of operands) {
    if (
      operand.notGreaterThanOperand !== undefined &&
      !operandIds.has(operand.notGreaterThanOperand)
    ) {
      return invalidDefinition();
    }
  }

  parseUnit(definition.outputUnit);
  if (Object.hasOwn(definition, 'outputNumericDomain')) {
    const outputNumericDomain = asString(definition.outputNumericDomain);
    if (!isOneOf(outputNumericDomain, numericDomains)) return invalidDefinition();
  }
  validateAstStructure(definition.ast);

  if (Object.hasOwn(definition, 'constraints')) {
    for (const value of asArray(definition.constraints)) {
      const constraint = asRecord(value);
      exactKeys(constraint, ['kind', 'left', 'right']);
      if (asString(constraint.kind) !== 'sum-lte-sum') return invalidDefinition();
      for (const operandId of [
        ...validateStringArray(constraint.left),
        ...validateStringArray(constraint.right),
      ]) {
        if (!operandIds.has(operandId)) return invalidDefinition();
      }
    }
  }
  return definition as unknown as FormulaDefinition;
}

function addExponent(dimension: Map<string, number>, key: string, delta: number): void {
  const exponent = (dimension.get(key) ?? 0) + delta;
  if (exponent === 0) dimension.delete(key);
  else dimension.set(key, exponent);
}

function combineDimensions(left: Dimension, right: Dimension, multiplier: 1 | -1): Dimension {
  const result = new Map(left);
  for (const [key, exponent] of right) addExponent(result, key, exponent * multiplier);
  return result;
}

function unitDimension(unit: AnalysisUnit): Dimension {
  switch (unit.kind) {
    case 'currency':
      return new Map([['currency', 1]]);
    case 'ratio':
    case 'multiple':
      return new Map();
    case 'duration':
      return new Map([[unit.durationUnit === 'months' ? 'month' : unit.durationUnit.slice(0, -1), 1]]);
    case 'count':
      return new Map([[`count:${unit.countKind}`, 1]]);
    case 'currency-per-count': {
      const result = new Map<string, number>([
        ['currency', 1],
        [`count:${unit.countKind}`, -1],
      ]);
      if (unit.perPeriod !== undefined) addExponent(result, unit.perPeriod, -1);
      return result;
    }
  }
}

function operandDimension(operand: FormulaOperandSpec): Dimension {
  const result = new Map(unitDimension(operand.expectedUnit));
  if (operand.periodRole === 'representative-month' && operand.expectedUnit.kind === 'currency') {
    addExponent(result, 'month', -1);
  }
  return result;
}

function dimensionsEqual(left: Dimension, right: Dimension): boolean {
  return left.size === right.size && [...left].every(([key, value]) => right.get(key) === value);
}

function inferAstDimension(
  ast: FormulaAst,
  definition: FormulaDefinition,
  definitions: ReadonlyMap<string, FormulaDefinition>,
  operands: ReadonlyMap<string, FormulaOperandSpec>,
  dependencies: string[],
): Dimension {
  switch (ast.kind) {
    case 'literal':
      return new Map();
    case 'operand': {
      const operand = operands.get(ast.operandId);
      if (operand !== undefined) return operandDimension(operand);
      if (
        ast.operandId === '__duration_years' &&
        definition.formulaId === 'revenue_cagr' &&
        definition.periodRule === 'ordered-as-of-endpoints'
      ) {
        return new Map();
      }
      if (
        ast.operandId === '__period_days' &&
        definition.formulaId === 'inventory_turnover_days' &&
        definition.periodRule === 'mixed-stock-flow'
      ) {
        return new Map([['day', 1]]);
      }
      return invalidDefinition();
    }
    case 'formula-ref': {
      const reference = definitions.get(`${ast.formulaId}@${ast.version}`);
      if (reference === undefined) return invalidDefinition();
      dependencies.push(`${definition.formulaId}@${definition.version}->${ast.formulaId}@${ast.version}`);
      return unitDimension(reference.outputUnit);
    }
    case 'add': {
      const [first, ...rest] = ast.values;
      if (first === undefined) return invalidDefinition();
      const dimension = inferAstDimension(first, definition, definitions, operands, dependencies);
      for (const nested of rest) {
        if (!dimensionsEqual(dimension, inferAstDimension(nested, definition, definitions, operands, dependencies))) {
          return invalidDefinition();
        }
      }
      return dimension;
    }
    case 'subtract': {
      const left = inferAstDimension(ast.left, definition, definitions, operands, dependencies);
      const right = inferAstDimension(ast.right, definition, definitions, operands, dependencies);
      return dimensionsEqual(left, right) ? left : invalidDefinition();
    }
    case 'multiply': {
      let result: Dimension = new Map();
      for (const nested of ast.values) {
        result = combineDimensions(
          result,
          inferAstDimension(nested, definition, definitions, operands, dependencies),
          1,
        );
      }
      return result;
    }
    case 'divide':
      return combineDimensions(
        inferAstDimension(ast.numerator, definition, definitions, operands, dependencies),
        inferAstDimension(ast.denominator, definition, definitions, operands, dependencies),
        -1,
      );
    case 'power': {
      const base = inferAstDimension(ast.base, definition, definitions, operands, dependencies);
      const exponent = inferAstDimension(ast.exponent, definition, definitions, operands, dependencies);
      if (base.size !== 0 || exponent.size !== 0) return invalidDefinition();
      return new Map();
    }
  }
}

function normalizedCurrencyJson(value: unknown): string {
  return JSON.stringify(value, (key, nested) => key === 'currency' ? '__CURRENCY__' : nested);
}

export function validateFormulaDefinitions(input: unknown): readonly FormulaDefinition[] {
  try {
    const snapshot = snapshotJsonDto(input);
    const values = asArray(snapshot);
    if (values.length !== STABLE_FORMULA_IDS.length) return invalidDefinition();

    const definitions = values.map(validateDefinitionStructure);
    for (let index = 0; index < STABLE_FORMULA_IDS.length; index += 1) {
      if (definitions[index]?.formulaId !== STABLE_FORMULA_IDS[index]) {
        return invalidDefinition();
      }
    }

    const definitionByRef = new Map(
      definitions.map((definition) => [`${definition.formulaId}@${definition.version}`, definition]),
    );
    if (definitionByRef.size !== STABLE_FORMULA_IDS.length) return invalidDefinition();

    const dependencies: string[] = [];
    for (const definition of definitions) {
      const operands = new Map(definition.operands.map((operand) => [operand.operandId, operand]));
      const inferred = inferAstDimension(
        definition.ast,
        definition,
        definitionByRef,
        operands,
        dependencies,
      );
      if (!dimensionsEqual(inferred, unitDimension(definition.outputUnit))) {
        return invalidDefinition();
      }
    }
    if (
      dependencies.length !== 1 ||
      dependencies[0] !== 'burn_multiple@1->net_new_arr@1'
    ) {
      return invalidDefinition();
    }

    if (normalizedCurrencyJson(definitions) !== normalizedCurrencyJson(formulaDefinitions)) {
      return invalidDefinition();
    }
    return deepFreeze(definitions);
  } catch {
    return invalidDefinition();
  }
}

const registeredDefinitions = validateFormulaDefinitions(formulaDefinitions);
const registeredById = new Map(
  registeredDefinitions.map((definition) => [definition.formulaId, definition]),
);

function isFormulaId(value: unknown): value is FormulaId {
  return typeof value === 'string' && STABLE_FORMULA_IDS.some((formulaId) => formulaId === value);
}

function unknownFormula(): never {
  throw new DomainContractError('unknown_formula');
}

export function listFormulaDefinitions(): readonly FormulaDefinition[] {
  return registeredDefinitions;
}

export function resolveFormulaDefinition(formulaId: unknown, version: unknown): FormulaResolution {
  if (!isFormulaId(formulaId)) return unknownFormula();
  if (version !== '1') {
    return deepFreeze({
      status: 'unsupported' as const,
      formulaId,
      version: typeof version === 'string' ? version : String(version),
    });
  }
  const definition = registeredById.get(formulaId);
  if (definition === undefined) return unknownFormula();
  return deepFreeze({ status: 'supported' as const, definition });
}

export function getFormulaDefinition(
  formulaId: FormulaId,
  version: '1',
): FormulaDefinition;
export function getFormulaDefinition(
  formulaId: unknown,
  version: unknown,
): FormulaDefinition | UnsupportedFormulaResolution;
export function getFormulaDefinition(
  formulaId: unknown,
  version: unknown,
): FormulaDefinition | UnsupportedFormulaResolution {
  const resolution = resolveFormulaDefinition(formulaId, version);
  return resolution.status === 'supported' ? resolution.definition : resolution;
}
