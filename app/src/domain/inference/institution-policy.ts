/**
 * Institution Private Investment Policy Types
 *
 * Configurable, versioned policies that shape how each institution
 * evaluates and decides on investments. Same project + different policy
 * can yield different investment judgment.
 */

export interface InstitutionPolicy {
  readonly policyId: string;
  readonly version: string;
  readonly name: string;
  readonly effectiveDate: string;
  readonly description: string;

  // Investment Mandate
  readonly mandate: {
    readonly stages: readonly string[]; // e.g. ['growth', 'pre_ipo']
    readonly industries: readonly string[]; // e.g. ['enterprise_software', 'consumer']
    readonly regions: readonly string[];
    readonly minInvestment: string; // Decimal, 万元
    readonly maxInvestment: string;
    readonly targetOwnershipMin: string; // Decimal 0-1
    readonly targetOwnershipMax: string;
    readonly maxSingleProjectExposure: string; // % of fund
  };

  // Return Requirements
  readonly returnRequirements: {
    readonly targetIrr: string; // Decimal 0-1 (e.g. 0.25)
    readonly targetMoic: string;
    readonly minMoic: string;
    readonly targetHoldingYears: number;
    readonly maxHoldingYears: number;
  };

  // Risk Tolerance
  readonly riskTolerance: {
    readonly maxPermanentLossProbability: string; // Decimal 0-1
    readonly maxDrawdownProbability: string;
    readonly maxCustomerConcentration: string; // %
    readonly minCashRunwayMonths: number;
    readonly maxDebtToEbitda: string;
    readonly requiresPathToProfitability: boolean;
  };

  // Deal Breakers (auto-reject)
  readonly vetoItems: {
    readonly businessFraud: boolean;
    readonly unclearOwnership: boolean;
    readonly majorIllegality: boolean;
    readonly founderIntegrity: boolean;
    readonly nrrBelowThreshold: boolean;
    readonly nrrThreshold: string; // e.g. 80 for 80%
    readonly cashRunwayBelowThreshold: boolean;
    readonly cashRunwayThreshold: number; // months
    readonly customerConcentrationAboveThreshold: boolean;
    readonly customerConcentrationThreshold: string; // %
  };

  // Evidence Standards
  readonly evidenceStandards: {
    readonly requireAuditedFinancials: boolean;
    readonly requireBackgroundCheck: boolean;
    readonly requireCustomerReferences: boolean;
    readonly requireLegalDueDiligence: boolean;
    readonly minimumEvidenceCount: number;
    readonly confidenceThresholdForSubmission: string; // Decimal 0-1
  };

  // Investment Committee
  readonly committeeRules: {
    readonly requireUnanimousApproval: boolean;
    readonly requireDissentDocumented: boolean;
    readonly requireExternalExpert: boolean;
    readonly maxDelegatedInvestmentAmount: string; // 万元
  };

  // Terms Preferences
  readonly termsPreferences: {
    readonly preferredClauseTypes: readonly string[];
    readonly requireBoardSeat: boolean;
    readonly requireInformationRights: boolean;
    readonly requireAntiDilution: boolean;
    readonly preferStagedFunding: boolean;
    readonly requireDragAlong: boolean;
  };

  // Post-Investment Monitoring
  readonly monitoring: {
    readonly frequency: 'monthly' | 'quarterly' | 'semi_annual';
    readonly keyMetrics: readonly string[];
    readonly yellowThresholds: Record<string, string>; // metricId -> threshold value
    readonly redThresholds: Record<string, string>;
    readonly requireBoardMeeting: boolean;
    readonly requireManagementUpdate: boolean;
  };
}

// ── Default Policies ──

export const DEFAULT_GROWTH_EQUITY_POLICY: InstitutionPolicy = {
  policyId: 'default_growth_equity',
  version: '1.0.0',
  name: '默认成长期股权投资政策',
  effectiveDate: '2026-01-01',
  description: '适用于成长期股权投资的通用机构政策模板',

  mandate: {
    stages: ['growth', 'pre_ipo'],
    industries: ['enterprise_software', 'consumer_brand', 'advanced_manufacturing', 'healthcare', 'fintech'],
    regions: ['中国'],
    minInvestment: '3000',
    maxInvestment: '50000',
    targetOwnershipMin: '0.05',
    targetOwnershipMax: '0.30',
    maxSingleProjectExposure: '0.15',
  },

  returnRequirements: {
    targetIrr: '0.25',
    targetMoic: '3.0',
    minMoic: '2.0',
    targetHoldingYears: 5,
    maxHoldingYears: 8,
  },

  riskTolerance: {
    maxPermanentLossProbability: '0.15',
    maxDrawdownProbability: '0.30',
    maxCustomerConcentration: '50',
    minCashRunwayMonths: 12,
    maxDebtToEbitda: '4',
    requiresPathToProfitability: true,
  },

  vetoItems: {
    businessFraud: true,
    unclearOwnership: true,
    majorIllegality: true,
    founderIntegrity: true,
    nrrBelowThreshold: true,
    nrrThreshold: '80',
    cashRunwayBelowThreshold: true,
    cashRunwayThreshold: 6,
    customerConcentrationAboveThreshold: true,
    customerConcentrationThreshold: '50',
  },

  evidenceStandards: {
    requireAuditedFinancials: true,
    requireBackgroundCheck: true,
    requireCustomerReferences: false,
    requireLegalDueDiligence: true,
    minimumEvidenceCount: 8,
    confidenceThresholdForSubmission: '0.70',
  },

  committeeRules: {
    requireUnanimousApproval: false,
    requireDissentDocumented: true,
    requireExternalExpert: false,
    maxDelegatedInvestmentAmount: '10000',
  },

  termsPreferences: {
    preferredClauseTypes: ['valuation_adjustment', 'anti_dilution', 'board_seat', 'information_rights', 'drag_along', 'staged_funding'],
    requireBoardSeat: true,
    requireInformationRights: true,
    requireAntiDilution: true,
    preferStagedFunding: true,
    requireDragAlong: false,
  },

  monitoring: {
    frequency: 'quarterly',
    keyMetrics: ['revenue', 'revenue_growth', 'gross_margin', 'cash_balance', 'burn_rate'],
    yellowThresholds: { 'revenue_growth': '0', 'gross_margin': '30', 'cash_runway_months': '9' },
    redThresholds: { 'revenue_growth': '-10', 'gross_margin': '15', 'cash_runway_months': '6' },
    requireBoardMeeting: true,
    requireManagementUpdate: true,
  },
};

export const CONSERVATIVE_POLICY: InstitutionPolicy = {
  ...DEFAULT_GROWTH_EQUITY_POLICY,
  policyId: 'conservative',
  version: '1.0.0',
  name: '保守型投资政策',
  description: '低风险容忍度、高证据要求、适合家族办公室或保守型LP',
  returnRequirements: { ...DEFAULT_GROWTH_EQUITY_POLICY.returnRequirements, targetIrr: '0.20', targetMoic: '2.5', minMoic: '2.0' },
  riskTolerance: { ...DEFAULT_GROWTH_EQUITY_POLICY.riskTolerance, maxPermanentLossProbability: '0.08', maxDrawdownProbability: '0.20', minCashRunwayMonths: 18, maxDebtToEbitda: '3' },
  evidenceStandards: { ...DEFAULT_GROWTH_EQUITY_POLICY.evidenceStandards, minimumEvidenceCount: 12, confidenceThresholdForSubmission: '0.80', requireCustomerReferences: true },
  committeeRules: { ...DEFAULT_GROWTH_EQUITY_POLICY.committeeRules, requireUnanimousApproval: true },
};

export const AGGRESSIVE_POLICY: InstitutionPolicy = {
  ...DEFAULT_GROWTH_EQUITY_POLICY,
  policyId: 'aggressive',
  version: '1.0.0',
  name: '激进型投资政策',
  description: '高风险容忍度、适合VC基金或成长型基金',
  returnRequirements: { ...DEFAULT_GROWTH_EQUITY_POLICY.returnRequirements, targetIrr: '0.35', targetMoic: '5.0', minMoic: '3.0' },
  riskTolerance: { ...DEFAULT_GROWTH_EQUITY_POLICY.riskTolerance, maxPermanentLossProbability: '0.25', maxDrawdownProbability: '0.45', minCashRunwayMonths: 6 },
  evidenceStandards: { ...DEFAULT_GROWTH_EQUITY_POLICY.evidenceStandards, minimumEvidenceCount: 5, confidenceThresholdForSubmission: '0.55', requireAuditedFinancials: false },
};
