import { describe, expect, it } from 'vitest';

import { riskAssessmentInput } from './risk-test-fixtures';
import { validateRiskInput } from './validate-risk-input';

describe('validateRiskInput', () => {
  it('validates a complete minimal input', () => {
    const input = riskAssessmentInput();
    const result = validateRiskInput(input);
    expect(result.status).toBe('valid');
  });

  it('accepts empty risk items list', () => {
    const input = riskAssessmentInput({ riskItems: [] });
    const result = validateRiskInput(input);
    expect(result.status).toBe('valid');
  });

  it('rejects duplicate riskIds', () => {
    const item = riskAssessmentInput().riskItems[0]!;
    const input = { ...riskAssessmentInput({ riskItems: [] }), riskItems: [item, { ...item, category: 'technology' as const }] };
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
  });

  it('rejects invalid probability, impact, or mitigation', () => {
    const input = riskAssessmentInput({
      riskItems: [
        {
          riskId: 'bad-prob',
          category: 'market',
          title: 'Bad probability',
          probability: '1.5',
          impact: '0.5',
          mitigationEffectiveness: '0',
        },
      ],
    });
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
  });

  it('requires mitigation description when effectiveness is positive', () => {
    const input = riskAssessmentInput({
      riskItems: [
        {
          riskId: 'no-desc',
          category: 'market',
          title: 'Missing description',
          probability: '0.5',
          impact: '0.5',
          mitigationEffectiveness: '0.3',
        },
      ],
    });
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
  });

  it('rejects signals outside their category', () => {
    const input = riskAssessmentInput({
      riskItems: [
        {
          riskId: 'wrong-signal',
          category: 'market',
          title: 'Wrong signal',
          probability: '0.5',
          impact: '0.5',
          mitigationEffectiveness: '0',
          signals: ['key_person'],
        },
      ],
    });
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
  });

  it('validates six fatal flaws present exactly once', () => {
    const input = { ...riskAssessmentInput(), fatalFlaws: [] };
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.issues.some((i: { code: string }) => i.code === 'invalid_fatal_flaw')).toBe(true);
    }
  });

  it('rejects duplicate fatal flaw IDs', () => {
    const base = riskAssessmentInput();
    const input = {
      ...base,
      fatalFlaws: [
        base.fatalFlaws[0]!,
        { ...base.fatalFlaws[0]!, fatalFlawId: 'material_data_or_business_fraud' as const },
        ...base.fatalFlaws.slice(2),
      ],
    };
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
  });

  it('requires coverageReason and bindingConditions when covered', () => {
    const base = riskAssessmentInput();
    const input = {
      ...base,
      fatalFlaws: base.fatalFlaws.map((flaw) =>
        flaw.fatalFlawId === 'material_data_or_business_fraud'
          ? {
              fatalFlawId: 'material_data_or_business_fraud' as const,
              status: 'covered' as const,
              evidenceRefs: [],
              coverageReason: '',
              bindingConditions: [],
            }
          : flaw,
      ),
    };
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
  });

  it('requires resolutionNote when resolved', () => {
    const base = riskAssessmentInput();
    const input = {
      ...base,
      fatalFlaws: base.fatalFlaws.map((flaw) =>
        flaw.fatalFlawId === 'material_data_or_business_fraud'
          ? {
              fatalFlawId: 'material_data_or_business_fraud' as const,
              status: 'resolved' as const,
              evidenceRefs: [],
              resolutionNote: '',
            }
          : flaw,
      ),
    };
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
  });

  it('validates custom weights must sum to exactly 1', () => {
    const input = riskAssessmentInput({
      categoryWeights: {
        market: '0.3',
        technology: '0.3',
        customer: '0.1',
        financial: '0.1',
        financing: '0.1',
        legal_compliance: '0',
        governance: '0',
        data_authenticity: '0',
        exit: '0',
      },
    });
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
  });

  it('validates custom thresholds require changeReason', () => {
    const input = riskAssessmentInput({
      trafficLightThresholds: {
        greenUpper: '0.4',
        redLower: '0.7',
        changeReason: '',
      },
    });
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
  });

  it('requires greenUpper < redLower', () => {
    const input = riskAssessmentInput({
      trafficLightThresholds: {
        greenUpper: '0.5',
        redLower: '0.3',
        changeReason: 'Test',
      },
    });
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
  });

  it('validates upstream snapshot source references', () => {
    const input = riskAssessmentInput({
      upstreamSnapshots: {
        valuation: { snapshotId: 'v1', sourceRef: 'scenario-forecast@1' as any, safetyMargin: '0.2' },
      },
    });
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
  });

  it('rejects non-ISO8601 asOfDate', () => {
    const input = riskAssessmentInput({ asOfDate: 'yesterday' });
    const result = validateRiskInput(input);
    expect(result.status).toBe('blocked');
  });

  it('accepts valid covered fatal flaw', () => {
    const base = riskAssessmentInput();
    const input = {
      ...base,
      fatalFlaws: base.fatalFlaws.map((flaw) =>
        flaw.fatalFlawId === 'core_ownership_or_license_unclear'
          ? {
              fatalFlawId: 'core_ownership_or_license_unclear' as const,
              status: 'covered' as const,
              evidenceRefs: ['legal-opinion'],
              coverageReason: 'Founders signed IP assignment agreement.',
              bindingConditions: ['IP assignment must be filed before closing.'],
            }
          : flaw,
      ),
    };
    const result = validateRiskInput(input);
    expect(result.status).toBe('valid');
  });
});
