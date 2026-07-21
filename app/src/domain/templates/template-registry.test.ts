import type { MetricDefinition } from '../metrics/metric-definition';
import { describe, expect, it } from 'vitest';
import {
  composeIndustryTemplates,
  industryTemplates,
} from './template-registry';

describe('composeIndustryTemplates', () => {
  it('combines SaaS and manufacturing metrics without duplicates', () => {
    const result = composeIndustryTemplates(['saas', 'hardtech_manufacturing']);
    const ids = result.metrics.map((metric) => metric.id);
    expect(ids).toContain('nrr');
    expect(ids).toContain('technology_readiness_level');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps project-specific custom metrics', () => {
    const result = composeIndustryTemplates(['saas'], [{
      id: 'hardware_attach_rate', label: '硬件绑定率', unit: 'percent',
      direction: 'higher_is_better', inputKind: 'manual',
      description: '使用硬件的付费 SaaS 客户比例',
    }]);
    expect(result.metrics.some((metric) => metric.id === 'hardware_attach_rate')).toBe(true);
  });
});

describe('industry template hardening', () => {
  it('normalizes duplicate selected IDs without duplicating metrics', () => {
    const result = composeIndustryTemplates(['saas', 'saas']);

    expect(result.selectedTemplateIds).toEqual(['saas']);
    expect(result.metrics.map((metric) => metric.id)).toEqual([
      'arr',
      'nrr',
      'revenue_churn',
      'cac_payback_months',
      'burn_multiple',
    ]);
  });

  it('lets a custom metric fully override a default at its original position', () => {
    const customNrr: MetricDefinition = {
      id: 'nrr',
      label: 'Adjusted NRR',
      unit: 'multiple',
      direction: 'lower_is_better',
      inputKind: 'manual',
      description: 'Project-specific NRR definition',
      formula: 'custom formula',
    };

    const result = composeIndustryTemplates(['saas'] as const, [customNrr] as const);

    expect(result.metrics.map((metric) => metric.id)).toEqual([
      'arr',
      'nrr',
      'revenue_churn',
      'cac_payback_months',
      'burn_multiple',
    ]);
    expect(result.metrics[1]).toEqual(customNrr);
  });

  it('returns metrics in deterministic selected-template order', () => {
    const result = composeIndustryTemplates([
      'saas',
      'hardtech_manufacturing',
    ]);

    expect(result.metrics.map((metric) => metric.id)).toEqual([
      'arr',
      'nrr',
      'revenue_churn',
      'cac_payback_months',
      'burn_multiple',
      'technology_readiness_level',
      'yield_rate',
      'capacity_utilization',
      'order_backlog',
    ]);
  });

  it('throws an exact error for an unknown template ID', () => {
    expect(() => composeIndustryTemplates(['saas', 'unknown'])).toThrowError(
      new Error('Unknown industry template: unknown'),
    );
  });

  it('isolates later compositions from mutation of returned metrics', () => {
    const first = composeIndustryTemplates(['saas']);
    (first.metrics[0] as { label: string }).label = 'mutated';

    const second = composeIndustryTemplates(['saas']);

    expect(second.metrics[0]?.label).toBe('ARR');
  });

  it('isolates composed results from later mutation of custom metrics', () => {
    const customMetric: MetricDefinition = {
      id: 'hardware_attach_rate',
      label: 'Hardware attach rate',
      unit: 'percent',
      direction: 'higher_is_better',
      inputKind: 'manual',
      description: 'Share of paid SaaS customers using hardware',
    };
    const result = composeIndustryTemplates(['saas'], [customMetric]);

    (customMetric as { label: string }).label = 'mutated';

    expect(result.metrics.at(-1)?.label).toBe('Hardware attach rate');
  });

  it('contains exactly three internally consistent templates and 13 metrics', () => {
    const entries = Object.entries(industryTemplates);

    expect(entries).toHaveLength(3);
    expect(
      entries.reduce((total, [, template]) => total + template.metrics.length, 0),
    ).toBe(13);
    for (const [key, template] of entries) {
      expect(template.id).toBe(key);
    }
  });
});
