import { describe, expect, it } from 'vitest';

import { DomainContractError } from './value';
import { validateScenarioSet } from './scenario';

function expectInvalidDto(operation: () => unknown, thrown?: unknown): void {
  try {
    operation();
    throw new Error('expected invalid_dto');
  } catch (error) {
    if (thrown !== undefined) {
      expect(error).not.toBe(thrown);
    }
    expect(error).toBeInstanceOf(DomainContractError);
    expect(error).toMatchObject({ code: 'invalid_dto', message: 'invalid_dto' });
  }
}

describe('validateScenarioSet', () => {
  it('returns a valid, stably ordered set when probabilities add to exactly one', () => {
    const input = [
      { id: 'upside', probability: '0.2', assumptions: { growth: '0.3' } },
      { id: 'downside', probability: '0.3', assumptions: { growth: '-0.1' } },
      { id: 'base', probability: '0.5', assumptions: { growth: '0.1' } },
    ];

    const result = validateScenarioSet(input);

    expect(result).toEqual({
      status: 'valid',
      scenarios: [input[1], input[2], input[0]],
    });
    if (result.status === 'valid') {
      expect(result.scenarios).not.toBe(input);
      expect(result.scenarios[0]).not.toBe(input[1]);
      expect(result.scenarios[1]).not.toBe(input[2]);
      expect(result.scenarios[2]).not.toBe(input[0]);
    }
  });

  it.each([
    [
      'only one scenario',
      [{ id: 'base', probability: '1', assumptions: {} }],
    ],
    [
      'a duplicate and a missing unique scenario',
      [
        { id: 'downside', probability: '0.2', assumptions: {} },
        { id: 'base', probability: '0.3', assumptions: {} },
        { id: 'base', probability: '0.5', assumptions: {} },
      ],
    ],
    [
      'an unknown scenario id',
      [
        { id: 'downside', probability: '0.2', assumptions: {} },
        { id: 'base', probability: '0.3', assumptions: {} },
        { id: 'stretch', probability: '0.5', assumptions: {} },
      ],
    ],
  ] as const)('returns invalid_scenario_set for %s', (_label, input) => {
    expect(validateScenarioSet(input)).toEqual({
      status: 'invalid',
      issue: { code: 'invalid_scenario_set' },
    });
  });

  it.each(['0.30', 'abc'])('returns invalid_decimal for probability %j', (probability) => {
    expect(
      validateScenarioSet([
        { id: 'downside', probability, assumptions: {} },
        { id: 'base', probability: '0.5', assumptions: {} },
        { id: 'upside', probability: '0.2', assumptions: {} },
      ]),
    ).toEqual({ status: 'invalid', issue: { code: 'invalid_decimal' } });
  });

  it.each(['-0.1', '1.1'])('returns value_out_of_range for probability %j', (probability) => {
    expect(
      validateScenarioSet([
        { id: 'downside', probability, assumptions: {} },
        { id: 'base', probability: '0.5', assumptions: {} },
        { id: 'upside', probability: '0.5', assumptions: {} },
      ]),
    ).toEqual({ status: 'invalid', issue: { code: 'value_out_of_range' } });
  });

  it('uses decimal arithmetic when checking the probability sum', () => {
    expect(
      validateScenarioSet([
        { id: 'downside', probability: '0.3', assumptions: {} },
        { id: 'base', probability: '0.6', assumptions: {} },
        { id: 'upside', probability: '0.2', assumptions: {} },
      ]),
    ).toEqual({ status: 'invalid', issue: { code: 'probability_sum_mismatch' } });
  });

  it.each([
    ['null input', null],
    ['non-array input', { scenarios: [] }],
    ['null item', [null]],
    [
      'numeric probability',
      [
        { id: 'downside', probability: 0.2, assumptions: {} },
        { id: 'base', probability: '0.5', assumptions: {} },
        { id: 'upside', probability: '0.3', assumptions: {} },
      ],
    ],
    [
      'missing assumptions',
      [
        { id: 'downside', probability: '0.2' },
        { id: 'base', probability: '0.5', assumptions: {} },
        { id: 'upside', probability: '0.3', assumptions: {} },
      ],
    ],
    [
      'missing id',
      [
        { probability: '0.2', assumptions: {} },
        { id: 'base', probability: '0.5', assumptions: {} },
        { id: 'upside', probability: '0.3', assumptions: {} },
      ],
    ],
  ])('throws a fresh invalid_dto for %s', (_label, input) => {
    expectInvalidDto(() => validateScenarioSet(input));
  });

  it.each([
    new DomainContractError('unknown_formula', 'spoofed'),
    new Proxy(Object.create(null) as object, {
      getPrototypeOf(): never {
        throw new TypeError('must not inspect prototype');
      },
    }),
  ])('normalizes hostile exceptions from item getters', (thrown) => {
    const item: Record<string, unknown> = {
      probability: '1',
      assumptions: {},
    };
    Object.defineProperty(item, 'id', {
      enumerable: true,
      get(): never {
        throw thrown;
      },
    });

    expectInvalidDto(() => validateScenarioSet([item]), thrown);
  });

  it('does not modify the caller array order', () => {
    const input = [
      { id: 'upside', probability: '0.2', assumptions: {} },
      { id: 'downside', probability: '0.3', assumptions: {} },
      { id: 'base', probability: '0.5', assumptions: {} },
    ];
    const originalOrder = [...input];

    validateScenarioSet(input);

    expect(input).toEqual(originalOrder);
    expect(input[0]).toBe(originalOrder[0]);
    expect(input[1]).toBe(originalOrder[1]);
    expect(input[2]).toBe(originalOrder[2]);
  });
});
