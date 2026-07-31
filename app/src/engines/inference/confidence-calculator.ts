/**
 * Confidence Calculator
 *
 * Confidence = evidence_coverage × data_quality × pack_fit × inference_stability × historical_calibration
 *
 * Each factor is 0-1. Final confidence is the geometric mean.
 * Confidence is NEVER declared by the LLM — it is always computed.
 */

import type { ConfidenceBand, ConfirmedFact, InferenceNode } from '../../domain/inference/types';

// ── Factor Calculations ──

/** How many required metrics have confirmed facts? */
export function calcEvidenceCoverage(
  nodes: readonly InferenceNode[],
  confirmedFacts: readonly ConfirmedFact[],
  requiredMetricIds: readonly string[],
): number {
  if (requiredMetricIds.length === 0) return 0.5; // neutral if no requirements
  const confirmedMetrics = new Set(confirmedFacts.map(f => f.metricId));
  let covered = 0;
  for (const metricId of requiredMetricIds) {
    if (confirmedMetrics.has(metricId)) covered++;
    // Also check if any node provides this metric
    const hasNode = nodes.some(n => n.metricId === metricId && n.confidence !== 'blocked');
    if (hasNode) covered += 0.5; // inferred but not confirmed
  }
  return Math.min(1, covered / requiredMetricIds.length);
}

/** Data quality: confirmed facts score higher than candidates */
export function calcDataQuality(
  confirmedFacts: readonly ConfirmedFact[],
  candidateCount: number,
): number {
  const confirmed = confirmedFacts.length;
  if (confirmed + candidateCount === 0) return 0.2; // no data at all
  // Confirmed facts weight 3x more than candidates
  return Math.min(1, (confirmed * 3 + candidateCount) / Math.max(1, (confirmed + candidateCount) * 2));
}

/** Industry pack match quality */
export function calcPackFit(matchScore: string): number {
  return parseFloat(matchScore) || 0.5;
}

/** How stable are the inferences? Check ratio of blocked/uncertain nodes */
export function calcInferenceStability(nodes: readonly InferenceNode[]): number {
  if (nodes.length === 0) return 0.5;
  let unstable = 0;
  for (const n of nodes) {
    if (n.confidence === 'blocked') unstable += 1;
    else if (n.confidence === 'low') unstable += 0.5;
  }
  return Math.max(0.1, 1 - unstable / nodes.length);
}

/** Placeholder for historical calibration (future: compare past inferences to actual outcomes) */
export function calcHistoricalCalibration(): number {
  return 0.8; // neutral until we have a track record
}

// ── Aggregate ──

export function calculateConfidence(
  evidenceCoverage: number,
  dataQuality: number,
  packFit: number,
  inferenceStability: number,
  historicalCalibration: number,
): number {
  // Geometric mean — any zero factor kills confidence
  const factors = [evidenceCoverage, dataQuality, packFit, inferenceStability, historicalCalibration];
  const product = factors.reduce((p, f) => p * Math.max(0.01, f), 1);
  return Math.pow(product, 1 / factors.length);
}

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= 0.75) return 'high';
  if (score >= 0.5) return 'medium';
  if (score >= 0.25) return 'low';
  return 'blocked';
}

export function calcOverallConfidence(
  nodes: readonly InferenceNode[],
  confirmedFacts: readonly ConfirmedFact[],
  candidateCount: number,
  requiredMetricIds: readonly string[],
  packMatchScore: string,
): { score: number; band: ConfidenceBand; factors: Record<string, number> } {
  const evidenceCoverage = calcEvidenceCoverage(nodes, confirmedFacts, requiredMetricIds);
  const dataQuality = calcDataQuality(confirmedFacts, candidateCount);
  const packFit = calcPackFit(packMatchScore);
  const inferenceStability = calcInferenceStability(nodes);
  const historicalCalibration = calcHistoricalCalibration();

  const score = calculateConfidence(evidenceCoverage, dataQuality, packFit, inferenceStability, historicalCalibration);

  return {
    score: Math.round(score * 10000) / 10000,
    band: confidenceBand(score),
    factors: { evidenceCoverage, dataQuality, packFit, inferenceStability, historicalCalibration },
  };
}

// ── Stability ──

export function calcStability(
  nodes: readonly InferenceNode[],
  sensitivityThreshold: number,
): 'stable' | 'sensitive' | 'unstable' {
  const criticalNodes = nodes.filter(n =>
    n.kind === 'judgment' ||
    n.confidence === 'blocked' ||
    (n.dependencyNodeIds.length > 5)
  );

  if (criticalNodes.length === 0) return 'stable';

  const blockedRatio = criticalNodes.filter(n => n.confidence === 'blocked').length / criticalNodes.length;
  const lowRatio = criticalNodes.filter(n => n.confidence === 'low').length / criticalNodes.length;

  if (blockedRatio > sensitivityThreshold) return 'unstable';
  if (lowRatio + blockedRatio > sensitivityThreshold * 1.5) return 'sensitive';
  return 'stable';
}
