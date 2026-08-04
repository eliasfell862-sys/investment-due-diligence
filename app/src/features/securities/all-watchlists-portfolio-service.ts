import { constrainPortfolioWeights, type PortfolioConstraintResult } from '../../engines/portfolio/portfolio-constraints';
import {
  PORTFOLIO_RISK_PROFILES,
  selectPortfolioCandidates,
  type PortfolioExclusion,
  type PortfolioRiskLevel,
} from '../../engines/portfolio/portfolio-candidate-selection';
import { solveRiskParityWeights, type PortfolioWeightResult } from '../../engines/portfolio/portfolio-risk-parity';
import { covarianceMatrix, type DatedReturn } from '../../engines/portfolio/portfolio-risk-metrics';
import { sizePortfolioTrades, type PortfolioSizingResult } from '../../engines/portfolio/portfolio-trade-sizing';
import { buildSecurityMaster, type SecurityMasterRecord } from '../../infrastructure/market-data/security-master';
import {
  fetchStockQuotes,
  loadStockDirectory,
  type StockQuote,
} from '../../infrastructure/market-data/stock-api';
import {
  analyzePortfolioCandidates,
  type PortfolioCandidateAnalysis,
  type PortfolioCandidateAnalysisResult,
} from './portfolio-candidate-analysis';
import {
  aggregateAllWatchlistCandidates,
  type PortfolioCandidateSnapshot,
} from './all-watchlists-portfolio-candidates';

export const ALL_WATCHLISTS_ANALYSIS_CACHE_KEY = 'sec_all_watchlists_portfolio_analysis_v1';
export const ALL_WATCHLISTS_ANALYSIS_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

export interface AllWatchlistsPortfolioDependencies {
  aggregateCandidates: () => PortfolioCandidateSnapshot;
  fetchQuotes: (codes: string[]) => Promise<Record<string, StockQuote>>;
  loadSecurityMaster: () => Promise<Record<string, SecurityMasterRecord>>;
  analyzeCandidates: typeof analyzePortfolioCandidates;
  selectCandidates: typeof selectPortfolioCandidates;
  covariance: typeof covarianceMatrix;
  solveRiskParity: typeof solveRiskParityWeights;
  constrain: typeof constrainPortfolioWeights;
  sizeTrades: typeof sizePortfolioTrades;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
}

export interface AllWatchlistsPortfolioRequest {
  capital: number;
  riskLevel: PortfolioRiskLevel;
  force?: boolean;
}

export interface AllWatchlistsPortfolioProgress {
  snapshotId: string;
  completed: number;
  total: number;
  successes: number;
  failures: number;
}

export interface DeterministicPortfolioResult {
  algorithmVersion: 'all-watchlists-risk-parity-v1';
  snapshot: PortfolioCandidateSnapshot;
  riskLevel: PortfolioRiskLevel;
  parameters: Record<string, number>;
  selected: PortfolioCandidateAnalysis[];
  excluded: PortfolioExclusion[];
  targetWeights: Record<string, number>;
  riskContributions: Record<string, number>;
  sizing: PortfolioSizingResult;
  metrics: {
    annualizedVolatility: number;
    concentration: number;
    maximumPairCorrelation: number | null;
  };
  dataAsOf: string;
  stale: boolean;
}

interface ReusableAnalysisCache {
  snapshotId: string;
  expiresAt: number;
  results: PortfolioCandidateAnalysisResult[];
}

export class PortfolioBuildError extends Error {
  readonly code: 'NO_QUOTES';

  constructor(code: 'NO_QUOTES', message: string) {
    super(message);
    this.name = 'PortfolioBuildError';
    this.code = code;
  }
}

async function defaultFetchQuotes(codes: string[]): Promise<Record<string, StockQuote>> {
  const quotes = await fetchStockQuotes(codes);
  return Object.fromEntries(quotes.map(quote => [quote.code, quote]));
}

async function defaultLoadSecurityMaster(): Promise<Record<string, SecurityMasterRecord>> {
  const rows = await loadStockDirectory();
  const asOf = new Date().toISOString();
  const records = buildSecurityMaster(rows, {
    directorySource: 'stock-directory',
    classificationSource: 'stock-directory',
    asOf,
    classificationVersion: `stock-directory-${asOf.slice(0, 10)}`,
  });
  return Object.fromEntries(records.map(record => [record.code, record]));
}

const defaultDependencies = (): AllWatchlistsPortfolioDependencies => ({
  aggregateCandidates: aggregateAllWatchlistCandidates,
  fetchQuotes: defaultFetchQuotes,
  loadSecurityMaster: defaultLoadSecurityMaster,
  analyzeCandidates: analyzePortfolioCandidates,
  selectCandidates: selectPortfolioCandidates,
  covariance: covarianceMatrix,
  solveRiskParity: solveRiskParityWeights,
  constrain: constrainPortfolioWeights,
  sizeTrades: sizePortfolioTrades,
  storage: globalThis.localStorage,
});

function dependenciesWith(overrides: Partial<AllWatchlistsPortfolioDependencies>): AllWatchlistsPortfolioDependencies {
  return { ...defaultDependencies(), ...overrides };
}

function readReusableAnalysis(
  storage: Pick<Storage, 'getItem'>,
  snapshotId: string,
): PortfolioCandidateAnalysisResult[] | null {
  try {
    const raw = storage.getItem(ALL_WATCHLISTS_ANALYSIS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReusableAnalysisCache>;
    if (parsed.snapshotId !== snapshotId || !Array.isArray(parsed.results)
      || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt! <= Date.now()) return null;
    return parsed.results as PortfolioCandidateAnalysisResult[];
  } catch {
    return null;
  }
}

function writeReusableAnalysis(
  storage: Pick<Storage, 'setItem'>,
  snapshotId: string,
  results: PortfolioCandidateAnalysisResult[],
): void {
  try {
    storage.setItem(ALL_WATCHLISTS_ANALYSIS_CACHE_KEY, JSON.stringify({
      snapshotId,
      expiresAt: Date.now() + ALL_WATCHLISTS_ANALYSIS_CACHE_TTL_MS,
      results,
    } satisfies ReusableAnalysisCache));
  } catch {
    // Reuse is an optimization and cannot be allowed to break portfolio construction.
  }
}

function successful(results: PortfolioCandidateAnalysisResult[]): PortfolioCandidateAnalysis[] {
  return results.flatMap(result => result.status === 'success' ? [result.candidate] : []);
}

function selectedReturns(candidates: PortfolioCandidateAnalysis[]): Record<string, DatedReturn[]> {
  return Object.fromEntries(candidates.map(candidate => [candidate.code, candidate.returns]));
}

function constrainedRiskContributions(
  codes: string[],
  matrix: number[][],
  weights: Record<string, number>,
  fallback: PortfolioWeightResult,
): Record<string, number> {
  if (codes.length === 0 || matrix.length !== codes.length) return {};
  const vector = codes.map(code => weights[code] ?? 0);
  const marginal = matrix.map(row => row.reduce((sum, value, index) => sum + value * vector[index], 0));
  const raw = vector.map((weight, index) => weight * marginal[index]);
  const sum = raw.reduce((total, value) => total + value, 0);
  return Object.fromEntries(codes
    .filter(code => (weights[code] ?? 0) > 0)
    .map((code, index) => [code, sum > 0 ? raw[index] / sum : fallback.riskContributions[code] ?? 0]));
}

function portfolioVolatility(codes: string[], matrix: number[][], weights: Record<string, number>): number {
  if (codes.length === 0 || matrix.length !== codes.length) return 0;
  const vector = codes.map(code => weights[code] ?? 0);
  let variance = 0;
  for (let row = 0; row < codes.length; row += 1) {
    for (let column = 0; column < codes.length; column += 1) {
      variance += vector[row] * matrix[row][column] * vector[column];
    }
  }
  return Math.sqrt(Math.max(0, variance)) * Math.sqrt(252);
}

function finalExclusions(
  excluded: PortfolioExclusion[],
  constrained: PortfolioConstraintResult,
): PortfolioExclusion[] {
  return [
    ...excluded,
    ...constrained.removed.map(item => ({
      code: item.code,
      reasonCode: 'selection_limit' as const,
      reason: item.reason,
    })),
  ];
}

export async function buildAllWatchlistsPortfolio(
  request: AllWatchlistsPortfolioRequest,
  options: {
    shouldPublish?: () => boolean;
    onProgress?: (progress: AllWatchlistsPortfolioProgress) => void;
  },
  overrides: Partial<AllWatchlistsPortfolioDependencies> = {},
): Promise<DeterministicPortfolioResult> {
  const dependencies = dependenciesWith(overrides);
  const snapshot = dependencies.aggregateCandidates();
  const codes = snapshot.candidates.map(candidate => candidate.code);
  const quotes = await dependencies.fetchQuotes(codes);
  if (codes.length > 0 && !codes.some(code => quotes[code])) {
    throw new PortfolioBuildError('NO_QUOTES', '未获取到任何候选股实时行情');
  }
  const securityMaster = await dependencies.loadSecurityMaster();
  const shouldPublish = options.shouldPublish ?? (() => true);

  let analyses = request.force ? null : readReusableAnalysis(dependencies.storage, snapshot.id);
  if (!analyses) {
    let successes = 0;
    let failures = 0;
    analyses = await dependencies.analyzeCandidates(snapshot, quotes, securityMaster, {
      force: request.force,
      shouldPublish,
      onUpdate: (completed, total, result) => {
        if (result.status === 'success') successes += 1;
        else failures += 1;
        if (shouldPublish()) options.onProgress?.({ snapshotId: snapshot.id, completed, total, successes, failures });
      },
    });
    writeReusableAnalysis(dependencies.storage, snapshot.id, analyses);
  } else if (shouldPublish()) {
    const successes = analyses.filter(result => result.status === 'success').length;
    options.onProgress?.({
      snapshotId: snapshot.id,
      completed: analyses.length,
      total: analyses.length,
      successes,
      failures: analyses.length - successes,
    });
  }

  const allSuccessful = successful(analyses);
  const selection = dependencies.selectCandidates(allSuccessful, request.riskLevel);
  const covariance = dependencies.covariance(selectedReturns(selection.selected));
  const covarianceCandidates = covariance.codes
    .map(code => selection.selected.find(candidate => candidate.code === code))
    .filter((candidate): candidate is PortfolioCandidateAnalysis => Boolean(candidate));
  const baseWeights = dependencies.solveRiskParity(covarianceCandidates.map(candidate => ({
    code: candidate.code,
    score: candidate.score,
    confidence: candidate.confidence,
    annualizedVolatility: candidate.risk.annualizedVolatility,
  })), covariance.matrix);
  const constrained = dependencies.constrain(
    selection.selected.map(candidate => ({
      code: candidate.code,
      industry: candidate.industry,
      labels: candidate.labels,
      score: candidate.score,
      confidence: candidate.confidence,
    })),
    baseWeights.weights,
    request.riskLevel,
    selection.highCorrelationPairs,
  );
  const finalSelected = selection.selected.filter(candidate => (constrained.weights[candidate.code] ?? 0) > 0);
  const sizing = dependencies.sizeTrades(
    request.capital,
    finalSelected.map(candidate => ({
      code: candidate.code,
      name: candidate.name,
      price: candidate.quote.price,
      targetWeight: constrained.weights[candidate.code],
    })),
    constrained.minimumCash,
    constrained.constraintCash,
  );
  const riskContributions = constrainedRiskContributions(
    covariance.codes,
    covariance.matrix,
    constrained.weights,
    baseWeights,
  );
  const selectedCodes = new Set(finalSelected.map(candidate => candidate.code));
  const pairCorrelations = selection.highCorrelationPairs
    .filter(pair => selectedCodes.has(pair.leftCode) && selectedCodes.has(pair.rightCode) && pair.correlation !== null)
    .map(pair => pair.correlation!);
  const profile = PORTFOLIO_RISK_PROFILES[request.riskLevel];
  const dataAsOf = [...finalSelected.map(candidate => candidate.dataAsOf), snapshot.createdAt].sort().at(-1)!;

  return {
    algorithmVersion: 'all-watchlists-risk-parity-v1',
    snapshot,
    riskLevel: request.riskLevel,
    parameters: {
      scoreThreshold: profile.score,
      volatilityLimit: profile.volatility,
      drawdownLimit: profile.drawdown,
      stockCap: profile.stockCap,
      cashFloor: profile.cashFloor,
      maximumPositions: 10,
      singleStockCap: 0.20,
      industryCap: 0.35,
      labelCap: 0.35,
      highCorrelationThreshold: 0.80,
      highCorrelationPairCap: 0.25,
      commonTradingDays: 60,
    },
    selected: finalSelected,
    excluded: finalExclusions(selection.excluded, constrained),
    targetWeights: constrained.weights,
    riskContributions,
    sizing,
    metrics: {
      annualizedVolatility: portfolioVolatility(covariance.codes, covariance.matrix, constrained.weights),
      concentration: Object.values(constrained.weights).reduce((sum, weight) => sum + weight * weight, 0),
      maximumPairCorrelation: pairCorrelations.length > 0 ? Math.max(...pairCorrelations) : null,
    },
    dataAsOf,
    stale: !shouldPublish(),
  };
}
