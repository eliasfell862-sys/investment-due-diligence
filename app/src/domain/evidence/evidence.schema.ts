import { z } from 'zod';
import { deepFreeze } from '../deep-freeze';
import type { EvidenceItem } from './evidence';
import { findTargetFieldDefinition, type TargetFieldDefinition } from './target-fields';
import { validateNormalizedTargetValue } from './validate-normalized-target-value';

const trimmedIdentifier = z.string().trim().min(1);
const timestamp = z.string().datetime({ offset: true });
const sourceFragmentIds = z
  .array(trimmedIdentifier)
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Source fragment ids must be unique',
  });
const reviewAuditSchema = z
  .object({
    originalCandidateValue: z.string(),
    reviewedValue: z.string(),
    reason: z.string().trim().min(1).optional(),
    reviewedAt: timestamp,
  })
  .strict();

const evidenceItemInputSchema = z
  .object({
    id: trimmedIdentifier,
    projectId: trimmedIdentifier,
    fieldId: trimmedIdentifier,
    periodIdentity: trimmedIdentifier,
    dimensionIdentity: trimmedIdentifier,
    normalizedValue: z.string(),
    importBatchId: trimmedIdentifier,
    sourceDocumentId: trimmedIdentifier.optional(),
    sourceFragmentIds: sourceFragmentIds.optional(),
    sourceType: z
      .enum([
        'document_fact',
        'management_forecast',
        'investor_assumption',
        'interview',
      ])
      .optional(),
    candidateId: trimmedIdentifier.optional(),
    reviewAudit: reviewAuditSchema.optional(),
    sourceSheet: trimmedIdentifier,
    sourceRow: z.number().int().positive(),
    sourceLocator: z.string().optional(),
    rawValue: z.string(),
    confidence: z.number().min(0).max(1),
    displayValue: z.string().optional(),
    formula: z.string().optional(),
    cellType: z.string().optional(),
    numberFormat: z.string().optional(),
    conflictStatus: z.enum(['none', 'unresolved', 'resolved']),
    updatedAt: timestamp,
  })
  .strict()
  .superRefine((item, context) => {
    if (item.candidateId === undefined) return;

    const requiredProvenance = [
      ['sourceDocumentId', item.sourceDocumentId],
      ['sourceFragmentIds', item.sourceFragmentIds],
      ['sourceType', item.sourceType],
      ['reviewAudit', item.reviewAudit],
    ] as const;
    for (const [path, value] of requiredProvenance) {
      if (value === undefined) {
        context.addIssue({
          code: 'custom',
          path: [path],
          message: `${path} is required for candidate evidence`,
        });
      }
    }
    if (item.sourceLocator === undefined || item.sourceLocator.trim().length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['sourceLocator'],
        message: 'sourceLocator is required for candidate evidence',
      });
    }
  });

function canonicalTargetValue(
  definition: TargetFieldDefinition,
  value: string,
  label: string,
): string {
  const targetValue = validateNormalizedTargetValue(definition, value);
  if (targetValue.status !== 'valid') {
    throw new Error(`Invalid ${label}: ${definition.id}`);
  }
  return targetValue.canonicalValue;
}

export function parseEvidenceItem(input: unknown): EvidenceItem {
  const parsed = evidenceItemInputSchema.parse(input);
  const definition = findTargetFieldDefinition(parsed.fieldId);
  if (!definition) {
    throw new Error(`Unknown target field: ${parsed.fieldId}`);
  }

  const normalizedValue = canonicalTargetValue(
    definition,
    parsed.normalizedValue,
    'normalized target value',
  );
  let reviewAudit: EvidenceItem['reviewAudit'];
  if (parsed.reviewAudit !== undefined) {
    const originalCandidateValue = canonicalTargetValue(
      definition,
      parsed.reviewAudit.originalCandidateValue,
      'original candidate value',
    );
    const reviewedValue = canonicalTargetValue(
      definition,
      parsed.reviewAudit.reviewedValue,
      'reviewed value',
    );
    if (reviewedValue !== normalizedValue) {
      throw new Error('Reviewed value must equal the final normalized value.');
    }
    reviewAudit = {
      originalCandidateValue,
      reviewedValue,
      ...(parsed.reviewAudit.reason === undefined
        ? {}
        : { reason: parsed.reviewAudit.reason }),
      reviewedAt: new Date(parsed.reviewAudit.reviewedAt).toISOString(),
    };
  }

  return deepFreeze({
    id: parsed.id,
    projectId: parsed.projectId,
    fieldId: parsed.fieldId,
    periodIdentity: parsed.periodIdentity,
    dimensionIdentity: parsed.dimensionIdentity,
    normalizedValue,
    importBatchId: parsed.importBatchId,
    ...(parsed.sourceDocumentId === undefined
      ? {}
      : { sourceDocumentId: parsed.sourceDocumentId }),
    ...(parsed.sourceFragmentIds === undefined
      ? {}
      : { sourceFragmentIds: parsed.sourceFragmentIds }),
    ...(parsed.sourceType === undefined ? {} : { sourceType: parsed.sourceType }),
    ...(parsed.candidateId === undefined ? {} : { candidateId: parsed.candidateId }),
    ...(reviewAudit === undefined ? {} : { reviewAudit }),
    sourceSheet: parsed.sourceSheet,
    sourceRow: parsed.sourceRow,
    ...(parsed.sourceLocator === undefined
      ? {}
      : { sourceLocator: parsed.sourceLocator }),
    rawValue: parsed.rawValue,
    confidence: parsed.confidence,
    ...(parsed.displayValue === undefined ? {} : { displayValue: parsed.displayValue }),
    ...(parsed.formula === undefined ? {} : { formula: parsed.formula }),
    ...(parsed.cellType === undefined ? {} : { cellType: parsed.cellType }),
    ...(parsed.numberFormat === undefined ? {} : { numberFormat: parsed.numberFormat }),
    conflictStatus: parsed.conflictStatus,
    updatedAt: new Date(parsed.updatedAt).toISOString(),
  });
}
