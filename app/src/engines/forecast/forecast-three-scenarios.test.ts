import { describe, expect, it } from 'vitest';

import { forecastInput } from './forecast-test-fixtures';
import { forecastThreeScenarios } from './forecast-three-scenarios';

describe('forecastThreeScenarios', () => {
  it('returns canonical scenarios, complete years, and a forecast trace', () => {
    const result = forecastThreeScenarios(forecastInput());

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.value.scenarios.map((scenario) => scenario.id)).toEqual([
        'downside',
        'base',
        'upside',
      ]);
      expect(result.value.scenarios.every((scenario) =>
        scenario.months.length === 36 &&
        scenario.modelYears.length === 3)).toBe(true);
      expect(result.trace.engine).toBe('forecast');
      expect(result.trace.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
        'downside',
        'base',
        'upside',
      ]);
      expect(result.trace.inputs.map((input) => input.valueRef)).toEqual(
        [...result.trace.inputs.map((input) => input.valueRef)].sort(),
      );
    }
  });

  it('blocks the complete set when one input assumption is invalid', () => {
    const input = forecastInput({
      scenarios: forecastInput().scenarios.map((scenario, index) => {
        if (index !== 0) return scenario;
        return {
          ...scenario,
          assumptions: {
            ...scenario.assumptions,
            taxRate: {
              ...scenario.assumptions.taxRate,
              value: {
                ...scenario.assumptions.taxRate.value,
                value: '2',
              },
            },
          },
        };
      }),
    });

    expect(forecastThreeScenarios(input)).toMatchObject({
      status: 'blocked',
      reason: 'invalid-input',
      issues: [{ code: 'value_out_of_range' }],
      trace: { engine: 'forecast', forecastRef: 'three-scenario@1' },
    });
  });

  it('preserves conservative warnings and their reasons', () => {
    const result = forecastThreeScenarios(forecastInput({
      baseline: {
        beginningCash: {
          conflict: {
            status: 'conservative-selected',
            selectionReason: 'lower verified cash balance',
          },
        },
      },
    }));

    expect(result).toMatchObject({
      status: 'ok',
      warnings: [{
        code: 'unresolved_conflict',
        details: { selectionReason: 'lower verified cash balance' },
      }],
    });
  });

  it('does not mutate input and returns deeply frozen JSON-safe snapshots', () => {
    const input = forecastInput();
    const before = JSON.stringify(input);
    const result = forecastThreeScenarios(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.trace)).toBe(true);
    if (result.status === 'ok') {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.scenarios[0]?.months)).toBe(true);
    }
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('is byte deterministic for equivalent repeated calls', () => {
    const first = JSON.stringify(forecastThreeScenarios(forecastInput()));
    const second = JSON.stringify(forecastThreeScenarios(forecastInput()));
    expect(second).toBe(first);
  });

  it('accepts unknown and rejects hostile DTOs through the structural boundary', () => {
    const hostile = new Proxy(forecastInput(), {
      ownKeys(): never {
        throw new RangeError('hostile');
      },
    });
    expect(() => forecastThreeScenarios(hostile)).toThrowError(
      expect.objectContaining({ code: 'invalid_dto' }),
    );
  });
});
