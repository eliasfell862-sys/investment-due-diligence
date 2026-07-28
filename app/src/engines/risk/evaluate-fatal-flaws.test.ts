import { describe, expect, it } from 'vitest';
import { evaluateFatalFlaws } from './evaluate-fatal-flaws';
import { fatalFlawCheckInput } from './risk-test-fixtures';
import type { FatalFlawId } from './risk-types';

describe('evaluateFatalFlaws', () => {
  const allClear = (): ReturnType<typeof fatalFlawCheckInput>[] => {
    const ids: FatalFlawId[] = [
      'material_data_or_business_fraud',
      'core_ownership_or_license_unclear',
      'irremediable_major_illegality',
      'business_model_unverifiable',
      'pre_close_cash_break',
      'founder_integrity_failure',
    ];
    return ids.map((id) => fatalFlawCheckInput(id));
  };

  it('returns none when all flaws are clear', () => {
    const result = evaluateFatalFlaws(allClear());
    expect(result.fatalOutcome).toBe('none');
    expect(result.notCurableByClause).toBe(false);
    expect(result.checks).toHaveLength(6);
  });

  it('returns reject for open material fraud', () => {
    const checks = allClear().map((c) =>
      c.fatalFlawId === 'material_data_or_business_fraud'
        ? { ...c, status: 'open' as const }
        : c,
    );
    const result = evaluateFatalFlaws(checks);
    expect(result.fatalOutcome).toBe('reject');
    expect(result.notCurableByClause).toBe(true);
  });

  it('returns pause for open ownership issue', () => {
    const checks = allClear().map((c) =>
      c.fatalFlawId === 'core_ownership_or_license_unclear'
        ? { ...c, status: 'open' as const }
        : c,
    );
    const result = evaluateFatalFlaws(checks);
    expect(result.fatalOutcome).toBe('pause');
    expect(result.notCurableByClause).toBe(false);
  });

  it('open reject outranks open pause', () => {
    const checks = allClear().map((c) => {
      if (c.fatalFlawId === 'material_data_or_business_fraud') return { ...c, status: 'open' as const };
      if (c.fatalFlawId === 'core_ownership_or_license_unclear') return { ...c, status: 'open' as const };
      return c;
    });
    const result = evaluateFatalFlaws(checks);
    expect(result.fatalOutcome).toBe('reject');
  });

  it('returns conditional_cap when one flaw is covered and none open', () => {
    const checks = allClear().map((c) =>
      c.fatalFlawId === 'business_model_unverifiable'
        ? {
            ...c,
            status: 'covered' as const,
            coverageReason: 'Verified with signed LOIs.',
            bindingConditions: ['Must convert 3 LOIs to contracts before closing.'],
          }
        : c,
    );
    const result = evaluateFatalFlaws(checks);
    expect(result.fatalOutcome).toBe('conditional_cap');
    expect(result.notCurableByClause).toBe(false);
  });

  it('retains resolved flaws without affecting outcome', () => {
    const checks = allClear().map((c) =>
      c.fatalFlawId === 'founder_integrity_failure'
        ? {
            ...c,
            status: 'resolved' as const,
            resolutionNote: 'Background check completed; no issues found.',
          }
        : c,
    );
    const result = evaluateFatalFlaws(checks);
    expect(result.fatalOutcome).toBe('none');
    expect(result.checks.find((c) => c.fatalFlawId === 'founder_integrity_failure')!.status).toBe('resolved');
  });

  it('has fixed severity per flaw', () => {
    const checks = allClear();
    const result = evaluateFatalFlaws(checks);
    const severities: Record<string, 'pause' | 'reject'> = {
      material_data_or_business_fraud: 'reject',
      core_ownership_or_license_unclear: 'pause',
      irremediable_major_illegality: 'reject',
      business_model_unverifiable: 'pause',
      pre_close_cash_break: 'pause',
      founder_integrity_failure: 'reject',
    };
    for (const check of result.checks) {
      expect(check.severity).toBe(severities[check.fatalFlawId]);
    }
  });

  it('outputs stable order matching the fixed six', () => {
    const result = evaluateFatalFlaws(allClear());
    const order = result.checks.map((c) => c.fatalFlawId);
    expect(order).toEqual([
      'material_data_or_business_fraud',
      'core_ownership_or_license_unclear',
      'irremediable_major_illegality',
      'business_model_unverifiable',
      'pre_close_cash_break',
      'founder_integrity_failure',
    ]);
  });
});
