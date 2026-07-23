import type { EvidenceItem, EvidenceSourceType } from './evidence';
import { parseEvidenceItem } from './evidence.schema';
import { findTargetFieldDefinition } from './target-fields';
import { validateNormalizedTargetValue } from './validate-normalized-target-value';

export interface ManualEvidenceInput {
  readonly projectId: string;
  readonly fieldId: string;
  readonly value: string;
  readonly sourceType: EvidenceSourceType;
  readonly sourceDocumentId?: string;
  readonly sourceLocator?: string;
  readonly sourceNote?: string;
  readonly periodIdentity?: string;
  readonly dimensionIdentity?: string;
}

export interface ManualEvidenceOptions {
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export type ManualEvidenceErrorCode =
  | 'invalid-project'
  | 'invalid-field'
  | 'invalid-value'
  | 'invalid-source'
  | 'invalid-period'
  | 'invalid-dimension'
  | 'invalid-id'
  | 'invalid-date';

export class ManualEvidenceError extends Error {
  readonly code: ManualEvidenceErrorCode;
  override readonly cause: unknown;

  constructor(code: ManualEvidenceErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ManualEvidenceError';
    this.code = code;
    this.cause = cause;
  }
}

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_IDENTITY_LENGTH = 2400;
const MAX_GENERATED_IDENTIFIER_LENGTH = 2400;
const MAX_VALUE_LENGTH = 65_536;
const MAX_SOURCE_NOTE_LENGTH = 65_536;
const MAX_SOURCE_LOCATOR_LENGTH = 4096;
const forecastPlaceholder = /^(?:manual:)?(?:past|undated)$/i;

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

function requireText(
  value: unknown,
  code: ManualEvidenceErrorCode,
  label: string,
  maxLength: number,
): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (
    trimmed.length === 0
    || trimmed.length > maxLength
    || !isWellFormedUnicode(trimmed)
  ) {
    throw new ManualEvidenceError(
      code,
      `${label} must be well-formed Unicode with 1-${maxLength} characters.`,
    );
  }
  return trimmed;
}

function optionalText(
  value: unknown,
  code: ManualEvidenceErrorCode,
  label: string,
  maxLength: number,
  blankIsMissing = false,
): string | undefined {
  if (value === undefined) return undefined;
  if (blankIsMissing && typeof value === 'string' && value.trim().length === 0) {
    return undefined;
  }
  return requireText(value, code, label, maxLength);
}

function safelyEncode(
  value: string,
  code: 'invalid-id' | 'invalid-dimension',
  label: string,
): string {
  try {
    return encodeURIComponent(value);
  } catch (error) {
    throw new ManualEvidenceError(code, `${label} cannot be encoded safely.`, error);
  }
}

function createManualId(createId: () => string): string {
  let value: unknown;
  try {
    value = createId();
  } catch (error) {
    throw new ManualEvidenceError('invalid-id', 'Manual evidence id creation failed.', error);
  }
  return requireText(value, 'invalid-id', 'Manual evidence id', MAX_IDENTIFIER_LENGTH);
}

function createImportBatchId(id: string): string {
  const importBatchId = `manual-batch:${safelyEncode(id, 'invalid-id', 'Manual evidence id')}`;
  if (importBatchId.length > MAX_GENERATED_IDENTIFIER_LENGTH) {
    throw new ManualEvidenceError(
      'invalid-id',
      `Manual import batch id exceeds ${MAX_GENERATED_IDENTIFIER_LENGTH} characters.`,
    );
  }
  return importBatchId;
}

function createTimestamp(now: () => Date): string {
  let value: unknown;
  try {
    value = now();
  } catch (error) {
    throw new ManualEvidenceError('invalid-date', 'Manual evidence date creation failed.', error);
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ManualEvidenceError('invalid-date', 'Manual evidence date must be valid.');
  }
  return value.toISOString();
}

function sourceDetails(
  sourceType: EvidenceSourceType,
  sourceDocumentId: string | undefined,
  sourceLocator: string | undefined,
  sourceNote: string | undefined,
): {
  readonly confidence: number;
  readonly sourceDocumentId?: string;
  readonly sourceLocator: string;
} {
  const hasDocument = sourceDocumentId !== undefined;
  const hasLocator = sourceLocator !== undefined;
  if (hasDocument !== hasLocator) {
    throw new ManualEvidenceError(
      'invalid-source',
      'Document provenance requires both a document id and source locator.',
    );
  }

  if (sourceType === 'document_fact') {
    if (!hasDocument || !hasLocator) {
      throw new ManualEvidenceError(
        'invalid-source',
        'Document facts require a document id and source locator.',
      );
    }
    return {
      confidence: 0.8,
      sourceDocumentId,
      sourceLocator,
    };
  }

  if (sourceType === 'interview') {
    if (sourceNote === undefined || hasDocument) {
      throw new ManualEvidenceError(
        'invalid-source',
        'Interviews require a source note and cannot use document provenance.',
      );
    }
    return { confidence: 0.7, sourceLocator: '人工访谈' };
  }

  if (sourceType === 'investor_assumption') {
    if (sourceNote === undefined || hasDocument) {
      throw new ManualEvidenceError(
        'invalid-source',
        'Investor assumptions require a source note and cannot use document provenance.',
      );
    }
    return { confidence: 0.5, sourceLocator: '投资者假设' };
  }

  if (sourceType === 'management_forecast') {
    if (!hasDocument && sourceNote === undefined) {
      throw new ManualEvidenceError(
        'invalid-source',
        'Management forecasts require document provenance or a source note.',
      );
    }
    return hasDocument
      ? {
          confidence: 0.6,
          sourceDocumentId,
          sourceLocator: sourceLocator!,
        }
      : { confidence: 0.6, sourceLocator: '管理层预测' };
  }

  throw new ManualEvidenceError('invalid-source', 'Unknown manual evidence source type.');
}

export function createManualEvidence(
  input: ManualEvidenceInput,
  options: ManualEvidenceOptions = {},
): EvidenceItem {
  const projectId = requireText(
    input.projectId,
    'invalid-project',
    'Project id',
    MAX_IDENTIFIER_LENGTH,
  );
  const fieldId = requireText(
    input.fieldId,
    'invalid-field',
    'Field id',
    MAX_IDENTIFIER_LENGTH,
  );
  const definition = findTargetFieldDefinition(fieldId);
  if (definition === undefined) {
    throw new ManualEvidenceError(
      'invalid-field',
      `Unknown target field: ${fieldId}`,
    );
  }

  const value = requireText(input.value, 'invalid-value', 'Value', MAX_VALUE_LENGTH);
  let normalizedValue: string;
  try {
    const validation = validateNormalizedTargetValue(definition, value);
    if (validation.status !== 'valid') {
      throw new Error(`Invalid target value: ${validation.status}`);
    }
    normalizedValue = validation.canonicalValue;
  } catch (error) {
    throw new ManualEvidenceError(
      'invalid-value',
      `Invalid target value: ${fieldId}`,
      error,
    );
  }

  const sourceType = input.sourceType;
  if (
    sourceType !== 'document_fact'
    && sourceType !== 'management_forecast'
    && sourceType !== 'investor_assumption'
    && sourceType !== 'interview'
  ) {
    throw new ManualEvidenceError('invalid-source', 'Unknown manual evidence source type.');
  }
  const sourceDocumentId = optionalText(
    input.sourceDocumentId,
    'invalid-source',
    'Source document id',
    MAX_IDENTIFIER_LENGTH,
  );
  const sourceLocator = optionalText(
    input.sourceLocator,
    'invalid-source',
    'Source locator',
    MAX_SOURCE_LOCATOR_LENGTH,
  );
  const sourceNote = optionalText(
    input.sourceNote,
    'invalid-source',
    'Source note',
    MAX_SOURCE_NOTE_LENGTH,
    true,
  );

  const periodIdentity = input.periodIdentity === undefined
    ? 'manual:undated'
    : requireText(
        input.periodIdentity,
        'invalid-period',
        'Period identity',
        MAX_IDENTITY_LENGTH,
      );
  if (
    sourceType === 'management_forecast'
    && (input.periodIdentity === undefined || forecastPlaceholder.test(periodIdentity))
  ) {
    throw new ManualEvidenceError(
      'invalid-period',
      'Management forecasts require an explicit forecast period.',
    );
  }

  const defaultDimensionIdentity =
    `project:${safelyEncode(projectId, 'invalid-dimension', 'Project id')}:default`;
  const dimensionIdentity = input.dimensionIdentity === undefined
    ? defaultDimensionIdentity
    : requireText(
        input.dimensionIdentity,
        'invalid-dimension',
        'Dimension identity',
        MAX_IDENTITY_LENGTH,
      );
  if (dimensionIdentity.length > MAX_IDENTITY_LENGTH) {
    throw new ManualEvidenceError(
      'invalid-dimension',
      `Dimension identity exceeds ${MAX_IDENTITY_LENGTH} characters.`,
    );
  }

  const source = sourceDetails(
    sourceType,
    sourceDocumentId,
    sourceLocator,
    sourceNote,
  );
  const id = createManualId(options.createId ?? (() => crypto.randomUUID()));
  const importBatchId = createImportBatchId(id);
  const updatedAt = createTimestamp(options.now ?? (() => new Date()));

  try {
    return parseEvidenceItem({
      id,
      projectId,
      fieldId,
      periodIdentity,
      dimensionIdentity,
      normalizedValue,
      importBatchId,
      ...(source.sourceDocumentId === undefined
        ? {}
        : { sourceDocumentId: source.sourceDocumentId }),
      sourceType,
      sourceSheet: '人工录入',
      sourceRow: 1,
      sourceLocator: source.sourceLocator,
      rawValue: sourceNote ?? value,
      confidence: source.confidence,
      ...(normalizedValue === value ? {} : { displayValue: value }),
      conflictStatus: 'none',
      updatedAt,
    });
  } catch (error) {
    if (error instanceof ManualEvidenceError) throw error;
    throw new ManualEvidenceError(
      'invalid-value',
      'Manual evidence failed canonical validation.',
      error,
    );
  }
}
