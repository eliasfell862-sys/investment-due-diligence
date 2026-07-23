import { z } from 'zod';
import type { EvidenceCandidate } from './evidence-candidate';
import { findTargetFieldDefinition } from './target-fields';
import { validateNormalizedTargetValue } from './validate-normalized-target-value';

const trimmedNonEmptyString = z.string().trim().min(1);
const optionalReviewReason = trimmedNonEmptyString.optional();
const optionalTimestamp = z.string().datetime({ offset: true }).optional();

const evidenceCandidateInputSchema = z
  .object({
    id: trimmedNonEmptyString,
    projectId: trimmedNonEmptyString,
    documentId: trimmedNonEmptyString,
    fieldId: trimmedNonEmptyString,
    normalizedValue: z.string(),
    displayValue: z.string().optional(),
    periodIdentity: trimmedNonEmptyString,
    dimensionIdentity: trimmedNonEmptyString,
    sourceFragmentIds: z
      .array(trimmedNonEmptyString)
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Source fragment ids must be unique',
      }),
    recognitionMethod: z.enum(['rule', 'ocr_rule', 'ai_assisted']),
    sourceTypeHint: z.enum(['document_fact', 'management_forecast']),
    confidence: z.number().min(0).max(1),
    reviewStatus: z.enum([
      'pending',
      'confirmed',
      'corrected',
      'rejected',
      'conflicted',
    ]),
    correctedValue: z.string().optional(),
    reviewReason: optionalReviewReason,
    reviewedAt: optionalTimestamp,
    candidateFingerprint: trimmedNonEmptyString,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((candidate, context) => {
    const hasCorrectedValue = candidate.correctedValue !== undefined;
    const hasReviewReason = candidate.reviewReason !== undefined;
    const hasReviewedAt = candidate.reviewedAt !== undefined;

    const addReviewIssue = (path: string, message: string) => {
      context.addIssue({ code: 'custom', path: [path], message });
    };

    if (candidate.reviewStatus === 'corrected') {
      if (!hasCorrectedValue) {
        addReviewIssue('correctedValue', 'Corrected value is required');
      }
      if (!hasReviewReason) {
        addReviewIssue('reviewReason', 'Review reason is required');
      }
      if (!hasReviewedAt) {
        addReviewIssue('reviewedAt', 'Review timestamp is required');
      }
      return;
    }

    if (candidate.reviewStatus === 'rejected') {
      if (hasCorrectedValue) {
        addReviewIssue('correctedValue', 'Rejected candidates cannot be corrected');
      }
      if (!hasReviewReason) {
        addReviewIssue('reviewReason', 'Review reason is required');
      }
      if (!hasReviewedAt) {
        addReviewIssue('reviewedAt', 'Review timestamp is required');
      }
      return;
    }

    if (candidate.reviewStatus === 'confirmed') {
      if (hasCorrectedValue) {
        addReviewIssue('correctedValue', 'Confirmed candidates cannot be corrected');
      }
      if (!hasReviewedAt) {
        addReviewIssue('reviewedAt', 'Review timestamp is required');
      }
      return;
    }

    if (hasCorrectedValue) {
      addReviewIssue('correctedValue', 'Machine states cannot contain review fields');
    }
    if (hasReviewReason) {
      addReviewIssue('reviewReason', 'Machine states cannot contain review fields');
    }
    if (hasReviewedAt) {
      addReviewIssue('reviewedAt', 'Machine states cannot contain review fields');
    }
  });

export function parseEvidenceCandidate(input: unknown): EvidenceCandidate {
  const parsed = evidenceCandidateInputSchema.parse(input);
  const definition = findTargetFieldDefinition(parsed.fieldId);
  if (!definition) {
    throw new Error(`Unknown target field: ${parsed.fieldId}`);
  }

  const targetValue = validateNormalizedTargetValue(
    definition,
    parsed.normalizedValue,
  );
  if (targetValue.status !== 'valid') {
    throw new Error(`Invalid normalized target value: ${parsed.fieldId}`);
  }

  let correctedValue = parsed.correctedValue;
  if (correctedValue !== undefined) {
    const correctedTargetValue = validateNormalizedTargetValue(
      definition,
      correctedValue,
    );
    if (correctedTargetValue.status !== 'valid') {
      throw new Error(`Invalid corrected target value: ${parsed.fieldId}`);
    }
    correctedValue = correctedTargetValue.canonicalValue;
  }

  return {
    ...parsed,
    normalizedValue: targetValue.canonicalValue,
    correctedValue,
    reviewedAt:
      parsed.reviewedAt === undefined
        ? undefined
        : new Date(parsed.reviewedAt).toISOString(),
    createdAt: new Date(parsed.createdAt).toISOString(),
    updatedAt: new Date(parsed.updatedAt).toISOString(),
  };
}
