import type { DecimalString } from '../../domain/analysis/decimal';
import type { EquityCalculationTrace } from '../../domain/analysis/calculation-trace';
import type { EngineResult } from '../../domain/analysis/engine-result';
import type { RiskCalculationTrace } from '../../domain/analysis/calculation-trace';

export type InvestmentStrategy = 'vc_early' | 'growth' | 'pe_buyout';

export type DecisionTier =
  | 'strong_recommend'
  | 'conditional_invest'
  | 'continue_observing'
  | 'defer'
  | 'do_not_invest';

export interface StageWeights {
  readonly teamAndGovernance: DecimalString;
  readonly marketAndIndustry: DecimalString;
  readonly productAndTechnology: DecimalString;
  readonly commercializationAndGrowth: DecimalString;
  readonly financialAndCashFlow: DecimalString;
  readonly valuationAndReturn: DecimalString;
}

export interface QualityScores {
  readonly teamAndGovernance: DecimalString;
  readonly marketAndIndustry: DecimalString;
  readonly productAndTechnology: DecimalString;
  readonly commercializationAndGrowth: DecimalString;
  readonly financialAndCashFlow: DecimalString;
  readonly valuationAndReturn: DecimalString;
}

export interface ReturnMetrics {
  readonly targetIrr: DecimalString;
  readonly targetMoic: DecimalString;
  readonly baseCaseIrr: DecimalString | null;
  readonly baseCaseMoic: DecimalString | null;
  readonly permanentLossProbabilityLower: DecimalString;
  readonly permanentLossProbabilityUpper: DecimalString;
}

export interface DecisionInput {
  readonly version: '1';
  readonly strategy: InvestmentStrategy;
  readonly qualityScores: QualityScores;
  readonly stageWeights?: StageWeights;
  readonly overallResidualRisk: DecimalString | null;
  readonly riskPenalty: DecimalString | null;
  readonly fatalOutcome: 'none' | 'conditional_cap' | 'pause' | 'reject';
  readonly notCurableByClause: boolean;
  readonly returnMetrics: ReturnMetrics;
  readonly maxAcceptableValuation: DecimalString | null;
  readonly keyAssumptions: readonly string[];
  readonly bearCaseArguments: readonly string[];
  readonly customThresholdOverrides?: ThresholdOverrides;
}

export interface ThresholdOverrides {
  readonly strongRecommendMin: DecimalString;
  readonly conditionalInvestMin: DecimalString;
  readonly continueObservingMin: DecimalString;
  readonly changeReason: string;
}

export interface DecisionOutput {
  readonly tier: DecisionTier;
  readonly compositeScore: DecimalString | null;
  readonly riskAdjustedScore: DecimalString | null;
  readonly investRationale: string;
  readonly bearCase: string;
  readonly maxAcceptableValuation: DecimalString | null;
  readonly targetIrr: DecimalString;
  readonly targetMoic: DecimalString;
  readonly permanentLossRange: { readonly lower: DecimalString; readonly upper: DecimalString };
  readonly keyAssumptions: readonly string[];
  readonly prerequisites: readonly string[];
  readonly suggestedClauses: readonly string[];
  readonly verificationActions: readonly string[];
  readonly reversalConditions: readonly string[];
}

export interface DecisionCalculationTrace {
  readonly engine: 'decision';
  readonly decisionRef: 'investment-decision@1';
  readonly inputs: readonly import('../../domain/analysis/calculation-trace').TraceInput[];
  readonly steps: readonly import('../../domain/analysis/calculation-trace').TraceStep[];
}

export type DecisionEngineResult<T> = EngineResult<T, DecisionCalculationTrace>;
