import { z } from 'zod';
import { industryTemplateIds } from '../templates/industry-template';
import {
  AMOUNT_UNITS,
  CURRENCY_CODES,
  INVESTMENT_STRATEGIES,
  PROJECT_STATUSES,
  type DealProfile,
  type Project,
} from './project';

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, '必须是非负数字');

export const dealProfileSchema = z.object({
  strategy: z.enum(INVESTMENT_STRATEGIES),
  investmentAmount: decimalString,
  targetOwnershipPct: decimalString,
  targetIrrPct: decimalString,
  targetMoic: decimalString,
  holdingPeriodYears: z.number().int().min(1).max(15),
  industryTemplateIds: z.array(z.enum(industryTemplateIds)).min(1),
}) satisfies z.ZodType<DealProfile>;

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, '项目名称不能为空'),
  status: z.enum(PROJECT_STATUSES),
  currency: z.enum(CURRENCY_CODES),
  amountUnit: z.enum(AMOUNT_UNITS),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dealProfile: dealProfileSchema,
}) satisfies z.ZodType<Project>;
