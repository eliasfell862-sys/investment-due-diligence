import type { SourceFragment } from '../../domain/documents/source-fragment';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import { parseEvidenceCandidate } from '../../domain/evidence/evidence-candidate.schema';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
import { validateNormalizedTargetValue } from '../../domain/evidence/validate-normalized-target-value';
import {
  candidateEvidenceId,
  CandidateReviewDerivationError,
  deriveCandidateReview,
  requireReviewIdentifier,
} from './candidate-review-derivation';
import type { DocumentEvidenceRepository } from './document-evidence-repository';
import {
  EvidenceRepositoryError,
  type EvidenceRepository,
} from './evidence-repository';

export type CandidateReviewServiceErrorCode =
  | 'invalid-project'
  | 'invalid-candidate'
  | 'invalid-value'
  | 'invalid-reason'
  | 'candidate-not-found'
  | 'invalid-transition'
  | 'missing-source'
  | 'invalid-source'
  | 'read-failure'
  | 'write-failure';

export class CandidateReviewServiceError extends Error {
  readonly code: CandidateReviewServiceErrorCode;
  override readonly cause: unknown;

  constructor(
    code: CandidateReviewServiceErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'CandidateReviewServiceError';
    this.code = code;
    this.cause = cause;
  }
}

interface CorrectionInput {
  readonly normalizedValue: string;
  readonly reason: string;
}

function requireIdentifier(
  value: string,
  code: 'invalid-project' | 'invalid-candidate' | 'invalid-source',
): string {
  try {
    return requireReviewIdentifier(value, code);
  } catch (error) {
    if (error instanceof CandidateReviewDerivationError) {
      throw new CandidateReviewServiceError(code, error.message, error);
    }
    throw error;
  }
}

function requireReason(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new CandidateReviewServiceError('invalid-reason', 'A review reason is required.');
  }
  return normalized;
}

function isMachineState(candidate: EvidenceCandidate): boolean {
  return candidate.reviewStatus === 'pending' || candidate.reviewStatus === 'conflicted';
}

function reviewedCandidate(
  candidate: EvidenceCandidate,
  reviewStatus: 'confirmed' | 'corrected' | 'rejected',
  reviewedAt: string,
  options: { readonly correctedValue?: string; readonly reason?: string } = {},
): EvidenceCandidate {
  return parseEvidenceCandidate({
    id: candidate.id,
    projectId: candidate.projectId,
    documentId: candidate.documentId,
    fieldId: candidate.fieldId,
    normalizedValue: candidate.normalizedValue,
    ...(candidate.displayValue === undefined
      ? {}
      : { displayValue: candidate.displayValue }),
    periodIdentity: candidate.periodIdentity,
    dimensionIdentity: candidate.dimensionIdentity,
    sourceFragmentIds: candidate.sourceFragmentIds,
    recognitionMethod: candidate.recognitionMethod,
    sourceTypeHint: candidate.sourceTypeHint,
    confidence: candidate.confidence,
    reviewStatus,
    ...(options.correctedValue === undefined
      ? {}
      : { correctedValue: options.correctedValue }),
    ...(options.reason === undefined ? {} : { reviewReason: options.reason }),
    reviewedAt,
    candidateFingerprint: candidate.candidateFingerprint,
    createdAt: candidate.createdAt,
    updatedAt: reviewedAt,
  });
}

export class CandidateReviewService {
  private readonly documentRepository: DocumentEvidenceRepository;
  private readonly evidenceRepository: EvidenceRepository;
  private readonly now: () => Date;

  constructor(
    documentRepository: DocumentEvidenceRepository,
    evidenceRepository: EvidenceRepository,
    now: () => Date = () => new Date(),
  ) {
    this.documentRepository = documentRepository;
    this.evidenceRepository = evidenceRepository;
    this.now = now;
  }

  async confirm(projectId: string, candidateId: string): Promise<void> {
    const project = requireIdentifier(projectId, 'invalid-project');
    const candidateIdentity = requireIdentifier(candidateId, 'invalid-candidate');
    const candidate = await this.loadCandidate(project, candidateIdentity);
    requireIdentifier(candidate.documentId, 'invalid-source');

    if (candidate.reviewStatus === 'corrected' || candidate.reviewStatus === 'rejected') {
      this.invalidTransition('The candidate already has a different terminal decision.');
    }
    if (candidate.reviewStatus !== 'confirmed' && !isMachineState(candidate)) {
      this.invalidTransition('The candidate cannot be confirmed from its current state.');
    }

    const existing = await this.loadExistingDecision(
      candidate,
      candidate.normalizedValue,
      undefined,
    );
    const reviewedAt = candidate.reviewStatus === 'confirmed'
      ? candidate.reviewedAt!
      : existing?.reviewAudit?.reviewedAt ?? this.now().toISOString();
    const nextCandidate = candidate.reviewStatus === 'confirmed'
      ? candidate
      : reviewedCandidate(candidate, 'confirmed', reviewedAt);
    const sourceFragments = await this.loadSourceSnapshot(candidate);
    const evidence = this.deriveEvidence(
      candidate,
      nextCandidate,
      sourceFragments,
      existing?.conflictStatus ?? 'none',
    );

    await this.commit(candidate, nextCandidate, sourceFragments, evidence);
  }

  async correct(
    projectId: string,
    candidateId: string,
    input: CorrectionInput,
  ): Promise<void> {
    const project = requireIdentifier(projectId, 'invalid-project');
    const candidateIdentity = requireIdentifier(candidateId, 'invalid-candidate');
    const reason = requireReason(input?.reason);
    const candidate = await this.loadCandidate(project, candidateIdentity);
    requireIdentifier(candidate.documentId, 'invalid-source');
    const canonicalValue = this.canonicalCorrection(candidate, input?.normalizedValue);

    if (candidate.reviewStatus === 'confirmed' || candidate.reviewStatus === 'rejected') {
      this.invalidTransition('The candidate already has a different terminal decision.');
    }
    if (candidate.reviewStatus === 'corrected') {
      if (
        candidate.correctedValue !== canonicalValue ||
        candidate.reviewReason !== reason
      ) {
        this.invalidTransition('A corrected candidate cannot be changed.');
      }
    } else if (!isMachineState(candidate)) {
      this.invalidTransition('The candidate cannot be corrected from its current state.');
    }

    const existing = await this.loadExistingDecision(candidate, canonicalValue, reason);
    const reviewedAt = candidate.reviewStatus === 'corrected'
      ? candidate.reviewedAt!
      : existing?.reviewAudit?.reviewedAt ?? this.now().toISOString();
    const nextCandidate = candidate.reviewStatus === 'corrected'
      ? candidate
      : reviewedCandidate(candidate, 'corrected', reviewedAt, {
          correctedValue: canonicalValue,
          reason,
        });
    const sourceFragments = await this.loadSourceSnapshot(candidate);
    const evidence = this.deriveEvidence(
      candidate,
      nextCandidate,
      sourceFragments,
      existing?.conflictStatus ?? 'none',
    );

    await this.commit(candidate, nextCandidate, sourceFragments, evidence);
  }

  async reject(projectId: string, candidateId: string, reasonValue: string): Promise<void> {
    const project = requireIdentifier(projectId, 'invalid-project');
    const candidateIdentity = requireIdentifier(candidateId, 'invalid-candidate');
    const reason = requireReason(reasonValue);
    const candidate = await this.loadCandidate(project, candidateIdentity);
    requireIdentifier(candidate.documentId, 'invalid-source');

    if (candidate.reviewStatus === 'rejected') {
      if (candidate.reviewReason !== reason) {
        this.invalidTransition('A rejected candidate cannot be changed.');
      }
    } else if (
      candidate.reviewStatus === 'confirmed' ||
      candidate.reviewStatus === 'corrected'
    ) {
      this.invalidTransition('The candidate already has a different terminal decision.');
    } else if (!isMachineState(candidate)) {
      this.invalidTransition('The candidate cannot be rejected from its current state.');
    }

    const nextCandidate = candidate.reviewStatus === 'rejected'
      ? candidate
      : reviewedCandidate(candidate, 'rejected', this.now().toISOString(), { reason });
    const sourceFragments = await this.loadSourceSnapshot(candidate);
    this.deriveEvidence(candidate, nextCandidate, sourceFragments, 'none');
    await this.commit(candidate, nextCandidate, sourceFragments);
  }

  private async loadCandidate(
    projectId: string,
    candidateId: string,
  ): Promise<EvidenceCandidate> {
    let candidate: EvidenceCandidate | undefined;
    try {
      candidate = await this.documentRepository.getCandidate(projectId, candidateId);
    } catch (error) {
      throw new CandidateReviewServiceError(
        'read-failure',
        'The candidate could not be loaded.',
        error,
      );
    }
    if (!candidate) {
      throw new CandidateReviewServiceError(
        'candidate-not-found',
        'The requested candidate does not exist in this project.',
      );
    }
    return candidate;
  }

  private canonicalCorrection(candidate: EvidenceCandidate, value: string): string {
    if (typeof value !== 'string') {
      throw new CandidateReviewServiceError(
        'invalid-value',
        'A corrected normalized value is required.',
      );
    }
    const definition = findTargetFieldDefinition(candidate.fieldId);
    if (!definition) {
      throw new CandidateReviewServiceError(
        'invalid-value',
        'The candidate references an unknown target field.',
      );
    }
    const validation = validateNormalizedTargetValue(definition, value);
    if (validation.status !== 'valid') {
      throw new CandidateReviewServiceError(
        'invalid-value',
        'The corrected value is invalid for the target field.',
      );
    }
    return validation.canonicalValue;
  }

  private async loadExistingDecision(
    candidate: EvidenceCandidate,
    reviewedValue: string,
    reason: string | undefined,
  ): Promise<EvidenceItem | undefined> {
    let id: string;
    try {
      id = candidateEvidenceId(candidate.id);
    } catch (error) {
      this.throwDerivationError(error);
    }
    let existing: EvidenceItem | undefined;
    try {
      existing = await this.evidenceRepository.getById(id!);
    } catch (error) {
      throw new CandidateReviewServiceError(
        'read-failure',
        'Existing promoted evidence could not be loaded.',
        error,
      );
    }
    if (!existing) return undefined;

    const audit = existing.reviewAudit;
    if (
      existing.candidateId !== candidate.id ||
      audit?.originalCandidateValue !== candidate.normalizedValue ||
      audit.reviewedValue !== reviewedValue ||
      audit.reason !== reason
    ) {
      this.invalidTransition('A different candidate decision was already persisted.');
    }
    return existing;
  }

  private async loadSourceSnapshot(candidate: EvidenceCandidate): Promise<SourceFragment[]> {
    let available: SourceFragment[];
    try {
      available = await this.documentRepository.listFragments(
        candidate.projectId,
        candidate.documentId,
      );
    } catch (error) {
      throw new CandidateReviewServiceError(
        'read-failure',
        'Candidate source fragments could not be loaded.',
        error,
      );
    }
    const byId = new Map(available.map((fragment) => [fragment.id, fragment]));
    const fragments: SourceFragment[] = [];
    for (const fragmentId of candidate.sourceFragmentIds) {
      const fragment = byId.get(fragmentId);
      if (!fragment) {
        throw new CandidateReviewServiceError(
          'missing-source',
          `Candidate source fragment is missing: ${fragmentId}`,
        );
      }
      fragments.push(fragment);
    }
    return fragments;
  }

  private deriveEvidence(
    expectedCandidate: EvidenceCandidate,
    nextCandidate: EvidenceCandidate,
    sourceFragments: readonly SourceFragment[],
    conflictStatus: EvidenceItem['conflictStatus'],
  ): EvidenceItem | undefined {
    try {
      return deriveCandidateReview(
        expectedCandidate,
        nextCandidate,
        sourceFragments,
        conflictStatus,
      ).evidence;
    } catch (error) {
      this.throwDerivationError(error);
    }
  }

  private throwDerivationError(error: unknown): never {
    if (error instanceof CandidateReviewDerivationError) {
      if (
        error.code === 'invalid-project' ||
        error.code === 'invalid-candidate' ||
        error.code === 'invalid-source'
      ) {
        throw new CandidateReviewServiceError(error.code, error.message, error);
      }
      throw new CandidateReviewServiceError(
        'invalid-transition',
        error.message,
        error,
      );
    }
    throw error;
  }

  private async commit(
    expectedCandidate: EvidenceCandidate,
    nextCandidate: EvidenceCandidate,
    sourceFragments: readonly SourceFragment[],
    evidence?: EvidenceItem,
  ): Promise<void> {
    try {
      await this.evidenceRepository.commitCandidateReview({
        expectedCandidate,
        nextCandidate,
        sourceFragments,
        ...(evidence === undefined ? {} : { evidence }),
      });
    } catch (error) {
      if (error instanceof EvidenceRepositoryError) {
        if (
          error.code === 'stale-candidate' ||
          error.code === 'evidence-collision'
        ) {
          throw new CandidateReviewServiceError(
            'invalid-transition',
            'The candidate decision is stale or conflicts with an existing decision.',
            error,
          );
        }
        if (error.code === 'stale-source') {
          throw new CandidateReviewServiceError(
            'invalid-source',
            'Candidate provenance changed before the decision was committed.',
            error,
          );
        }
      }
      throw new CandidateReviewServiceError(
        'write-failure',
        'The candidate review could not be committed atomically.',
        error,
      );
    }
  }

  private invalidTransition(message: string): never {
    throw new CandidateReviewServiceError('invalid-transition', message);
  }
}
