import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../../domain/deep-freeze';
import { evaluateFormulaGraph } from './evaluate-formula-graph';
import { evaluateMetric } from './evaluate-metric';
import { currencyUnit, FY2025_BEGIN, FY2025_END, observation } from './formula-test-fixtures';
import type { FormulaObservation } from './formula-types';

const huge = '9999999999999999999999999999999999999999';

const burnObservations = (): FormulaObservation[] => [
  observation('net_cash_burn', '80'),
  observation('beginning_arr', '100', currencyUnit(), FY2025_BEGIN),
  observation('ending_arr', '180', currencyUnit(), FY2025_END),
];

function isDeepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

function expectSafeJson(value: unknown): string {
  const json = JSON.stringify(value);
  expect(json).not.toMatch(/Infinity|NaN|e[+-]?\d/i);
  expect(JSON.parse(json)).toEqual(value);
  return json;
}

describe('formula production invariants', () => {
  it('keeps extreme gross-margin arithmetic canonical and finite', () => {
    const result = evaluateMetric({
      formulaId: 'gross_margin', version: '1',
      observations: [observation('revenue', huge), observation('cost_of_goods_sold', '0')],
    });
    expect(result).toMatchObject({ status: 'ok', value: { value: { value: '1' } } });
    expectSafeJson(result);
  });

  it('uses deterministic 40-digit half-even decimal precision for one third', () => {
    const result = evaluateMetric({
      formulaId: 'ebitda_margin', version: '1',
      observations: [observation('ebitda', '1'), observation('revenue', '3')],
    });
    expect(result).toMatchObject({
      status: 'ok',
      value: { value: { value: '0.3333333333333333333333333333333333333333' } },
    });
    expectSafeJson(result);
  });

  it('accepts deeply frozen observations without mutating nested provenance, values, units, or periods', () => {
    const observations = deepFreeze([
      observation('revenue', '100', currencyUnit('USD'), undefined, { sourceRefs: ['b', 'a'] }),
      observation('cost_of_goods_sold', '40', currencyUnit('USD')),
    ]);
    const before = JSON.stringify(observations);
    evaluateMetric({ formulaId: 'gross_margin', version: '1', observations });
    expect(JSON.stringify(observations)).toBe(before);
    expect(isDeepFrozen(observations)).toBe(true);
  });

  it('keeps graph output byte-identical across equivalent root and observation orders', () => {
    const observations = [
      observation('revenue', '100'),
      observation('cost_of_goods_sold', '40'),
      ...burnObservations(),
    ];
    const first = evaluateFormulaGraph({
      requests: [
        { formulaId: 'burn_multiple', version: '1' },
        { formulaId: 'gross_margin', version: '1' },
      ],
      observations,
    });
    const second = evaluateFormulaGraph({
      requests: [
        { formulaId: 'gross_margin', version: '1' },
        { formulaId: 'burn_multiple', version: '1' },
      ],
      observations: [...observations].reverse(),
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('returns serializable deeply frozen graph calculations, values, trace, and steps', () => {
    const result = evaluateFormulaGraph({
      requests: [
        { formulaId: 'gross_margin', version: '1' },
        { formulaId: 'burn_multiple', version: '1' },
      ],
      observations: [
        observation('revenue', '100'),
        observation('cost_of_goods_sold', '40'),
        ...burnObservations(),
      ],
    });
    expectSafeJson(result);
    expect(isDeepFrozen(result)).toBe(true);
    if (result.status !== 'ok') throw new Error('expected ok graph');
    expect(isDeepFrozen(result.value)).toBe(true);
    expect(isDeepFrozen(result.trace.steps)).toBe(true);
  });

  it('keeps blocked zero-over-zero results frozen, finite, and free of placeholder numbers', () => {
    const result = evaluateFormulaGraph({
      requests: [{ formulaId: 'gross_margin', version: '1' }],
      observations: [observation('revenue', '0'), observation('cost_of_goods_sold', '0')],
    });
    expect(result).toMatchObject({
      status: 'blocked', reason: 'not-meaningful', issues: [{ code: 'division_by_zero' }],
    });
    const json = expectSafeJson(result);
    expect(json).not.toMatch(/placeholder|null_value|sentinel/i);
    expect(isDeepFrozen(result)).toBe(true);
  });

  it('is deterministic across duplicate calls and preserves extreme canonical strings', () => {
    const input = {
      requests: [
        { formulaId: 'gross_margin', version: '1' },
        { formulaId: 'ebitda_margin', version: '1' },
        { formulaId: 'gross_margin', version: '1' },
      ],
      observations: [
        observation('revenue', huge),
        observation('cost_of_goods_sold', '0'),
        observation('ebitda', '1'),
      ],
    };
    const first = evaluateFormulaGraph(input);
    const second = evaluateFormulaGraph(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toMatchObject({
      status: 'ok',
      value: { calculations: [
        { formulaId: 'gross_margin', value: { value: '1' } },
        { formulaId: 'ebitda_margin', value: { value: '0.0000000000000000000000000000000000000001' } },
      ] },
    });
    expectSafeJson(first);
  });
});
