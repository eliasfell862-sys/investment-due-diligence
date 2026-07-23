export type CandidateReviewStatus =
  | 'pending'
  | 'confirmed'
  | 'corrected'
  | 'rejected'
  | 'conflicted';

export interface EvidenceCandidate {
  readonly id: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly fieldId: string;
  readonly normalizedValue: string;
  readonly displayValue?: string;
  readonly periodIdentity: string;
  readonly dimensionIdentity: string;
  readonly sourceFragmentIds: readonly string[];
  readonly recognitionMethod: 'rule' | 'ocr_rule' | 'ai_assisted';
  readonly sourceTypeHint: 'document_fact' | 'management_forecast';
  readonly confidence: number;
  readonly reviewStatus: CandidateReviewStatus;
  readonly correctedValue?: string;
  readonly reviewReason?: string;
  readonly reviewedAt?: string;
  readonly candidateFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
