import { findTargetFieldDefinition } from '../evidence/target-fields';
import { validateNormalizedTargetValue } from '../evidence/validate-normalized-target-value';

export interface EvidenceSummary {
  readonly projectId: string;
  readonly fieldId: string;
  readonly periodIdentity: string;
  readonly dimensionIdentity: string;
  readonly normalizedValue: string;
  readonly conflictStatus: 'none' | 'unresolved' | 'resolved';
}

export interface Readiness {
  readonly missingFieldIds: readonly string[];
  readonly presentFieldIds: readonly string[];
  readonly completenessPct: number;
  readonly unresolvedConflictCount: number;
  readonly canExport: boolean;
}

export type ReadinessValidationErrorCode =
  | 'invalid-project-id'
  | 'invalid-required-field'
  | 'unknown-required-field';

export class ReadinessValidationError extends Error {
  readonly code: ReadinessValidationErrorCode;
  readonly fieldId?: unknown;
  readonly projectId?: unknown;

  constructor(
    code: ReadinessValidationErrorCode,
    inputValue: unknown,
  ) {
    super(
      code === 'invalid-project-id'
        ? '目标项目标识必须是非空字符串。'
        : code === 'invalid-required-field'
          ? '必填字段标识不能为空。'
          : `未找到必填字段“${String(inputValue)}”的规范定义。`,
    );
    this.name = 'ReadinessValidationError';
    this.code = code;
    if (code === 'invalid-project-id') {
      this.projectId = inputValue;
    } else {
      this.fieldId = inputValue;
    }
  }
}

export type ReadinessInputErrorCode =
  | 'invalid-evidence-record'
  | 'invalid-evidence-project-id'
  | 'invalid-evidence-field-id'
  | 'unknown-evidence-field'
  | 'invalid-evidence-period-identity'
  | 'invalid-evidence-dimension-identity'
  | 'invalid-evidence-normalized-value'
  | 'invalid-evidence-conflict-status'
  | 'invalid-evidence-target-value';

const inputErrorMessages: Readonly<Record<ReadinessInputErrorCode, string>> = {
  'invalid-evidence-record': '证据项必须是对象记录。',
  'invalid-evidence-project-id': '证据项的项目标识必须是非空字符串。',
  'invalid-evidence-field-id': '证据项的字段标识必须是非空字符串。',
  'unknown-evidence-field': '证据项的字段标识不在规范字段注册表中。',
  'invalid-evidence-period-identity': '证据项的期间标识必须是非空字符串。',
  'invalid-evidence-dimension-identity': '证据项的维度标识必须是非空字符串。',
  'invalid-evidence-normalized-value': '证据项的规范值必须是字符串。',
  'invalid-evidence-conflict-status': '证据项的冲突状态无效。',
  'invalid-evidence-target-value': '证据项的规范值不符合目标字段定义。',
};

export class ReadinessInputError extends Error {
  readonly code: ReadinessInputErrorCode;
  readonly evidenceIndex: number;

  constructor(code: ReadinessInputErrorCode, evidenceIndex: number) {
    super(`第 ${evidenceIndex + 1} 条证据无效：${inputErrorMessages[code]}`);
    this.name = 'ReadinessInputError';
    this.code = code;
    this.evidenceIndex = evidenceIndex;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(
  value: unknown,
  code: ReadinessInputErrorCode,
  evidenceIndex: number,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ReadinessInputError(code, evidenceIndex);
  }
  return value.trim();
}

function validateEvidenceRecordAndProject(item: unknown, evidenceIndex: number) {
  if (!isRecord(item)) {
    throw new ReadinessInputError('invalid-evidence-record', evidenceIndex);
  }

  const projectId = requireNonEmptyString(
    item.projectId,
    'invalid-evidence-project-id',
    evidenceIndex,
  );
  return { item, projectId };
}

function validateEvidenceSummary(
  item: Readonly<Record<string, unknown>>,
  projectId: string,
  evidenceIndex: number,
): EvidenceSummary {
  const fieldId = requireNonEmptyString(
    item.fieldId,
    'invalid-evidence-field-id',
    evidenceIndex,
  );
  const targetDefinition = findTargetFieldDefinition(fieldId);
  if (!targetDefinition) {
    throw new ReadinessInputError('unknown-evidence-field', evidenceIndex);
  }
  const periodIdentity = requireNonEmptyString(
    item.periodIdentity,
    'invalid-evidence-period-identity',
    evidenceIndex,
  );
  const dimensionIdentity = requireNonEmptyString(
    item.dimensionIdentity,
    'invalid-evidence-dimension-identity',
    evidenceIndex,
  );
  if (typeof item.normalizedValue !== 'string') {
    throw new ReadinessInputError('invalid-evidence-normalized-value', evidenceIndex);
  }
  if (
    item.conflictStatus !== 'none' &&
    item.conflictStatus !== 'unresolved' &&
    item.conflictStatus !== 'resolved'
  ) {
    throw new ReadinessInputError('invalid-evidence-conflict-status', evidenceIndex);
  }

  const targetValue = validateNormalizedTargetValue(
    targetDefinition,
    item.normalizedValue,
  );
  if (targetValue.status === 'invalid') {
    throw new ReadinessInputError('invalid-evidence-target-value', evidenceIndex);
  }

  return {
    projectId,
    fieldId,
    periodIdentity,
    dimensionIdentity,
    normalizedValue:
      targetValue.status === 'valid' ? targetValue.canonicalValue : '',
    conflictStatus: item.conflictStatus,
  };
}

function normalizeProjectId(projectId: unknown): string {
  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    throw new ReadinessValidationError('invalid-project-id', projectId);
  }
  return projectId.trim();
}

function normalizeRequiredFieldIds(requiredFieldIds: readonly string[]): string[] {
  const uniqueFieldIds: string[] = [];
  const seen = new Set<string>();

  for (const originalFieldId of requiredFieldIds) {
    if (typeof originalFieldId !== 'string') {
      throw new ReadinessValidationError('invalid-required-field', originalFieldId);
    }
    const fieldId = originalFieldId.trim();
    if (fieldId.length === 0) {
      throw new ReadinessValidationError('invalid-required-field', originalFieldId);
    }
    if (!findTargetFieldDefinition(fieldId)) {
      throw new ReadinessValidationError('unknown-required-field', originalFieldId);
    }
    if (!seen.has(fieldId)) {
      seen.add(fieldId);
      uniqueFieldIds.push(fieldId);
    }
  }

  return uniqueFieldIds;
}

function hasNormalizedValue(item: EvidenceSummary): boolean {
  return item.normalizedValue.length > 0;
}

export function calculateReadiness(
  projectId: string,
  requiredFieldIds: readonly string[],
  evidence: readonly EvidenceSummary[],
): Readiness {
  const targetProjectId = normalizeProjectId(projectId);
  const required = normalizeRequiredFieldIds(requiredFieldIds);
  const requiredSet = new Set(required);
  const presentSet = new Set<string>();
  const unresolvedGroups = new Set<string>();

  for (const [evidenceIndex, rawItem] of evidence.entries()) {
    const evidenceRecord = validateEvidenceRecordAndProject(rawItem, evidenceIndex);
    if (evidenceRecord.projectId !== targetProjectId) {
      continue;
    }

    const item = validateEvidenceSummary(
      evidenceRecord.item, evidenceRecord.projectId, evidenceIndex,
    );

    if (requiredSet.has(item.fieldId) && hasNormalizedValue(item)) {
      presentSet.add(item.fieldId);
    }

    if (item.conflictStatus === 'unresolved') {
      unresolvedGroups.add(
        JSON.stringify([
          item.projectId,
          item.fieldId,
          item.periodIdentity,
          item.dimensionIdentity,
        ]),
      );
    }
  }

  const presentFieldIds = required.filter((fieldId) => presentSet.has(fieldId));
  const missingFieldIds = required.filter((fieldId) => !presentSet.has(fieldId));
  const completenessPct =
    required.length === 0
      ? 100
      : Math.round((presentFieldIds.length / required.length) * 100);
  const unresolvedConflictCount = unresolvedGroups.size;

  return {
    missingFieldIds,
    presentFieldIds,
    completenessPct,
    unresolvedConflictCount,
    canExport: missingFieldIds.length === 0 && unresolvedConflictCount === 0,
  };
}
