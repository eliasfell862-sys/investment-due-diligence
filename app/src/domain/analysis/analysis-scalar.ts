import type { MetricValue } from './value';

export type ConflictStatus =
  | 'none'
  | 'resolved'
  | 'conservative-selected'
  | 'blocking';

export interface AnalysisConflict {
  readonly status: ConflictStatus;
  readonly selectionReason?: string;
}

export interface AnalysisScalar {
  readonly valueRef: string;
  readonly metricId: string;
  readonly value: MetricValue;
  readonly sourceRefs: readonly string[];
  readonly conflict: AnalysisConflict;
}
