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

interface ResolvedSource {
  readonly fragments: readonly SourceFragment[];
  readonly sourceSheet: 'PDF' | 'PPTX';
  readonly sourceRow: number;
  readonly sourceLocator: string;
  readonly rawValue: string;
}

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_GENERATED_IDENTIFIER_LENGTH = 2400;

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function requireIdentifier(
  value: string,
  code: 'invalid-project' | 'invalid-candidate' | 'invalid-source',
): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (
    !normalized ||
    normalized.length > MAX_IDENTIFIER_LENGTH ||
    !isWellFormedUnicode(normalized)
  ) {
    throw new CandidateReviewServiceError(
      code,
      `Identifier must be well-formed Unicode with 1-${MAX_IDENTIFIER_LENGTH} characters.`,
    );
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

function generatedIdentifier(
  prefix: string,
  value: string,
  code: 'invalid-candidate' | 'invalid-source',
): string {
  const validated = requireIdentifier(value, code);
  let encoded: string;
  try {
    encoded = encodeURIComponent(validated);
  } catch (error) {
    throw new CandidateReviewServiceError(code, 'Identifier cannot be encoded safely.', error);
  }
  const generated = `${prefix}${encoded}`;
  if (generated.length > MAX_GENERATED_IDENTIFIER_LENGTH) {
    throw new CandidateReviewServiceError(
      code,
      `Generated identifier exceeds ${MAX_GENERATED_IDENTIFIER_LENGTH} characters.`,
    );
  }
  return generated;
}

function evidenceId(candidateId: string): string {
  return generatedIdentifier('candidate-evidence:', candidateId, 'invalid-candidate');
}

function importBatchId(documentId: string): string {
  return generatedIdentifier('document-candidate:', documentId, 'invalid-source');
}

function isMachineState(candidate: EvidenceCandidate): boolean {
  return candidate.reviewStatus === 'pending' || candidate.reviewStatus === 'conflicted';
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
    const source = await this.resolveSource(candidate);
    const evidence = this.formalEvidence(
      candidate,
      candidate.normalizedValue,
      reviewedAt,
      source,
      undefined,
      existing?.conflictStatus ?? 'none',
    );

    await this.commit(candidate, nextCandidate, source.fragments, evidence);
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
    const source = await this.resolveSource(candidate);
    const evidence = this.formalEvidence(
      candidate,
      canonicalValue,
      reviewedAt,
      source,
      reason,
      existing?.conflictStatus ?? 'none',
    );

    await this.commit(candidate, nextCandidate, source.fragments, evidence);
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
    const source = await this.resolveSource(candidate);
    await this.commit(candidate, nextCandidate, source.fragments);
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
    let existing: EvidenceItem | undefined;
    try {
      existing = await this.evidenceRepository.getById(evidenceId(candidate.id));
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

    const allPages = fragments.every(({ locator }) => locator.pageNumber !== undefined);
    const allSlides = fragments.every(({ locator }) => locator.slideNumber !== undefined);
    if (allPages === allSlides) {
      throw new CandidateReviewServiceError(
        'invalid-source',
        'Candidate sources cannot mix page and slide locators.',
      );
    }
    const sourceSheet = allPages ? 'PDF' : 'PPTX';
    const sourceRow = Math.min(
      ...fragments.map(({ locator }) =>
        allPages ? locator.pageNumber! : locator.slideNumber!,
      ),
    );
    return {
      fragments,
      sourceSheet,
      sourceRow,
      sourceLocator: uniqueSourceLocator(fragments),
      rawValue:
        candidate.displayValue !== undefined && candidate.displayValue.trim().length > 0
          ? candidate.displayValue
          : fragments.map(({ rawText }) => rawText).join('；'),
    };
  }

  private formalEvidence(
    candidate: EvidenceCandidate,
    normalizedValue: string,
    reviewedAt: string,
    source: ResolvedSource,
    reason: string | undefined,
    conflictStatus: EvidenceItem['conflictStatus'],
  ): EvidenceItem {
    return {
      id: evidenceId(candidate.id),
      projectId: candidate.projectId,
      fieldId: candidate.fieldId,
      periodIdentity: candidate.periodIdentity,
      dimensionIdentity: candidate.dimensionIdentity,
      normalizedValue,
      importBatchId: importBatchId(candidate.documentId),
      sourceDocumentId: candidate.documentId,
      sourceFragmentIds: candidate.sourceFragmentIds,
      sourceType: candidate.sourceTypeHint,
      candidateId: candidate.id,
      sourceSheet: source.sourceSheet,
      sourceRow: source.sourceRow,
      sourceLocator: source.sourceLocator,
      rawValue: source.rawValue,
      confidence: candidate.confidence,
      conflictStatus,
      updatedAt: reviewedAt,
      reviewAudit: {
        originalCandidateValue: candidate.normalizedValue,
        reviewedValue: normalizedValue,
        ...(reason === undefined ? {} : { reason }),
        reviewedAt,
      },
    };
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
