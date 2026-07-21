export const INVESTMENT_STRATEGIES = ['vc_early', 'growth', 'pe_buyout'] as const;
export const PROJECT_STATUSES = [
  'draft',
  'in_diligence',
  'decision_ready',
  'archived',
] as const;
export const CURRENCY_CODES = ['CNY', 'USD', 'HKD', 'EUR'] as const;
export const AMOUNT_UNITS = ['yuan', 'ten_thousand', 'million'] as const;

export type InvestmentStrategy = (typeof INVESTMENT_STRATEGIES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type CurrencyCode = (typeof CURRENCY_CODES)[number];
export type AmountUnit = (typeof AMOUNT_UNITS)[number];

export interface DealProfile {
  strategy: InvestmentStrategy;
  investmentAmount: string;
  targetOwnershipPct: string;
  targetIrrPct: string;
  targetMoic: string;
  holdingPeriodYears: number;
  industryTemplateIds: string[];
}

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  currency: CurrencyCode;
  amountUnit: AmountUnit;
  createdAt: string;
  updatedAt: string;
  dealProfile: DealProfile;
}
