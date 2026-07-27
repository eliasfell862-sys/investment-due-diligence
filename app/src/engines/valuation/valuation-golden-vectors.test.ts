import { describe, expect, it } from 'vitest';

import { AnalysisDecimal } from '../../domain/analysis/decimal';
import { forecastInput } from '../forecast/forecast-test-fixtures';
import { forecastThreeScenarios } from '../forecast/forecast-three-scenarios';
import type {
  ForecastHorizonMonths,
  ModelYearForecast,
} from '../forecast/forecast-types';
import { calculateComparableValuation } from './calculate-comparable-valuation';
import { calculateDcf } from './calculate-dcf';
import { calculateVcMethod } from './calculate-vc-method';
import { triangulateValuations } from './triangulate-valuations';
import {
  comparableInput,
  dcfInput,
  vcInput,
} from './valuation-test-fixtures';
import type {
  ComparableValuationResult,
  DcfResult,
  ValuationEngineResult,
  ValuationTriangulationResult,
  VcMethodResult,
  WeightedValuationMethod,
} from './valuation-types';

interface PipelineResult {
  readonly forecastJson: string;
  readonly dcf: Extract<ValuationEngineResult<DcfResult>, { readonly status: 'ok' }>;
  readonly comparable: Extract<
    ValuationEngineResult<ComparableValuationResult>,
    { readonly status: 'ok' }
  >;
  readonly vc: Extract<ValuationEngineResult<VcMethodResult>, { readonly status: 'ok' }>;
  readonly triangulation: Extract<
    ValuationEngineResult<ValuationTriangulationResult>,
    { readonly status: 'ok' }
  >;
}

function requireOk<T>(
  result: ValuationEngineResult<T>,
): Extract<ValuationEngineResult<T>, { readonly status: 'ok' }> {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error(JSON.stringify(result));
  return result;
}

function subjectFromYear(year: ModelYearForecast) {
  return {
    period: year.period,
    revenue: year.revenue,
    ebitda: year.ebitda,
    netIncome: year.netIncome,
    interestBearingDebt: '300',
    cashAndCashEquivalents: '500',
  };
}

function runPipeline(horizonMonths: ForecastHorizonMonths): PipelineResult {
  const forecast = forecastThreeScenarios(forecastInput({
    baseline: { horizonMonths },
  }));
  expect(forecast.status).toBe('ok');
  if (forecast.status !== 'ok') throw new Error(JSON.stringify(forecast));
  const base = forecast.value.scenarios.find(({ id }) => id === 'base')!;
  const dcf = requireOk(calculateDcf(dcfInput({
    modelYears: base.modelYears,
  })));
  const comparable = requireOk(calculateComparableValuation(comparableInput({
    subject: subjectFromYear(base.modelYears.at(-1)!),
  })));
  const vc = requireOk(calculateVcMethod(vcInput()));

  const methods: WeightedValuationMethod[] = [
    {
      methodId: 'dcf',
      label: 'DCF',
      weight: '0.35',
      range: dcf.value.range,
      sensitivityMatrices: dcf.value.sensitivityMatrices,
    },
    ...comparable.value.methods.map((method) => ({
      methodId: method.methodId,
      label: method.label,
      weight: '0.1',
      range: method.range,
    })),
    {
      methodId: 'vc-method',
      label: 'VC Method',
      weight: '0.35',
      range: vc.value.range,
      sensitivityMatrices: [vc.value.sensitivityMatrix],
    },
  ];
  const triangulation = requireOk(triangulateValuations({
    version: '1',
    methods,
  }));

  return {
    forecastJson: JSON.stringify(forecast),
    dcf,
    comparable,
    vc,
    triangulation,
  };
}

describe('valuation engine golden vectors', () => {
  it('consumes the base scenario model-year DTOs without reshaping them', () => {
    const pipeline = runPipeline(36);

    expect(pipeline.dcf.value.presentValueOfExplicitFcff).not.toBe('0');
    expect(pipeline.comparable.value.methods).toHaveLength(3);
    expect(pipeline.triangulation.value.methodCount).toBe(5);
    expect(pipeline.triangulation.value.footballField.map(({ methodId }) => methodId)).toEqual([
      'dcf',
      'comparable-ev-revenue',
      'comparable-ev-ebitda',
      'comparable-pe',
      'vc-method',
      'triangulated',
    ]);
    expect(pipeline.triangulation.value.sensitivityMatrices.map(({ matrixRef }) => matrixRef)).toEqual([
      'dcf-wacc-exit-multiple@1',
      'dcf-wacc-perpetuity-growth@1',
      'vc-exit-equity-target-irr@1',
    ]);
  });

  it.each([
    [36, 3],
    [48, 4],
    [60, 5],
  ] as const)(
    'supports a %i-month forecast with %i complete model years',
    (horizonMonths, modelYearCount) => {
      const pipeline = runPipeline(horizonMonths);

      expect(pipeline.dcf.trace.inputs.filter(({ metricId }) => metricId === 'fcff')).toHaveLength(
        modelYearCount,
      );
      expect(new AnalysisDecimal(pipeline.triangulation.value.range.low).lessThanOrEqualTo(
        pipeline.triangulation.value.range.midpoint,
      )).toBe(true);
      expect(new AnalysisDecimal(pipeline.triangulation.value.range.midpoint).lessThanOrEqualTo(
        pipeline.triangulation.value.range.high,
      )).toBe(true);
    },
  );

  it('keeps every sensitivity center tied to its base method output', () => {
    const pipeline = runPipeline(36);
    const matrices = pipeline.triangulation.value.sensitivityMatrices;

    expect(matrices.find(({ matrixRef }) =>
      matrixRef === 'dcf-wacc-perpetuity-growth@1'
    )!.values[2][2]).toBe(pipeline.dcf.value.perpetuityGrowth.equityValue);
    expect(matrices.find(({ matrixRef }) =>
      matrixRef === 'dcf-wacc-exit-multiple@1'
    )!.values[2][2]).toBe(pipeline.dcf.value.exitMultiple.equityValue);
    expect(matrices.find(({ matrixRef }) =>
      matrixRef === 'vc-exit-equity-target-irr@1'
    )!.values[2][2]).toBe(pipeline.vc.value.range.midpoint);
  });

  it('is byte-deterministic across repeated full-pipeline runs', () => {
    const first = runPipeline(36);
    const second = runPipeline(36);

    expect(first.forecastJson).toBe(second.forecastJson);
    expect(JSON.stringify(first.dcf)).toBe(JSON.stringify(second.dcf));
    expect(JSON.stringify(first.comparable)).toBe(JSON.stringify(second.comparable));
    expect(JSON.stringify(first.vc)).toBe(JSON.stringify(second.vc));
    expect(JSON.stringify(first.triangulation)).toBe(
      JSON.stringify(second.triangulation),
    );
  });

  it('keeps comparable output stable when peer order is reversed', () => {
    const first = calculateComparableValuation(comparableInput());
    const second = calculateComparableValuation({
      ...comparableInput(),
      peers: [...comparableInput().peers].reverse(),
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
