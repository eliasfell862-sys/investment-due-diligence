export const METRIC_UNITS = [
  'currency',
  'percent',
  'multiple',
  'months',
  'days',
  'count',
  'level',
] as const;

export const METRIC_DIRECTIONS = [
  'higher_is_better',
  'lower_is_better',
  'neutral',
] as const;

export const METRIC_INPUT_KINDS = ['manual', 'formula', 'imported'] as const;

export type MetricUnit = (typeof METRIC_UNITS)[number];
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];
export type MetricInputKind = (typeof METRIC_INPUT_KINDS)[number];

export interface MetricDefinition {
  readonly id: string;
  readonly label: string;
  readonly unit: MetricUnit;
  readonly direction: MetricDirection;
  readonly inputKind: MetricInputKind;
  readonly description: string;
  readonly formula?: string;
}
