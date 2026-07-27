import type {
  ForecastCalculationTrace,
  ForecastScenarioTrace,
} from '../../domain/analysis/calculation-trace';
import {
  blockedResult,
  okResult,
} from '../../domain/analysis/engine-result';
import { aggregateModelYears } from './aggregate-model-years';
import { calculateScenario } from './calculate-scenario';
import { createForecastPeriods } from './generate-monthly-series';
import type {
  ForecastEngineResult,
  ScenarioForecast,
  ScenarioForecastSet,
} from './forecast-types';
import { validateForecastInput } from './validate-forecast-input';

function trace(
  inputs: ForecastCalculationTrace['inputs'],
  scenarios: readonly ForecastScenarioTrace[],
): ForecastCalculationTrace {
  return {
    engine: 'forecast',
    forecastRef: 'three-scenario@1',
    inputs,
    scenarios,
  };
}

export function forecastThreeScenarios(
  input: unknown,
): ForecastEngineResult<ScenarioForecastSet> {
  const validation = validateForecastInput(input);
  if (validation.status === 'blocked') {
    return blockedResult(
      validation.reason,
      validation.issues,
      trace(validation.traceInputs, []),
    );
  }

  const periods = createForecastPeriods(
    validation.input.baseline.forecastStartMonth,
    validation.input.baseline.horizonMonths,
  );
  const forecasts: ScenarioForecast[] = [];
  const scenarioTraces: ForecastScenarioTrace[] = [];

  for (const scenario of validation.input.scenarios) {
    const calculation = calculateScenario(
      scenario,
      validation.input.baseline,
      periods,
    );
    if (calculation.status === 'blocked') {
      scenarioTraces.push({
        scenarioId: scenario.id,
        months: calculation.monthTraces,
        aggregationSteps: [],
      });
      return blockedResult(
        calculation.reason,
        calculation.issues,
        trace(validation.traceInputs, scenarioTraces),
      );
    }

    const aggregated = aggregateModelYears(calculation.months);
    forecasts.push({
      id: scenario.id,
      probability: scenario.probability,
      months: calculation.months,
      modelYears: aggregated.modelYears,
      cashSummary: aggregated.cashSummary,
    });
    scenarioTraces.push({
      scenarioId: scenario.id,
      months: calculation.monthTraces,
      aggregationSteps: aggregated.steps,
    });
  }

  return okResult(
    {
      version: validation.input.version,
      currency: validation.input.baseline.currency,
      forecastStartMonth: validation.input.baseline.forecastStartMonth,
      horizonMonths: validation.input.baseline.horizonMonths,
      scenarios: forecasts,
    },
    validation.warnings,
    trace(validation.traceInputs, scenarioTraces),
  );
}
