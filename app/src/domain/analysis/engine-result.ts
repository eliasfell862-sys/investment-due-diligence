import { deepFreeze } from '../deep-freeze';
import type {
  CalculationTrace,
  DecisionCalculationTrace,
  EquityCalculationTrace,
  ForecastCalculationTrace,
  FormulaCalculationTrace,
  RiskCalculationTrace,
  ValuationCalculationTrace,
} from './calculation-trace';
import { DomainContractError } from './value';

export type EngineIssueCode =
  | 'missing_input'
  | 'invalid_decimal'
  | 'value_out_of_range'
  | 'currency_mismatch'
  | 'unit_mismatch'
  | 'period_mismatch'
  | 'division_by_zero'
  | 'non_positive_denominator'
  | 'probability_sum_mismatch'
  | 'circular_dependency'
  | 'unsupported_formula'
  | 'root_not_found'
  | 'insufficient_comparables'
  | 'invalid_terminal_value'
  | 'invalid_scenario_set'
  | 'unsupported_engine_version'
  | 'invalid_forecast_horizon'
  | 'invalid_seasonality'
  | 'invalid_revenue_driver'
  | 'invalid_valuation_basis'
  | 'invalid_valuation_range'
  | 'invalid_sensitivity_matrix'
  | 'inconsistent_target_return'
  | 'invalid_cap_table'
  | 'invalid_equity_event'
  | 'invalid_liquidation_preference'
  | 'invalid_conversion_equilibrium'
  | 'allocation_mismatch'
  | 'unresolved_conflict'
  | 'invalid_risk_item'
  | 'invalid_risk_weight'
  | 'invalid_risk_threshold'
  | 'invalid_fatal_flaw'
  | 'invalid_risk_snapshot'
  | 'missing_risk_coverage';

export interface EngineIssue {
  readonly code: EngineIssueCode;
  readonly path: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export type EngineResult<
  T,
  TTrace extends CalculationTrace = CalculationTrace,
> =
  | {
      readonly status: 'ok';
      readonly value: T;
      readonly warnings: readonly EngineIssue[];
      readonly trace: TTrace;
    }
  | {
      readonly status: 'blocked';
      readonly reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful';
      readonly issues: readonly EngineIssue[];
      readonly trace: TTrace;
    };

function invalidDto(): never {
  throw new DomainContractError('invalid_dto');
}

function snapshotJsonDto<T>(input: T): T {
  const active = new WeakSet<object>();
  try {
    return snapshotJsonValue(input, active) as T;
  } catch {
    return invalidDto();
  }
}

function snapshotJsonValue(value: unknown, active: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : invalidDto();
  }
  if (typeof value !== 'object') {
    return invalidDto();
  }
  if (active.has(value)) {
    return invalidDto();
  }

  active.add(value);
  try {
    return Array.isArray(value)
      ? snapshotJsonArray(value, active)
      : snapshotJsonObject(value, active);
  } finally {
    active.delete(value);
  }
}

function snapshotJsonArray(
  value: unknown[],
  active: WeakSet<object>,
): unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return invalidDto();
  }

  const keys = Reflect.ownKeys(value);
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return invalidDto();
  }

  const length = lengthDescriptor.value;
  if (keys.length !== length + 1) {
    return invalidDto();
  }

  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      return invalidDto();
    }
    output.push(snapshotJsonValue(descriptor.value, active));
  }
  return output;
}

function snapshotJsonObject(
  value: object,
  active: WeakSet<object>,
): Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidDto();
  }

  const output = Object.create(prototype) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      return invalidDto();
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      return invalidDto();
    }
    Object.defineProperty(output, key, {
      value: snapshotJsonValue(descriptor.value, active),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return output;
}

export function okResult<T>(
  value: T,
  warnings: readonly EngineIssue[],
  trace: FormulaCalculationTrace,
): Extract<EngineResult<T, FormulaCalculationTrace>, { readonly status: 'ok' }>;
export function okResult<T>(
  value: T,
  warnings: readonly EngineIssue[],
  trace: ForecastCalculationTrace,
): Extract<EngineResult<T, ForecastCalculationTrace>, { readonly status: 'ok' }>;
export function okResult<T>(
  value: T,
  warnings: readonly EngineIssue[],
  trace: ValuationCalculationTrace,
): Extract<EngineResult<T, ValuationCalculationTrace>, { readonly status: 'ok' }>;
export function okResult<T>(
  value: T,
  warnings: readonly EngineIssue[],
  trace: EquityCalculationTrace,
): Extract<EngineResult<T, EquityCalculationTrace>, { readonly status: 'ok' }>;
export function okResult<T>(
  value: T,
  warnings: readonly EngineIssue[],
  trace: RiskCalculationTrace,
): Extract<EngineResult<T, RiskCalculationTrace>, { readonly status: 'ok' }>;
export function okResult<T>(
  value: T,
  warnings: readonly EngineIssue[],
  trace: DecisionCalculationTrace,
): Extract<EngineResult<T, DecisionCalculationTrace>, { readonly status: 'ok' }>;
export function okResult<T>(
  value: T,
  warnings: readonly EngineIssue[],
  trace: CalculationTrace,
): Extract<EngineResult<T>, { readonly status: 'ok' }>;
export function okResult<T>(
  value: T,
  warnings: readonly EngineIssue[],
  trace: CalculationTrace,
): Extract<EngineResult<T>, { readonly status: 'ok' }> {
  return deepFreeze(
    snapshotJsonDto({
      status: 'ok' as const,
      value,
      warnings,
      trace,
    }),
  );
}

export function blockedResult<T = never>(
  reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful',
  issues: readonly EngineIssue[],
  trace: FormulaCalculationTrace,
): Extract<EngineResult<T, FormulaCalculationTrace>, { readonly status: 'blocked' }>;
export function blockedResult<T = never>(
  reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful',
  issues: readonly EngineIssue[],
  trace: ForecastCalculationTrace,
): Extract<EngineResult<T, ForecastCalculationTrace>, { readonly status: 'blocked' }>;
export function blockedResult<T = never>(
  reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful',
  issues: readonly EngineIssue[],
  trace: ValuationCalculationTrace,
): Extract<EngineResult<T, ValuationCalculationTrace>, { readonly status: 'blocked' }>;
export function blockedResult<T = never>(
  reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful',
  issues: readonly EngineIssue[],
  trace: EquityCalculationTrace,
): Extract<EngineResult<T, EquityCalculationTrace>, { readonly status: 'blocked' }>;
export function blockedResult<T = never>(
  reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful',
  issues: readonly EngineIssue[],
  trace: RiskCalculationTrace,
): Extract<EngineResult<T, RiskCalculationTrace>, { readonly status: 'blocked' }>;
export function blockedResult<T = never>(
  reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful',
  issues: readonly EngineIssue[],
  trace: DecisionCalculationTrace,
): Extract<EngineResult<T, DecisionCalculationTrace>, { readonly status: 'blocked' }>;
export function blockedResult<T = never>(
  reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful',
  issues: readonly EngineIssue[],
  trace: CalculationTrace,
): Extract<EngineResult<T>, { readonly status: 'blocked' }>;
export function blockedResult<T = never>(
  reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful',
  issues: readonly EngineIssue[],
  trace: CalculationTrace,
): Extract<EngineResult<T>, { readonly status: 'blocked' }> {
  return deepFreeze(
    snapshotJsonDto({
      status: 'blocked' as const,
      reason,
      issues,
      trace,
    }),
  );
}
