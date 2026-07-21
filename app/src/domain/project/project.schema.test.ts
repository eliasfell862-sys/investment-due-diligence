import { describe, expect, it } from 'vitest';
import { projectSchema } from './project.schema';

const validProject = {
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
};

describe('projectSchema', () => {
  it('accepts a valid local due diligence project', () => {
    const result = projectSchema.parse(validProject);
    expect(result.dealProfile.strategy).toBe('growth');
  });

  it('rejects an empty project name', () => {
    const result = projectSchema.safeParse({
      ...validProject,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a holding period below one year', () => {
    const result = projectSchema.safeParse({
      ...validProject,
      dealProfile: {
        ...validProject.dealProfile,
        holdingPeriodYears: 0,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty industry template selection', () => {
    const result = projectSchema.safeParse({
      ...validProject,
      dealProfile: {
        ...validProject.dealProfile,
        industryTemplateIds: [],
      },
    });
    expect(result.success).toBe(false);
  });
});
