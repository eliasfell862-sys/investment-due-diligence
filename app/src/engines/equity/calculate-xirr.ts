import type Decimal from 'decimal.js';

import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
import type { DatedCashFlow, XirrCalculation } from './equity-types';

const LOWER_BOUND = new AnalysisDecimal('-0.999999999999');
const INITIAL_UPPER_BOUND = new AnalysisDecimal(1);
const MAXIMUM_UPPER_BOUND = new AnalysisDecimal(1000);
const NPV_TOLERANCE = new AnalysisDecimal('1e-20');
const BRACKET_TOLERANCE = new AnalysisDecimal('1e-24');
const MAXIMUM_BISECTIONS = 512;
const MILLISECONDS_PER_DAY = 86_400_000;

interface PreparedCashFlow {
  readonly day: number;
  readonly amount: Decimal;
}

function blocked(): XirrCalculation {
  return { status: 'blocked', issue: 'root_not_found' };
}

function isoDateToDay(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return undefined;
  if (new Date(timestamp).toISOString().slice(0, 10) !== value) return undefined;
  return timestamp / MILLISECONDS_PER_DAY;
}

function prepareCashFlows(
  cashFlows: readonly DatedCashFlow[],
): readonly PreparedCashFlow[] | undefined {
  if (cashFlows.length < 2) return undefined;

  const prepared: PreparedCashFlow[] = [];
  let previousDay: number | undefined;
  let previousSign = 0;
  let signChanges = 0;

  try {
    for (const cashFlow of cashFlows) {
      const day = isoDateToDay(cashFlow.date);
      if (day === undefined || (previousDay !== undefined && day < previousDay)) {
        return undefined;
      }

      const amount = new AnalysisDecimal(cashFlow.amount);
      if (!amount.isFinite()) return undefined;
      const sign = amount.comparedTo(0);
      if (sign !== 0) {
        if (previousSign !== 0 && sign !== previousSign) signChanges += 1;
        previousSign = sign;
      }

      prepared.push({ day, amount });
      previousDay = day;
    }
  } catch {
    return undefined;
  }

  return signChanges === 1 ? prepared : undefined;
}

function npv(
  cashFlows: readonly PreparedCashFlow[],
  firstDay: number,
  rate: Decimal,
): Decimal {
  const base = new AnalysisDecimal(1).plus(rate);
  return cashFlows.reduce((sum, cashFlow) => {
    const years = new AnalysisDecimal(cashFlow.day - firstDay).dividedBy(365);
    return sum.plus(cashFlow.amount.dividedBy(base.pow(years)));
  }, new AnalysisDecimal(0));
}

function isConverged(value: Decimal, scale: Decimal): boolean {
  return value.abs().dividedBy(scale).lessThanOrEqualTo(NPV_TOLERANCE);
}

function result(value: Decimal, iterations: number): XirrCalculation {
  return {
    status: 'ok',
    value: canonicalDecimal(value),
    iterations,
  };
}

export function calculateXirr(
  cashFlows: readonly DatedCashFlow[],
): XirrCalculation {
  const prepared = prepareCashFlows(cashFlows);
  if (prepared === undefined) return blocked();

  const firstDay = prepared[0]!.day;
  const scale = AnalysisDecimal.max(
    prepared.reduce((sum, cashFlow) => sum.plus(cashFlow.amount.abs()), new AnalysisDecimal(0)),
    1,
  );

  let lower = LOWER_BOUND;
  let upper = INITIAL_UPPER_BOUND;
  let lowerNpv = npv(prepared, firstDay, lower);
  let upperNpv = npv(prepared, firstDay, upper);

  if (isConverged(lowerNpv, scale)) return result(lower, 0);
  if (isConverged(upperNpv, scale)) return result(upper, 0);

  while (lowerNpv.isPositive() === upperNpv.isPositive()
    && upper.lessThan(MAXIMUM_UPPER_BOUND)) {
    upper = AnalysisDecimal.min(upper.times(2), MAXIMUM_UPPER_BOUND);
    upperNpv = npv(prepared, firstDay, upper);
    if (isConverged(upperNpv, scale)) return result(upper, 0);
  }

  if (lowerNpv.isPositive() === upperNpv.isPositive()) return blocked();

  for (let iterations = 1; iterations <= MAXIMUM_BISECTIONS; iterations += 1) {
    const midpoint = lower.plus(upper).dividedBy(2);
    const midpointNpv = npv(prepared, firstDay, midpoint);
    if (isConverged(midpointNpv, scale)) return result(midpoint, iterations);

    if (lowerNpv.isPositive() === midpointNpv.isPositive()) {
      lower = midpoint;
      lowerNpv = midpointNpv;
    } else {
      upper = midpoint;
      upperNpv = midpointNpv;
    }

    if (upper.minus(lower).lessThanOrEqualTo(BRACKET_TOLERANCE)) {
      return result(midpoint, iterations);
    }
  }

  return blocked();
}
