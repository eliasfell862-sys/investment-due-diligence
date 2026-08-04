export interface PortfolioWeightInput {
  code: string;
  score: number;
  confidence: number;
  annualizedVolatility: number;
}

export interface PortfolioWeightResult {
  weights: Record<string, number>;
  riskContributions: Record<string, number>;
  method: 'risk_parity' | 'inverse_volatility';
  converged: boolean;
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function qualityTilt(input: Pick<PortfolioWeightInput, 'score' | 'confidence'>): number {
  const quality = clamp((input.score + input.confidence) / 2, 0, 100);
  return 0.85 + quality / 100 * 0.30;
}

function normalize(values: number[]): number[] {
  const positive = values.map(value => Number.isFinite(value) && value > 0 ? value : 0);
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.length === 0 ? [] : values.map(() => 1 / values.length);
  return positive.map(value => value / total);
}

function matrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map(row => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function componentContributions(weights: number[], covariance: number[][]): number[] {
  const marginal = matrixVector(covariance, weights);
  return weights.map((weight, index) => weight * marginal[index]);
}

function normalizedContributions(weights: number[], covariance: number[][]): number[] {
  const contributions = componentContributions(weights, covariance);
  const total = contributions.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return contributions.map(() => 0);
  return contributions.map(value => value / total);
}

function validPositiveDefiniteMatrix(matrix: number[][], size: number): boolean {
  if (matrix.length !== size || matrix.some(row => row.length !== size)) return false;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (!Number.isFinite(matrix[row][column])) return false;
      if (Math.abs(matrix[row][column] - matrix[column][row]) > 1e-10) return false;
    }
  }

  const lower = Array.from({ length: size }, () => Array(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let value = matrix[row][column];
      for (let index = 0; index < column; index += 1) value -= lower[row][index] * lower[column][index];
      if (row === column) {
        if (!Number.isFinite(value) || value <= 1e-12) return false;
        lower[row][column] = Math.sqrt(value);
      } else {
        lower[row][column] = value / lower[column][column];
      }
    }
  }
  return true;
}

function applyQualityTilt(candidates: PortfolioWeightInput[], weights: number[]): number[] {
  return normalize(weights.map((weight, index) => weight * qualityTilt(candidates[index])));
}

function asRecord(candidates: PortfolioWeightInput[], values: number[]): Record<string, number> {
  return Object.fromEntries(candidates.map((candidate, index) => [candidate.code, values[index] ?? 0]));
}

function independentCovariance(candidates: PortfolioWeightInput[]): number[][] {
  return candidates.map((candidate, row) => candidates.map((_, column) => {
    if (row !== column) return 0;
    const volatility = Number.isFinite(candidate.annualizedVolatility) && candidate.annualizedVolatility > 0
      ? candidate.annualizedVolatility
      : 1;
    return volatility * volatility;
  }));
}

function inverseVolatilityResult(candidates: PortfolioWeightInput[]): PortfolioWeightResult {
  if (candidates.length === 0) {
    return { weights: {}, riskContributions: {}, method: 'inverse_volatility', converged: false };
  }
  const base = normalize(candidates.map(candidate => (
    Number.isFinite(candidate.annualizedVolatility) && candidate.annualizedVolatility > 0
      ? 1 / candidate.annualizedVolatility
      : 0
  )));
  const weights = applyQualityTilt(candidates, base);
  const contributions = normalizedContributions(weights, independentCovariance(candidates));
  return {
    weights: asRecord(candidates, weights),
    riskContributions: asRecord(candidates, contributions),
    method: 'inverse_volatility',
    converged: false,
  };
}

export function solveRiskParityWeights(
  candidates: PortfolioWeightInput[],
  covariance: number[][],
): PortfolioWeightResult {
  if (candidates.length === 0) return inverseVolatilityResult(candidates);
  if (!validPositiveDefiniteMatrix(covariance, candidates.length)) return inverseVolatilityResult(candidates);

  let weights = candidates.map(() => 1 / candidates.length);
  let converged = false;
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const contributions = componentContributions(weights, covariance);
    if (contributions.some(value => !Number.isFinite(value) || value <= 0)) return inverseVolatilityResult(candidates);
    const target = contributions.reduce((sum, value) => sum + value, 0) / contributions.length;
    const maximumGap = Math.max(...contributions.map(value => Math.abs(value - target) / target));
    if (maximumGap <= 1e-7) {
      converged = true;
      break;
    }
    weights = normalize(weights.map((weight, index) => weight * Math.sqrt(target / contributions[index])));
  }
  if (!converged) return inverseVolatilityResult(candidates);

  weights = applyQualityTilt(candidates, weights);
  const contributions = normalizedContributions(weights, covariance);
  return {
    weights: asRecord(candidates, weights),
    riskContributions: asRecord(candidates, contributions),
    method: 'risk_parity',
    converged: true,
  };
}
