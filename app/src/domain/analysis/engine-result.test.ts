import { describe, expect, it } from 'vitest';

import type { CalculationTrace } from './calculation-trace';
import { blockedResult, okResult } from './engine-result';
import { DomainContractError } from './value';

function makeTrace(): CalculationTrace {
  return {
    engine: 'formula',
    formulaRef: 'gross-margin',
    inputs: [
      {
        valueRef: 'revenue',
        metricId: 'revenue',
        value: '100',
        unit: { kind: 'currency', currency: 'CNY' },
        periodId: 'FY2025',
        sourceRefs: ['source-1'],
      },
    ],
    steps: [
      {
        id: 'divide-1',
        operator: 'divide',
        operands: ['gross-profit', 'revenue'],
        result: '0.25',
        rule: 'denominator must be positive',
        outcome: 'passed',
      },
    ],
    output: {
      value: '-0.25',
      unit: { kind: 'ratio', rateKind: 'signed-rate' },
    },
  };
}

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

function expectTraceFrozen(trace: CalculationTrace): void {
  expect(Object.isFrozen(trace)).toBe(true);
  expect(Object.isFrozen(trace.inputs)).toBe(true);
  expect(Object.isFrozen(trace.inputs[0])).toBe(true);
  expect(Object.isFrozen(trace.inputs[0]?.unit)).toBe(true);
  expect(Object.isFrozen(trace.inputs[0]?.sourceRefs)).toBe(true);
  expect(Object.isFrozen(trace.steps)).toBe(true);
  expect(Object.isFrozen(trace.steps[0])).toBe(true);
  expect(Object.isFrozen(trace.output)).toBe(true);
  expect(Object.isFrozen(trace.output?.unit)).toBe(true);
}

describe('analysis engine result factories', () => {
  it('deep-freezes an ok result and remains JSON serializable without undefined', () => {
    const trace = makeTrace();
    const warnings = [
      {
        code: 'insufficient_comparables' as const,
        path: 'inputs.comparables',
        message: 'Only two comparables were available.',
        details: { available: 2, required: 3, fallbackUsed: false, note: null },
      },
    ];
    const value = {
      value: '-0.25',
      unit: { kind: 'ratio' as const, rateKind: 'signed-rate' as const },
    };
    Object.freeze(value);
    Object.freeze(trace);

    const result = okResult(value, warnings, trace);

    expect(result).toEqual({ status: 'ok', value, warnings, trace });
    expect(result.value).not.toBe(value);
    expect(result.value.unit).not.toBe(value.unit);
    expect(result.warnings).not.toBe(warnings);
    expect(result.warnings[0]).not.toBe(warnings[0]);
    expect(result.warnings[0]?.details).not.toBe(warnings[0]?.details);
    expect(result.trace).not.toBe(trace);
    expect(result.trace.inputs).not.toBe(trace.inputs);
    expect(result.trace.inputs[0]).not.toBe(trace.inputs[0]);
    expect(Object.isFrozen(value.unit)).toBe(false);
    expect(Object.isFrozen(trace.inputs)).toBe(false);
    expect(Object.isFrozen(trace.inputs[0])).toBe(false);
    expect(Object.isFrozen(warnings)).toBe(false);
    expect(Object.isFrozen(warnings[0])).toBe(false);
    expect(Object.isFrozen(warnings[0]?.details)).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.unit)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
    expect(Object.isFrozen(result.warnings[0])).toBe(true);
    expect(Object.isFrozen(result.warnings[0]?.details)).toBe(true);
    expectTraceFrozen(result.trace);

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain('undefined');
  });

  it('deep-freezes a blocked result and remains JSON serializable without undefined', () => {
    const trace = makeTrace();
    const issues = [
      {
        code: 'unit_mismatch' as const,
        path: 'steps.divide-1.operands',
        message: 'Operands must use compatible units.',
        details: { numerator: 'CNY', denominator: 'count', recoverable: false },
      },
    ];
    Object.freeze(trace);

    const result = blockedResult('invalid-input', issues, trace);

    expect(result).toEqual({ status: 'blocked', reason: 'invalid-input', issues, trace });
    expect(result.issues).not.toBe(issues);
    expect(result.issues[0]).not.toBe(issues[0]);
    expect(result.issues[0]?.details).not.toBe(issues[0]?.details);
    expect(result.trace).not.toBe(trace);
    expect(result.trace.inputs).not.toBe(trace.inputs);
    expect(Object.isFrozen(trace.inputs)).toBe(false);
    expect(Object.isFrozen(issues)).toBe(false);
    expect(Object.isFrozen(issues[0])).toBe(false);
    expect(Object.isFrozen(issues[0]?.details)).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
    expect(Object.isFrozen(result.issues[0])).toBe(true);
    expect(Object.isFrozen(result.issues[0]?.details)).toBe(true);
    expectTraceFrozen(result.trace);

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain('undefined');
  });

  const factories = [
    {
      name: 'ok',
      create: (trace: CalculationTrace) =>
        okResult({ value: '1', unit: { kind: 'multiple' } }, [], trace),
    },
    {
      name: 'blocked',
      create: (trace: CalculationTrace) =>
        blockedResult('invalid-input', [], trace),
    },
  ] as const;

  const invalidTraceCases = [
    [
      'BigInt',
      () => ({
        trace: { ...makeTrace(), formulaRef: 1n } as unknown as CalculationTrace,
      }),
    ],
    [
      'own undefined',
      () => ({
        trace: { ...makeTrace(), formulaRef: undefined } as unknown as CalculationTrace,
      }),
    ],
    [
      'NaN',
      () => ({
        trace: { ...makeTrace(), formulaRef: Number.NaN } as unknown as CalculationTrace,
      }),
    ],
    [
      'Infinity',
      () => ({
        trace: {
          ...makeTrace(),
          formulaRef: Number.POSITIVE_INFINITY,
        } as unknown as CalculationTrace,
      }),
    ],
    [
      'function',
      () => ({
        trace: { ...makeTrace(), formulaRef: () => 'formula' } as unknown as CalculationTrace,
      }),
    ],
    [
      'circular reference',
      () => {
        const trace = { ...makeTrace() } as Record<string, unknown>;
        trace.self = trace;
        return { trace: trace as unknown as CalculationTrace };
      },
    ],
    [
      'class instance',
      () => {
        class TraceDto {}
        return {
          trace: Object.assign(new TraceDto(), makeTrace()) as CalculationTrace,
        };
      },
    ],
    [
      'throwing accessor',
      () => {
        const thrown = new TypeError('hostile getter');
        const trace = { ...makeTrace() };
        Object.defineProperty(trace, 'formulaRef', {
          enumerable: true,
          get(): never {
            throw thrown;
          },
        });
        return { trace, thrown };
      },
    ],
    [
      'symbol key',
      () => {
        const trace = { ...makeTrace() } as Record<PropertyKey, unknown>;
        trace[Symbol('extra')] = 'not-json';
        return { trace: trace as unknown as CalculationTrace };
      },
    ],
    [
      'sparse array',
      () => ({
        trace: {
          ...makeTrace(),
          inputs: new Array<unknown>(1),
        } as unknown as CalculationTrace,
      }),
    ],
    [
      'hostile reflection proxy',
      () => {
        const thrown = new TypeError('hostile ownKeys');
        return {
          trace: new Proxy(makeTrace(), {
            ownKeys(): never {
              throw thrown;
            },
          }),
          thrown,
        };
      },
    ],
  ] as const;

  it.each(invalidTraceCases)('rejects non-JSON trace DTO: %s', (_label, makeCase) => {
    for (const factory of factories) {
      const testCase = makeCase();
      const thrown = 'thrown' in testCase ? testCase.thrown : undefined;
      expectInvalidDto(() => factory.create(testCase.trace), thrown);
    }
  });
});
