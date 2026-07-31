export type KnowledgeKind = 'fact' | 'calculation' | 'inference' | 'judgment' | 'unknown';
export type ConfidenceBand = 'high' | 'medium' | 'low' | 'blocked';

export interface ConfirmedFact {
  readonly factId: string;
  readonly metricId: string;
  readonly value: string | boolean;
  readonly unit: string | null;
  readonly period: string | null;
  readonly evidenceIds: readonly string[];
  readonly confirmedBy: string;
  readonly confirmedAt: string;
}

export interface CandidateFact {
  readonly candidateId: string;
  readonly metricId: string;
  readonly proposedValue: string | boolean;
  readonly unit: string | null;
  readonly period: string | null;
  readonly sourceEvidenceIds: readonly string[];
  readonly modelRef: string | null;
  readonly confidence: ConfidenceBand;
}

export interface InferenceSessionInput {
  readonly version: '1';
  readonly projectId: string;
  readonly institutionPolicyVersion: string;
  readonly asOfDate: string;
  readonly confirmedFacts: readonly ConfirmedFact[];
  readonly candidateFacts: readonly CandidateFact[];
  readonly requestedStrategy: 'growth_equity';
}

export interface CompanyArchetypeResult {
  readonly primaryPackId: string;
  readonly supplementalPackIds: readonly string[];
  readonly matchScore: string; // Decimal string 0-1
  readonly classificationReasons: readonly string[];
  readonly confirmationQuestions: readonly string[];
  readonly fallbackUsed: boolean;
}

export interface InferenceNode {
  readonly nodeId: string;
  readonly kind: KnowledgeKind;
  readonly metricId: string;
  readonly value: string | boolean | null;
  readonly lowerBound: string | null;
  readonly upperBound: string | null;
  readonly unit: string | null;
  readonly period: string | null;
  readonly confidence: ConfidenceBand;
  readonly sourceEvidenceIds: readonly string[];
  readonly dependencyNodeIds: readonly string[];
  readonly ruleIds: readonly string[];
  readonly assumptionIds: readonly string[];
  readonly conflictIds: readonly string[];
  readonly reversibleByQuestionIds: readonly string[];
}

export interface NextBestQuestion {
  readonly questionId: string;
  readonly prompt: string;
  readonly reason: string;
  readonly expectedAnswerType: string;
  readonly unit: string | null;
  readonly requestedEvidenceTypes: readonly string[];
  readonly affectedNodeIds: readonly string[];
  readonly affectedOutputs: readonly ('risk' | 'forecast' | 'valuation' | 'financing' | 'exit' | 'decision')[];
  readonly informationValue: string; // Decimal 0-1
  readonly blocking: boolean;
}

export interface IndustryPackManifest {
  readonly packId: string;
  readonly version: string;
  readonly strategy: 'growth_equity';
  readonly supportedArchetypes: readonly string[];
  readonly requiredMetricIds: readonly string[];
  readonly optionalMetricIds: readonly string[];
  readonly ruleIds: readonly string[];
  readonly fatalFlawIds: readonly string[];
  readonly questionIds: readonly string[];
  readonly forecastProfileId: string;
  readonly valuationProfileIds: readonly string[];
  readonly exitProfileIds: readonly string[];
  readonly clauseProfileIds: readonly string[];
  readonly monitoringMetricIds: readonly string[];
  readonly goldenCaseIds: readonly string[];
}

export interface InvestmentJudgmentOutput {
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly archetype: CompanyArchetypeResult;
  readonly investmentThesis: readonly InferenceNode[];
  readonly strongestCounterThesis: readonly InferenceNode[];
  readonly operatingAssessment: readonly InferenceNode[];
  readonly financialAssessment: readonly InferenceNode[];
  readonly competitiveAssessment: readonly InferenceNode[];
  readonly moatAssessment: readonly InferenceNode[];
  readonly teamAssessment: readonly InferenceNode[];
  readonly riskSnapshotRef: string | null;
  readonly forecastSnapshotRef: string | null;
  readonly valuationSnapshotRef: string | null;
  readonly equitySnapshotRef: string | null;
  readonly exitAssessment: readonly InferenceNode[];
  readonly transactionRecommendations: readonly InferenceNode[];
  readonly monitoringRecommendations: readonly InferenceNode[];
  readonly nextQuestions: readonly NextBestQuestion[];
  readonly overallConfidence: ConfidenceBand;
  readonly stability: 'stable' | 'sensitive' | 'unstable';
  readonly formalSubmissionBlocked: boolean;
  readonly blockingReasons: readonly string[];
  readonly traceId: string;
}
