import type Decimal from 'decimal.js';

import type {
  EquityCalculationTrace,
  TraceStep,
} from '../../domain/analysis/calculation-trace';
import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
import { blockedResult, okResult } from '../../domain/analysis/engine-result';
import { compareUnicodeCodePoints } from './compare-equity-strings';
import { validateWaterfallInput } from './validate-equity-input';
import type {
  CapTablePosition,
  ConversionDecision,
  EquityEngineResult,
  LiquidationWaterfall,
  WaterfallAllocation,
} from './equity-types';

interface MutableAllocation {
  readonly position: CapTablePosition;
  readonly converted: boolean;
  readonly preferenceClaim: Decimal;
  preferenceProceeds: Decimal;
  participationProceeds: Decimal;
}

interface EvaluatedWaterfall {
  readonly decisions: readonly boolean[];
  readonly allocations: readonly MutableAllocation[];
  readonly totalAllocated: Decimal;
  readonly remainingValue: Decimal;
}

interface CandidateSummary {
  readonly decisions: readonly boolean[];
  readonly payouts: readonly Decimal[];
  readonly totalAllocated: Decimal;
  readonly remainingValue: Decimal;
}

function trace(
  inputs: EquityCalculationTrace['inputs'],
  steps: readonly TraceStep[],
): EquityCalculationTrace {
  return {
    engine: 'equity',
    equityRef: 'liquidation-waterfall@1',
    inputs,
    steps,
  };
}

function preferenceClaim(position: CapTablePosition): Decimal {
  const preference = position.liquidationPreference;
  return preference === undefined
    ? new AnalysisDecimal(0)
    : new AnalysisDecimal(position.investedCapital).times(preference.multiple);
}

function vectorKey(decisions: readonly boolean[]): string {
  return decisions.map((converted) => converted ? '1' : '0').join('');
}

function decisionsForMask(mask: number, size: number): readonly boolean[] {
  return Array.from({ length: size }, (_, index) =>
    (mask & (1 << (size - index - 1))) !== 0
  );
}

function allocateProRata(
  amount: Decimal,
  allocations: readonly MutableAllocation[],
  apply: (allocation: MutableAllocation, proceeds: Decimal) => void,
): void {
  if (!amount.greaterThan(0) || allocations.length === 0) return;
  const totalWeight = allocations.reduce(
    (sum, allocation) => sum.plus(allocation.position.shares),
    new AnalysisDecimal(0),
  );
  if (!totalWeight.greaterThan(0)) return;

  let assigned = new AnalysisDecimal(0);
  allocations.forEach((allocation, index) => {
    const proceeds = index === allocations.length - 1
      ? amount.minus(assigned)
      : amount.times(allocation.position.shares).dividedBy(totalWeight);
    assigned = assigned.plus(proceeds);
    apply(allocation, proceeds);
  });
}

function allocatePreferences(
  allocations: readonly MutableAllocation[],
  exitValue: Decimal,
): Decimal {
  let remaining = exitValue;
  const allocationsByRank = new Map<number, MutableAllocation[]>();
  for (const allocation of allocations) {
    if (allocation.converted || !allocation.preferenceClaim.greaterThan(0)) continue;
    const rank = allocation.position.liquidationPreference!.seniorityRank;
    const sameRank = allocationsByRank.get(rank);
    if (sameRank === undefined) {
      allocationsByRank.set(rank, [allocation]);
    } else {
      sameRank.push(allocation);
    }
  }
  const rankedAllocations = [...allocationsByRank.entries()]
    .sort(([leftRank], [rightRank]) => leftRank - rightRank);

  for (const [, sameRank] of rankedAllocations) {
    if (!remaining.greaterThan(0)) break;
    const claims = sameRank.reduce(
      (sum, allocation) => sum.plus(allocation.preferenceClaim),
      new AnalysisDecimal(0),
    );
    const distributable = AnalysisDecimal.min(remaining, claims);

    let assigned = new AnalysisDecimal(0);
    sameRank.forEach((allocation, index) => {
      const proceeds = index === sameRank.length - 1
        ? distributable.minus(assigned)
        : distributable.times(allocation.preferenceClaim).dividedBy(claims);
      allocation.preferenceProceeds = proceeds;
      assigned = assigned.plus(proceeds);
    });
    remaining = remaining.minus(distributable);
  }

  return remaining;
}

function participationCapacity(
  allocation: MutableAllocation,
): Decimal | undefined {
  const preference = allocation.position.liquidationPreference;
  if (
    preference?.participation !== 'participating' ||
    preference.capMultiple === undefined
  ) {
    return undefined;
  }
  const totalCap = new AnalysisDecimal(allocation.position.investedCapital)
    .times(preference.capMultiple);
  return AnalysisDecimal.max(totalCap.minus(allocation.preferenceProceeds), 0);
}

function allocateParticipation(
  allocations: readonly MutableAllocation[],
  residual: Decimal,
): Decimal {
  let remaining = residual;
  let eligible = allocations.filter((allocation) => {
    if (!new AnalysisDecimal(allocation.position.shares).greaterThan(0)) return false;
    if (allocation.position.securityType !== 'preferred') return true;
    const preference = allocation.position.liquidationPreference!;
    return preference.participation === 'participating' || allocation.converted;
  });

  while (remaining.greaterThan(0) && eligible.length > 0) {
    const totalShares = eligible.reduce(
      (sum, allocation) => sum.plus(allocation.position.shares),
      new AnalysisDecimal(0),
    );
    if (!totalShares.greaterThan(0)) break;

    const newlyCapped = eligible.filter((allocation) => {
      const capacity = participationCapacity(allocation);
      if (capacity === undefined) return false;
      const remainingCapacity = AnalysisDecimal.max(
        capacity.minus(allocation.participationProceeds),
        0,
      );
      const proRata = remaining
        .times(allocation.position.shares)
        .dividedBy(totalShares);
      return proRata.greaterThanOrEqualTo(remainingCapacity);
    });

    if (newlyCapped.length === 0) {
      allocateProRata(remaining, eligible, (allocation, proceeds) => {
        allocation.participationProceeds = allocation.participationProceeds.plus(proceeds);
      });
      return new AnalysisDecimal(0);
    }

    for (const allocation of newlyCapped) {
      const capacity = participationCapacity(allocation)!;
      const proceeds = AnalysisDecimal.max(
        capacity.minus(allocation.participationProceeds),
        0,
      );
      allocation.participationProceeds = allocation.participationProceeds.plus(proceeds);
      remaining = remaining.minus(proceeds);
    }
    const capped = new Set(newlyCapped.map(({ position }) => position.securityId));
    eligible = eligible.filter(({ position }) => !capped.has(position.securityId));
  }

  return remaining;
}

function evaluateVector(
  positions: readonly CapTablePosition[],
  nonParticipatingIds: readonly string[],
  decisions: readonly boolean[],
  exitValue: Decimal,
): EvaluatedWaterfall {
  const decisionById = new Map(
    nonParticipatingIds.map((securityId, index) => [securityId, decisions[index]!] as const),
  );
  const allocations = positions.map((position): MutableAllocation => ({
    position,
    converted: decisionById.get(position.securityId) ?? false,
    preferenceClaim: preferenceClaim(position),
    preferenceProceeds: new AnalysisDecimal(0),
    participationProceeds: new AnalysisDecimal(0),
  }));
  let remaining = allocatePreferences(allocations, exitValue);
  remaining = allocateParticipation(allocations, remaining);
  const totalAllocated = allocations.reduce(
    (sum, allocation) => sum
      .plus(allocation.preferenceProceeds)
      .plus(allocation.participationProceeds),
    new AnalysisDecimal(0),
  );
  return { decisions, allocations, totalAllocated, remainingValue: remaining };
}

function summarizeCandidate(
  waterfall: EvaluatedWaterfall,
  nonParticipatingIds: readonly string[],
): CandidateSummary {
  const payoutsById = new Map<string, Decimal>();
  for (const allocation of waterfall.allocations) {
    if (allocation.position.securityType === 'preferred') {
      payoutsById.set(
        allocation.position.securityId,
        allocation.preferenceProceeds.plus(allocation.participationProceeds),
      );
    }
  }
  return {
    decisions: waterfall.decisions,
    payouts: nonParticipatingIds.map((securityId) => payoutsById.get(securityId)!),
    totalAllocated: waterfall.totalAllocated,
    remainingValue: waterfall.remainingValue,
  };
}

function isSelfConsistent(
  candidate: CandidateSummary,
  candidates: ReadonlyMap<string, CandidateSummary>,
): boolean {
  return candidate.decisions.every((_, index) => {
    const flipped = [...candidate.decisions];
    flipped[index] = !flipped[index];
    return candidate.payouts[index]!.greaterThanOrEqualTo(
      candidates.get(vectorKey(flipped))!.payouts[index]!,
    );
  });
}

function isConserved(
  candidate: Pick<EvaluatedWaterfall, 'totalAllocated' | 'remainingValue'>,
  exitValue: Decimal,
): boolean {
  return !candidate.remainingValue.isNegative() &&
    candidate.totalAllocated.plus(candidate.remainingValue).equals(exitValue) &&
    candidate.remainingValue.equals(0);
}

function outputAllocations(
  candidate: EvaluatedWaterfall,
): readonly WaterfallAllocation[] {
  return candidate.allocations.map((allocation) => ({
    securityId: allocation.position.securityId,
    holderId: allocation.position.holderId,
    converted: allocation.converted,
    preferenceClaim: canonicalDecimal(allocation.preferenceClaim),
    preferenceProceeds: canonicalDecimal(allocation.preferenceProceeds),
    participationProceeds: canonicalDecimal(allocation.participationProceeds),
    totalProceeds: canonicalDecimal(
      allocation.preferenceProceeds.plus(allocation.participationProceeds),
    ),
  }));
}

export function calculateLiquidationWaterfall(
  input: unknown,
): EquityEngineResult<LiquidationWaterfall> {
  const validation = validateWaterfallInput(input);
  if (validation.status === 'blocked') {
    return blockedResult(
      validation.reason,
      validation.issues,
      trace(validation.traceInputs, []),
    );
  }

  const normalized = validation.input;
  const positions = [...normalized.positions]
    .sort((a, b) => compareUnicodeCodePoints(a.securityId, b.securityId));
  const nonParticipatingIds = positions
    .filter((position) =>
      position.liquidationPreference?.participation === 'non-participating'
    )
    .map(({ securityId }) => securityId);
  const exitValue = new AnalysisDecimal(normalized.exitValue);
  const candidates = new Map<string, CandidateSummary>();

  const candidateCount = 2 ** nonParticipatingIds.length;
  if (exitValue.isZero()) {
    const zero = new AnalysisDecimal(0);
    const zeroPayouts = nonParticipatingIds.map(() => zero);
    for (let mask = 0; mask < candidateCount; mask += 1) {
      const decisions = decisionsForMask(mask, nonParticipatingIds.length);
      candidates.set(vectorKey(decisions), {
        decisions,
        payouts: zeroPayouts,
        totalAllocated: zero,
        remainingValue: zero,
      });
    }
  } else {
    for (let mask = 0; mask < candidateCount; mask += 1) {
      const decisions = decisionsForMask(mask, nonParticipatingIds.length);
      const evaluated = evaluateVector(
        positions,
        nonParticipatingIds,
        decisions,
        exitValue,
      );
      candidates.set(
        vectorKey(decisions),
        summarizeCandidate(evaluated, nonParticipatingIds),
      );
    }
  }

  const equilibria = [...candidates.values()].filter((candidate) =>
    isSelfConsistent(candidate, candidates)
  );
  const selectedSummary = equilibria.find((candidate) =>
    isConserved(candidate, exitValue)
  );
  if (selectedSummary === undefined) {
    const allocationIssue = equilibria.length > 0;
    return blockedResult('invalid-input', [{
      code: allocationIssue ? 'allocation_mismatch' : 'invalid_conversion_equilibrium',
      path: 'positions',
      message: allocationIssue
        ? 'No self-consistent conversion vector conserves the exit value.'
        : 'No self-consistent non-participating conversion vector exists.',
      details: { classes: nonParticipatingIds.length },
    }], trace(validation.traceInputs, []));
  }

  const selected = evaluateVector(
    positions,
    nonParticipatingIds,
    selectedSummary.decisions,
    exitValue,
  );
  if (!isConserved(selected, exitValue)) {
    return blockedResult('invalid-input', [{
      code: 'allocation_mismatch',
      path: 'positions',
      message: 'Selected conversion equilibrium does not conserve the exit value.',
      details: { classes: nonParticipatingIds.length },
    }], trace(validation.traceInputs, []));
  }

  const conversionDecisions: readonly ConversionDecision[] = nonParticipatingIds.map(
    (securityId, index) => ({
      securityId,
      converted: selected.decisions[index]!,
    }),
  );
  const allocations = outputAllocations(selected);
  const steps: readonly TraceStep[] = [
    ...allocations.map((allocation): TraceStep => ({
      id: `liquidation:${allocation.securityId}:allocate`,
      operator: 'liquidation-waterfall',
      operands: [
        allocation.preferenceClaim,
        allocation.preferenceProceeds,
        allocation.participationProceeds,
      ],
      result: allocation.totalProceeds,
      rule: allocation.converted ? 'as-converted' : 'preference-and-participation',
      outcome: 'passed',
    })),
    {
      id: 'liquidation:conversion-equilibrium',
      operator: 'enumerate-conversion-vectors',
      operands: [String(candidates.size), ...selected.decisions.map(String)],
      result: canonicalDecimal(selected.totalAllocated),
      rule: 'single-security-flip-self-consistency',
      outcome: 'passed',
    },
  ];

  return okResult({
    version: normalized.version,
    currency: normalized.currency,
    exitDate: normalized.exitDate,
    exitValue: normalized.exitValue,
    conversionDecisions,
    allocations,
    totalAllocated: canonicalDecimal(selected.totalAllocated),
    remainingValue: canonicalDecimal(selected.remainingValue),
  }, validation.warnings, trace(validation.traceInputs, steps));
}
