import type Decimal from 'decimal.js';

import type {
  EquityCalculationTrace,
  TraceStep,
} from '../../domain/analysis/calculation-trace';
import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
import { blockedResult, okResult } from '../../domain/analysis/engine-result';
import { validateCapTableInput } from './validate-equity-input';
import type {
  CapTableModel,
  CapTablePosition,
  CapTableSnapshot,
  EquityEngineResult,
  InvestmentLedgerEntry,
  PricedRoundEvent,
  PricedRoundResult,
  SecurityPosition,
} from './equity-types';

function trace(inputs: EquityCalculationTrace['inputs'], steps: readonly TraceStep[]): EquityCalculationTrace {
  return { engine: 'equity', equityRef: 'cap-table@1', inputs, steps };
}

function totalShares(positions: readonly SecurityPosition[]): Decimal {
  return positions.reduce((sum, item) => sum.plus(item.shares), new AnalysisDecimal(0));
}

function snapshot(eventId: string, asOfDate: string, positions: readonly SecurityPosition[]): CapTableSnapshot {
  const ordered = [...positions].sort((a, b) => a.securityId.localeCompare(b.securityId));
  const total = totalShares(ordered);
  let assigned = new AnalysisDecimal(0);
  const output: CapTablePosition[] = ordered.map((item, index) => {
    const ownership = index === ordered.length - 1
      ? new AnalysisDecimal(1).minus(assigned)
      : new AnalysisDecimal(item.shares).dividedBy(total);
    assigned = assigned.plus(ownership);
    return { ...item, ownership: canonicalDecimal(ownership) };
  });
  return {
    eventId,
    asOfDate,
    totalFullyDilutedShares: canonicalDecimal(total),
    positions: output,
  };
}

function addPoolShares(
  positions: SecurityPosition[],
  event: PricedRoundEvent,
  increase: Decimal,
): void {
  if (!increase.greaterThan(0) || event.esopPoolExpansion === undefined) return;
  const pool = event.esopPoolExpansion;
  const index = positions.findIndex(({ securityId }) => securityId === pool.securityId);
  if (index >= 0) {
    const existing = positions[index]!;
    positions[index] = {
      ...existing,
      shares: canonicalDecimal(new AnalysisDecimal(existing.shares).plus(increase)),
    };
  } else {
    positions.push({
      securityId: pool.securityId,
      holderId: pool.holderId,
      securityType: 'esop',
      shares: canonicalDecimal(increase),
      investedCapital: '0',
      acquisitionDate: event.date,
    });
  }
}

function poolIncrease(
  positions: readonly SecurityPosition[],
  event: PricedRoundEvent,
  timing: 'pre-money' | 'post-money',
  sharesAfterInvestor?: Decimal,
): Decimal | undefined {
  const pool = event.esopPoolExpansion;
  if (pool === undefined || pool.timing !== timing) return new AnalysisDecimal(0);
  const existingPool = positions
    .filter(({ securityId }) => securityId === pool.securityId)
    .reduce((sum, item) => sum.plus(item.shares), new AnalysisDecimal(0));
  const target = new AnalysisDecimal(pool.targetOwnership);
  if (timing === 'pre-money') {
    const shares = totalShares(positions);
    const financingRatio = new AnalysisDecimal(event.investmentAmount)
      .dividedBy(event.preMoneyEquityValue);
    const factor = new AnalysisDecimal(1).plus(financingRatio);
    const denominator = new AnalysisDecimal(1).minus(target.times(factor));
    if (!denominator.greaterThan(0)) return undefined;
    return AnalysisDecimal.max(
      target.times(factor).times(shares).minus(existingPool).dividedBy(denominator),
      0,
    );
  }
  const denominator = new AnalysisDecimal(1).minus(target);
  if (!denominator.greaterThan(0) || sharesAfterInvestor === undefined) return undefined;
  return AnalysisDecimal.max(
    target.times(sharesAfterInvestor).minus(existingPool).dividedBy(denominator),
    0,
  );
}

export function modelCapTable(input: unknown): EquityEngineResult<CapTableModel> {
  const validation = validateCapTableInput(input);
  if (validation.status === 'blocked') {
    return blockedResult(validation.reason, validation.issues, trace(validation.traceInputs, []));
  }
  const normalized = validation.input;
  const positions: SecurityPosition[] = normalized.initialPositions.map((item) => ({ ...item }));
  const initialSnapshot = snapshot('initial', normalized.asOfDate, positions);
  const snapshots: CapTableSnapshot[] = [];
  const rounds: PricedRoundResult[] = [];
  const investments: InvestmentLedgerEntry[] = positions
    .filter(({ investedCapital }) => new AnalysisDecimal(investedCapital).greaterThan(0))
    .map((item) => ({
      holderId: item.holderId,
      securityId: item.securityId,
      eventId: `initial:${item.securityId}`,
      date: item.acquisitionDate,
      amount: item.investedCapital,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.securityId.localeCompare(b.securityId));
  const steps: TraceStep[] = [];

  for (const event of normalized.events) {
    if (positions.some(({ securityId }) => securityId === event.securityId)) {
      return blockedResult('invalid-input', [{
        code: 'invalid_equity_event',
        path: `events.${event.eventId}.securityId`,
        message: 'Round security ID already exists.',
        details: { securityId: event.securityId },
      }], trace(validation.traceInputs, steps));
    }
    const preIncrease = poolIncrease(positions, event, 'pre-money');
    if (preIncrease === undefined) {
      return blockedResult('invalid-input', [{
        code: 'invalid_equity_event',
        path: `events.${event.eventId}.esopPoolExpansion`,
        message: 'Pre-money ESOP target creates a non-positive denominator.',
        details: {},
      }], trace(validation.traceInputs, steps));
    }
    addPoolShares(positions, event, preIncrease);
    const prePricingShares = totalShares(positions);
    const pricePerShare = new AnalysisDecimal(event.preMoneyEquityValue)
      .dividedBy(prePricingShares);
    const newInvestorShares = new AnalysisDecimal(event.investmentAmount)
      .dividedBy(pricePerShare);
    positions.push({
      securityId: event.securityId,
      holderId: event.investorHolderId,
      securityType: event.securityType,
      shares: canonicalDecimal(newInvestorShares),
      investedCapital: event.investmentAmount,
      acquisitionDate: event.date,
      ...(event.liquidationPreference === undefined
        ? {}
        : { liquidationPreference: event.liquidationPreference }),
    });
    const sharesAfterInvestor = totalShares(positions);
    const postIncrease = poolIncrease(positions, event, 'post-money', sharesAfterInvestor);
    if (postIncrease === undefined) {
      return blockedResult('invalid-input', [{
        code: 'invalid_equity_event',
        path: `events.${event.eventId}.esopPoolExpansion`,
        message: 'Post-money ESOP target creates a non-positive denominator.',
        details: {},
      }], trace(validation.traceInputs, steps));
    }
    addPoolShares(positions, event, postIncrease);
    const increase = preIncrease.plus(postIncrease);
    rounds.push({
      eventId: event.eventId,
      pricePerShare: canonicalDecimal(pricePerShare),
      newInvestorShares: canonicalDecimal(newInvestorShares),
      esopPoolIncrease: canonicalDecimal(increase),
    });
    investments.push({
      holderId: event.investorHolderId,
      securityId: event.securityId,
      eventId: event.eventId,
      date: event.date,
      amount: event.investmentAmount,
    });
    snapshots.push(snapshot(event.eventId, event.date, positions));
    steps.push({
      id: `cap-table:${event.eventId}:issue-shares`,
      operator: 'priced-round',
      operands: [
        event.preMoneyEquityValue,
        canonicalDecimal(prePricingShares),
        event.investmentAmount,
      ],
      result: canonicalDecimal(newInvestorShares),
      outcome: 'passed',
    });
  }

  const finalSnapshot = snapshots.at(-1) ?? initialSnapshot;
  return okResult({
    version: normalized.version,
    currency: normalized.currency,
    initialSnapshot,
    snapshots,
    finalSnapshot,
    rounds,
    investments: investments.sort((a, b) =>
      a.date.localeCompare(b.date) || a.eventId.localeCompare(b.eventId)
    ),
  }, validation.warnings, trace(validation.traceInputs, steps));
}
