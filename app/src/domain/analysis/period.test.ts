import { describe, expect, it } from 'vitest';

import {
  DomainContractError,
  parseAnalysisPeriodStructure,
  validateAnalysisPeriodValue,
} from './period';

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

function periodWithThrowingKind(thrown: unknown): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  Object.defineProperty(input, 'kind', {
    enumerable: true,
    get(): never {
      throw thrown;
    },
  });
  return input;
}

describe('analysis period parsing and value validation', () => {
  it.each([
    {
      kind: 'flow',
      id: 'FY2025',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      durationMonths: 12,
      granularity: 'year',
    },
    {
      kind: 'flow',
      id: '2025-02',
      startDate: '2025-02-01',
      endDate: '2025-02-28',
      durationMonths: 1,
      granularity: 'month',
    },
    {
      kind: 'flow',
      id: 'model-year-1',
      startDate: '2025-02-01',
      endDate: '2026-01-31',
      durationMonths: 12,
      granularity: 'year',
    },
    { kind: 'as-of', id: 'AsOf 2025-12-31', date: '2025-12-31' },
  ] as const)('returns a valid result for $id', (input) => {
    const period = parseAnalysisPeriodStructure(input);

    expect(validateAnalysisPeriodValue(period)).toEqual({ status: 'valid', period });
    expect(period).toEqual(input);
    expect(period).not.toBe(input);
  });

  it.each([
    {
      kind: 'flow',
      id: 'bad-date',
      startDate: '2025-13-01',
      endDate: '2025-12-31',
      durationMonths: 12,
      granularity: 'year',
    },
    {
      kind: 'flow',
      id: 'bad-duration',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      durationMonths: 11,
      granularity: 'year',
    },
    {
      kind: 'flow',
      id: 'not-month-start',
      startDate: '2025-02-02',
      endDate: '2025-02-28',
      durationMonths: 1,
      granularity: 'month',
    },
    { kind: 'as-of', id: 'not-a-leap-day', date: '2025-02-29' },
    {
      kind: 'flow',
      id: 'incomplete-year',
      startDate: '2025-01-01',
      endDate: '2025-11-30',
      durationMonths: 11,
      granularity: 'year',
    },
    { kind: 'as-of', id: '', date: '2025-12-31' },
    {
      kind: 'flow',
      id: 'reverse',
      startDate: '2025-03-01',
      endDate: '2025-02-28',
      durationMonths: 1,
      granularity: 'month',
    },
  ] as const)('returns invalid without throwing for $id', (input) => {
    const period = parseAnalysisPeriodStructure(input);

    expect(() => validateAnalysisPeriodValue(period)).not.toThrow();
    expect(validateAnalysisPeriodValue(period)).toEqual({ status: 'invalid' });
  });

  it.each([
    {},
    { id: 'missing-kind', date: '2025-01-01' },
    { kind: 'as-of', date: '2025-01-01' },
    { kind: 'as-of', id: 'missing-date' },
    { kind: 'flow', id: 'missing-flow-fields' },
    {
      kind: 'flow',
      id: 'wrong-duration-type',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      durationMonths: '12',
      granularity: 'year',
    },
    {
      kind: 'flow',
      id: 'wrong-field-types',
      startDate: 1,
      endDate: false,
      durationMonths: 1,
      granularity: 'quarter',
    },
    null,
    [],
  ])('rejects structurally malformed periods as invalid_dto', (input) => {
    expectInvalidDto(() => parseAnalysisPeriodStructure(input));
  });
});

describe('hostile period DTO normalization', () => {
  it('normalizes a spoofed DomainContractError thrown from a getter', () => {
    const spoofed = new DomainContractError('unknown_formula', 'spoofed');
    expectNormalizedInvalidDto(() => parseAnalysisPeriodStructure(periodWithThrowingKind(spoofed)), spoofed);
  });

  it('normalizes a hostile thrown proxy without inspecting its prototype', () => {
    const hostile = new Proxy(Object.create(null) as object, {
      getPrototypeOf(): never {
        throw new TypeError('must not inspect prototype');
      },
    });
    expectNormalizedInvalidDto(() => parseAnalysisPeriodStructure(periodWithThrowingKind(hostile)), hostile);
  });

  it('reads durationMonths exactly once', () => {
    let reads = 0;
    const input = {
      kind: 'flow',
      id: 'FY2025',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      get durationMonths(): number | string {
        reads += 1;
        return reads === 1 ? 12 : 'bad';
      },
      granularity: 'year',
    };

    expect(parseAnalysisPeriodStructure(input)).toEqual({
      kind: 'flow',
      id: 'FY2025',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      durationMonths: 12,
      granularity: 'year',
    });
    expect(reads).toBe(1);
  });
});
