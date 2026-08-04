import { PORTFOLIO_RISK_PROFILES, type PortfolioRiskLevel } from './portfolio-candidate-selection';
import type { PairCorrelation } from './portfolio-risk-metrics';

export interface ConstrainedCandidate {
  code: string;
  industry: string | null;
  labels: string[];
  score: number;
  confidence: number;
}

export interface PortfolioConstraintResult {
  weights: Record<string, number>;
  removed: Array<{ code: string; reason: string }>;
  stockWeight: number;
  minimumCash: number;
  constraintCash: number;
  exposures: { industries: Record<string, number>; labels: Record<string, number> };
}

const EPSILON = 1e-12;
const STOCK_CAP = 0.20;
const CLASSIFICATION_CAP = 0.35;
const CORRELATED_PAIR_CAP = 0.25;

function total(values: Iterable<number>): number {
  let result = 0;
  for (const value of values) result += value;
  return result;
}

function exposureFor(
  candidates: ConstrainedCandidate[],
  weights: Map<string, number>,
): { industries: Record<string, number>; labels: Record<string, number> } {
  const industries: Record<string, number> = {};
  const labels: Record<string, number> = {};
  for (const candidate of candidates) {
    const weight = weights.get(candidate.code) ?? 0;
    if (weight <= EPSILON) continue;
    if (candidate.industry) industries[candidate.industry] = (industries[candidate.industry] ?? 0) + weight;
    for (const label of new Set(candidate.labels)) labels[label] = (labels[label] ?? 0) + weight;
  }
  return { industries, labels };
}

function isPairSaturated(code: string, weights: Map<string, number>, pairs: PairCorrelation[]): boolean {
  return pairs.some(pair => pair.correlation !== null && pair.correlation >= 0.8
    && (pair.leftCode === code || pair.rightCode === code)
    && (weights.get(pair.leftCode) ?? 0) + (weights.get(pair.rightCode) ?? 0) >= CORRELATED_PAIR_CAP - EPSILON);
}

function allocate(
  candidates: ConstrainedCandidate[],
  initialWeights: Record<string, number>,
  targetStockWeight: number,
  pairs: PairCorrelation[],
): Map<string, number> {
  const weights = new Map(candidates.map(candidate => [candidate.code, 0]));
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const currentTotal = total(weights.values());
    const remaining = targetStockWeight - currentTotal;
    if (remaining <= EPSILON) break;
    const exposures = exposureFor(candidates, weights);
    const eligible = candidates.filter(candidate => {
      if ((weights.get(candidate.code) ?? 0) >= STOCK_CAP - EPSILON) return false;
      if (candidate.industry && (exposures.industries[candidate.industry] ?? 0) >= CLASSIFICATION_CAP - EPSILON) return false;
      if (candidate.labels.some(label => (exposures.labels[label] ?? 0) >= CLASSIFICATION_CAP - EPSILON)) return false;
      if (isPairSaturated(candidate.code, weights, pairs)) return false;
      return (initialWeights[candidate.code] ?? 0) > 0;
    });
    if (eligible.length === 0) break;

    const baseTotal = total(eligible.map(candidate => initialWeights[candidate.code] ?? 0));
    const proposals = new Map(eligible.map(candidate => [
      candidate.code,
      remaining * (initialWeights[candidate.code] ?? 0) / baseTotal,
    ]));
    let scale = 1;
    for (const candidate of eligible) {
      const proposal = proposals.get(candidate.code) ?? 0;
      if (proposal > 0) scale = Math.min(scale, (STOCK_CAP - (weights.get(candidate.code) ?? 0)) / proposal);
    }

    const industries = new Set(eligible.map(candidate => candidate.industry).filter((value): value is string => Boolean(value)));
    for (const industry of industries) {
      const proposal = total(eligible.filter(item => item.industry === industry).map(item => proposals.get(item.code) ?? 0));
      if (proposal > 0) scale = Math.min(scale, (CLASSIFICATION_CAP - (exposures.industries[industry] ?? 0)) / proposal);
    }
    const labels = new Set(eligible.flatMap(candidate => candidate.labels));
    for (const label of labels) {
      const proposal = total(eligible.filter(item => item.labels.includes(label)).map(item => proposals.get(item.code) ?? 0));
      if (proposal > 0) scale = Math.min(scale, (CLASSIFICATION_CAP - (exposures.labels[label] ?? 0)) / proposal);
    }
    for (const pair of pairs) {
      if (pair.correlation === null || pair.correlation < 0.8) continue;
      const proposal = (proposals.get(pair.leftCode) ?? 0) + (proposals.get(pair.rightCode) ?? 0);
      if (proposal <= 0) continue;
      const current = (weights.get(pair.leftCode) ?? 0) + (weights.get(pair.rightCode) ?? 0);
      scale = Math.min(scale, (CORRELATED_PAIR_CAP - current) / proposal);
    }

    scale = Math.max(0, Math.min(1, scale));
    if (scale <= EPSILON) continue;
    for (const candidate of eligible) {
      weights.set(candidate.code, (weights.get(candidate.code) ?? 0) + (proposals.get(candidate.code) ?? 0) * scale);
    }
  }
  return weights;
}

function lowerRank(left: ConstrainedCandidate, right: ConstrainedCandidate): number {
  return left.score - right.score
    || left.confidence - right.confidence
    || right.code.localeCompare(left.code);
}

export function constrainPortfolioWeights(
  candidates: ConstrainedCandidate[],
  initialWeights: Record<string, number>,
  riskLevel: PortfolioRiskLevel,
  highCorrelationPairs: PairCorrelation[],
): PortfolioConstraintResult {
  const profile = PORTFOLIO_RISK_PROFILES[riskLevel];
  const byCode = new Map(candidates.map(candidate => [candidate.code, candidate]));
  const removed: Array<{ code: string; reason: string }> = [];
  const active = new Set(candidates
    .filter(candidate => Number.isFinite(initialWeights[candidate.code]) && initialWeights[candidate.code] > 0)
    .map(candidate => candidate.code));

  const initialBelowMinimum = candidates
    .filter(candidate => active.has(candidate.code) && initialWeights[candidate.code] < 0.05 - EPSILON)
    .sort(lowerRank);
  for (const candidate of initialBelowMinimum) {
    active.delete(candidate.code);
    removed.push({ code: candidate.code, reason: '初始目标权重低于5%，已转为现金' });
  }

  let constrained = new Map<string, number>();
  for (let iteration = 0; iteration < candidates.length + 1; iteration += 1) {
    const activeCandidates = candidates.filter(candidate => active.has(candidate.code));
    const initialStockWeight = total(activeCandidates.map(candidate => initialWeights[candidate.code] ?? 0));
    const targetStockWeight = Math.min(profile.stockCap, initialStockWeight);
    constrained = allocate(activeCandidates, initialWeights, targetStockWeight, highCorrelationPairs);
    const belowMinimum = activeCandidates
      .filter(candidate => {
        const weight = constrained.get(candidate.code) ?? 0;
        return weight > EPSILON && weight < 0.05 - EPSILON;
      })
      .sort(lowerRank);
    if (belowMinimum.length === 0) break;
    const candidate = belowMinimum[0];
    active.delete(candidate.code);
    removed.push({ code: candidate.code, reason: '约束后目标权重低于5%，已重新求解并转为现金' });
  }

  const weights = Object.fromEntries([...constrained.entries()].filter(([, weight]) => weight > EPSILON));
  const stockWeight = total(Object.values(weights));
  const minimumCash = profile.cashFloor;
  const constraintCash = Math.max(0, 1 - minimumCash - stockWeight);
  const activeCandidates = Object.keys(weights).map(code => byCode.get(code)!).filter(Boolean);
  return {
    weights,
    removed,
    stockWeight,
    minimumCash,
    constraintCash,
    exposures: exposureFor(activeCandidates, new Map(Object.entries(weights))),
  };
}
