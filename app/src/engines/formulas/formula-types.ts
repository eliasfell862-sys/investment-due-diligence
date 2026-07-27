import type { AnalysisScalar } from '../../domain/analysis/analysis-scalar';
export type { ConflictStatus } from '../../domain/analysis/analysis-scalar';
import type { DecimalString } from '../../domain/analysis/decimal';
import type { EngineResult } from '../../domain/analysis/engine-result';
import type { AnalysisPeriod, AsOfPeriod } from '../../domain/analysis/period';
import type { AnalysisUnit, MetricValue } from '../../domain/analysis/value';

export const FORMULA_IDS = Object.freeze([
  'gross_margin',
  'ebitda_margin',
  'free_cash_flow',
  'burn_multiple',
  'cac_payback_months',
  'cash_runway_months',
  'revenue_cagr',
  'customer_concentration',
  'repeat_purchase_rate',
  'nrr',
  'ltv_cac',
  'inventory_turnover_days',
  'net_new_arr',
] as const);

export type FormulaId = (typeof FORMULA_IDS)[number];
export type FormulaVersion = '1';
export type FormulaDirection = 'higher_is_better' | 'lower_is_better' | 'neutral';
export type PeriodRule =
  | 'same-flow-period'
  | 'same-as-of'
  | 'ordered-as-of-endpoints'
  | 'mixed-stock-flow';

export interface EffectivePeriodSpan {
  readonly kind: 'span';
  readonly startDate: string;
  readonly endDate: string;
  readonly durationMonths: number;
}

export type CalculationPeriod = AsOfPeriod | EffectivePeriodSpan;
export type DenominatorRule = 'positive';

export type FormulaAst =
  | { readonly kind: 'literal'; readonly value: DecimalString }
  | { readonly kind: 'operand'; readonly operandId: string }
  | {
      readonly kind: 'formula-ref';
      readonly formulaId: FormulaId;
      readonly version: FormulaVersion;
    }
  | { readonly kind: 'add'; readonly values: readonly FormulaAst[] }
  | {
      readonly kind: 'subtract';
      readonly left: FormulaAst;
      readonly right: FormulaAst;
    }
  | { readonly kind: 'multiply'; readonly values: readonly FormulaAst[] }
  | {
      readonly kind: 'divide';
      readonly numerator: FormulaAst;
      readonly denominator: FormulaAst;
      readonly rule: DenominatorRule;
    }
  | {
      readonly kind: 'power';
      readonly base: FormulaAst;
      readonly exponent: FormulaAst;
    };

export type FormulaOperandPeriodRole =
  | 'flow'
  | 'as-of-begin'
  | 'as-of-end'
  | 'as-of'
  | 'representative-month';

export type FormulaNumericDomain =
  | 'decimal'
  | 'unit-interval'
  | 'non-negative-rate'
  | 'signed-rate'
  | 'multiple';

export interface FormulaOperandSpec {
  readonly operandId: string;
  readonly metricId: string;
  readonly expectedUnit: AnalysisUnit;
  readonly periodRole: FormulaOperandPeriodRole;
  readonly numericDomain: FormulaNumericDomain;
  readonly nonNegative?: boolean;
  readonly notGreaterThanOperand?: string;
}

export interface FormulaConstraint {
  readonly kind: 'sum-lte-sum';
  readonly left: readonly string[];
  readonly right: readonly string[];
}

export interface FormulaDefinition {
  readonly formulaId: FormulaId;
  readonly version: FormulaVersion;
  readonly operands: readonly FormulaOperandSpec[];
  readonly outputUnit: AnalysisUnit;
  readonly outputNumericDomain?: FormulaNumericDomain;
  readonly periodRule: PeriodRule;
  readonly direction: FormulaDirection;
  readonly ast: FormulaAst;
  readonly constraints?: readonly FormulaConstraint[];
}

export interface FormulaObservation extends AnalysisScalar {
  readonly period: AnalysisPeriod;
  readonly label?: string;
}

export interface MetricEvaluationInput {
  readonly formulaId: string;
  readonly version: string;
  readonly observations: readonly FormulaObservation[];
}

export interface MetricCalculation {
  readonly formulaId: FormulaId;
  readonly version: FormulaVersion;
  readonly value: MetricValue;
  readonly period: CalculationPeriod;
  readonly periodRefs: readonly string[];
  readonly direction: FormulaDirection;
}

export interface FormulaGraphInput {
  readonly requests: readonly {
    readonly formulaId: string;
    readonly version: string;
  }[];
  readonly observations: readonly FormulaObservation[];
}

export interface FormulaGraphResult {
  readonly calculations: readonly MetricCalculation[];
}

export type EvaluateMetric = (
  input: MetricEvaluationInput,
) => EngineResult<MetricCalculation>;
