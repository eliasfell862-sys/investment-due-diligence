import {
  formatSourceLocator,
  type SourceFragment,
} from '../../domain/documents/source-fragment';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import type { EvidenceItem } from '../../domain/evidence/evidence';

export type CandidateReviewDerivationErrorCode =
  | 'invalid-project'
  | 'invalid-candidate'
  | 'invalid-source'
  | 'invalid-review';

export class CandidateReviewDerivationError extends Error {
  readonly code: CandidateReviewDerivationErrorCode;
  override readonly cause: unknown;

  constructor(
    code: CandidateReviewDerivationErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'CandidateReviewDerivationError';
    this.code = code;
    this.cause = cause;
  }
}

export interface DerivedCandidateReview {
  readonly evidence?: EvidenceItem;
}

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_GENERATED_IDENTIFIER_LENGTH = 2400;

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

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

export function requireReviewIdentifier(
  value: string,
  code: 'invalid-project' | 'invalid-candidate' | 'invalid-source',
): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (
    !normalized ||
    normalized.length > MAX_IDENTIFIER_LENGTH ||
    !isWellFormedUnicode(normalized)
  ) {
    throw new CandidateReviewDerivationError(
      code,
      `Identifier must be well-formed Unicode with 1-${MAX_IDENTIFIER_LENGTH} characters.`,
    );
  }
  return normalized;
}

function generatedIdentifier(
  prefix: string,
  value: string,
  code: 'invalid-candidate' | 'invalid-source',
): string {
  const validated = requireReviewIdentifier(value, code);
  let encoded: string;
  try {
    encoded = encodeURIComponent(validated);
  } catch (error) {
    throw new CandidateReviewDerivationError(
      code,
      'Identifier cannot be encoded safely.',
      error,
    );
  }
  const generated = `${prefix}${encoded}`;
  if (generated.length > MAX_GENERATED_IDENTIFIER_LENGTH) {
    throw new CandidateReviewDerivationError(
      code,
      `Generated identifier exceeds ${MAX_GENERATED_IDENTIFIER_LENGTH} characters.`,
    );
  }
  return generated;
}

export function candidateEvidenceId(candidateId: string): string {
  return generatedIdentifier('candidate-evidence:', candidateId, 'invalid-candidate');
}

export function candidateImportBatchId(documentId: string): string {
  return generatedIdentifier('document-candidate:', documentId, 'invalid-source');
}

function immutableCandidate(candidate: EvidenceCandidate): unknown {
  return {
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
    candidateFingerprint: candidate.candidateFingerprint,
    createdAt: candidate.createdAt,
  };
}

function validateTransition(
  expectedCandidate: EvidenceCandidate,
  nextCandidate: EvidenceCandidate,
): void {
  if (!recordsEqual(immutableCandidate(expectedCandidate), immutableCandidate(nextCandidate))) {
    throw new CandidateReviewDerivationError(
      'invalid-review',
      'Candidate review cannot change immutable or machine-derived fields.',
    );
  }
  if (
    expectedCandidate.reviewStatus !== 'pending' &&
    expectedCandidate.reviewStatus !== 'conflicted' &&
    !recordsEqual(expectedCandidate, nextCandidate)
  ) {
    throw new CandidateReviewDerivationError(
      'invalid-review',
      'A terminal candidate may only be retried with the exact same state.',
    );
  }
  if (
    nextCandidate.reviewedAt === undefined ||
    nextCandidate.updatedAt !== nextCandidate.reviewedAt
  ) {
    throw new CandidateReviewDerivationError(
      'invalid-review',
      'Reviewed and updated timestamps must be identical.',
    );
  }

  if (nextCandidate.reviewStatus === 'confirmed') {
    if (
      nextCandidate.correctedValue !== undefined ||
      nextCandidate.reviewReason !== undefined
    ) {
      throw new CandidateReviewDerivationError(
        'invalid-review',
        'Confirmed candidates cannot contain correction or reason fields.',
      );
    }
    return;
  }
  if (nextCandidate.reviewStatus === 'corrected') {
    if (
      nextCandidate.correctedValue === undefined ||
      nextCandidate.reviewReason === undefined ||
      nextCandidate.reviewReason.trim().length === 0
    ) {
      throw new CandidateReviewDerivationError(
        'invalid-review',
        'Corrected candidates require a corrected value and non-empty reason.',
      );
    }
    return;
  }
  if (nextCandidate.reviewStatus === 'rejected') {
    if (
      nextCandidate.correctedValue !== undefined ||
      nextCandidate.reviewReason === undefined ||
      nextCandidate.reviewReason.trim().length === 0
    ) {
      throw new CandidateReviewDerivationError(
        'invalid-review',
        'Rejected candidates require a reason and cannot contain a correction.',
      );
    }
    return;
  }
  throw new CandidateReviewDerivationError(
    'invalid-review',
    'The next candidate state must be terminal.',
  );
}

function validateSources(
  candidate: EvidenceCandidate,
  sourceFragments: readonly SourceFragment[],
): void {
  if (
    !recordsEqual(
      sourceFragments.map(({ id }) => id),
      candidate.sourceFragmentIds,
    ) ||
    sourceFragments.some(
      ({ projectId, documentId }) =>
        projectId !== candidate.projectId || documentId !== candidate.documentId,
    )
  ) {
    throw new CandidateReviewDerivationError(
      'invalid-review',
      'Source snapshots must match candidate provenance in exact order.',
    );
  }
}

function promotableSource(candidate: EvidenceCandidate, sourceFragments: readonly SourceFragment[]) {
  const allPages = sourceFragments.every(
    ({ locator }) => locator.pageNumber !== undefined,
  );
  const allSlides = sourceFragments.every(
    ({ locator }) => locator.slideNumber !== undefined,
  );
  if (allPages === allSlides) {
    throw new CandidateReviewDerivationError(
      'invalid-source',
      'Candidate sources cannot mix page and slide locators.',
    );
  }
  const sourceSheet = allPages ? 'PDF' as const : 'PPTX' as const;
  const sourceRow = Math.min(
    ...sourceFragments.map(({ locator }) =>
      allPages ? locator.pageNumber! : locator.slideNumber!,
    ),
  );
  return {
    sourceSheet,
    sourceRow,
    sourceLocator: [...new Set(sourceFragments.map(formatSourceLocator))].join('；'),
    rawValue:
      candidate.displayValue !== undefined && candidate.displayValue.trim().length > 0
        ? candidate.displayValue
        : sourceFragments.map(({ rawText }) => rawText).join('；'),
  };
}

export function deriveCandidateReview(
  expectedCandidate: EvidenceCandidate,
  nextCandidate: EvidenceCandidate,
  sourceFragments: readonly SourceFragment[],
  conflictStatus: EvidenceItem['conflictStatus'] = 'none',
): DerivedCandidateReview {
  requireReviewIdentifier(expectedCandidate.projectId, 'invalid-project');
  requireReviewIdentifier(expectedCandidate.id, 'invalid-candidate');
  requireReviewIdentifier(expectedCandidate.documentId, 'invalid-source');
  validateTransition(expectedCandidate, nextCandidate);
  validateSources(expectedCandidate, sourceFragments);

  if (nextCandidate.reviewStatus === 'rejected') {
    return {};
  }

  const source = promotableSource(expectedCandidate, sourceFragments);
  const reviewedValue = nextCandidate.reviewStatus === 'corrected'
    ? nextCandidate.correctedValue!
    : expectedCandidate.normalizedValue;
  const reason = nextCandidate.reviewStatus === 'corrected'
    ? nextCandidate.reviewReason
    : undefined;
  return {
    evidence: {
      id: candidateEvidenceId(expectedCandidate.id),
      projectId: expectedCandidate.projectId,
      fieldId: expectedCandidate.fieldId,
      periodIdentity: expectedCandidate.periodIdentity,
      dimensionIdentity: expectedCandidate.dimensionIdentity,
      normalizedValue: reviewedValue,
      importBatchId: candidateImportBatchId(expectedCandidate.documentId),
      sourceDocumentId: expectedCandidate.documentId,
      sourceFragmentIds: expectedCandidate.sourceFragmentIds,
      sourceType: expectedCandidate.sourceTypeHint,
      candidateId: expectedCandidate.id,
      sourceSheet: source.sourceSheet,
      sourceRow: source.sourceRow,
      sourceLocator: source.sourceLocator,
      rawValue: source.rawValue,
      confidence: expectedCandidate.confidence,
      conflictStatus,
      updatedAt: nextCandidate.reviewedAt!,
      reviewAudit: {
        originalCandidateValue: expectedCandidate.normalizedValue,
        reviewedValue,
        ...(reason === undefined ? {} : { reason }),
        reviewedAt: nextCandidate.reviewedAt!,
      },
    },
  };
}

export function evidenceContentEqual(
  left: EvidenceItem,
  right: EvidenceItem,
): boolean {
  const { conflictStatus: _leftStatus, ...leftContent } = left;
  const { conflictStatus: _rightStatus, ...rightContent } = right;
  return recordsEqual(leftContent, rightContent);
}
