import { z } from 'zod';
import type { EvidenceItem } from './evidence';
import { findTargetFieldDefinition } from './target-fields';
import { validateNormalizedTargetValue } from './validate-normalized-target-value';

const trimmedIdentifier = z.string().trim().min(1);

const evidenceItemInputSchema = z.object({
  id: trimmedIdentifier,
  projectId: trimmedIdentifier,
  fieldId: trimmedIdentifier,
  periodIdentity: trimmedIdentifier,
  dimensionIdentity: trimmedIdentifier,
  normalizedValue: z.string(),
  importBatchId: trimmedIdentifier,
  sourceDocumentId: trimmedIdentifier.optional(),
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
  updatedAt: z.string().datetime(),
});

export function parseEvidenceItem(input: unknown): EvidenceItem {
  const parsed = evidenceItemInputSchema.parse(input);
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

  return {
    ...parsed,
    normalizedValue: targetValue.canonicalValue,
    updatedAt: new Date(parsed.updatedAt).toISOString(),
  };
}
