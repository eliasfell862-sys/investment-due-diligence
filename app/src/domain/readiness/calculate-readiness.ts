import { findTargetFieldDefinition } from '../evidence/target-fields';

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
  | 'invalid-required-field'
  | 'unknown-required-field';

export class ReadinessValidationError extends Error {
  readonly code: ReadinessValidationErrorCode;
  readonly fieldId: string;

  constructor(
    code: ReadinessValidationErrorCode,
    fieldId: string,
  ) {
    super(
      code === 'invalid-required-field'
        ? '必填字段标识不能为空。'
        : `未找到必填字段“${fieldId}”的规范定义。`,
    );
    this.name = 'ReadinessValidationError';
    this.code = code;
    this.fieldId = fieldId;
  }
}

function normalizeRequiredFieldIds(requiredFieldIds: readonly string[]): string[] {
  const uniqueFieldIds: string[] = [];
  const seen = new Set<string>();

  for (const originalFieldId of requiredFieldIds) {
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

function hasCanonicalValue(item: EvidenceSummary): boolean {
  return (
    findTargetFieldDefinition(item.fieldId) !== undefined &&
    item.normalizedValue.normalize('NFC').trim().length > 0
  );
}

export function calculateReadiness(
  requiredFieldIds: readonly string[],
  evidence: readonly EvidenceSummary[],
): Readiness {
  const required = normalizeRequiredFieldIds(requiredFieldIds);
  const requiredSet = new Set(required);
  const presentSet = new Set<string>();
  const unresolvedGroups = new Set<string>();

  for (const item of evidence) {
    if (requiredSet.has(item.fieldId) && hasCanonicalValue(item)) {
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
