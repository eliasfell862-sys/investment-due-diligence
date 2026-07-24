import { describe, expect, it } from 'vitest';
import { DomainContractError } from '../../domain/analysis/value';
import { formulaDefinitions } from './formula-definitions';
import {
  FORMULA_IDS,
  getFormulaDefinition,
  listFormulaDefinitions,
  resolveFormulaDefinition,
  validateFormulaDefinitions,
} from './formula-registry';

const EXPECTED_IDS = [
  'gross_margin',
  'ebitda_margin',
  'free_cash_flow',
  'burn_multiple',
  'cac_payback_months',
  'cash_runway_months',
  'revenue_cagr',
  'customer_concentration',
  'repeat_purchase_rate',
  'nrr',
  'ltv_cac',
  'inventory_turnover_days',
  'net_new_arr',
] as const;

type MutableDefinition = Record<string, any>;

function cloneDefinitions(): MutableDefinition[] {
  return JSON.parse(JSON.stringify(formulaDefinitions)) as MutableDefinition[];
}

function expectInvalid(input: unknown): DomainContractError {
  let thrown: unknown;
  try {
    validateFormulaDefinitions(input);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainContractError);
  expect((thrown as DomainContractError).code).toBe('invalid_formula_definition');
  expect((thrown as Error).name).toBe('DomainContractError');
  return thrown as DomainContractError;
}

function findDefinition(definitions: MutableDefinition[], formulaId: string) {
  const definition = definitions.find((candidate) => candidate.formulaId === formulaId);
  if (definition === undefined) {
    throw new Error(`missing test definition ${formulaId}`);
  }
  return definition;
}

function isDeepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return true;
  }
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

describe('formula registry', () => {
  it('publishes the exact stable formula order and v1 definitions', () => {
    expect(FORMULA_IDS).toEqual(EXPECTED_IDS);
    expect(Object.isFrozen(FORMULA_IDS)).toBe(true);
    expect(listFormulaDefinitions().map(({ formulaId, version }) => [formulaId, version])).toEqual(
      EXPECTED_IDS.map((formulaId) => [formulaId, '1']),
    );
  });

  it('stores only restricted JSON data AST and freezes all nested values', () => {
    expect(JSON.stringify(formulaDefinitions)).not.toContain('function');
    expect(isDeepFrozen(formulaDefinitions)).toBe(true);
    expect(isDeepFrozen(listFormulaDefinitions())).toBe(true);

    const burnMultiple = getFormulaDefinition('burn_multiple', '1');
    expect(burnMultiple.ast).toMatchObject({
      kind: 'divide',
      denominator: { kind: 'formula-ref', formulaId: 'net_new_arr', version: '1' },
    });
    expect(isDeepFrozen(burnMultiple)).toBe(true);
  });

  it('returns stable supported and unsupported resolutions', () => {
    expect(resolveFormulaDefinition('gross_margin', '1')).toEqual({
      status: 'supported',
      definition: getFormulaDefinition('gross_margin', '1'),
    });
    expect(resolveFormulaDefinition('gross_margin', '2')).toEqual({
      status: 'unsupported',
      formulaId: 'gross_margin',
      version: '2',
    });
    expect(getFormulaDefinition('gross_margin', '2')).toEqual({
      status: 'unsupported',
      formulaId: 'gross_margin',
      version: '2',
    });
  });

  it('throws a fresh unknown_formula error for every unknown public id lookup', () => {
    const errors: DomainContractError[] = [];
    for (const lookup of [
      () => resolveFormulaDefinition('made_up_metric', '1'),
      () => getFormulaDefinition('made_up_metric', '1'),
    ]) {
      try {
        lookup();
      } catch (error) {
        expect(error).toBeInstanceOf(DomainContractError);
        expect((error as DomainContractError).code).toBe('unknown_formula');
        errors.push(error as DomainContractError);
      }
    }
    expect(errors).toHaveLength(2);
    expect(errors[0]).not.toBe(errors[1]);
  });

  it('defines the required operands, periods, directions, units, constraints, and AST shapes', () => {
    expect(formulaDefinitions).toMatchObject([
      {
        formulaId: 'gross_margin', version: '1', periodRule: 'same-flow-period', direction: 'higher',
        operands: [
          { operandId: 'revenue', metricId: 'revenue', expectedUnit: { kind: 'currency', currency: 'CNY' }, periodRole: 'flow', numericDomain: 'decimal' },
          { operandId: 'cost_of_goods_sold', metricId: 'cost_of_goods_sold', expectedUnit: { kind: 'currency', currency: 'CNY' }, periodRole: 'flow', numericDomain: 'decimal' },
        ],
        outputUnit: { kind: 'ratio', rateKind: 'signed-rate' },
        ast: { kind: 'divide', numerator: { kind: 'subtract' }, denominator: { kind: 'operand', operandId: 'revenue' }, rule: 'positive' },
      },
      { formulaId: 'ebitda_margin', periodRule: 'same-flow-period', direction: 'higher', outputUnit: { kind: 'ratio', rateKind: 'signed-rate' } },
      { formulaId: 'free_cash_flow', periodRule: 'same-flow-period', direction: 'higher', outputUnit: { kind: 'currency', currency: 'CNY' }, ast: { kind: 'subtract' } },
      { formulaId: 'burn_multiple', periodRule: 'same-flow-period', direction: 'lower', outputUnit: { kind: 'multiple' }, outputNumericDomain: 'decimal' },
      { formulaId: 'cac_payback_months', periodRule: 'same-flow-period', direction: 'lower', outputUnit: { kind: 'duration', durationUnit: 'months' } },
      { formulaId: 'cash_runway_months', periodRule: 'mixed-stock-flow', direction: 'higher', outputUnit: { kind: 'duration', durationUnit: 'months' } },
      { formulaId: 'revenue_cagr', periodRule: 'ordered-as-of-endpoints', direction: 'higher', outputUnit: { kind: 'ratio', rateKind: 'signed-rate' }, ast: { kind: 'subtract', left: { kind: 'power' }, right: { kind: 'literal', value: '1' } } },
      { formulaId: 'customer_concentration', periodRule: 'same-flow-period', direction: 'lower', outputUnit: { kind: 'ratio', rateKind: 'unit-interval' } },
      { formulaId: 'repeat_purchase_rate', periodRule: 'same-flow-period', direction: 'higher', outputUnit: { kind: 'ratio', rateKind: 'unit-interval' } },
      { formulaId: 'nrr', periodRule: 'mixed-stock-flow', direction: 'higher', outputUnit: { kind: 'ratio', rateKind: 'non-negative-rate' }, constraints: [{ kind: 'sum-lte-sum', left: ['contraction_revenue', 'churned_revenue'], right: ['opening_recurring_revenue', 'expansion_revenue'] }] },
      { formulaId: 'ltv_cac', periodRule: 'same-as-of', direction: 'higher', outputUnit: { kind: 'multiple' } },
      { formulaId: 'inventory_turnover_days', periodRule: 'mixed-stock-flow', direction: 'lower', outputUnit: { kind: 'duration', durationUnit: 'days' } },
      { formulaId: 'net_new_arr', periodRule: 'ordered-as-of-endpoints', direction: 'higher', outputUnit: { kind: 'currency', currency: 'CNY' }, ast: { kind: 'subtract' } },
    ]);
  });

  it.each([
    ['declared output dimension', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'gross_margin').outputUnit = { kind: 'currency', currency: 'USD' }; }],
    ['add incompatible units', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'free_cash_flow').ast = { kind: 'add', values: [{ kind: 'operand', operandId: 'operating_cash_flow' }, { kind: 'literal', value: '1' }] }; }],
    ['subtract incompatible units', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'free_cash_flow').ast.right = { kind: 'literal', value: '1' }; }],
    ['unknown AST node', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'gross_margin').ast = { kind: 'execute', source: 'return 1' }; }],
    ['missing operand reference', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'gross_margin').ast.denominator.operandId = 'missing'; }],
    ['invalid synthetic operand', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'gross_margin').ast.denominator.operandId = '__period_days'; }],
    ['bad formula ref id', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'burn_multiple').ast.denominator.formulaId = 'gross_margin'; }],
    ['bad formula ref version', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'burn_multiple').ast.denominator.version = '2'; }],
    ['missing dependency', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'burn_multiple').ast.denominator = { kind: 'literal', value: '1' }; }],
    ['extra dependency', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'gross_margin').ast.denominator = { kind: 'formula-ref', formulaId: 'net_new_arr', version: '1' }; }],
    ['duplicate id', (definitions: MutableDefinition[]) => { definitions[1].formulaId = definitions[0].formulaId; }],
    ['missing definition', (definitions: MutableDefinition[]) => { definitions.pop(); }],
    ['out of order definition', (definitions: MutableDefinition[]) => { [definitions[0], definitions[1]] = [definitions[1], definitions[0]]; }],
    ['wrong version', (definitions: MutableDefinition[]) => { definitions[0].version = '2'; }],
    ['duplicate operand id', (definitions: MutableDefinition[]) => { definitions[0].operands[1].operandId = definitions[0].operands[0].operandId; }],
    ['duplicate metric id', (definitions: MutableDefinition[]) => { definitions[0].operands[1].metricId = definitions[0].operands[0].metricId; }],
    ['invalid constraint reference', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'nrr').constraints[0].left[0] = 'missing'; }],
    ['non-canonical literal', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'revenue_cagr').ast.right.value = '1.0'; }],
    ['empty multiply', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'inventory_turnover_days').ast.values = []; }],
    ['power with dimensional base', (definitions: MutableDefinition[]) => { findDefinition(definitions, 'revenue_cagr').ast.left.base = { kind: 'operand', operandId: 'ending_revenue' }; }],
  ] as const)('rejects %s damage as invalid_formula_definition', (_name, damage) => {
    const definitions = cloneDefinitions();
    damage(definitions);
    expectInvalid(definitions);
  });

  it('treats currency codes as one dimension category while preserving currency output', () => {
    const definitions = cloneDefinitions();
    for (const definition of definitions) {
      for (const operand of definition.operands) {
        if ('currency' in operand.expectedUnit) operand.expectedUnit.currency = 'USD';
      }
      if ('currency' in definition.outputUnit) definition.outputUnit.currency = 'JPY';
    }
    expect(() => validateFormulaDefinitions(definitions)).not.toThrow();
    expect(getFormulaDefinition('free_cash_flow', '1').outputUnit).toEqual({ kind: 'currency', currency: 'CNY' });
  });

  it('returns a separately frozen validated snapshot instead of exposing mutable DTO references', () => {
    const definitions = cloneDefinitions();
    const validated = validateFormulaDefinitions(definitions);
    definitions[0].formulaId = 'damaged_after_validation';
    expect(validated[0].formulaId).toBe('gross_margin');
    expect(isDeepFrozen(validated)).toBe(true);
  });

  it('normalizes hostile arrays, proxies, accessors, sparse values, symbols, and native exceptions', () => {
    const getter = Object.defineProperty({}, 'formulaId', {
      enumerable: true,
      get() { throw new TypeError('getter leaked'); },
    });
    const proxy = new Proxy([], { ownKeys() { throw new RangeError('proxy leaked'); } });
    const sparse = new Array(13);
    const withSymbol = cloneDefinitions();
    Object.defineProperty(withSymbol[0], Symbol('hidden'), { value: true, enumerable: true });

    const errors = [getter, proxy, sparse, withSymbol].map(expectInvalid);
    expect(new Set(errors).size).toBe(errors.length);
    expect(errors.every((error) => !(error instanceof TypeError) && !(error instanceof RangeError))).toBe(true);
  });
});
