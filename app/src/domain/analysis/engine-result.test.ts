import { describe, expect, it } from 'vitest';

import type { CalculationTrace } from './calculation-trace';
import { blockedResult, okResult } from './engine-result';

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

    const result = okResult(value, warnings, trace);

    expect(result).toEqual({ status: 'ok', value, warnings, trace });
    expect(result.warnings).not.toBe(warnings);
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

    const result = blockedResult('invalid-input', issues, trace);

    expect(result).toEqual({ status: 'blocked', reason: 'invalid-input', issues, trace });
    expect(result.issues).not.toBe(issues);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
    expect(Object.isFrozen(result.issues[0])).toBe(true);
    expect(Object.isFrozen(result.issues[0]?.details)).toBe(true);
    expectTraceFrozen(result.trace);

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain('undefined');
  });
});
