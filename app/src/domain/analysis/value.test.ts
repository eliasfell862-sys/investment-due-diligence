import { describe, expect, it } from 'vitest';

import {
  DomainContractError,
  parseMetricValueStructure,
  parseMoneyValueStructure,
} from './value';

function expectInvalidDto(operation: () => unknown): void {
  try {
    operation();
    throw new Error('expected invalid_dto');
  } catch (error) {
    expect(error).toBeInstanceOf(DomainContractError);
    expect(error).toMatchObject({ code: 'invalid_dto', message: 'invalid_dto' });
  }
}

function expectNormalizedInvalidDto(operation: () => unknown, thrown: unknown): void {
  try {
    operation();
    throw new Error('expected invalid_dto');
  } catch (error) {
    expect(error).not.toBe(thrown);
    expect(error).toBeInstanceOf(DomainContractError);
    expect(error).toMatchObject({ code: 'invalid_dto', message: 'invalid_dto' });
  }
}

function withThrowingGetter(
  property: string,
  thrown: unknown,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const input = { ...fields };
  Object.defineProperty(input, property, {
    enumerable: true,
    get(): never {
      throw thrown;
    },
  });
  return input;
}

describe('DomainContractError', () => {
  it('preserves an explicit domain message', () => {
    expect(new DomainContractError('invalid_dto', 'MetricValue is damaged.').message).toBe(
      'MetricValue is damaged.',
    );
  });

  it('falls back to the code when no message is provided', () => {
    expect(new DomainContractError('invalid_dto').message).toBe('invalid_dto');
  });

  it.each([
    {
      [Symbol.toPrimitive](): never {
        throw new TypeError('must not coerce');
      },
    },
    Object.create(null) as object,
  ])('does not coerce hostile runtime messages', (hostile) => {
    expect(() => new DomainContractError('invalid_dto', hostile as never)).not.toThrow();
    expect(new DomainContractError('invalid_dto', hostile as never).message).toBe('invalid_dto');
  });
});

describe('parseMoneyValueStructure', () => {
  it('returns a fresh money value with its decimal amount and currency unchanged', () => {
    const input = { amount: '123.45', currency: 'CNY' };

    const result = parseMoneyValueStructure(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });
});

describe('parseMetricValueStructure', () => {
  it.each([
    { value: '45', unit: { kind: 'count', countKind: 'customer' } },
    { value: '0.25', unit: { kind: 'ratio', rateKind: 'unit-interval' } },
    { value: '1.2', unit: { kind: 'ratio', rateKind: 'non-negative-rate' } },
    { value: '-0.1', unit: { kind: 'ratio', rateKind: 'signed-rate' } },
    { value: '2.5', unit: { kind: 'ratio', rateKind: 'return-rate' } },
    { value: '3', unit: { kind: 'multiple' } },
    { value: '18', unit: { kind: 'duration', durationUnit: 'months' } },
    {
      value: '20',
      unit: { kind: 'currency-per-count', currency: 'CNY', countKind: 'customer' },
    },
    { value: '100', unit: { kind: 'currency', currency: 'JPY' } },
  ])('accepts and preserves $unit.kind values', (input) => {
    const result = parseMetricValueStructure(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.unit).not.toBe(input.unit);
  });

  it.each([
    { value: '1', unit: { kind: 'currency' } },
    { value: '1', unit: { kind: 'count' } },
    { value: '1', unit: { kind: 'ratio', rateKind: 'percent' } },
    { value: 1, unit: { kind: 'multiple' } },
    { unit: { kind: 'multiple' } },
    { value: '1', unit: { kind: 'currency', currency: 'cny' } },
    { value: '1', unit: { kind: 'currency', currency: 'US' } },
    {
      value: '1',
      unit: {
        kind: 'currency-per-count',
        currency: 'USD',
        countKind: 'user',
        perPeriod: 'quarter',
      },
    },
    [],
    null,
  ])('rejects malformed metric values as invalid_dto', (input) => {
    expectInvalidDto(() => parseMetricValueStructure(input));
  });

  it('rejects hostile non-string fields without coercing them or leaking native errors', () => {
    const hostile = {
      toString(): string {
        throw new TypeError('must not be called');
      },
    };

    expectInvalidDto(() =>
      parseMetricValueStructure({
        value: hostile,
        unit: { kind: 'currency', currency: hostile },
      }),
    );
  });

  it('leaves decimal validity to the formula layer', () => {
    expect(
      parseMetricValueStructure({ value: 'abc', unit: { kind: 'multiple' } }),
    ).toEqual({ value: 'abc', unit: { kind: 'multiple' } });
  });
});

describe('hostile value DTO normalization', () => {
  const parsers = [
    {
      name: 'money',
      parse: parseMoneyValueStructure,
      input: (thrown: unknown) => withThrowingGetter('amount', thrown, { currency: 'CNY' }),
    },
    {
      name: 'metric',
      parse: parseMetricValueStructure,
      input: (thrown: unknown) =>
        withThrowingGetter('value', thrown, { unit: { kind: 'multiple' } }),
    },
  ];

  it.each(parsers)('normalizes a spoofed DomainContractError from $name getters', ({ parse, input }) => {
    const spoofed = new DomainContractError('unknown_formula', 'spoofed');
    expectNormalizedInvalidDto(() => parse(input(spoofed)), spoofed);
  });

  it.each(parsers)('normalizes hostile thrown proxies from $name getters', ({ parse, input }) => {
    const hostile = new Proxy(Object.create(null) as object, {
      getPrototypeOf(): never {
        throw new TypeError('must not inspect prototype');
      },
    });
    expectNormalizedInvalidDto(() => parse(input(hostile)), hostile);
  });

  it('reads currency-per-count perPeriod exactly once', () => {
    let reads = 0;
    const unit = {
      kind: 'currency-per-count',
      currency: 'CNY',
      countKind: 'customer',
      get perPeriod(): string {
        reads += 1;
        return reads === 1 ? 'month' : 'quarter';
      },
    };

    expect(parseMetricValueStructure({ value: '20', unit })).toEqual({
      value: '20',
      unit: {
        kind: 'currency-per-count',
        currency: 'CNY',
        countKind: 'customer',
        perPeriod: 'month',
      },
    });
    expect(reads).toBe(1);
  });
});
