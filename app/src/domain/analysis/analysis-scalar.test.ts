import { describe, expect, expectTypeOf, it } from 'vitest';

import './analysis-scalar';
import type {
  AnalysisConflict,
  AnalysisScalar,
  ConflictStatus,
} from './analysis-scalar';
import type { MetricValue } from './value';

describe('shared analysis scalar contracts', () => {
  it('locks the conflict status and scalar DTO shapes', () => {
    const value: MetricValue = {
      value: '100',
      unit: { kind: 'currency', currency: 'CNY' },
    };
    const conflict: AnalysisConflict = {
      status: 'conservative-selected',
      selectionReason: 'Used the lower supported observation.',
    };
    const scalar: AnalysisScalar = {
      valueRef: 'revenue-fy2025',
      metricId: 'revenue',
      value,
      sourceRefs: ['source-1'],
      conflict,
    };

    expectTypeOf<ConflictStatus>().toEqualTypeOf<
      'none' | 'resolved' | 'conservative-selected' | 'blocking'
    >();
    expectTypeOf<AnalysisConflict>().toEqualTypeOf<{
      readonly status: ConflictStatus;
      readonly selectionReason?: string;
    }>();
    expectTypeOf<AnalysisScalar>().toEqualTypeOf<{
      readonly valueRef: string;
      readonly metricId: string;
      readonly value: MetricValue;
      readonly sourceRefs: readonly string[];
      readonly conflict: AnalysisConflict;
    }>();

    expect(scalar).toEqual({
      valueRef: 'revenue-fy2025',
      metricId: 'revenue',
      value,
      sourceRefs: ['source-1'],
      conflict,
    });
  });
});
