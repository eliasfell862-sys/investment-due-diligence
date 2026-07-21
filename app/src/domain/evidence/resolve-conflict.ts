import Decimal from 'decimal.js';
import type { MetricDirection } from '../metrics/metric-definition';
import type { ConflictResolution, EvidenceConflictCandidate } from './evidence';

interface ParsedCandidate {
  readonly candidate: EvidenceConflictCandidate;
  readonly value: Decimal;
  readonly canonicalValue: string;
}

const invalidResolution = (): ConflictResolution => ({
  status: 'invalid',
  analysisValue: null,
  selectedEvidenceId: null,
  requiresConfirmation: true,
  blocksConclusion: true,
});

const lowestId = (items: readonly EvidenceConflictCandidate[]) =>
  items.reduce((selected, item) => (item.id < selected.id ? item : selected));

export function resolveEvidenceConflict(
  items: readonly EvidenceConflictCandidate[],
  direction: MetricDirection,
): ConflictResolution {
  if (items.length === 0) {
    return {
      status: 'missing',
      analysisValue: null,
      selectedEvidenceId: null,
      requiresConfirmation: false,
      blocksConclusion: true,
    };
  }

  const first = items[0];
  const hasInvalidIdentity = items.some(
    (item) =>
      item.id.trim().length === 0 ||
      item.projectId.trim().length === 0 ||
      item.fieldId.trim().length === 0 ||
      item.normalizedValue.trim().length === 0,
  );
  const hasMixedGroup = items.some(
    (item) => item.projectId !== first.projectId || item.fieldId !== first.fieldId,
  );

  if (hasInvalidIdentity || hasMixedGroup) {
    return invalidResolution();
  }

  // Confidence and conflictStatus are intentionally upstream concerns and never
  // override conservative selection in this domain resolver.
  if (direction === 'neutral') {
    const allAgreed = items.every(
      (item) => item.normalizedValue === first.normalizedValue,
    );

    if (!allAgreed) {
      return {
        status: 'blocked',
        analysisValue: null,
        selectedEvidenceId: null,
        requiresConfirmation: true,
        blocksConclusion: true,
      };
    }

    const selected = lowestId(items);
    return {
      status: 'agreed',
      analysisValue: first.normalizedValue,
      selectedEvidenceId: selected.id,
      requiresConfirmation: false,
      blocksConclusion: false,
    };
  }

  const parsed: ParsedCandidate[] = [];
  for (const candidate of items) {
    let value: Decimal;
    try {
      value = new Decimal(candidate.normalizedValue);
    } catch {
      return invalidResolution();
    }

    if (!value.isFinite()) {
      return invalidResolution();
    }

    parsed.push({ candidate, value, canonicalValue: value.toString() });
  }

  const firstParsed = parsed[0];
  const allAgreed = parsed.every(
    (entry) => entry.canonicalValue === firstParsed.canonicalValue,
  );

  if (allAgreed) {
    const selected = lowestId(parsed.map((entry) => entry.candidate));
    return {
      status: 'agreed',
      analysisValue: firstParsed.canonicalValue,
      selectedEvidenceId: selected.id,
      requiresConfirmation: false,
      blocksConclusion: false,
    };
  }

  let selectedValue = firstParsed.value;
  for (const entry of parsed.slice(1)) {
    const comparison = entry.value.comparedTo(selectedValue);
    const isMoreConservative =
      direction === 'higher_is_better' ? comparison < 0 : comparison > 0;
    if (isMoreConservative) {
      selectedValue = entry.value;
    }
  }

  const selectedCanonicalValue = selectedValue.toString();
  const selected = lowestId(
    parsed
      .filter((entry) => entry.canonicalValue === selectedCanonicalValue)
      .map((entry) => entry.candidate),
  );

  return {
    status: 'provisional',
    analysisValue: selectedCanonicalValue,
    selectedEvidenceId: selected.id,
    requiresConfirmation: true,
    blocksConclusion: false,
  };
}
