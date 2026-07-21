import Decimal from 'decimal.js';
import type { MetricDirection } from '../metrics/metric-definition';
import type { ConflictResolution, EvidenceItem } from './evidence';

export function resolveEvidenceConflict(
  items: readonly EvidenceItem[],
  direction: MetricDirection,
): ConflictResolution {
  if (items.length === 0) {
    return {
      analysisValue: null,
      selectedEvidenceId: null,
      requiresConfirmation: false,
      blocksConclusion: true,
    };
  }

  if (items.length === 1) {
    return {
      analysisValue: items[0].normalizedValue,
      selectedEvidenceId: items[0].id,
      requiresConfirmation: false,
      blocksConclusion: false,
    };
  }

  if (direction === 'neutral') {
    return {
      analysisValue: null,
      selectedEvidenceId: null,
      requiresConfirmation: true,
      blocksConclusion: true,
    };
  }

  const ordered = [...items].sort((left, right) =>
    new Decimal(left.normalizedValue).comparedTo(right.normalizedValue),
  );
  const selected =
    direction === 'higher_is_better' ? ordered[0] : ordered[ordered.length - 1];

  return {
    analysisValue: selected.normalizedValue,
    selectedEvidenceId: selected.id,
    requiresConfirmation: true,
    blocksConclusion: false,
  };
}
