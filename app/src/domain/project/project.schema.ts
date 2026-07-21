import { z } from 'zod';

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, '必须是非负数字');

export const dealProfileSchema = z.object({
  strategy: z.enum(['vc_early', 'growth', 'pe_buyout']),
  investmentAmount: decimalString,
  targetOwnershipPct: decimalString,
  targetIrrPct: decimalString,
  targetMoic: decimalString,
  holdingPeriodYears: z.number().int().min(1).max(15),
  industryTemplateIds: z.array(z.string().min(1)).min(1),
});

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, '项目名称不能为空'),
  status: z.enum(['draft', 'in_diligence', 'decision_ready', 'archived']),
  currency: z.enum(['CNY', 'USD', 'HKD', 'EUR']),
  amountUnit: z.enum(['yuan', 'ten_thousand', 'million']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dealProfile: dealProfileSchema,
});
