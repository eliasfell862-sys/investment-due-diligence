import {
  formatSourceLocator,
  type SourceFragment,
} from '../../domain/documents/source-fragment';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import { parseEvidenceCandidate } from '../../domain/evidence/evidence-candidate.schema';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
import { validateNormalizedTargetValue } from '../../domain/evidence/validate-normalized-target-value';
import type { DocumentEvidenceRepository } from './document-evidence-repository';
import type { EvidenceRepository } from './evidence-repository';

export type CandidateReviewServiceErrorCode =
  | 'invalid-project'
  | 'invalid-candidate'
  | 'invalid-value'
  | 'invalid-reason'
  | 'candidate-not-found'
  | 'invalid-transition'
  | 'missing-source'
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

interface ResolvedSource {
  readonly fragments: readonly SourceFragment[];
  readonly sourceSheet: string;
  readonly sourceRow: number;
  readonly sourceLocator: string;
  readonly rawValue: string;
}

function requireIdentifier(
  value: string,
  code: 'invalid-project' | 'invalid-candidate',
): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new CandidateReviewServiceError(code, 'A non-empty identifier is required.');
  }
  return normalized;
}

function requireReason(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new CandidateReviewServiceError('invalid-reason', 'A review reason is required.');
  }
  return normalized;
}

function evidenceId(candidateId: string): string {
  return `candidate-evidence:${encodeURIComponent(candidateId)}`;
}

function isMachineState(candidate: EvidenceCandidate): boolean {
  return candidate.reviewStatus === 'pending' || candidate.reviewStatus === 'conflicted';
}

function isPdfSource(fragment: SourceFragment): boolean {
  return (
    fragment.sourceKind.startsWith('pdf_') ||
    (fragment.sourceKind === 'ocr' && fragment.locator.pageNumber !== undefined)
  );
}

function isPptSource(fragment: SourceFragment): boolean {
  return (
    fragment.sourceKind.startsWith('ppt_') ||
    (fragment.sourceKind === 'embedded_chart_data' &&
      fragment.locator.slideNumber !== undefined)
  );
}

function sourceSheet(fragments: readonly SourceFragment[]): string {
  if (fragments.every(isPdfSource)) return 'PDF';
  if (fragments.every(isPptSource)) return 'PPTX';
  return '文档';
}

function uniqueSourceLocator(fragments: readonly SourceFragment[]): string {
  return [...new Set(fragments.map(formatSourceLocator))].join('；');
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

    if (candidate.reviewStatus === 'corrected' || candidate.reviewStatus === 'rejected') {
      this.invalidTransition('The candidate already has a different terminal decision.');
    }
    if (candidate.reviewStatus === 'confirmed') {
      await this.promote(candidate, candidate.normalizedValue, candidate.reviewedAt!);
      return;
    }
    if (!isMachineState(candidate)) {
      this.invalidTransition('The candidate cannot be confirmed from its current state.');
    }

    const reviewedAt = await this.reviewedAtForPendingPromotion(
      candidate,
      candidate.normalizedValue,
      undefined,
    );
    await this.promote(candidate, candidate.normalizedValue, reviewedAt);
    await this.writeCandidate(
      reviewedCandidate(candidate, 'confirmed', reviewedAt),
    );
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
      await this.promote(candidate, canonicalValue, candidate.reviewedAt!, reason);
      return;
    }
    if (!isMachineState(candidate)) {
      this.invalidTransition('The candidate cannot be corrected from its current state.');
    }

    const reviewedAt = await this.reviewedAtForPendingPromotion(
      candidate,
      canonicalValue,
      reason,
    );
    await this.promote(candidate, canonicalValue, reviewedAt, reason);
    await this.writeCandidate(
      reviewedCandidate(candidate, 'corrected', reviewedAt, {
        correctedValue: canonicalValue,
        reason,
      }),
    );
  }

  async reject(projectId: string, candidateId: string, reasonValue: string): Promise<void> {
    const project = requireIdentifier(projectId, 'invalid-project');
    const candidateIdentity = requireIdentifier(candidateId, 'invalid-candidate');
    const reason = requireReason(reasonValue);
    const candidate = await this.loadCandidate(project, candidateIdentity);

    if (candidate.reviewStatus === 'rejected') {
      if (candidate.reviewReason !== reason) {
        this.invalidTransition('A rejected candidate cannot be changed.');
      }
      return;
    }
    if (candidate.reviewStatus === 'confirmed' || candidate.reviewStatus === 'corrected') {
      this.invalidTransition('The candidate already has a different terminal decision.');
    }
    if (!isMachineState(candidate)) {
      this.invalidTransition('The candidate cannot be rejected from its current state.');
    }

    const reviewedAt = this.now().toISOString();
    await this.writeCandidate(
      reviewedCandidate(candidate, 'rejected', reviewedAt, { reason }),
    );
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

  private async reviewedAtForPendingPromotion(
    candidate: EvidenceCandidate,
    reviewedValue: string,
    reason: string | undefined,
  ): Promise<string> {
    let existing: EvidenceItem | undefined;
    try {
      existing = (await this.evidenceRepository.listByProject(candidate.projectId))
        .find(({ id }) => id === evidenceId(candidate.id));
    } catch (error) {
      throw new CandidateReviewServiceError(
        'read-failure',
        'Existing promoted evidence could not be loaded.',
        error,
      );
    }
    if (!existing) return this.now().toISOString();

    const audit = existing.reviewAudit;
    if (
      existing.candidateId !== candidate.id ||
      audit?.originalCandidateValue !== candidate.normalizedValue ||
      audit.reviewedValue !== reviewedValue ||
      audit.reason !== reason
    ) {
      this.invalidTransition('A different candidate decision was already persisted.');
    }
    return audit.reviewedAt;
  }

  private async resolveSource(candidate: EvidenceCandidate): Promise<ResolvedSource> {
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

    const sourceRow = Math.min(
      ...fragments.map(({ locator }) => locator.pageNumber ?? locator.slideNumber!),
    );
    return {
      fragments,
      sourceSheet: sourceSheet(fragments),
      sourceRow,
      sourceLocator: uniqueSourceLocator(fragments),
      rawValue:
        candidate.displayValue !== undefined && candidate.displayValue.trim().length > 0
          ? candidate.displayValue
          : fragments.map(({ rawText }) => rawText).join('；'),
    };
  }

  private async promote(
    candidate: EvidenceCandidate,
    normalizedValue: string,
    reviewedAt: string,
    reason?: string,
  ): Promise<void> {
    const source = await this.resolveSource(candidate);
    const evidence: EvidenceItem = {
      id: evidenceId(candidate.id),
      projectId: candidate.projectId,
      fieldId: candidate.fieldId,
      periodIdentity: candidate.periodIdentity,
      dimensionIdentity: candidate.dimensionIdentity,
      normalizedValue,
      importBatchId: `document-candidate:${encodeURIComponent(candidate.documentId)}`,
      sourceDocumentId: candidate.documentId,
      sourceFragmentIds: candidate.sourceFragmentIds,
      sourceType: candidate.sourceTypeHint,
      candidateId: candidate.id,
      sourceSheet: source.sourceSheet,
      sourceRow: source.sourceRow,
      sourceLocator: source.sourceLocator,
      rawValue: source.rawValue,
      confidence: candidate.confidence,
      conflictStatus: 'none',
      updatedAt: reviewedAt,
      reviewAudit: {
        originalCandidateValue: candidate.normalizedValue,
        reviewedValue: normalizedValue,
        ...(reason === undefined ? {} : { reason }),
        reviewedAt,
      },
    };

    try {
      await this.evidenceRepository.saveMany([evidence]);
    } catch (error) {
      throw new CandidateReviewServiceError(
        'write-failure',
        'Formal evidence could not be saved.',
        error,
      );
    }
  }

  private async writeCandidate(candidate: EvidenceCandidate): Promise<void> {
    try {
      await this.documentRepository.setCandidate(candidate);
    } catch (error) {
      throw new CandidateReviewServiceError(
        'write-failure',
        'The candidate review state could not be saved.',
        error,
      );
    }
  }

  private invalidTransition(message: string): never {
    throw new CandidateReviewServiceError('invalid-transition', message);
  }
}
