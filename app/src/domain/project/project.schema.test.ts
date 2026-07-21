import type { DealProfile, Project } from './project';
import type { z } from 'zod';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { dealProfileSchema, projectSchema } from './project.schema';

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
} satisfies Project;

const withDealProfile = (overrides: Partial<DealProfile>): Project => ({
  ...validProject,
  dealProfile: {
    ...validProject.dealProfile,
    ...overrides,
  },
});

const expectIssuePath = (
  result: ReturnType<typeof projectSchema.safeParse>,
  path: (string | number)[],
) => {
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path })]),
    );
  }
};

const decimalFields = [
  'investmentAmount',
  'targetOwnershipPct',
  'targetIrrPct',
  'targetMoic',
] as const satisfies readonly (keyof DealProfile)[];

const invalidDecimalCases = decimalFields.flatMap((field) => [
  { label: `${field} is negative`, field, value: '-1' },
  { label: `${field} is malformed`, field, value: '1.2.3' },
]);

describe('projectSchema', () => {
  it('matches the domain types exactly', () => {
    expectTypeOf<z.output<typeof dealProfileSchema>>().toEqualTypeOf<DealProfile>();
    expectTypeOf<z.output<typeof projectSchema>>().toEqualTypeOf<Project>();
  });

  it('accepts a valid local due diligence project', () => {
    const result = projectSchema.parse(validProject);
    expect(result.dealProfile.strategy).toBe('growth');
  });

  it('keeps decimal outputs as strings', () => {
    const result = projectSchema.parse(validProject);

    expect(typeof result.dealProfile.investmentAmount).toBe('string');
    expect(typeof result.dealProfile.targetOwnershipPct).toBe('string');
    expect(typeof result.dealProfile.targetIrrPct).toBe('string');
    expect(typeof result.dealProfile.targetMoic).toBe('string');
  });

  it.each([
    { label: 'empty', name: '' },
    { label: 'whitespace-only', name: '   ' },
  ])('rejects a $label project name', ({ name }) => {
    const result = projectSchema.safeParse({
      ...validProject,
      name,
    });

    expectIssuePath(result, ['name']);
  });

  it.each([
    { label: 'below minimum', value: 0 },
    { label: 'above maximum', value: 16 },
    { label: 'non-integer', value: 1.5 },
  ])('rejects a holding period $label', ({ value }) => {
    const result = projectSchema.safeParse(
      withDealProfile({ holdingPeriodYears: value }),
    );

    expectIssuePath(result, ['dealProfile', 'holdingPeriodYears']);
  });

  it.each([1, 15])('accepts holding period boundary %i', (holdingPeriodYears) => {
    const result = projectSchema.parse(withDealProfile({ holdingPeriodYears }));

    expect(result.dealProfile.holdingPeriodYears).toBe(holdingPeriodYears);
  });

  it.each([
    { field: 'createdAt' as const, label: 'createdAt' },
    { field: 'updatedAt' as const, label: 'updatedAt' },
  ])('rejects an invalid $label timestamp', ({ field }) => {
    const result = projectSchema.safeParse({
      ...validProject,
      [field]: 'not-a-date',
    });

    expectIssuePath(result, [field]);
  });

  it.each(invalidDecimalCases)('rejects $label', ({ field, value }) => {
    const result = projectSchema.safeParse(withDealProfile({ [field]: value }));

    expectIssuePath(result, ['dealProfile', field]);
  });

  it('rejects an unknown industry template id', () => {
    const result = projectSchema.safeParse({
      ...validProject,
      dealProfile: {
        ...validProject.dealProfile,
        industryTemplateIds: ['unknown_template'],
      },
    });

    expectIssuePath(result, ['dealProfile', 'industryTemplateIds', 0]);
  });

  it('rejects an empty industry template selection', () => {
    const result = projectSchema.safeParse(
      withDealProfile({ industryTemplateIds: [] }),
    );

    expectIssuePath(result, ['dealProfile', 'industryTemplateIds']);
  });
});
