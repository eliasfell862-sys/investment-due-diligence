import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { EngineResult } from '../../domain/analysis/engine-result';
import { DomainContractError } from '../../domain/analysis/value';
import { evaluateFormulaGraph } from './evaluate-formula-graph';
import {
  currencyUnit,
  FY2025,
  FY2025_BEGIN,
  FY2025_END,
  observation,
} from './formula-test-fixtures';
import type {
  FormulaGraphInput,
  FormulaGraphResult,
  FormulaObservation,
} from './formula-types';

const fullObservations = (): FormulaObservation[] => [
  observation('revenue', '100'),
  observation('cost_of_goods_sold', '40'),
  observation('net_cash_burn', '80'),
  observation('beginning_arr', '100', currencyUnit(), FY2025_BEGIN),
  observation('ending_arr', '180', currencyUnit(), FY2025_END),
];

const graphInput = (
  requests: FormulaGraphInput['requests'],
  observations: readonly FormulaObservation[] = fullObservations(),
): FormulaGraphInput => ({ requests, observations });

const expectDomainError = (
  run: () => unknown,
  code: DomainContractError['code'],
): DomainContractError => {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainContractError);
  expect((thrown as DomainContractError).code).toBe(code);
  return thrown as DomainContractError;
};

const expectBlocked = (
  result: EngineResult<FormulaGraphResult>,
  code: string,
) => {
  expect(result).toMatchObject({
    status: 'blocked',
    reason: 'invalid-input',
    issues: [{ code }],
    trace: { engine: 'formula', formulaRef: 'formula_graph@1' },
  });
  if (result.status !== 'blocked') throw new Error('expected blocked graph');
  return result;
};

function isDeepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

afterEach(() => {
  vi.doUnmock('./formula-registry');
  vi.resetModules();
});

describe('evaluateFormulaGraph', () => {
  it.each([
    ['null graph', null],
    ['non-array requests', { requests: {}, observations: [] }],
    ['non-array observations', { requests: [], observations: {} }],
    ['extra graph field', { requests: [], observations: [], extra: true }],
    ['non-object request', { requests: [null], observations: [] }],
    ['non-string formula id', { requests: [{ formulaId: 1, version: '1' }], observations: [] }],
    ['non-string version', { requests: [{ formulaId: 'gross_margin', version: 1 }], observations: [] }],
    ['extra request field', { requests: [{ formulaId: 'gross_margin', version: '1', extra: true }], observations: [] }],
  ])('throws a fresh invalid_dto for %s', (_label, input) => {
    const first = expectDomainError(() => evaluateFormulaGraph(input as never), 'invalid_dto');
    const second = expectDomainError(() => evaluateFormulaGraph(input as never), 'invalid_dto');
    expect(first).not.toBe(second);
  });

  it('rejects sparse, class, inherited, accessor, symbol, and proxy requests safely', () => {
    class RequestDto {
      formulaId = 'gross_margin';
      version = '1';
    }
    const inherited = Object.create({ formulaId: 'gross_margin' }) as Record<string, unknown>;
    inherited.version = '1';
    let accessorReads = 0;
    const accessor = Object.defineProperty({ version: '1' }, 'formulaId', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'gross_margin';
      },
    });
    const symbolRequest = { formulaId: 'gross_margin', version: '1' } as Record<PropertyKey, unknown>;
    symbolRequest[Symbol('extra')] = true;
    const sparse = new Array<{ readonly formulaId: string; readonly version: string }>(1);
    let proxyTraps = 0;
    const proxy = new Proxy({ requests: [], observations: [] }, {
      ownKeys() {
        proxyTraps += 1;
        throw new Error('proxy trap executed');
      },
    });
    const inputs = [
      { requests: sparse, observations: [] },
      { requests: [new RequestDto()], observations: [] },
      { requests: [inherited], observations: [] },
      { requests: [accessor], observations: [] },
      { requests: [symbolRequest], observations: [] },
      proxy,
    ];

    for (const input of inputs) {
      const first = expectDomainError(() => evaluateFormulaGraph(input as never), 'invalid_dto');
      const second = expectDomainError(() => evaluateFormulaGraph(input as never), 'invalid_dto');
      expect(first).not.toBe(second);
    }
    expect(accessorReads).toBe(0);
    expect(proxyTraps).toBe(2);
  });

  it('deduplicates roots and emits dependency-first calculations in registry order', () => {
    const result = evaluateFormulaGraph(graphInput([
      { formulaId: 'burn_multiple', version: '1' },
      { formulaId: 'gross_margin', version: '1' },
      { formulaId: 'net_new_arr', version: '1' },
      { formulaId: 'burn_multiple', version: '1' },
    ]));

    expectTypeOf(result).toEqualTypeOf<EngineResult<FormulaGraphResult>>();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok graph');
    expect(result.value.calculations.map((calculation) => calculation.formulaId)).toEqual([
      'gross_margin', 'net_new_arr', 'burn_multiple',
    ]);
    expect(result.value.calculations.map((calculation) => calculation.value.value)).toEqual([
      '0.6', '80', '1',
    ]);
    expect(result.trace.steps.slice(-3)).toEqual([
      { id: 'formula_graph@1:evaluate:1', operator: 'evaluate', operands: ['gross_margin@1'], result: '0.6' },
      { id: 'formula_graph@1:evaluate:2', operator: 'evaluate', operands: ['net_new_arr@1'], result: '80' },
      { id: 'formula_graph@1:evaluate:3', operator: 'evaluate', operands: ['burn_multiple@1'], result: '1' },
    ]);
    expect(result.trace.output).toEqual(result.value.calculations.at(-1)?.value);
  });

  it('preserves conservative warnings and source provenance through burn dependencies', () => {
    const observations = [
      observation('net_cash_burn', '80', currencyUnit(), FY2025, {
        sourceRefs: ['z-root', 'a-root'],
        conflict: { status: 'conservative-selected', selectionReason: 'root conservative' },
      }),
      observation('beginning_arr', '100', currencyUnit(), FY2025_BEGIN, {
        sourceRefs: ['dep-begin'],
        conflict: { status: 'conservative-selected', selectionReason: 'dependency conservative' },
      }),
      observation('ending_arr', '180', currencyUnit(), FY2025_END, {
        sourceRefs: ['dep-end'], conflict: { status: 'none' },
      }),
    ];
    const result = evaluateFormulaGraph(graphInput([
      { formulaId: 'burn_multiple', version: '1' },
    ], observations));

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok graph');
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.map((warning) => warning.details.selectionReason)).toEqual([
      'dependency conservative', 'root conservative',
    ]);
    expect(result.trace.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricId: 'net_cash_burn', sourceRefs: ['a-root', 'z-root'] }),
      expect.objectContaining({ metricId: 'beginning_arr', sourceRefs: ['dep-begin'] }),
    ]));
  });

  it('is byte-identical for reordered requests and reversed observations', () => {
    const observations = fullObservations();
    const first = evaluateFormulaGraph(graphInput([
      { formulaId: 'burn_multiple', version: '1' },
      { formulaId: 'gross_margin', version: '1' },
    ], observations));
    const second = evaluateFormulaGraph(graphInput([
      { formulaId: 'gross_margin', version: '1' },
      { formulaId: 'burn_multiple', version: '1' },
    ], [...observations].reverse()));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('returns a stable empty success without undefined properties', () => {
    const first = evaluateFormulaGraph({ requests: [], observations: [] });
    const second = evaluateFormulaGraph({ requests: [], observations: [] });
    expect(first).toEqual({
      status: 'ok', value: { calculations: [] }, warnings: [],
      trace: { engine: 'formula', formulaRef: 'formula_graph@1', inputs: [], steps: [] },
    });
    expect(Object.hasOwn(first.trace, 'output')).toBe(false);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).not.toContain('undefined');
  });

  it('deduplicates identical requests but keeps versions distinct and blocks unsupported versions', () => {
    const duplicate = evaluateFormulaGraph(graphInput([
      { formulaId: 'gross_margin', version: '1' },
      { formulaId: 'gross_margin', version: '1' },
    ]));
    expect(duplicate.status).toBe('ok');
    if (duplicate.status !== 'ok') throw new Error('expected ok graph');
    expect(duplicate.value.calculations).toHaveLength(1);

    const unsupported = expectBlocked(evaluateFormulaGraph(graphInput([
      { formulaId: 'gross_margin', version: '2' },
    ])), 'unsupported_formula');
    expect(unsupported.issues[0]).toEqual({
      code: 'unsupported_formula', path: 'formula.gross_margin@2',
      message: 'gross_margin@2: unsupported_formula',
      details: { formulaId: 'gross_margin', version: '2' },
    });
  });

  it('throws a fresh unknown_formula error without coercing unknown ids', () => {
    const first = expectDomainError(() => evaluateFormulaGraph(graphInput([
      { formulaId: 'unknown_formula', version: '1' },
    ])), 'unknown_formula');
    const second = expectDomainError(() => evaluateFormulaGraph(graphInput([
      { formulaId: 'unknown_formula', version: '1' },
    ])), 'unknown_formula');
    expect(first).not.toBe(second);
  });

  it('preserves prior successful provenance when a later version blocks', () => {
    const result = expectBlocked(evaluateFormulaGraph(graphInput([
      { formulaId: 'gross_margin', version: '2' },
      { formulaId: 'gross_margin', version: '1' },
    ])), 'unsupported_formula');
    expect(result.trace.inputs.map((input) => input.valueRef)).toEqual([
      'cost_of_goods_sold:FY2025', 'revenue:FY2025',
    ]);
    expect(result.trace.steps.some((step) => step.id.startsWith('gross_margin@1:'))).toBe(true);
    expect(result.trace.steps.at(-1)).toEqual({
      id: 'formula_graph@1:evaluate:1', operator: 'evaluate',
      operands: ['gross_margin@1'], result: '0.6',
    });
  });

  it('outputs an explicit dependency and its consumer only once', () => {
    const result = evaluateFormulaGraph(graphInput([
      { formulaId: 'net_new_arr', version: '1' },
      { formulaId: 'burn_multiple', version: '1' },
      { formulaId: 'net_new_arr', version: '1' },
    ]));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok graph');
    expect(result.value.calculations.map((calculation) => calculation.formulaId)).toEqual([
      'net_new_arr', 'burn_multiple',
    ]);
    expect(result.trace.steps.filter((step) => step.operator === 'evaluate')).toHaveLength(2);
  });

  it('does not mutate graph inputs and returns deeply frozen defensive data', () => {
    const input = graphInput([
      { formulaId: 'gross_margin', version: '1' },
      { formulaId: 'burn_multiple', version: '1' },
    ]);
    const before = JSON.stringify(input);
    const result = evaluateFormulaGraph(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(isDeepFrozen(result)).toBe(true);
  });

  it('preflights circular dependencies and reports a canonical cycle', async () => {
    vi.resetModules();
    vi.doMock('./formula-registry', async () => {
      const actual = await vi.importActual<typeof import('./formula-registry')>('./formula-registry');
      return {
        ...actual,
        getFormulaDependencies: (formulaId: string) => {
          if (formulaId === 'gross_margin') return [{ formulaId: 'ebitda_margin', version: '1' }] as const;
          if (formulaId === 'ebitda_margin') return [{ formulaId: 'gross_margin', version: '1' }] as const;
          return [];
        },
      };
    });
    const { evaluateFormulaGraph: evaluateMockedGraph } = await import('./evaluate-formula-graph');
    const result = expectBlocked(evaluateMockedGraph(graphInput([
      { formulaId: 'gross_margin', version: '1' },
    ])), 'circular_dependency');
    expect(result.issues).toEqual([{
      code: 'circular_dependency', path: 'formula.gross_margin@1',
      message: 'gross_margin@1: circular_dependency',
      details: { cycle: 'ebitda_margin@1>gross_margin@1>ebitda_margin@1' },
    }]);
    expect(result.trace).toEqual({
      engine: 'formula', formulaRef: 'formula_graph@1', inputs: [], steps: [],
    });
  });
});
