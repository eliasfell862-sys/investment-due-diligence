import type { EvidenceSourceType } from '../evidence/evidence';
import {
  calculateReadiness,
  type EvidenceSummary,
} from './calculate-readiness';

export interface ReportGate {
  readonly canExport: boolean;
  readonly missingFieldIds: readonly string[];
  readonly blockingReasons: readonly string[];
}

export interface ReportReadiness {
  readonly quickLook: ReportGate;
  readonly formal: ReportGate;
  readonly pendingCandidateCount: number;
  readonly unresolvedConflictCount: number;
  readonly decisionState: 'ready' | 'insufficient-data' | 'conflicted';
}

export interface ReportReadinessEvidence extends EvidenceSummary {
  readonly sourceType?: EvidenceSourceType;
}

export interface CalculateReportReadinessInput {
  readonly projectId: string;
  readonly documentCount: number;
  readonly pendingCandidateCount: number;
  readonly evidence: readonly ReportReadinessEvidence[];
  readonly formalRequiredFieldIds: readonly string[];
}

const quickLookSummaryFieldIds = [
  'team_summary',
  'product_summary',
  'market_summary',
] as const;

export function calculateReportReadiness({
  projectId,
  documentCount,
  pendingCandidateCount,
  evidence,
  formalRequiredFieldIds,
}: CalculateReportReadinessInput): ReportReadiness {
  const validated = calculateReadiness(projectId, [], evidence);
  const quickLookCore = calculateReadiness(
    projectId,
    ['company_name', 'business_description'],
    evidence,
  );
  const quickLookSummaries = calculateReadiness(
    projectId,
    quickLookSummaryFieldIds,
    evidence,
  );
  const hasSummary = quickLookSummaries.presentFieldIds.length > 0;
  const quickLookMissingFieldIds = [
    ...quickLookCore.missingFieldIds,
    ...(hasSummary ? [] : quickLookSummaryFieldIds),
  ];
  const quickLookBlockingReasons = [
    ...(documentCount > 0 ? [] : ['missing-source-document']),
    ...(quickLookCore.missingFieldIds.length > 0 ? ['missing-core-fields'] : []),
    ...(hasSummary ? [] : ['missing-summary']),
  ];
  const quickLook = {
    canExport: quickLookBlockingReasons.length === 0,
    missingFieldIds: quickLookMissingFieldIds,
    blockingReasons: quickLookBlockingReasons,
  };

  const historicalEvidence = evidence.filter(
    ({ sourceType }) => sourceType !== 'investor_assumption',
  );
  const formalReadiness = calculateReadiness(
    projectId,
    formalRequiredFieldIds,
    historicalEvidence,
  );
  const formalBlockingReasons = [
    ...(formalReadiness.missingFieldIds.length > 0 ? ['missing-required-fields'] : []),
    ...(validated.unresolvedConflictCount > 0 ? ['unresolved-conflicts'] : []),
  ];
  const formal = {
    canExport: formalBlockingReasons.length === 0,
    missingFieldIds: formalReadiness.missingFieldIds,
    blockingReasons: formalBlockingReasons,
  };

  return {
    quickLook,
    formal,
    pendingCandidateCount,
    unresolvedConflictCount: validated.unresolvedConflictCount,
    decisionState: formal.canExport
      ? 'ready'
      : validated.unresolvedConflictCount > 0
        ? 'conflicted'
        : 'insufficient-data',
  };
}
