import { describe, expect, expectTypeOf, it } from 'vitest';

import type { RiskCalculationTrace } from '../../domain/analysis/calculation-trace';
import type { DecimalString } from '../../domain/analysis/decimal';
import { compareUnicodeCodePoints } from './compare-risk-strings';
import { riskAssessmentInput } from './risk-test-fixtures';
import type {
  AppliedTrafficLightThresholds,
  CategoryRiskAssessment,
  ClauseRecommendation,
  FatalFlawAssessment,
  FatalFlawCheckAssessment,
  FatalFlawStatus,
  FatalOutcome,
  LossProbabilityRange,
  RiskAssessment,
  RiskAssessmentInput,
  RiskCategory,
  RiskDataGap,
  RiskEngineResult,
  RiskItemAssessment,
  RiskLight,
  VerificationChecklistItem,
} from './risk-types';

describe('risk engine public contracts', () => {
  it('locks the versioned input and risk-specific trace', () => {
    expectTypeOf<RiskAssessmentInput['version']>().toEqualTypeOf<'1'>();
    expectTypeOf<RiskEngineResult<RiskAssessment>['trace']>()
      .toEqualTypeOf<RiskCalculationTrace>();
  });

  it('locks the fixed public enums', () => {
    expectTypeOf<RiskCategory>().toEqualTypeOf<
      | 'market'
      | 'technology'
      | 'customer'
      | 'financial'
      | 'financing'
      | 'legal_compliance'
      | 'governance'
      | 'data_authenticity'
      | 'exit'
    >();
    expectTypeOf<RiskLight>().toEqualTypeOf<'green' | 'yellow' | 'red'>();
    expectTypeOf<FatalFlawStatus>()
      .toEqualTypeOf<'unassessed' | 'clear' | 'open' | 'covered' | 'resolved'>();
    expectTypeOf<FatalOutcome>()
      .toEqualTypeOf<'none' | 'conditional_cap' | 'pause' | 'reject'>();
  });

  it('locks scored item and threshold outputs', () => {
    expectTypeOf<RiskItemAssessment>().toEqualTypeOf<{
      readonly riskId: string;
      readonly category: RiskCategory;
      readonly title: string;
      readonly probability: DecimalString;
      readonly impact: DecimalString;
      readonly mitigationEffectiveness: DecimalString;
      readonly mitigationDescription: string | null;
      readonly signals: readonly import('./risk-types').RiskSignal[];
      readonly evidenceRefs: readonly string[];
      readonly residualRisk: DecimalString;
      readonly light: RiskLight;
    }>();
    expectTypeOf<AppliedTrafficLightThresholds>().toEqualTypeOf<{
      readonly greenUpper: DecimalString;
      readonly redLower: DecimalString;
      readonly source: 'default' | 'custom';
      readonly changeReason: string | null;
    }>();
  });

  it('locks the exact nine-row and overall output fields', () => {
    expectTypeOf<CategoryRiskAssessment>().toEqualTypeOf<{
      readonly category: RiskCategory;
      readonly status: 'assessed' | 'unassessed';
      readonly riskItemCount: number;
      readonly residualRisk: DecimalString | null;
      readonly light: RiskLight | null;
      readonly topRiskId: string | null;
      readonly topRiskTitle: string | null;
      readonly clauseRecommendationCount: number;
      readonly evidenceRefCount: number;
      readonly dataGaps: readonly RiskDataGap[];
    }>();
    expectTypeOf<RiskAssessment['overall']>().toEqualTypeOf<{
      readonly assessedCategoryCount: number;
      readonly categoryCoverageRatio: DecimalString;
      readonly weightCoverageRatio: DecimalString;
      readonly residualRisk: DecimalString | null;
      readonly riskPenalty: DecimalString | null;
      readonly light: RiskLight | null;
    }>();
  });

  it('retains every fatal-flaw check and its aggregate outcome', () => {
    expectTypeOf<FatalFlawCheckAssessment>().toEqualTypeOf<{
      readonly fatalFlawId: import('./risk-types').FatalFlawId;
      readonly severity: 'pause' | 'reject';
      readonly status: FatalFlawStatus;
      readonly evidenceRefs: readonly string[];
      readonly coverageReason: string | null;
      readonly bindingConditions: readonly string[];
      readonly resolutionNote: string | null;
    }>();
    expectTypeOf<FatalFlawAssessment>().toEqualTypeOf<{
      readonly checks: readonly FatalFlawCheckAssessment[];
      readonly fatalOutcome: FatalOutcome;
      readonly notCurableByClause: boolean;
    }>();
  });

  it('keeps checklist and data-gap records minimal and source-linked', () => {
    expectTypeOf<VerificationChecklistItem>().toEqualTypeOf<{
      readonly checklistId: string;
      readonly description: string;
      readonly sourceRiskIds: readonly string[];
      readonly sourceFatalFlawIds: readonly import('./risk-types').FatalFlawId[];
    }>();
    expectTypeOf<RiskDataGap>().toEqualTypeOf<{
      readonly gapId: string;
      readonly description: string;
      readonly category: RiskCategory | null;
      readonly sourceRefs: readonly string[];
    }>();
  });

  it('locks loss ranges and clause recommendations to the approved outputs', () => {
    expectTypeOf<LossProbabilityRange>().toEqualTypeOf<{
      readonly lower: DecimalString;
      readonly upper: DecimalString;
      readonly selectedRuleId: string;
      readonly triggeredRuleIds: readonly string[];
      readonly missingInputs: readonly string[];
      readonly requiresInvestorConfirmation: true;
    }>();
    expectTypeOf<ClauseRecommendation>().toEqualTypeOf<{
      readonly clauseId: string;
      readonly clauseType: import('./risk-types').ClauseType;
      readonly sourceRiskIds: readonly string[];
      readonly sourceFatalFlawIds: readonly import('./risk-types').FatalFlawId[];
      readonly applicability: string;
      readonly protectionMechanism: string;
      readonly riskTreatment:
        | 'transfer'
        | 'constraint'
        | 'verification_condition'
        | 'partial_mitigation';
      readonly negotiationPriority: 'must_have' | 'high';
      readonly sideEffects: readonly string[];
      readonly legalReviewRequired: true;
      readonly disclaimer: string;
    }>();
  });

  it('provides fresh complete fixtures with deterministic nested overrides', () => {
    const input = riskAssessmentInput({
      trafficLightThresholds: { greenUpper: '0.25' },
      upstreamSnapshots: { valuation: { safetyMargin: '0.12' } },
    });
    const second = riskAssessmentInput();

    expect(input).toMatchObject({
      version: '1',
      asOfDate: '2026-03-31',
      trafficLightThresholds: {
        greenUpper: '0.25',
        redLower: '0.67',
        changeReason: 'Investment committee approved project thresholds.',
      },
      upstreamSnapshots: {
        valuation: {
          snapshotId: 'valuation-base',
          sourceRef: 'valuation-triangulation@1',
          safetyMargin: '0.12',
        },
      },
    });
    expect(input.fatalFlaws).toHaveLength(6);
    expect(input).not.toBe(second);
    expect(input.riskItems).not.toBe(second.riskItems);
    expect(input.riskItems[0]).not.toBe(second.riskItems[0]);
    expect(input.fatalFlaws).not.toBe(second.fatalFlaws);
    expect(input.upstreamSnapshots).not.toBe(second.upstreamSnapshots);
    expect(input.upstreamSnapshots?.valuation)
      .not.toBe(second.upstreamSnapshots?.valuation);

    const nullPrototypeOverrides = Object.assign(Object.create(null), {
      asOfDate: '2026-06-30',
    }) as Partial<RiskAssessmentInput>;
    const nullPrototypeInput = riskAssessmentInput(nullPrototypeOverrides);
    expect(nullPrototypeInput.asOfDate).toBe('2026-06-30');
    expect(Object.getPrototypeOf(nullPrototypeInput)).toBe(Object.prototype);
    expect(() => JSON.stringify(nullPrototypeInput)).not.toThrow();
    expect(JSON.stringify(nullPrototypeInput)).not.toContain('undefined');
  });

  it('sorts strings by Unicode code points without locale dependence', () => {
    expect(['blind-risk', 'blind-risk-a', 'blind-risk'].sort(compareUnicodeCodePoints))
      .toEqual(['blind-risk', 'blind-risk', 'blind-risk-a']);
    expect(['\u76F2-risk', 'z-risk'].sort(compareUnicodeCodePoints))
      .toEqual(['z-risk', '\u76F2-risk']);
    expect(['\uE000-risk', '\u{10000}-risk'].sort(compareUnicodeCodePoints))
      .toEqual(['\uE000-risk', '\u{10000}-risk']);
  });
});
