export type InvestmentStrategy = 'vc_early' | 'growth' | 'pe_buyout';
export type ProjectStatus = 'draft' | 'in_diligence' | 'decision_ready' | 'archived';
export type CurrencyCode = 'CNY' | 'USD' | 'HKD' | 'EUR';
export type AmountUnit = 'yuan' | 'ten_thousand' | 'million';

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
