import type { MetricDefinition } from '../metrics/metric-definition';

export interface IndustryTemplate {
  id: string;
  name: string;
  metrics: MetricDefinition[];
}

export interface ComposedIndustryTemplate {
  selectedTemplateIds: string[];
  metrics: MetricDefinition[];
}
