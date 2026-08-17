import type { BridgeCapabilityReport, ShadowOrder } from './live-trading-types';

export const REQUIRED_SHADOW_SCENARIOS = [
  'core_buy',
  'expiry_or_cancel',
  'ordinary_sell',
  'hard_stop',
  't_plus_one_block',
  't_sell',
  't_buyback',
  'partial_fill',
  'duplicate_rejection',
  'bridge_restart_recovery',
] as const;

export type ShadowScenario = typeof REQUIRED_SHADOW_SCENARIOS[number];

export interface ShadowEvidenceSnapshot {
  scenario: ShadowScenario;
  candidateSnapshot: Record<string, unknown>;
  riskSnapshot: Record<string, unknown>;
  feeSnapshot: Record<string, unknown>;
}

export type ShadowQualificationOrder = ShadowOrder & {
  evidence?: ShadowEvidenceSnapshot;
};

export interface ShadowQualificationReport {
  passed: boolean;
  validOrders: number;
  requiredOrders: 20;
  blockingFailures: number;
  probeReady: boolean;
  scenarioCoverage: Record<ShadowScenario, number>;
  missingScenarios: ShadowScenario[];
  reasons: string[];
}

const terminalStatuses = new Set(['filled', 'cancelled', 'expired']);
const blockingFailureKinds = new Set([
  'wrong_code',
  'wrong_side',
  'wrong_quantity',
  'duplicate_execution',
  'live_submission_detected',
]);

function hasFrozenEvidence(order: ShadowQualificationOrder): boolean {
  const evidence = order.evidence;
  return Boolean(
    evidence
    && evidence.candidateSnapshot
    && Object.keys(evidence.candidateSnapshot).length > 0
    && evidence.riskSnapshot
    && Object.keys(evidence.riskSnapshot).length > 0
    && evidence.feeSnapshot
    && Object.keys(evidence.feeSnapshot).length > 0,
  );
}

function currentProbe(
  probe: BridgeCapabilityReport | null,
  now: number,
): boolean {
  if (!probe?.safeForShadow || probe.safeForLive || probe.unknownDialogs.length > 0) return false;
  const probedAt = Date.parse(probe.probedAt);
  return Number.isFinite(probedAt) && now >= probedAt && now - probedAt <= 24 * 60 * 60 * 1_000;
}

export function evaluateShadowQualification(
  orders: readonly ShadowQualificationOrder[],
  probe: BridgeCapabilityReport | null,
  now: number = Date.now(),
): ShadowQualificationReport {
  const valid = orders.filter(order => terminalStatuses.has(order.status) && !order.failureKind && hasFrozenEvidence(order));
  const scenarioCoverage = Object.fromEntries(
    REQUIRED_SHADOW_SCENARIOS.map(scenario => [
      scenario,
      valid.filter(order => order.evidence?.scenario === scenario).length,
    ]),
  ) as Record<ShadowScenario, number>;
  const missingScenarios = REQUIRED_SHADOW_SCENARIOS.filter(scenario => scenarioCoverage[scenario] === 0);
  const blockingFailures = orders.filter(order => (
    order.failureKind !== null && blockingFailureKinds.has(order.failureKind)
  )).length;
  const probeReady = currentProbe(probe, now);
  const reasons: string[] = [];
  if (valid.length < 20) reasons.push(`shadow_orders_${valid.length}_of_20`);
  if (blockingFailures > 0) reasons.push(`blocking_failures_${blockingFailures}`);
  if (missingScenarios.length > 0) reasons.push(`missing_scenarios_${missingScenarios.join(',')}`);
  if (!probeReady) reasons.push('current_read_only_probe_required');
  return {
    passed: valid.length >= 20 && blockingFailures === 0 && missingScenarios.length === 0 && probeReady,
    validOrders: valid.length,
    requiredOrders: 20,
    blockingFailures,
    probeReady,
    scenarioCoverage,
    missingScenarios,
    reasons,
  };
}
