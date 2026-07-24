import { deepFreeze } from '../../domain/deep-freeze';
import type { EngineResult } from '../../domain/analysis/engine-result';
import type { AnalysisUnit } from '../../domain/analysis/value';
import type { FormulaObservation, MetricCalculation } from './formula-types';

export const FY2025 = deepFreeze({
  kind: 'flow' as const,
  id: 'FY2025',
  startDate: '2025-01-01',
  endDate: '2025-12-31',
  durationMonths: 12,
  granularity: 'year' as const,
});

export const JAN2025 = deepFreeze({
  kind: 'flow' as const,
  id: 'JAN2025',
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  durationMonths: 1,
  granularity: 'month' as const,
});

export const FY2025_BEGIN = deepFreeze({
  kind: 'as-of' as const,
  id: 'FY2025_BEGIN',
  date: '2024-12-31',
});

export const FY2025_END = deepFreeze({
  kind: 'as-of' as const,
  id: 'FY2025_END',
  date: '2025-12-31',
});

export const currencyUnit = (currency = 'CNY'): AnalysisUnit => ({
  kind: 'currency',
  currency,
});

export const customerMoneyUnit = (
  currency = 'CNY',
  perPeriod?: 'month' | 'year',
): AnalysisUnit => perPeriod === undefined
  ? { kind: 'currency-per-count', currency, countKind: 'customer' }
  : { kind: 'currency-per-count', currency, countKind: 'customer', perPeriod };

export const customerCountUnit: AnalysisUnit = deepFreeze({
  kind: 'count' as const,
  countKind: 'customer' as const,
});

export function observation(
  metricId: string,
  value: string,
  unit: AnalysisUnit = currencyUnit(),
  period: FormulaObservation['period'] = FY2025,
  overrides: Partial<FormulaObservation> = {},
): FormulaObservation {
  return {
    valueRef: `${metricId}:${'id' in period ? period.id : 'period'}`,
    metricId,
    value: { value, unit },
    period,
    sourceRefs: ['evidence'],
    conflict: { status: 'none' },
    ...overrides,
  };
}

export function expectOkValue(
  result: EngineResult<MetricCalculation>,
): string {
  if (result.status !== 'ok') {
    throw new Error(`Expected formula result to be ok: ${JSON.stringify(result)}`);
  }
  return result.value.value.value;
}
