import type { MetricDefinition } from '../metrics/metric-definition';

export const industryTemplateIds = [
  'saas',
  'consumer',
  'hardtech_manufacturing',
] as const;

export type IndustryTemplateId = (typeof industryTemplateIds)[number];

export interface IndustryTemplate {
  readonly id: IndustryTemplateId;
  readonly name: string;
  readonly metrics: readonly MetricDefinition[];
}

export interface ComposedIndustryTemplate {
  readonly selectedTemplateIds: readonly IndustryTemplateId[];
  readonly metrics: readonly MetricDefinition[];
}
