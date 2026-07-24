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

export interface CalculationTrace {
  readonly engine: 'formula';
  readonly formulaRef: string;
  readonly inputs: readonly TraceInput[];
  readonly steps: readonly TraceStep[];
  readonly output?: MetricValue;
}
