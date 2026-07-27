import { describe, expect, it } from 'vitest';

import { AnalysisDecimal } from '../../domain/analysis/decimal';
import type { DatedCashFlow, XirrCalculation } from './equity-types';
import { calculateXirr } from './calculate-xirr';

function expectRate(
  cashFlows: readonly DatedCashFlow[],
  expected: string,
  tolerance = '1e-18',
): XirrCalculation & { readonly status: 'ok' } {
  const result = calculateXirr(cashFlows);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error('Expected XIRR to converge.');
  expect(new AnalysisDecimal(result.value).minus(expected).abs().lessThanOrEqualTo(tolerance)).toBe(true);
  expect(result.iterations).toBeLessThanOrEqual(512);
  return result;
}

describe('calculateXirr', () => {
  it('returns exactly 100% for a one-year doubling', () => {
    const result = expectRate([
      { date: '2025-01-01', amount: '-100' },
      { date: '2026-01-01', amount: '200' },
    ], '1');

    expect(result.value).toBe('1');
  });

  it('uses Actual/365 across a leap-year interval', () => {
    expectRate([
      { date: '2024-01-01', amount: '-100' },
      { date: '2025-01-01', amount: '110' },
    ], '0.099713585934141241287045322671875459053');
  });

  it('includes multiple negative investments before one positive exit', () => {
    expectRate([
      { date: '2025-01-01', amount: '-100' },
      { date: '2025-07-02', amount: '-50' },
      { date: '2026-01-01', amount: '180' },
    ], '0.2424973754537886954414439936316501949');
  });

  it('expands the bracket to find an IRR above 100%', () => {
    expectRate([
      { date: '2025-01-01', amount: '-100' },
      { date: '2026-01-01', amount: '400' },
    ], '3');
  });

  it('finds a valid negative IRR', () => {
    expectRate([
      { date: '2025-01-01', amount: '-100' },
      { date: '2026-01-01', amount: '50' },
    ], '-0.5');
  });

  it('returns root_not_found when cash flows have no sign change', () => {
    expect(calculateXirr([
      { date: '2025-01-01', amount: '-100' },
      { date: '2026-01-01', amount: '-50' },
    ])).toEqual({ status: 'blocked', issue: 'root_not_found' });
  });

  it('returns root_not_found when cash flows have more than one sign change', () => {
    expect(calculateXirr([
      { date: '2025-01-01', amount: '-100' },
      { date: '2025-06-01', amount: '20' },
      { date: '2026-01-01', amount: '-10' },
      { date: '2027-01-01', amount: '150' },
    ])).toEqual({ status: 'blocked', issue: 'root_not_found' });
  });

  it('returns root_not_found when the only root is above the maximum bracket', () => {
    expect(calculateXirr([
      { date: '2025-01-01', amount: '-1' },
      { date: '2026-01-01', amount: '1002' },
    ])).toEqual({ status: 'blocked', issue: 'root_not_found' });
  });

  it('returns root_not_found when cash flows are not chronological', () => {
    expect(calculateXirr([
      { date: '2026-01-01', amount: '-100' },
      { date: '2025-01-01', amount: '150' },
    ])).toEqual({ status: 'blocked', issue: 'root_not_found' });
  });

  it('converges deterministically for fractional Actual/365 periods', () => {
    const cashFlows: readonly DatedCashFlow[] = [
      { date: '2025-01-17', amount: '-73.25' },
      { date: '2025-08-09', amount: '-26.75' },
      { date: '2027-03-04', amount: '163.4' },
    ];

    const first = calculateXirr(cashFlows);
    const second = calculateXirr(cashFlows);

    expect(first).toEqual(second);
    expect(first.status).toBe('ok');
    if (first.status === 'ok') {
      expect(first.iterations).toBeGreaterThan(0);
      expect(first.iterations).toBeLessThanOrEqual(512);
    }
  });
});
