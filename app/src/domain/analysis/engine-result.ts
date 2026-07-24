import { deepFreeze } from '../deep-freeze';
import type { CalculationTrace } from './calculation-trace';

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
  | 'unresolved_conflict';

export interface EngineIssue {
  readonly code: EngineIssueCode;
  readonly path: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export type EngineResult<T> =
  | {
      readonly status: 'ok';
      readonly value: T;
      readonly warnings: readonly EngineIssue[];
      readonly trace: CalculationTrace;
    }
  | {
      readonly status: 'blocked';
      readonly reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful';
      readonly issues: readonly EngineIssue[];
      readonly trace: CalculationTrace;
    };

export function okResult<T>(
  value: T,
  warnings: readonly EngineIssue[],
  trace: CalculationTrace,
): Extract<EngineResult<T>, { readonly status: 'ok' }> {
  return deepFreeze({
    status: 'ok' as const,
    value,
    warnings: [...warnings],
    trace,
  });
}

export function blockedResult<T = never>(
  reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful',
  issues: readonly EngineIssue[],
  trace: CalculationTrace,
): Extract<EngineResult<T>, { readonly status: 'blocked' }> {
  return deepFreeze({
    status: 'blocked' as const,
    reason,
    issues: [...issues],
    trace,
  });
}
