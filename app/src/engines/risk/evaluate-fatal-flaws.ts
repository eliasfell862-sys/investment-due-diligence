import type {
  FatalFlawCheckAssessment,
  FatalFlawCheckInput,
  FatalFlawId,
} from './risk-types';

const FATAL_FLAW_ORDER: readonly FatalFlawId[] = [
  'material_data_or_business_fraud',
  'core_ownership_or_license_unclear',
  'irremediable_major_illegality',
  'business_model_unverifiable',
  'pre_close_cash_break',
  'founder_integrity_failure',
];

const SEVERITY: Readonly<Record<FatalFlawId, 'pause' | 'reject'>> = {
  material_data_or_business_fraud: 'reject',
  core_ownership_or_license_unclear: 'pause',
  irremediable_major_illegality: 'reject',
  business_model_unverifiable: 'pause',
  pre_close_cash_break: 'pause',
  founder_integrity_failure: 'reject',
};

export interface FatalFlawCalculation {
  readonly checks: readonly FatalFlawCheckAssessment[];
  readonly fatalOutcome: 'none' | 'conditional_cap' | 'pause' | 'reject';
  readonly notCurableByClause: boolean;
}

export function evaluateFatalFlaws(
  checks: readonly FatalFlawCheckInput[],
): FatalFlawCalculation {
  const ordered: FatalFlawCheckInput[] = FATAL_FLAW_ORDER.map((id) => {
    const found = checks.find((c) => c.fatalFlawId === id);
    return found!;
  });

  const assessments: FatalFlawCheckAssessment[] = ordered.map((check) => ({
    fatalFlawId: check.fatalFlawId,
    severity: SEVERITY[check.fatalFlawId],
    status: check.status,
    evidenceRefs: check.evidenceRefs ?? [],
    coverageReason: check.coverageReason ?? null,
    bindingConditions: check.bindingConditions ?? [],
    resolutionNote: check.resolutionNote ?? null,
  }));

  const openRejects = assessments.filter(
    (c) => c.status === 'open' && SEVERITY[c.fatalFlawId] === 'reject',
  );
  const openPauses = assessments.filter(
    (c) => c.status === 'open' && SEVERITY[c.fatalFlawId] === 'pause',
  );
  const unassessed = assessments.filter((c) => c.status === 'unassessed');
  const covered = assessments.filter((c) => c.status === 'covered');

  let fatalOutcome: 'none' | 'conditional_cap' | 'pause' | 'reject' = 'none';
  let notCurableByClause = false;

  if (openRejects.length > 0) {
    fatalOutcome = 'reject';
    notCurableByClause = true;
  } else if (openPauses.length > 0) {
    fatalOutcome = 'pause';
  } else if (unassessed.length > 0) {
    fatalOutcome = 'pause';
  } else if (covered.length > 0) {
    fatalOutcome = 'conditional_cap';
  }

  return { checks: assessments, fatalOutcome, notCurableByClause };
}
