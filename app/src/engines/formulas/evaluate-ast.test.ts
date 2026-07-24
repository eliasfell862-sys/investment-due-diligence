import Decimal from 'decimal.js';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { AnalysisDecimal } from '../../domain/analysis/decimal';
import { DomainContractError } from '../../domain/analysis/value';
import type { FormulaAst } from './formula-types';
import { evaluateAst, type AstEvaluation } from './evaluate-ast';

const decimal = (value: string) => new AnalysisDecimal(value);
const empty = new Map<string, Decimal>();

function expectInvalid(run: () => unknown): DomainContractError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainContractError);
  expect((thrown as DomainContractError).code).toBe('invalid_formula_definition');
  expect((thrown as Error).message).toBe('invalid_formula_definition');
  return thrown as DomainContractError;
}

describe('evaluateAst', () => {
  it('publishes the exact result union and evaluates (10 - 4) * 2 in post-order', () => {
    const ast: FormulaAst = {
      kind: 'multiply',
      values: [
        {
          kind: 'subtract',
          left: { kind: 'literal', value: '10' },
          right: { kind: 'literal', value: '4' },
        },
        { kind: 'literal', value: '2' },
      ],
    };

    const result = evaluateAst(ast, empty, empty);

    expectTypeOf(result).toEqualTypeOf<AstEvaluation>();
    expect(result).toEqual({
      status: 'ok',
      value: '12',
      steps: [
        { id: 'subtract:1', operator: 'subtract', operands: ['10', '4'], result: '6' },
        { id: 'multiply:2', operator: 'multiply', operands: ['6', '2'], result: '12' },
      ],
    });
  });

  it('evaluates operand, formula-ref, add, and n-ary multiply without leaf steps', () => {
    const ast: FormulaAst = {
      kind: 'multiply',
      values: [
        {
          kind: 'add',
          values: [
            { kind: 'operand', operandId: 'a' },
            { kind: 'formula-ref', formulaId: 'net_new_arr', version: '1' },
            { kind: 'literal', value: '0.5' },
          ],
        },
        { kind: 'literal', value: '2' },
        { kind: 'literal', value: '3' },
      ],
    };

    expect(evaluateAst(
      ast,
      new Map([['a', decimal('1.5')]]),
      new Map([['net_new_arr@1', new Decimal('2')]]),
    )).toEqual({
      status: 'ok',
      value: '24',
      steps: [
        { id: 'add:1', operator: 'add', operands: ['1.5', '2', '0.5'], result: '4' },
        { id: 'multiply:2', operator: 'multiply', operands: ['4', '2', '3'], result: '24' },
      ],
    });
  });

  it.each(['add', 'multiply'] as const)('evaluates a unary %s and still records its operation', (kind) => {
    expect(evaluateAst({
      kind,
      values: [{ kind: 'literal', value: '1' }],
    }, empty, empty)).toEqual({
      status: 'ok',
      value: '1',
      steps: [{ id: `${kind}:1`, operator: kind, operands: ['1'], result: '1' }],
    });
  });

  it.each(['add', 'multiply'] as const)('rejects an empty %s', (kind) => {
    expectInvalid(() => evaluateAst({ kind, values: [] }, empty, empty));
  });

  it('supports fractional powers using decimal arithmetic', () => {
    const result = evaluateAst({
      kind: 'power',
      base: { kind: 'literal', value: '4' },
      exponent: { kind: 'literal', value: '0.5' },
    }, empty, empty);

    expect(result).toEqual({
      status: 'ok',
      value: '2',
      steps: [{ id: 'power:1', operator: 'power', operands: ['4', '0.5'], result: '2' }],
    });
  });

  it.each([
    ['zero', '0', 'division_by_zero', 'Formula denominator is zero.'],
    ['negative zero', '-0', 'division_by_zero', 'Formula denominator is zero.'],
    ['negative', '-2', 'non_positive_denominator', 'Formula denominator must be positive.'],
  ] as const)('blocks a %s denominator before division', (_label, denominator, code, message) => {
    const result = evaluateAst(
      {
        kind: 'divide',
        numerator: { kind: 'operand', operandId: 'numerator' },
        denominator: { kind: 'operand', operandId: 'denominator' },
        rule: 'positive',
      },
      new Map([
        ['numerator', decimal('-6')],
        ['denominator', decimal(denominator)],
      ]),
      empty,
    );

    expect(result).toEqual({
      status: 'blocked',
      issue: {
        code,
        path: 'divide:1',
        message,
        details: { rule: 'positive' },
      },
      steps: [{
        id: 'divide:1',
        operator: 'divide',
        operands: ['-6', '0' === denominator || '-0' === denominator ? '0' : '-2'],
        rule: 'positive',
        outcome: 'blocked',
      }],
    });
    expect('result' in result.steps[0]!).toBe(false);
  });

  it('keeps zero-denominator messages stable when earlier sibling steps change the path', () => {
    const direct = evaluateAst({
      kind: 'divide',
      numerator: { kind: 'literal', value: '4' },
      denominator: { kind: 'literal', value: '0' },
      rule: 'positive',
    }, empty, empty);
    const nested = evaluateAst({
      kind: 'add',
      values: [
        {
          kind: 'multiply',
          values: [{ kind: 'literal', value: '2' }, { kind: 'literal', value: '3' }],
        },
        {
          kind: 'divide',
          numerator: { kind: 'literal', value: '4' },
          denominator: { kind: 'literal', value: '0' },
          rule: 'positive',
        },
      ],
    }, empty, empty);

    expect(direct.status).toBe('blocked');
    expect(nested.status).toBe('blocked');
    if (direct.status !== 'blocked' || nested.status !== 'blocked') throw new Error('expected blocked');
    expect(direct.issue).toMatchObject({
      path: 'divide:1',
      message: 'Formula denominator is zero.',
    });
    expect(nested.issue).toMatchObject({
      path: 'divide:2',
      message: 'Formula denominator is zero.',
    });
    expect(direct.issue.message).toBe(nested.issue.message);
  });

  it('records a passed divide rule and permits a negative numerator', () => {
    expect(evaluateAst({
      kind: 'divide',
      numerator: { kind: 'literal', value: '-3' },
      denominator: { kind: 'literal', value: '2' },
      rule: 'positive',
    }, empty, empty)).toEqual({
      status: 'ok',
      value: '-1.5',
      steps: [{
        id: 'divide:1',
        operator: 'divide',
        operands: ['-3', '2'],
        result: '-1.5',
        rule: 'positive',
        outcome: 'passed',
      }],
    });
  });

  it('propagates a nested blocked divide without evaluating or tracing its parent', () => {
    const result = evaluateAst({
      kind: 'add',
      values: [
        {
          kind: 'multiply',
          values: [
            { kind: 'literal', value: '2' },
            { kind: 'literal', value: '3' },
          ],
        },
        {
          kind: 'divide',
          numerator: { kind: 'literal', value: '4' },
          denominator: { kind: 'literal', value: '0' },
          rule: 'positive',
        },
      ],
    }, empty, empty);

    expect(result.status).toBe('blocked');
    expect(result.steps).toEqual([
      { id: 'multiply:1', operator: 'multiply', operands: ['2', '3'], result: '6' },
      {
        id: 'divide:2',
        operator: 'divide',
        operands: ['4', '0'],
        rule: 'positive',
        outcome: 'blocked',
      },
    ]);
  });

  it('resets local step sequence for every invocation', () => {
    const ast: FormulaAst = {
      kind: 'add',
      values: [{ kind: 'literal', value: '1' }, { kind: 'literal', value: '2' }],
    };
    expect(evaluateAst(ast, empty, empty).steps[0]?.id).toBe('add:1');
    expect(evaluateAst(ast, empty, empty).steps[0]?.id).toBe('add:1');
  });

  it('keeps long decimals and very large values canonical without number conversion', () => {
    const result = evaluateAst({
      kind: 'add',
      values: [
        { kind: 'literal', value: '999999999999999999999999999999' },
        { kind: 'literal', value: '0.000000001' },
      ],
    }, empty, empty);

    expect(result).toEqual({
      status: 'ok',
      value: '999999999999999999999999999999.000000001',
      steps: [{
        id: 'add:1',
        operator: 'add',
        operands: [
          '999999999999999999999999999999',
          '0.000000001',
        ],
        result: '999999999999999999999999999999.000000001',
      }],
    });
  });

  it.each([
    [{ kind: 'operand', operandId: 'missing' }, new Map(), new Map()],
    [{ kind: 'formula-ref', formulaId: 'net_new_arr', version: '1' }, new Map(), new Map()],
    [{ kind: 'literal', value: '01' }, new Map(), new Map()],
  ] as const)('normalizes missing lookups and invalid literals', (ast, operands, dependencies) => {
    expectInvalid(() => evaluateAst(ast as FormulaAst, operands, dependencies));
  });

  it.each([
    ['unknown kind', { kind: 'sqrt', value: { kind: 'literal', value: '4' } }],
    ['bad node field', { kind: 'operand', operandId: 1 }],
    ['bad divide rule', {
      kind: 'divide',
      numerator: { kind: 'literal', value: '1' },
      denominator: { kind: 'literal', value: '2' },
      rule: 'non-zero',
    }],
    ['extra field', { kind: 'literal', value: '1', extra: true }],
    ['sparse values', Object.assign({ kind: 'add', values: new Array(2) }, {})],
    ['class instance', new (class { kind = 'literal'; value = '1'; })()],
    ['null', null],
  ])('rejects hostile AST shape: %s', (_label, ast) => {
    expectInvalid(() => evaluateAst(ast as FormulaAst, empty, empty));
  });

  it('rejects accessors without executing them', () => {
    let reads = 0;
    const ast = Object.defineProperty({ kind: 'literal' }, 'value', {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error('getter executed');
      },
    });

    expectInvalid(() => evaluateAst(ast as FormulaAst, empty, empty));
    expect(reads).toBe(0);
  });

  it('rejects cycles and shared DAG aliases', () => {
    const cycle: Record<string, unknown> = { kind: 'add', values: [] };
    cycle.values = [cycle];
    expectInvalid(() => evaluateAst(cycle as FormulaAst, empty, empty));

    const shared = { kind: 'literal', value: '1' };
    expectInvalid(() => evaluateAst({
      kind: 'add',
      values: [shared, shared],
    } as FormulaAst, empty, empty));
  });

  it('rejects the first illegal registry depth of 49', () => {
    let ast: FormulaAst = { kind: 'literal', value: '1' };
    for (let index = 0; index < 49; index += 1) {
      ast = { kind: 'add', values: [ast, { kind: 'literal', value: '0' }] };
    }
    expectInvalid(() => evaluateAst(ast, empty, empty));
  });

  it('rejects exactly 513 total AST nodes', () => {
    const ast: FormulaAst = {
      kind: 'add',
      values: Array.from(
        { length: 512 },
        () => ({ kind: 'literal', value: '0' } as const),
      ),
    };
    expectInvalid(() => evaluateAst(ast, empty, empty));
  });

  it('evaluates exactly 512 total AST nodes', () => {
    const ast: FormulaAst = {
      kind: 'add',
      values: Array.from(
        { length: 511 },
        () => ({ kind: 'literal', value: '0' } as const),
      ),
    };

    const result = evaluateAst(ast, empty, empty);

    expect(result.status).toBe('ok');
    expect(result.status === 'ok' ? result.value : undefined).toBe('0');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      id: 'add:1',
      operator: 'add',
      result: '0',
    });
    expect(result.steps[0]?.operands).toHaveLength(511);
  });

  it('evaluates the exact legal registry depth of 48', () => {
    let ast: FormulaAst = { kind: 'literal', value: '1' };
    for (let index = 0; index < 48; index += 1) {
      ast = { kind: 'add', values: [ast, { kind: 'literal', value: '0' }] };
    }

    const result = evaluateAst(ast, empty, empty);

    expect(result.status).toBe('ok');
    expect(result.status === 'ok' ? result.value : undefined).toBe('1');
    expect(result.steps).toHaveLength(48);
    expect(result.steps.at(-1)).toEqual({
      id: 'add:48',
      operator: 'add',
      operands: ['1', '0'],
      result: '1',
    });
  });

  it.each(['add', 'multiply'] as const)(
    'rejects an ultra-wide %s before scanning array keys or elements',
    (kind) => {
      let ownKeysCalls = 0;
      let elementDescriptorReads = 0;
      const values = new Proxy(new Array(100_000), {
        ownKeys(target) {
          ownKeysCalls += 1;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          if (typeof key === 'string' && /^\\d+$/.test(key)) elementDescriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });

      expectInvalid(() => evaluateAst({ kind, values } as FormulaAst, empty, empty));
      expect(ownKeysCalls).toBe(0);
      expect(elementDescriptorReads).toBe(0);
    },
  );

  it.each([
    ['negative base fractional exponent', '-4', '0.5'],
    ['zero base negative exponent', '0', '-1'],
  ])('normalizes non-real or non-finite powers: %s', (_label, base, exponent) => {
    expectInvalid(() => evaluateAst({
      kind: 'power',
      base: { kind: 'literal', value: base },
      exponent: { kind: 'literal', value: exponent },
    } as FormulaAst, empty, empty));
  });

  it.each([
    ['operand number', new Map([['value', 1]]) as unknown as ReadonlyMap<string, Decimal>, empty],
    ['operand string', new Map([['value', '1']]) as unknown as ReadonlyMap<string, Decimal>, empty],
    ['operand infinity', new Map([['value', new Decimal(Infinity)]]) as ReadonlyMap<string, Decimal>, empty],
    ['dependency NaN', empty, new Map([['net_new_arr@1', new Decimal(NaN)]])],
  ])('rejects invalid map decimal values: %s', (_label, operands, dependencies) => {
    const ast = dependencies.size > 0
      ? { kind: 'formula-ref', formulaId: 'net_new_arr', version: '1' } as const
      : { kind: 'operand', operandId: 'value' } as const;
    expectInvalid(() => evaluateAst(ast, operands, dependencies));
  });

  it('rejects non-Map and subclassed Map objects without invoking hostile methods', () => {
    let calls = 0;
    const hostile = {
      get() {
        calls += 1;
        throw new Error('get called');
      },
      has() {
        calls += 1;
        return true;
      },
    } as unknown as ReadonlyMap<string, Decimal>;
    class HostileMap extends Map<string, Decimal> {
      override entries(): MapIterator<[string, Decimal]> {
        calls += 1;
        throw new Error('entries called');
      }
    }

    expectInvalid(() => evaluateAst({ kind: 'literal', value: '1' }, hostile, empty));
    expectInvalid(() => evaluateAst(
      { kind: 'literal', value: '1' },
      new HostileMap([['unused', decimal('1')]]),
      empty,
    ));
    expect(calls).toBe(0);
  });

  it('does not mutate input maps or Decimal values and returns JSON-safe output', () => {
    const input = decimal('1.25');
    const operands = new Map([['value', input]]);
    const beforeEntries = [...operands];
    const beforeValue = input.toString();

    const result = evaluateAst({
      kind: 'multiply',
      values: [{ kind: 'operand', operandId: 'value' }, { kind: 'literal', value: '2' }],
    }, operands, empty);

    expect([...operands]).toEqual(beforeEntries);
    expect(input.toString()).toBe(beforeValue);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(JSON.stringify(result)).not.toContain('Decimal');
  });

  it('throws a fresh domain error for each invalid invocation', () => {
    const first = expectInvalid(() => evaluateAst({ kind: 'literal', value: '01' } as FormulaAst, empty, empty));
    const second = expectInvalid(() => evaluateAst({ kind: 'literal', value: '01' } as FormulaAst, empty, empty));
    expect(first).not.toBe(second);
  });
});
