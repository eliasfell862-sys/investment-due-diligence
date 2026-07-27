import type { EquityCalculationTrace } from '../../domain/analysis/calculation-trace';
import type {
  DecimalString,
  ProbabilityString,
} from '../../domain/analysis/decimal';
import type { EngineResult } from '../../domain/analysis/engine-result';
import type { ScenarioId } from '../../domain/analysis/scenario';
import type { CurrencyCode } from '../../domain/analysis/value';

export type EquityEngineVersion = '1';
export type SecurityType = 'common' | 'preferred' | 'esop';

export interface LiquidationPreference {
  readonly participation: 'non-participating' | 'participating';
  readonly multiple: DecimalString;
  readonly seniorityRank: number;
  readonly capMultiple?: DecimalString;
}

export interface SecurityPosition {
  readonly securityId: string;
  readonly holderId: string;
  readonly securityType: SecurityType;
  readonly shares: DecimalString;
  readonly investedCapital: DecimalString;
  readonly acquisitionDate: string;
  readonly liquidationPreference?: LiquidationPreference;
}

export interface EsopPoolExpansion {
  readonly securityId: string;
  readonly holderId: string;
  readonly timing: 'pre-money' | 'post-money';
  readonly targetOwnership: DecimalString;
}

export interface PricedRoundEvent {
  readonly kind: 'priced-round';
  readonly eventId: string;
  readonly date: string;
  readonly investorHolderId: string;
  readonly securityId: string;
  readonly securityType: 'common' | 'preferred';
  readonly preMoneyEquityValue: DecimalString;
  readonly investmentAmount: DecimalString;
  readonly postMoneyEquityValue?: DecimalString;
  readonly liquidationPreference?: LiquidationPreference;
  readonly esopPoolExpansion?: EsopPoolExpansion;
}

export interface CapTableModelInput {
  readonly version: EquityEngineVersion;
  readonly currency: CurrencyCode;
  readonly asOfDate: string;
  readonly initialPositions: readonly SecurityPosition[];
  readonly events: readonly PricedRoundEvent[];
}

export interface CapTablePosition extends SecurityPosition {
  readonly ownership: DecimalString;
}

export interface InvestmentLedgerEntry {
  readonly holderId: string;
  readonly securityId: string;
  readonly eventId: string;
  readonly date: string;
  readonly amount: DecimalString;
}

export interface CapTableSnapshot {
  readonly eventId: string;
  readonly asOfDate: string;
  readonly totalFullyDilutedShares: DecimalString;
  readonly positions: readonly CapTablePosition[];
}

export interface PricedRoundResult {
  readonly eventId: string;
  readonly pricePerShare: DecimalString;
  readonly newInvestorShares: DecimalString;
  readonly esopPoolIncrease: DecimalString;
}

export interface CapTableModel {
  readonly version: EquityEngineVersion;
  readonly currency: CurrencyCode;
  readonly initialSnapshot: CapTableSnapshot;
  readonly snapshots: readonly CapTableSnapshot[];
  readonly finalSnapshot: CapTableSnapshot;
  readonly rounds: readonly PricedRoundResult[];
  readonly investments: readonly InvestmentLedgerEntry[];
}

export interface LiquidationWaterfallInput {
  readonly version: EquityEngineVersion;
  readonly currency: CurrencyCode;
  readonly asOfDate: string;
  readonly exitDate: string;
  readonly exitValue: DecimalString;
  readonly positions: readonly CapTablePosition[];
}

export interface ConversionDecision {
  readonly securityId: string;
  readonly converted: boolean;
}

export interface WaterfallAllocation {
  readonly securityId: string;
  readonly holderId: string;
  readonly converted: boolean;
  readonly preferenceClaim: DecimalString;
  readonly preferenceProceeds: DecimalString;
  readonly participationProceeds: DecimalString;
  readonly totalProceeds: DecimalString;
}

export interface LiquidationWaterfall {
  readonly version: EquityEngineVersion;
  readonly currency: CurrencyCode;
  readonly exitDate: string;
  readonly exitValue: DecimalString;
  readonly conversionDecisions: readonly ConversionDecision[];
  readonly allocations: readonly WaterfallAllocation[];
  readonly totalAllocated: DecimalString;
  readonly remainingValue: DecimalString;
}

export interface InvestorCapTableSnapshot {
  readonly asOfDate: string;
  readonly positions: readonly CapTablePosition[];
  readonly investments: readonly InvestmentLedgerEntry[];
}

export interface InvestorExitScenario {
  readonly id: ScenarioId;
  readonly probability: ProbabilityString;
  readonly exitDate: string;
  readonly exitValue: DecimalString;
}

export interface InvestorReturnInput {
  readonly version: EquityEngineVersion;
  readonly currency: CurrencyCode;
  readonly holderId: string;
  readonly capTable: InvestorCapTableSnapshot;
  readonly scenarios: readonly InvestorExitScenario[];
}

export interface DatedCashFlow {
  readonly date: string;
  readonly amount: DecimalString;
}

export type XirrCalculation =
  | {
      readonly status: 'ok';
      readonly value: DecimalString;
      readonly iterations: number;
    }
  | {
      readonly status: 'blocked';
      readonly issue: 'root_not_found';
    };

export interface InvestorScenarioReturn {
  readonly id: ScenarioId;
  readonly probability: ProbabilityString;
  readonly exitDate: string;
  readonly exitValue: DecimalString;
  readonly investorProceeds: DecimalString;
  readonly moic: DecimalString;
  readonly irr: DecimalString | null;
  readonly irrIssue?: 'root_not_found';
  readonly permanentLoss: boolean;
}

export interface InvestorReturnSet {
  readonly version: EquityEngineVersion;
  readonly currency: CurrencyCode;
  readonly holderId: string;
  readonly totalInvestedCapital: DecimalString;
  readonly scenarios: readonly InvestorScenarioReturn[];
  readonly expectedExitProceeds: DecimalString;
  readonly expectedMoic: DecimalString;
  readonly permanentLossProbability: ProbabilityString;
}

export type EquityEngineResult<T> = EngineResult<T, EquityCalculationTrace>;
