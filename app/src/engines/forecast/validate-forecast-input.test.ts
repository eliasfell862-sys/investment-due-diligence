import { describe, expect, it } from 'vitest';

import { DomainContractError } from '../../domain/analysis/value';
import {
  forecastAssumptions,
  forecastInput,
} from './forecast-test-fixtures';
import type { SeasonalityPattern } from './forecast-types';
import { validateForecastInput } from './validate-forecast-input';

function expectInvalidDto(action: () => unknown): void {
  expect(action).toThrowError(
    expect.objectContaining<Partial<DomainContractError>>({
      code: 'invalid_dto',
    }),
  );
}

function seasonality(
  multipliers: SeasonalityPattern['multipliers'],
): SeasonalityPattern {
  return {
    valueRef: 'seasonality',
    sourceRefs: ['assumption:seasonality'],
    multipliers,
  };
}

describe('validateForecastInput', () => {
  it('normalizes a complete request in canonical scenario and trace order', () => {
    const result = validateForecastInput(forecastInput());

    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.input.scenarios.map((scenario) => scenario.id)).toEqual([
        'downside',
        'base',
        'upside',
      ]);
      expect(result.warnings).toEqual([]);
      expect(result.traceInputs.map((input) => input.valueRef)).toEqual(
        [...result.traceInputs.map((input) => input.valueRef)].sort(),
      );
      expect(new Set(result.traceInputs.map((input) => input.valueRef)).size).toBe(
        result.traceInputs.length,
      );
    }
  });

  it.each([
    ['unsupported version', () => ({ ...forecastInput(), version: '2' }), 'unsupported_engine_version'],
    [
      'unsupported horizon',
      () => ({ ...forecastInput(), baseline: { ...forecastInput().baseline, horizonMonths: 42 } }),
      'invalid_forecast_horizon',
    ],
    [
      'invalid start month',
      () => ({ ...forecastInput(), baseline: { ...forecastInput().baseline, forecastStartMonth: '2026-13' } }),
      'period_mismatch',
    ],
  ] as const)('blocks an %s', (_label, createInput, code) => {
    const result = validateForecastInput(createInput());
    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'invalid-input',
      issues: [{ code }],
    });
  });

  it('blocks invalid scenario probabilities and annual-rate lengths', () => {
    const probability = forecastInput({
      scenarios: forecastInput().scenarios.map((scenario) => ({
        ...scenario,
        probability: '0.4',
      })),
    });
    expect(validateForecastInput(probability)).toMatchObject({
      status: 'blocked',
      issues: [{ code: 'probability_sum_mismatch' }],
    });

    const annual = forecastInput({
      scenarios: forecastInput().scenarios.map((scenario) => ({
        ...scenario,
        assumptions: {
          ...scenario.assumptions,
          costOfGoodsSold: {
            kind: 'revenue-ratio',
            modelYearRates: [],
          },
        },
      })),
    });
    expect(validateForecastInput(annual)).toMatchObject({
      status: 'blocked',
      issues: [{ code: 'invalid_forecast_horizon' }],
    });
  });

  it('prioritizes an invalid scenario set over duplicate nested valueRefs', () => {
    const source = forecastInput();
    const duplicated = {
      ...source,
      scenarios: [source.scenarios[0], source.scenarios[0], source.scenarios[0]],
    };

    expect(validateForecastInput(duplicated)).toMatchObject({
      status: 'blocked',
      issues: [{ code: 'invalid_scenario_set' }],
    });
  });

  it('accepts exact direct seasonality and rejects non-positive or inexact sums', () => {
    const withSeasonality = (
      multipliers: SeasonalityPattern['multipliers'],
    ) => {
      const source = forecastInput();
      return {
        ...source,
        scenarios: source.scenarios.map((scenario, index) => {
          if (
            index !== 0 ||
            scenario.assumptions.revenue.kind !==
              'customer-count-times-average-revenue'
          ) {
            return scenario;
          }
          return {
            ...scenario,
            assumptions: {
              ...scenario.assumptions,
              revenue: {
                ...scenario.assumptions.revenue,
                customerCount: {
                  ...scenario.assumptions.revenue.customerCount,
                  seasonality: seasonality(multipliers),
                },
              },
            },
          };
        }),
      };
    };
    const valid = withSeasonality([
      '1', '1', '1', '1', '1', '1',
      '1', '1', '1', '1', '1', '1',
    ]);
    expect(validateForecastInput(valid).status).toBe('valid');

    for (const multipliers of [
      ['0', '1', '1', '1', '1', '1', '1', '1', '1', '1', '1', '2'] as const,
      ['1.1', '1', '1', '1', '1', '1', '1', '1', '1', '1', '1', '1'] as const,
    ]) {
      const input = withSeasonality(multipliers);
      expect(validateForecastInput(input)).toMatchObject({
        status: 'blocked',
        issues: [{ code: 'invalid_seasonality' }],
      });
    }
  });

  it('blocks blocking conflicts and warns for conservative selections', () => {
    const blocking = forecastInput({
      baseline: {
        beginningCash: {
          conflict: { status: 'blocking' },
        },
      },
    });
    expect(validateForecastInput(blocking)).toMatchObject({
      status: 'blocked',
      issues: [{ code: 'unresolved_conflict' }],
    });

    const conservative = forecastInput({
      baseline: {
        beginningCash: {
          conflict: {
            status: 'conservative-selected',
            selectionReason: 'lower verified cash balance',
          },
        },
      },
    });
    const result = validateForecastInput(conservative);
    expect(result).toMatchObject({
      status: 'valid',
      warnings: [{
        code: 'unresolved_conflict',
        details: { selectionReason: 'lower verified cash balance' },
      }],
    });
  });

  it('blocks duplicate valueRefs and wrong currency units', () => {
    const duplicate = forecastInput({
      baseline: {
        minimumCashBalance: {
          valueRef: 'forecast.baseline.beginning-cash',
        },
      },
    });
    expect(validateForecastInput(duplicate)).toMatchObject({
      status: 'blocked',
      issues: [{ code: 'value_out_of_range' }],
    });

    const currency = forecastInput({
      baseline: {
        beginningCash: {
          value: {
            unit: { kind: 'currency', currency: 'USD' },
          },
        },
      },
    });
    expect(validateForecastInput(currency)).toMatchObject({
      status: 'blocked',
      issues: [{ code: 'currency_mismatch' }],
    });
  });

  it('blocks custom factor counts outside 2 through 5', () => {
    for (const factors of [[], Array.from({ length: 6 }, (_, index) => ({
      factorId: `factor-${index}`,
      rule: forecastAssumptions().depreciationAndAmortization.rule,
    }))]) {
      const assumptions = forecastAssumptions({
        revenue: { kind: 'custom-product', factors },
      });
      const input = forecastInput({
        scenarios: forecastInput().scenarios.map((scenario) => ({
          ...scenario,
          assumptions,
        })),
      });
      expect(validateForecastInput(input)).toMatchObject({
        status: 'blocked',
        issues: [{ code: 'invalid_revenue_driver' }],
      });
    }
  });

  it('throws invalid_dto for damaged exact shapes', () => {
    expectInvalidDto(() => validateForecastInput({
      ...forecastInput(),
      unexpected: true,
    }));
    expectInvalidDto(() => validateForecastInput({
      ...forecastInput(),
      baseline: {
        ...forecastInput().baseline,
        beginningCash: {
          ...forecastInput().baseline.beginningCash,
          unexpected: true,
        },
      },
    }));
  });
});
