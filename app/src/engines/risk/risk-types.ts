import type { RiskCalculationTrace } from '../../domain/analysis/calculation-trace';
import type { DecimalString } from '../../domain/analysis/decimal';
import type { EngineResult } from '../../domain/analysis/engine-result';

export type RiskCategory =
  | 'market'
  | 'technology'
  | 'customer'
  | 'financial'
  | 'financing'
  | 'legal_compliance'
  | 'governance'
  | 'data_authenticity'
  | 'exit';

export type RiskLight = 'green' | 'yellow' | 'red';

export type RiskSignal =
  | 'market_adoption'
  | 'valuation_overhang'
  | 'technical_feasibility'
  | 'ip_ownership'
  | 'customer_concentration'
  | 'revenue_quality'
  | 'cash_runway'
  | 'reporting_quality'
  | 'financing_dependency'
  | 'regulatory_approval'
  | 'key_person'
  | 'governance_control'
  | 'data_integrity'
  | 'exit_delay';

export interface RiskItemInput {
  readonly riskId: string;
  readonly category: RiskCategory;
  readonly title: string;
  readonly probability: DecimalString;
  readonly impact: DecimalString;
  readonly mitigationEffectiveness: DecimalString;
  readonly mitigationDescription?: string;
  readonly signals?: readonly RiskSignal[];
  readonly evidenceRefs?: readonly string[];
}

export interface TrafficLightThresholdInput {
  readonly greenUpper: DecimalString;
  readonly redLower: DecimalString;
  readonly changeReason: string;
}

export type FatalFlawId =
  | 'material_data_or_business_fraud'
  | 'core_ownership_or_license_unclear'
  | 'irremediable_major_illegality'
  | 'business_model_unverifiable'
  | 'pre_close_cash_break'
  | 'founder_integrity_failure';

export type FatalFlawStatus = 'clear' | 'open' | 'covered' | 'resolved';

export interface FatalFlawCheckInput {
  readonly fatalFlawId: FatalFlawId;
  readonly status: FatalFlawStatus;
  readonly evidenceRefs?: readonly string[];
  readonly coverageReason?: string;
  readonly bindingConditions?: readonly string[];
  readonly resolutionNote?: string;
}

export interface ValuationRiskSnapshot {
  readonly snapshotId: string;
  readonly sourceRef: 'valuation-triangulation@1';
  readonly safetyMargin: DecimalString;
}

export interface ForecastRiskSnapshot {
  readonly snapshotId: string;
  readonly sourceRef: 'scenario-forecast@1';
  readonly downsideCashBreak: boolean;
}

export interface InvestorReturnsRiskSnapshot {
  readonly snapshotId: string;
  readonly sourceRef: 'investor-returns@1';
  readonly downsideMoic: DecimalString;
}

export interface ExitRiskSnapshot {
  readonly snapshotId: string;
  readonly sourceRef: 'exit-assessment@1';
  readonly exitDelayed: boolean;
}

export interface RiskUpstreamSnapshots {
  readonly valuation?: ValuationRiskSnapshot;
  readonly forecast?: ForecastRiskSnapshot;
  readonly investorReturns?: InvestorReturnsRiskSnapshot;
  readonly exit?: ExitRiskSnapshot;
}

export interface RiskAssessmentInput {
  readonly version: '1';
  readonly asOfDate: string;
  readonly riskItems: readonly RiskItemInput[];
  readonly fatalFlaws: readonly FatalFlawCheckInput[];
  readonly categoryWeights?: Readonly<Record<RiskCategory, DecimalString>>;
  readonly trafficLightThresholds?: TrafficLightThresholdInput;
  readonly upstreamSnapshots?: RiskUpstreamSnapshots;
}

export interface AppliedTrafficLightThresholds {
  readonly greenUpper: DecimalString;
  readonly redLower: DecimalString;
  readonly source: 'default' | 'custom';
  readonly changeReason: string | null;
}

export interface RiskItemAssessment {
  readonly riskId: string;
  readonly category: RiskCategory;
  readonly title: string;
  readonly probability: DecimalString;
  readonly impact: DecimalString;
  readonly mitigationEffectiveness: DecimalString;
  readonly mitigationDescription: string | null;
  readonly signals: readonly RiskSignal[];
  readonly evidenceRefs: readonly string[];
  readonly residualRisk: DecimalString;
  readonly light: RiskLight;
}

export interface RiskDataGap {
  readonly gapId: string;
  readonly description: string;
  readonly category: RiskCategory | null;
  readonly sourceRefs: readonly string[];
}

export interface CategoryRiskAssessment {
  readonly category: RiskCategory;
  readonly status: 'assessed' | 'unassessed';
  readonly riskItemCount: number;
  readonly residualRisk: DecimalString | null;
  readonly light: RiskLight | null;
  readonly topRiskId: string | null;
  readonly topRiskTitle: string | null;
  readonly clauseRecommendationCount: number;
  readonly evidenceRefCount: number;
  readonly dataGaps: readonly RiskDataGap[];
}

export interface OverallRiskAssessment {
  readonly assessedCategoryCount: number;
  readonly categoryCoverageRatio: DecimalString;
  readonly weightCoverageRatio: DecimalString;
  readonly residualRisk: DecimalString | null;
  readonly riskPenalty: DecimalString | null;
  readonly light: RiskLight | null;
}

export type FatalOutcome = 'none' | 'conditional_cap' | 'pause' | 'reject';

export interface FatalFlawCheckAssessment {
  readonly fatalFlawId: FatalFlawId;
  readonly severity: 'pause' | 'reject';
  readonly status: FatalFlawStatus;
  readonly evidenceRefs: readonly string[];
  readonly coverageReason: string | null;
  readonly bindingConditions: readonly string[];
  readonly resolutionNote: string | null;
}

export interface FatalFlawAssessment {
  readonly checks: readonly FatalFlawCheckAssessment[];
  readonly fatalOutcome: FatalOutcome;
  readonly notCurableByClause: boolean;
}

export interface LossProbabilityRange {
  readonly lower: DecimalString;
  readonly upper: DecimalString;
  readonly selectedRuleId: string;
  readonly triggeredRuleIds: readonly string[];
  readonly missingInputs: readonly string[];
  readonly requiresInvestorConfirmation: true;
}

export type ClauseType =
  | 'staged_pricing'
  | 'performance_milestone'
  | 'valuation_adjustment'
  | 'anti_dilution'
  | 'technical_verification_condition'
  | 'development_milestone_tranche'
  | 'ip_representation_and_warranty'
  | 'customer_concentration_covenant'
  | 'revenue_milestone'
  | 'information_rights'
  | 'customer_diversification_plan'
  | 'use_of_proceeds'
  | 'budget_approval'
  | 'periodic_financial_reporting'
  | 'financial_covenant'
  | 'staged_funding'
  | 'minimum_cash_balance'
  | 'financing_condition_precedent'
  | 'pro_rata_right'
  | 'compliance_remediation_condition'
  | 'representation_and_warranty'
  | 'specific_indemnity'
  | 'regulatory_approval_condition'
  | 'founder_vesting'
  | 'key_person_protection'
  | 'founder_repurchase_right'
  | 'reserved_matters'
  | 'board_seat'
  | 'audit_rights'
  | 'data_authenticity_warranty'
  | 'pre_closing_data_verification'
  | 'redemption_right'
  | 'drag_along_right'
  | 'tag_along_right'
  | 'exit_milestone'
  | 'liquidity_protection'
  | 'fatal_flaw_condition_precedent'
  | 'covered_flaw_binding_condition';

export interface ClauseRecommendation {
  readonly clauseId: string;
  readonly clauseType: ClauseType;
  readonly sourceRiskIds: readonly string[];
  readonly sourceFatalFlawIds: readonly FatalFlawId[];
  readonly applicability: string;
  readonly protectionMechanism: string;
  readonly riskTreatment:
    | 'transfer'
    | 'constraint'
    | 'verification_condition'
    | 'partial_mitigation';
  readonly negotiationPriority: 'must_have' | 'high';
  readonly sideEffects: readonly string[];
  readonly legalReviewRequired: true;
  readonly disclaimer: string;
}

export interface VerificationChecklistItem {
  readonly checklistId: string;
  readonly description: string;
  readonly sourceRiskIds: readonly string[];
  readonly sourceFatalFlawIds: readonly FatalFlawId[];
}

export interface RiskAssessment {
  readonly version: '1';
  readonly asOfDate: string;
  readonly thresholds: AppliedTrafficLightThresholds;
  readonly riskItems: readonly RiskItemAssessment[];
  readonly categoryMatrix: readonly CategoryRiskAssessment[];
  readonly overall: OverallRiskAssessment;
  readonly fatalFlaws: FatalFlawAssessment;
  readonly permanentLoss: LossProbabilityRange;
  readonly temporaryDrawdown: LossProbabilityRange;
  readonly clauseRecommendations: readonly ClauseRecommendation[];
  readonly verificationChecklist: readonly VerificationChecklistItem[];
  readonly dataGaps: readonly RiskDataGap[];
}

export type RiskEngineResult<T> = EngineResult<T, RiskCalculationTrace>;
