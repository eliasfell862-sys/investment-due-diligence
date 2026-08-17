import { describe, expect, it } from 'vitest';
import type { BridgeCapabilityReport, ShadowOrder } from './live-trading-types';
import {
  evaluateShadowQualification,
  REQUIRED_SHADOW_SCENARIOS,
  type ShadowQualificationOrder,
} from './shadow-qualification';

function probe(overrides: Partial<BridgeCapabilityReport> = {}): BridgeCapabilityReport {
  return {
    processDetected: true, executablePathHash: 'hash', productVersion: '1', windowDetected: true,
    loginStateReadable: true, fundsViewReadable: true, positionsViewReadable: true,
    ordersViewReadable: true, cancelControlReadable: true, unknownDialogs: [], evidence: [],
    safeForShadow: true, safeForLive: false, probedAt: '2026-08-17T02:00:00.000Z', ...overrides,
  };
}

function order(index: number, overrides: Partial<ShadowQualificationOrder> = {}): ShadowQualificationOrder {
  const scenario = REQUIRED_SHADOW_SCENARIOS[index % REQUIRED_SHADOW_SCENARIOS.length];
  const base: ShadowOrder = {
    id: `o${index}`, idempotencyKey: `key-${index}`, kind: 'core_buy', code: '000333', name: 'Midea',
    side: 'buy', limitPrice: 10, shares: 100, stopPrice: 9.5,
    createdAt: '2026-08-17T01:00:00.000Z', expiresAt: '2026-08-17T01:00:30.000Z',
    requiresUserConfirmation: false, feeProfile: {} as ShadowOrder['feeProfile'], reasons: [],
    status: 'filled', submittedAt: '2026-08-17T01:00:01.000Z', filledShares: 100,
    averageFillPrice: 10, brokerOrderId: null, failureKind: null,
  };
  return {
    ...base,
    evidence: {
      scenario,
      candidateSnapshot: { code: '000333', price: 10 },
      riskSnapshot: { allowed: true, shares: 100 },
      feeSnapshot: { entryFees: 5, exitFees: 5.5 },
    },
    ...overrides,
  };
}

function validOrders(count: number): ShadowQualificationOrder[] {
  return Array.from({ length: count }, (_, index) => order(index));
}

describe('shadow qualification', () => {
  it('does not pass with nineteen valid orders', () => {
    expect(evaluateShadowQualification(validOrders(19), probe(), Date.parse('2026-08-17T03:00:00Z')).passed)
      .toBe(false);
  });

  it('passes twenty terminal evidence-complete orders covering every required scenario', () => {
    const report = evaluateShadowQualification(validOrders(20), probe(), Date.parse('2026-08-17T03:00:00Z'));
    expect(report).toMatchObject({ passed: true, validOrders: 20, blockingFailures: 0 });
    expect(report.missingScenarios).toEqual([]);
  });

  it('fails the run when a wrong-code or duplicate-execution incident exists', () => {
    const orders = [...validOrders(20), order(21, { failureKind: 'wrong_code', status: 'rejected' })];
    expect(evaluateShadowQualification(orders, probe(), Date.parse('2026-08-17T03:00:00Z')))
      .toMatchObject({ passed: false, blockingFailures: 1 });
  });

  it('does not count terminal orders without frozen candidate, risk, and fee evidence', () => {
    const orders = validOrders(20);
    orders[0] = { ...orders[0], evidence: undefined };
    expect(evaluateShadowQualification(orders, probe(), Date.parse('2026-08-17T03:00:00Z')).validOrders)
      .toBe(19);
  });

  it('requires a current successful read-only probe', () => {
    const stale = probe({ probedAt: '2026-08-15T01:00:00.000Z' });
    expect(evaluateShadowQualification(validOrders(20), stale, Date.parse('2026-08-17T03:00:00Z')))
      .toMatchObject({ passed: false, probeReady: false });
  });
});
