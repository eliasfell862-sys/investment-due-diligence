import { describe, expect, it } from 'vitest';
import { projectSchema } from './project.schema';

describe('projectSchema', () => {
  it('accepts a valid local due diligence project', () => {
    const result = projectSchema.parse({
      id: 'project-1',
      name: '示例科技',
      status: 'draft',
      currency: 'CNY',
      amountUnit: 'ten_thousand',
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
      dealProfile: {
        strategy: 'growth',
        investmentAmount: '5000',
        targetOwnershipPct: '10',
        targetIrrPct: '25',
        targetMoic: '3',
        holdingPeriodYears: 5,
        industryTemplateIds: ['saas'],
      },
    });
    expect(result.dealProfile.strategy).toBe('growth');
  });

  it('rejects an empty project name and invalid holding period', () => {
    const result = projectSchema.safeParse({
      id: 'project-2', name: '', status: 'draft', currency: 'CNY', amountUnit: 'yuan',
      createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z',
      dealProfile: {
        strategy: 'vc_early', investmentAmount: '1000', targetOwnershipPct: '8',
        targetIrrPct: '35', targetMoic: '5', holdingPeriodYears: 0, industryTemplateIds: [],
      },
    });
    expect(result.success).toBe(false);
  });
});
