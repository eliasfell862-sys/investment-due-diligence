import type {
  AnalysisConflict,
  AnalysisScalar,
} from '../../domain/analysis/analysis-scalar';
import type {
  ForecastCalculationTrace,
  ForecastMonthTrace,
  TraceStep,
} from '../../domain/analysis/calculation-trace';
import type {
  DecimalString,
  ProbabilityString,
} from '../../domain/analysis/decimal';
import type { EngineIssue, EngineResult } from '../../domain/analysis/engine-result';
import type { FlowPeriod } from '../../domain/analysis/period';
import type {
  ScenarioDefinition,
  ScenarioId,
} from '../../domain/analysis/scenario';
import type {
  AnalysisUnit,
  CurrencyCode,
} from '../../domain/analysis/value';

export type ForecastEngineVersion = '1';
export type ForecastHorizonMonths = 36 | 48 | 60;

export interface ThreeScenarioForecastInput {
  readonly version: ForecastEngineVersion;
  readonly baseline: ForecastBaseline;
  readonly scenarios: readonly ScenarioDefinition<ForecastScenarioAssumptions>[];
}

export interface ForecastBaseline {
  readonly currency: CurrencyCode;
  readonly forecastStartMonth: string;
  readonly horizonMonths: ForecastHorizonMonths;
  readonly beginningCash: AnalysisScalar;
  readonly minimumCashBalance: AnalysisScalar;
}

export interface SeasonalityPattern {
  readonly valueRef: string;
  readonly sourceRefs: readonly string[];
  readonly multipliers: readonly [
    DecimalString,
    DecimalString,
    DecimalString,
    DecimalString,
    DecimalString,
    DecimalString,
    DecimalString,
    DecimalString,
    DecimalString,
    DecimalString,
    DecimalString,
    DecimalString,
  ];
}

export interface GeneratedValueRule {
  readonly startingValue: AnalysisScalar;
  readonly monthlyGrowthRate: AnalysisScalar;
  readonly seasonality?: SeasonalityPattern;
}

export interface CustomRevenueFactor {
  readonly factorId: string;
  readonly rule: GeneratedValueRule;
}

export type RevenueModel =
  | {
      readonly kind: 'customer-count-times-average-revenue';
      readonly customerCount: GeneratedValueRule;
      readonly averageRevenuePerCustomer: GeneratedValueRule;
    }
  | {
      readonly kind: 'user-count-times-arpu';
      readonly userCount: GeneratedValueRule;
      readonly arpu: GeneratedValueRule;
    }
  | {
      readonly kind: 'gmv-times-take-rate';
      readonly gmv: GeneratedValueRule;
      readonly takeRate: GeneratedValueRule;
    }
  | {
      readonly kind: 'unit-sales-times-unit-price';
      readonly unitsSold: GeneratedValueRule;
      readonly unitPrice: GeneratedValueRule;
    }
  | {
      readonly kind: 'custom-product';
      readonly factors: readonly CustomRevenueFactor[];
    };

export interface RevenueRatioRule {
  readonly kind: 'revenue-ratio';
  readonly modelYearRates: readonly AnalysisScalar[];
}

export interface AmountGrowthRule {
  readonly kind: 'amount-growth';
  readonly rule: GeneratedValueRule;
}

export type OperatingCostRule = RevenueRatioRule | AmountGrowthRule;

export interface ForecastScenarioAssumptions {
  readonly revenue: RevenueModel;
  readonly costOfGoodsSold: OperatingCostRule;
  readonly salesAndMarketing: OperatingCostRule;
  readonly researchAndDevelopment: OperatingCostRule;
  readonly generalAndAdministrative: OperatingCostRule;
  readonly depreciationAndAmortization: AmountGrowthRule;
  readonly interestExpense: AmountGrowthRule;
  readonly capitalExpenditure: AmountGrowthRule;
  readonly increaseInNetWorkingCapital: AmountGrowthRule;
  readonly taxRate: AnalysisScalar;
}

export interface ForecastDriverValue {
  readonly factorId: string;
  readonly value: DecimalString;
  readonly unit: AnalysisUnit;
}

interface ForecastFinancialFields {
  readonly revenue: DecimalString;
  readonly costOfGoodsSold: DecimalString;
  readonly grossProfit: DecimalString;
  readonly salesAndMarketing: DecimalString;
  readonly researchAndDevelopment: DecimalString;
  readonly generalAndAdministrative: DecimalString;
  readonly ebitda: DecimalString;
  readonly depreciationAndAmortization: DecimalString;
  readonly ebit: DecimalString;
  readonly interestExpense: DecimalString;
  readonly preTaxIncome: DecimalString;
  readonly incomeTax: DecimalString;
  readonly netIncome: DecimalString;
  readonly increaseInNetWorkingCapital: DecimalString;
  readonly operatingCashFlow: DecimalString;
  readonly capitalExpenditure: DecimalString;
  readonly freeCashFlow: DecimalString;
  readonly fcff: DecimalString;
  readonly beginningCash: DecimalString;
  readonly preFinancingEndingCash: DecimalString;
  readonly financingInflow: DecimalString;
  readonly endingCash: DecimalString;
}

export interface MonthlyForecast extends ForecastFinancialFields {
  readonly period: FlowPeriod;
  readonly driverValues: readonly ForecastDriverValue[];
}

export interface ModelYearForecast extends ForecastFinancialFields {
  readonly period: FlowPeriod;
}

export interface ForecastCashSummary {
  readonly minimumPreFinancingCash: DecimalString;
  readonly minimumPreFinancingPeriodId: string;
  readonly firstFinancingPeriodId?: string;
  readonly minimumFinancingRequirement: DecimalString;
  readonly finalEndingCash: DecimalString;
}

export interface ScenarioForecast {
  readonly id: ScenarioId;
  readonly probability: ProbabilityString;
  readonly months: readonly MonthlyForecast[];
  readonly modelYears: readonly ModelYearForecast[];
  readonly cashSummary: ForecastCashSummary;
}

export interface ScenarioForecastSet {
  readonly version: ForecastEngineVersion;
  readonly currency: CurrencyCode;
  readonly forecastStartMonth: string;
  readonly horizonMonths: ForecastHorizonMonths;
  readonly scenarios: readonly ScenarioForecast[];
}

export type ForecastEngineResult<T> = EngineResult<T, ForecastCalculationTrace>;

export interface NormalizedScalar {
  readonly valueRef: string;
  readonly metricId: string;
  readonly value: DecimalString;
  readonly unit: AnalysisUnit;
  readonly sourceRefs: readonly string[];
  readonly conflict: AnalysisConflict;
}

export interface NormalizedSeasonalityPattern {
  readonly valueRef: string;
  readonly sourceRefs: readonly string[];
  readonly multipliers: SeasonalityPattern['multipliers'];
}

export interface NormalizedGeneratedValueRule {
  readonly startingValue: NormalizedScalar;
  readonly monthlyGrowthRate: NormalizedScalar;
  readonly seasonality?: NormalizedSeasonalityPattern;
}

export interface NormalizedForecastBaseline {
  readonly currency: CurrencyCode;
  readonly forecastStartMonth: string;
  readonly horizonMonths: ForecastHorizonMonths;
  readonly beginningCash: NormalizedScalar;
  readonly minimumCashBalance: NormalizedScalar;
}

export interface NormalizedCustomRevenueFactor {
  readonly factorId: string;
  readonly rule: NormalizedGeneratedValueRule;
}

export type NormalizedRevenueModel =
  | {
      readonly kind: 'customer-count-times-average-revenue';
      readonly customerCount: NormalizedGeneratedValueRule;
      readonly averageRevenuePerCustomer: NormalizedGeneratedValueRule;
    }
  | {
      readonly kind: 'user-count-times-arpu';
      readonly userCount: NormalizedGeneratedValueRule;
      readonly arpu: NormalizedGeneratedValueRule;
    }
  | {
      readonly kind: 'gmv-times-take-rate';
      readonly gmv: NormalizedGeneratedValueRule;
      readonly takeRate: NormalizedGeneratedValueRule;
    }
  | {
      readonly kind: 'unit-sales-times-unit-price';
      readonly unitsSold: NormalizedGeneratedValueRule;
      readonly unitPrice: NormalizedGeneratedValueRule;
    }
  | {
      readonly kind: 'custom-product';
      readonly factors: readonly NormalizedCustomRevenueFactor[];
    };

export interface NormalizedRevenueRatioRule {
  readonly kind: 'revenue-ratio';
  readonly modelYearRates: readonly NormalizedScalar[];
}

export interface NormalizedAmountGrowthRule {
  readonly kind: 'amount-growth';
  readonly rule: NormalizedGeneratedValueRule;
}

export type NormalizedOperatingCostRule =
  | NormalizedRevenueRatioRule
  | NormalizedAmountGrowthRule;

export interface NormalizedForecastScenarioAssumptions {
  readonly revenue: NormalizedRevenueModel;
  readonly costOfGoodsSold: NormalizedOperatingCostRule;
  readonly salesAndMarketing: NormalizedOperatingCostRule;
  readonly researchAndDevelopment: NormalizedOperatingCostRule;
  readonly generalAndAdministrative: NormalizedOperatingCostRule;
  readonly depreciationAndAmortization: NormalizedAmountGrowthRule;
  readonly interestExpense: NormalizedAmountGrowthRule;
  readonly capitalExpenditure: NormalizedAmountGrowthRule;
  readonly increaseInNetWorkingCapital: NormalizedAmountGrowthRule;
  readonly taxRate: NormalizedScalar;
}

export interface NormalizedScenario {
  readonly id: ScenarioId;
  readonly probability: ProbabilityString;
  readonly assumptions: NormalizedForecastScenarioAssumptions;
}

export interface NormalizedForecastInput {
  readonly version: ForecastEngineVersion;
  readonly baseline: NormalizedForecastBaseline;
  readonly scenarios: readonly NormalizedScenario[];
}

interface InternalBlockedCalculation {
  readonly status: 'blocked';
  readonly reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful';
  readonly issues: readonly EngineIssue[];
}

export type SeriesGeneration =
  | {
      readonly status: 'ok';
      readonly values: readonly DecimalString[];
      readonly steps: readonly TraceStep[];
    }
  | (InternalBlockedCalculation & {
      readonly steps: readonly TraceStep[];
    });

export type RevenueCalculation =
  | {
      readonly status: 'ok';
      readonly revenue: readonly DecimalString[];
      readonly driverValues: readonly (readonly ForecastDriverValue[])[];
      readonly monthTraces: readonly ForecastMonthTrace[];
    }
  | (InternalBlockedCalculation & {
      readonly monthTraces: readonly ForecastMonthTrace[];
    });

export type ScenarioCalculation =
  | {
      readonly status: 'ok';
      readonly months: readonly MonthlyForecast[];
      readonly monthTraces: readonly ForecastMonthTrace[];
    }
  | (InternalBlockedCalculation & {
      readonly monthTraces: readonly ForecastMonthTrace[];
    });
