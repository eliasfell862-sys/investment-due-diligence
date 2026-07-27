import type { ValuationCalculationTrace } from '../../domain/analysis/calculation-trace';
import type { DecimalString, ProbabilityString } from '../../domain/analysis/decimal';
import type { EngineResult } from '../../domain/analysis/engine-result';
import type { FlowPeriod } from '../../domain/analysis/period';
import type { ScenarioId } from '../../domain/analysis/scenario';
import type { CurrencyCode } from '../../domain/analysis/value';
import type { ModelYearForecast } from '../forecast/forecast-types';

export type ValuationEngineVersion = '1';
export type ValuationBasis = 'pre-money-equity';

export type ValuationMethodId =
  | 'dcf'
  | 'comparable-ev-revenue'
  | 'comparable-ev-ebitda'
  | 'comparable-pe'
  | 'vc-method';

export type SensitivityMatrixRef =
  | 'dcf-wacc-perpetuity-growth@1'
  | 'dcf-wacc-exit-multiple@1'
  | 'vc-exit-equity-target-irr@1';

export type FivePointDecimalTuple = readonly [
  DecimalString,
  DecimalString,
  DecimalString,
  DecimalString,
  DecimalString,
];

export type FiveByFiveDecimalMatrix = readonly [
  FivePointDecimalTuple,
  FivePointDecimalTuple,
  FivePointDecimalTuple,
  FivePointDecimalTuple,
  FivePointDecimalTuple,
];

export interface DecimalRangeInput {
  readonly low: DecimalString;
  readonly midpoint: DecimalString;
  readonly high: DecimalString;
}

export interface ValuationRange extends DecimalRangeInput {
  readonly currency: CurrencyCode;
  readonly valuationDate: string;
  readonly basis: ValuationBasis;
}

export interface SensitivityAxis {
  readonly axisId:
    | 'wacc'
    | 'perpetuity-growth'
    | 'exit-multiple'
    | 'exit-equity-value'
    | 'target-irr';
  readonly label: string;
  readonly unit: 'rate' | 'multiple' | 'currency';
  readonly values: FivePointDecimalTuple;
}

export interface SensitivityMatrix {
  readonly matrixRef: SensitivityMatrixRef;
  readonly rowAxis: SensitivityAxis;
  readonly columnAxis: SensitivityAxis;
  readonly currency: CurrencyCode;
  readonly valuationDate: string;
  readonly basis: ValuationBasis;
  readonly values: FiveByFiveDecimalMatrix;
}

export interface FootballFieldRow {
  readonly methodId: ValuationMethodId | 'triangulated';
  readonly label: string;
  readonly low: DecimalString;
  readonly midpoint: DecimalString;
  readonly high: DecimalString;
}

export interface DcfSensitivityInput {
  readonly wacc: FivePointDecimalTuple;
  readonly perpetuityGrowthRate: FivePointDecimalTuple;
  readonly exitMultiple: FivePointDecimalTuple;
}

export interface DcfInput {
  readonly version: ValuationEngineVersion;
  readonly currency: CurrencyCode;
  readonly valuationDate: string;
  readonly scenarioId: ScenarioId;
  readonly probability: ProbabilityString;
  readonly modelYears: readonly ModelYearForecast[];
  readonly discountingConvention: 'year-end' | 'mid-year';
  readonly wacc: DecimalString;
  readonly perpetuityGrowthRate: DecimalString;
  readonly exitMultiple: DecimalString;
  readonly exitMetric: 'revenue' | 'ebitda';
  readonly interestBearingDebt: DecimalString;
  readonly cashAndCashEquivalents: DecimalString;
  readonly terminalMethodWeights: {
    readonly perpetuityGrowth: DecimalString;
    readonly exitMultiple: DecimalString;
  };
  readonly sensitivity: DcfSensitivityInput;
}

export interface DcfTerminalMethodResult {
  readonly method: 'perpetuity-growth' | 'exit-multiple';
  readonly terminalValue: DecimalString;
  readonly presentValueOfTerminalValue: DecimalString;
  readonly enterpriseValue: DecimalString;
  readonly equityValue: DecimalString;
  readonly terminalValueShareOfEnterpriseValue: DecimalString;
}

export interface DcfResult {
  readonly version: ValuationEngineVersion;
  readonly methodId: 'dcf';
  readonly range: ValuationRange;
  readonly presentValueOfExplicitFcff: DecimalString;
  readonly netDebt: DecimalString;
  readonly perpetuityGrowth: DcfTerminalMethodResult;
  readonly exitMultiple: DcfTerminalMethodResult;
  readonly sensitivityMatrices: readonly [SensitivityMatrix, SensitivityMatrix];
}

export interface ComparableSubject {
  readonly period: FlowPeriod;
  readonly revenue: DecimalString;
  readonly ebitda: DecimalString;
  readonly netIncome: DecimalString;
  readonly interestBearingDebt: DecimalString;
  readonly cashAndCashEquivalents: DecimalString;
}

export interface ComparablePeer {
  readonly companyId: string;
  readonly enterpriseValue: DecimalString;
  readonly equityValue: DecimalString;
  readonly revenue: DecimalString;
  readonly ebitda: DecimalString;
  readonly netIncome: DecimalString;
}

export interface ComparableAdjustments {
  readonly growth: DecimalString;
  readonly profitability: DecimalString;
  readonly size: DecimalString;
  readonly liquidity: DecimalString;
}

export interface ComparableValuationInput {
  readonly version: ValuationEngineVersion;
  readonly currency: CurrencyCode;
  readonly valuationDate: string;
  readonly subject: ComparableSubject;
  readonly peers: readonly ComparablePeer[];
  readonly adjustments: ComparableAdjustments;
}

export interface ComparableMethodResult {
  readonly methodId:
    | 'comparable-ev-revenue'
    | 'comparable-ev-ebitda'
    | 'comparable-pe';
  readonly label: string;
  readonly validSampleCount: number;
  readonly rawMultipleRange: DecimalRangeInput;
  readonly totalAdjustment: DecimalString;
  readonly adjustedMultipleRange: DecimalRangeInput;
  readonly range: ValuationRange;
}

export interface ComparableValuationResult {
  readonly version: ValuationEngineVersion;
  readonly methods: readonly ComparableMethodResult[];
  readonly footballField: readonly FootballFieldRow[];
}

export interface VcMethodInput {
  readonly version: ValuationEngineVersion;
  readonly currency: CurrencyCode;
  readonly valuationDate: string;
  readonly exitEquityValue: DecimalRangeInput;
  readonly targetOwnership: DecimalString;
  readonly expectedDilution: DecimalString;
  readonly holdingYears: DecimalString;
  readonly targetIrr?: DecimalString;
  readonly targetMoic?: DecimalString;
  readonly sensitivity: {
    readonly exitEquityValue: FivePointDecimalTuple;
    readonly targetIrr: FivePointDecimalTuple;
  };
}

export interface VcMethodResult {
  readonly version: ValuationEngineVersion;
  readonly methodId: 'vc-method';
  readonly targetMoic: DecimalString;
  readonly targetExitProceeds: DecimalRangeInput;
  readonly maximumInvestment: DecimalRangeInput;
  readonly range: ValuationRange;
  readonly sensitivityMatrix: SensitivityMatrix;
}

export interface WeightedValuationMethod {
  readonly methodId: ValuationMethodId;
  readonly label: string;
  readonly weight: DecimalString;
  readonly range: ValuationRange;
  readonly sensitivityMatrices?: readonly SensitivityMatrix[];
}

export interface ValuationTriangulationInput {
  readonly version: ValuationEngineVersion;
  readonly methods: readonly WeightedValuationMethod[];
}

export interface ValuationTriangulationResult {
  readonly version: ValuationEngineVersion;
  readonly range: ValuationRange;
  readonly methodCount: number;
  readonly totalWeight: DecimalString;
  readonly methods: readonly WeightedValuationMethod[];
  readonly footballField: readonly FootballFieldRow[];
  readonly sensitivityMatrices: readonly SensitivityMatrix[];
}

export type ValuationEngineResult<T> = EngineResult<T, ValuationCalculationTrace>;
