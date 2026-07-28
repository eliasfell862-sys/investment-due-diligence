import type { RiskCategory, RiskSignal, ClauseType, FatalFlawId } from './risk-types';

export interface ClauseEntry {
  readonly clauseType: ClauseType;
  readonly applicability: string;
  readonly protectionMechanism: string;
  readonly riskTreatment: 'transfer' | 'constraint' | 'verification_condition' | 'partial_mitigation';
  readonly sideEffects: readonly string[];
}

export const CATEGORY_CLAUSE_MAP: Readonly<Record<RiskCategory, readonly ClauseType[]>> = {
  market: ['staged_pricing', 'performance_milestone', 'valuation_adjustment', 'anti_dilution'],
  technology: ['technical_verification_condition', 'development_milestone_tranche', 'ip_representation_and_warranty'],
  customer: ['customer_concentration_covenant', 'revenue_milestone', 'information_rights', 'customer_diversification_plan'],
  financial: ['use_of_proceeds', 'budget_approval', 'periodic_financial_reporting', 'financial_covenant'],
  financing: ['staged_funding', 'minimum_cash_balance', 'financing_condition_precedent', 'pro_rata_right'],
  legal_compliance: ['compliance_remediation_condition', 'representation_and_warranty', 'specific_indemnity', 'regulatory_approval_condition'],
  governance: ['founder_vesting', 'key_person_protection', 'founder_repurchase_right', 'reserved_matters', 'board_seat'],
  data_authenticity: ['audit_rights', 'data_authenticity_warranty', 'specific_indemnity', 'pre_closing_data_verification'],
  exit: ['redemption_right', 'drag_along_right', 'tag_along_right', 'exit_milestone', 'liquidity_protection'],
};

export const SIGNAL_REFINED_CLAUSES: Readonly<Record<RiskSignal, readonly ClauseType[]>> = {
  market_adoption: ['staged_pricing', 'performance_milestone', 'valuation_adjustment', 'anti_dilution'],
  valuation_overhang: ['valuation_adjustment', 'anti_dilution'],
  technical_feasibility: ['technical_verification_condition', 'development_milestone_tranche'],
  ip_ownership: ['ip_representation_and_warranty'],
  customer_concentration: ['customer_concentration_covenant', 'information_rights'],
  revenue_quality: ['revenue_milestone', 'information_rights'],
  cash_runway: ['use_of_proceeds', 'financial_covenant'],
  reporting_quality: ['periodic_financial_reporting', 'audit_rights'],
  financing_dependency: ['staged_funding', 'minimum_cash_balance', 'financing_condition_precedent'],
  regulatory_approval: ['regulatory_approval_condition', 'compliance_remediation_condition'],
  key_person: ['founder_vesting', 'key_person_protection', 'founder_repurchase_right'],
  governance_control: ['reserved_matters', 'board_seat'],
  data_integrity: ['data_authenticity_warranty', 'pre_closing_data_verification', 'audit_rights'],
  exit_delay: ['redemption_right', 'exit_milestone', 'liquidity_protection'],
};

const CLAUSE_CATALOG: Readonly<Record<ClauseType, ClauseEntry>> = {
  staged_pricing: { clauseType: 'staged_pricing', applicability: 'Valuation linked to performance milestones.', protectionMechanism: 'Adjusts deal price based on achieved metrics.', riskTreatment: 'transfer', sideEffects: ['May delay closing if milestones are contested.'] },
  performance_milestone: { clauseType: 'performance_milestone', applicability: 'Funding released upon achieving defined milestones.', protectionMechanism: 'Ties capital deployment to verified progress.', riskTreatment: 'constraint', sideEffects: ['Milestone definitions may be gamed.'] },
  valuation_adjustment: { clauseType: 'valuation_adjustment', applicability: 'Price adjustment if financial targets are missed.', protectionMechanism: 'Reduces overpayment risk.', riskTreatment: 'transfer', sideEffects: ['Creates adversarial negotiation dynamic.'] },
  anti_dilution: { clauseType: 'anti_dilution', applicability: 'Protects investor ownership if down-round occurs.', protectionMechanism: 'Weighted-average or full-ratchet conversion adjustment.', riskTreatment: 'partial_mitigation', sideEffects: ['May deter new investors.'] },
  technical_verification_condition: { clauseType: 'technical_verification_condition', applicability: 'Technical due diligence confirms feasibility before closing.', protectionMechanism: 'Blocks investment until technology is independently verified.', riskTreatment: 'verification_condition', sideEffects: ['Delays closing timeline.'] },
  development_milestone_tranche: { clauseType: 'development_milestone_tranche', applicability: 'R&D funding released in phases.', protectionMechanism: 'Capital tied to technical progress.', riskTreatment: 'constraint', sideEffects: ['May slow development if milestones are too granular.'] },
  ip_representation_and_warranty: { clauseType: 'ip_representation_and_warranty', applicability: 'Founders warrant IP ownership and non-infringement.', protectionMechanism: 'Breach triggers indemnification or price adjustment.', riskTreatment: 'transfer', sideEffects: ['Enforcement depends on founder net worth.'] },
  customer_concentration_covenant: { clauseType: 'customer_concentration_covenant', applicability: 'Limits revenue from any single customer.', protectionMechanism: 'Requires diversification or triggers early redemption.', riskTreatment: 'constraint', sideEffects: ['May constrain growth strategy.'] },
  revenue_milestone: { clauseType: 'revenue_milestone', applicability: 'Revenue targets must be met for subsequent funding.', protectionMechanism: 'Links capital to commercial traction.', riskTreatment: 'constraint', sideEffects: ['Short-term revenue focus may harm long-term value.'] },
  information_rights: { clauseType: 'information_rights', applicability: 'Investor receives regular operational and financial reports.', protectionMechanism: 'Enables early detection of issues.', riskTreatment: 'verification_condition', sideEffects: ['Reporting burden on small teams.'] },
  customer_diversification_plan: { clauseType: 'customer_diversification_plan', applicability: 'Company commits to reducing customer concentration.', protectionMechanism: 'Board-approved plan with progress reviews.', riskTreatment: 'constraint', sideEffects: ['Resource diversion from core growth.'] },
  use_of_proceeds: { clauseType: 'use_of_proceeds', applicability: 'Investment capital restricted to approved budget categories.', protectionMechanism: 'Prevents misallocation of funds.', riskTreatment: 'constraint', sideEffects: ['Reduces operational flexibility.'] },
  budget_approval: { clauseType: 'budget_approval', applicability: 'Material expenditures require investor consent.', protectionMechanism: 'Prevents unauthorized spending.', riskTreatment: 'constraint', sideEffects: ['Slows decision-making.'] },
  periodic_financial_reporting: { clauseType: 'periodic_financial_reporting', applicability: 'Monthly or quarterly financial statements required.', protectionMechanism: 'Ensures transparency.', riskTreatment: 'verification_condition', sideEffects: ['Administrative overhead.'] },
  financial_covenant: { clauseType: 'financial_covenant', applicability: 'Company must maintain minimum cash balance or EBITDA threshold.', protectionMechanism: 'Early warning of financial distress.', riskTreatment: 'constraint', sideEffects: ['Technical default risk in volatile periods.'] },
  staged_funding: { clauseType: 'staged_funding', applicability: 'Investment deployed in tranches based on milestones.', protectionMechanism: 'Limits exposure if performance lags.', riskTreatment: 'constraint', sideEffects: ['Company faces funding uncertainty.'] },
  minimum_cash_balance: { clauseType: 'minimum_cash_balance', applicability: 'Company must hold minimum cash reserves.', protectionMechanism: 'Prevents insolvency between rounds.', riskTreatment: 'constraint', sideEffects: ['Idle cash earns minimal return.'] },
  financing_condition_precedent: { clauseType: 'financing_condition_precedent', applicability: 'Conditions that must be satisfied before closing.', protectionMechanism: 'Ensures key risks are addressed before capital is committed.', riskTreatment: 'verification_condition', sideEffects: ['May delay or block closing.'] },
  pro_rata_right: { clauseType: 'pro_rata_right', applicability: 'Investor maintains ownership in future rounds.', protectionMechanism: 'Prevents dilution from follow-on financing.', riskTreatment: 'partial_mitigation', sideEffects: ['May limit new lead investor flexibility.'] },
  compliance_remediation_condition: { clauseType: 'compliance_remediation_condition', applicability: 'Regulatory or legal issues must be resolved before or after closing.', protectionMechanism: 'Creates binding remediation timeline.', riskTreatment: 'verification_condition', sideEffects: ['Remediation costs borne by company.'] },
  representation_and_warranty: { clauseType: 'representation_and_warranty', applicability: 'Sellers warrant accuracy of disclosed information.', protectionMechanism: 'Breach triggers indemnification.', riskTreatment: 'transfer', sideEffects: ['Disputes may arise over scope of representations.'] },
  specific_indemnity: { clauseType: 'specific_indemnity', applicability: 'Identified risk allocated to seller via indemnity.', protectionMechanism: 'Financial recourse for specific losses.', riskTreatment: 'transfer', sideEffects: ['Seller may resist broad indemnity scope.'] },
  regulatory_approval_condition: { clauseType: 'regulatory_approval_condition', applicability: 'Closing contingent on regulatory clearance.', protectionMechanism: 'Prevents investment in non-compliant entity.', riskTreatment: 'verification_condition', sideEffects: ['Approval timelines uncertain.'] },
  founder_vesting: { clauseType: 'founder_vesting', applicability: 'Founder equity vests over time with cliff.', protectionMechanism: 'Retains key talent and allows repurchase of unvested shares.', riskTreatment: 'constraint', sideEffects: ['Founders may perceive as loss of control.'] },
  key_person_protection: { clauseType: 'key_person_protection', applicability: 'Key individuals must remain with company.', protectionMechanism: 'Departure triggers board seat, redemption right, or insurance.', riskTreatment: 'partial_mitigation', sideEffects: ['Key person may still leave despite protections.'] },
  founder_repurchase_right: { clauseType: 'founder_repurchase_right', applicability: 'Company or investor can repurchase founder shares upon departure.', protectionMechanism: 'Prevents departing founders from retaining control.', riskTreatment: 'constraint', sideEffects: ['Valuation of repurchased shares is contentious.'] },
  reserved_matters: { clauseType: 'reserved_matters', applicability: 'Certain decisions require investor approval.', protectionMechanism: 'Prevents unilateral actions that harm investor.', riskTreatment: 'constraint', sideEffects: ['May slow operational decisions.'] },
  board_seat: { clauseType: 'board_seat', applicability: 'Investor gains board representation.', protectionMechanism: 'Ensures governance oversight.', riskTreatment: 'partial_mitigation', sideEffects: ['Board dynamics may become adversarial.'] },
  audit_rights: { clauseType: 'audit_rights', applicability: 'Investor can audit financial and operational records.', protectionMechanism: 'Deters fraud and surface irregularities.', riskTreatment: 'verification_condition', sideEffects: ['Audit costs borne by company.'] },
  data_authenticity_warranty: { clauseType: 'data_authenticity_warranty', applicability: 'Management warrants accuracy of provided data.', protectionMechanism: 'Misrepresentation triggers indemnification.', riskTreatment: 'transfer', sideEffects: ['Scope of data covered may be disputed.'] },
  pre_closing_data_verification: { clauseType: 'pre_closing_data_verification', applicability: 'Third-party verification of key data before closing.', protectionMechanism: 'Independent confirmation of claims.', riskTreatment: 'verification_condition', sideEffects: ['Verification adds time and cost.'] },
  redemption_right: { clauseType: 'redemption_right', applicability: 'Investor can require company to repurchase shares after a period.', protectionMechanism: 'Provides exit path if no IPO or sale occurs.', riskTreatment: 'partial_mitigation', sideEffects: ['May strain company finances.'] },
  drag_along_right: { clauseType: 'drag_along_right', applicability: 'Majority shareholders can force minority to sell.', protectionMechanism: 'Facilitates exit transactions.', riskTreatment: 'transfer', sideEffects: ['Minority shareholders may receive unfavorable terms.'] },
  tag_along_right: { clauseType: 'tag_along_right', applicability: 'Minority investors can participate in founder share sales.', protectionMechanism: 'Prevents founders from exiting without investors.', riskTreatment: 'partial_mitigation', sideEffects: ['May complicate founder liquidity events.'] },
  exit_milestone: { clauseType: 'exit_milestone', applicability: 'IPO or sale must be pursued within a defined timeframe.', protectionMechanism: 'Creates accountability for exit planning.', riskTreatment: 'constraint', sideEffects: ['Forced exit timing may not optimize value.'] },
  liquidity_protection: { clauseType: 'liquidity_protection', applicability: 'Structured to ensure investor can achieve liquidity.', protectionMechanism: 'Registration rights, listing requirements.', riskTreatment: 'partial_mitigation', sideEffects: ['May require company resources for listing preparation.'] },
  fatal_flaw_condition_precedent: { clauseType: 'fatal_flaw_condition_precedent', applicability: 'Mandatory condition to resolve an open pause fatal flaw before closing.', protectionMechanism: 'Blocks closing until the condition is satisfied.', riskTreatment: 'verification_condition', sideEffects: ['Closing may be delayed or blocked permanently.'] },
  covered_flaw_binding_condition: { clauseType: 'covered_flaw_binding_condition', applicability: 'Binding condition from investor coverage of a fatal flaw.', protectionMechanism: 'Legally binds the covered resolution.', riskTreatment: 'constraint', sideEffects: ['Failure to meet condition may trigger default.'] },
};

export function getClauseEntry(clauseType: ClauseType): ClauseEntry {
  return CLAUSE_CATALOG[clauseType];
}

export function getClausesForCategory(category: RiskCategory): readonly ClauseType[] {
  return CATEGORY_CLAUSE_MAP[category];
}

export function getRefinedClausesForSignal(signal: RiskSignal): readonly ClauseType[] {
  return SIGNAL_REFINED_CLAUSES[signal];
}

export const ALL_CLAUSE_TYPES: readonly ClauseType[] = Object.keys(CLAUSE_CATALOG) as ClauseType[];
