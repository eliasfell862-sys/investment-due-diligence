import { describe, expect, it } from 'vitest';
import { composeIndustryTemplates } from './template-registry';

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
