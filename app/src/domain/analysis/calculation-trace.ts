import type { AnalysisUnit, MetricValue } from './value';

export interface TraceInput {
  readonly valueRef: string;
  readonly metricId: string;
  readonly value: string;
  readonly unit: AnalysisUnit;
  readonly periodId: string;
  readonly sourceRefs: readonly string[];
}

export interface TraceStep {
  readonly id: string;
  readonly operator: string;
  readonly operands: readonly string[];
  readonly result?: string;
  readonly rule?: string;
  readonly outcome?: 'passed' | 'blocked';
}

export interface FormulaCalculationTrace {
  readonly engine: 'formula';
  readonly formulaRef: string;
  readonly inputs: readonly TraceInput[];
  readonly steps: readonly TraceStep[];
  readonly output?: MetricValue;
}

export interface ForecastMonthTrace {
  readonly periodId: string;
  readonly steps: readonly TraceStep[];
}

export interface ForecastScenarioTrace {
  readonly scenarioId: 'downside' | 'base' | 'upside';
  readonly months: readonly ForecastMonthTrace[];
  readonly aggregationSteps: readonly TraceStep[];
}

export interface ForecastCalculationTrace {
  readonly engine: 'forecast';
  readonly forecastRef: 'three-scenario@1';
  readonly inputs: readonly TraceInput[];
  readonly scenarios: readonly ForecastScenarioTrace[];
}

export type CalculationTrace =
  | FormulaCalculationTrace
  | ForecastCalculationTrace;
