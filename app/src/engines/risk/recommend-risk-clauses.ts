import { compareUnicodeCodePoints } from './compare-risk-strings';
import {
  getClauseEntry,
  getClausesForCategory,
  getRefinedClausesForSignal,
} from './risk-clause-catalog';
import type {
  ClauseRecommendation,
  ClauseType,
  FatalFlawCheckAssessment,
  FatalFlawId,
  RiskItemAssessment,
  VerificationChecklistItem,
} from './risk-types';

export interface ClauseRecommendationInput {
  readonly riskItems: readonly RiskItemAssessment[];
  readonly fatalFlaws: readonly FatalFlawCheckAssessment[];
}

export interface ClauseRecommendationOutput {
  readonly recommendations: readonly ClauseRecommendation[];
  readonly verificationChecklist: readonly VerificationChecklistItem[];
}

interface ClauseCandidate {
  readonly clauseType: ClauseType;
  readonly negotiationPriority: 'must_have' | 'high';
  readonly riskIds: Set<string>;
  readonly fatalFlawIds: Set<FatalFlawId>;
}

const DISCLAIMER = 'Clauses can transfer, constrain, verify, or partially mitigate risk — they cannot eliminate underlying business risk. This is not legal advice.';

export function recommendRiskClauses(
  input: ClauseRecommendationInput,
): ClauseRecommendationOutput {
  const candidates = new Map<ClauseType, ClauseCandidate>();
  const checklist: { description: string; riskIds: Set<string>; fatalFlawIds: Set<FatalFlawId> }[] = [];

  // Generate clauses from risk items
  for (const item of input.riskItems) {
    if (item.light !== 'red' && item.light !== 'yellow') continue;

    const priority = item.light === 'red' ? 'must_have' as const : 'high' as const;

    // Use signal-refined clauses if available, otherwise default category clauses
    let clauseTypes: readonly ClauseType[];
    if (item.signals.length > 0) {
      const refined = new Set<ClauseType>();
      for (const signal of item.signals) {
        for (const ct of getRefinedClausesForSignal(signal)) {
          refined.add(ct);
        }
      }
      clauseTypes = [...refined];
    } else {
      clauseTypes = getClausesForCategory(item.category);
    }

    for (const clauseType of clauseTypes) {
      const existing = candidates.get(clauseType);
      if (existing !== undefined) {
        existing.riskIds.add(item.riskId);
        // Escalate priority if any source is red
        if (priority === 'must_have' && existing.negotiationPriority === 'high') {
          candidates.set(clauseType, { ...existing, negotiationPriority: 'must_have' as const });
        }
      } else {
        candidates.set(clauseType, {
          clauseType,
          negotiationPriority: priority,
          riskIds: new Set([item.riskId]),
          fatalFlawIds: new Set(),
        });
      }
    }
  }

  // Generate from fatal flaws
  for (const flaw of input.fatalFlaws) {
    if (flaw.status === 'open') {
      // open + pause → condition precedent
      checklist.push({
        description: `Resolve fatal flaw: ${flaw.fatalFlawId}`,
        riskIds: new Set(),
        fatalFlawIds: new Set([flaw.fatalFlawId]),
      });

      const ct: ClauseType = 'fatal_flaw_condition_precedent';
      const existing = candidates.get(ct);
      if (existing !== undefined) {
        existing.fatalFlawIds.add(flaw.fatalFlawId);
      } else {
        candidates.set(ct, {
          clauseType: ct,
          negotiationPriority: 'must_have',
          riskIds: new Set(),
          fatalFlawIds: new Set([flaw.fatalFlawId]),
        });
      }
    }

    if (flaw.status === 'covered' && flaw.bindingConditions.length > 0) {
      const ct: ClauseType = 'covered_flaw_binding_condition';
      const existing = candidates.get(ct);
      if (existing !== undefined) {
        existing.fatalFlawIds.add(flaw.fatalFlawId);
      } else {
        candidates.set(ct, {
          clauseType: ct,
          negotiationPriority: 'must_have',
          riskIds: new Set(),
          fatalFlawIds: new Set([flaw.fatalFlawId]),
        });
      }
    }
  }

  // Build recommendations
  const recommendations: ClauseRecommendation[] = [];
  for (const [clauseType, candidate] of candidates) {
    const entry = getClauseEntry(clauseType);
    const sourceRiskIds = [...candidate.riskIds].sort(compareUnicodeCodePoints);
    const sourceFatalFlawIds = [...candidate.fatalFlawIds].sort(compareUnicodeCodePoints);

    recommendations.push({
      clauseId: `clause-${clauseType}-${sourceRiskIds.join('-')}`.slice(0, 256),
      clauseType,
      sourceRiskIds,
      sourceFatalFlawIds,
      applicability: entry.applicability,
      protectionMechanism: entry.protectionMechanism,
      riskTreatment: entry.riskTreatment,
      negotiationPriority: candidate.negotiationPriority,
      sideEffects: entry.sideEffects,
      legalReviewRequired: true,
      disclaimer: DISCLAIMER,
    });
  }

  // Sort by priority (must_have first), then clauseType Unicode
  recommendations.sort((left, right) => {
    if (left.negotiationPriority !== right.negotiationPriority) {
      return left.negotiationPriority === 'must_have' ? -1 : 1;
    }
    return compareUnicodeCodePoints(left.clauseType, right.clauseType);
  });

  // Build verification checklist
  const verificationChecklist: VerificationChecklistItem[] = checklist.map((item) => ({
    checklistId: `verify-${[...item.fatalFlawIds, ...item.riskIds].join('-')}`.slice(0, 256),
    description: item.description,
    sourceRiskIds: [...item.riskIds].sort(compareUnicodeCodePoints),
    sourceFatalFlawIds: [...item.fatalFlawIds].sort(compareUnicodeCodePoints),
  }));

  return { recommendations, verificationChecklist };
}
