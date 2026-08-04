import { buildMediumTermBuyAdvice, type MediumTermBuyAdvice, type MediumTermBuyAdviceInput } from '../../engines/market-analysis/medium-term-buy-advice';
import { scoreFundamentals, type FundamentalScore } from '../../engines/market-analysis/fundamental-scorer';
import { scanPatterns, type PatternResult } from '../../engines/market-analysis/kline-patterns';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import { scanStrategies, type StrategySignal } from '../../engines/market-analysis/trading-strategies';
import {
  calculateStockRiskMetrics,
  type DatedReturn,
  type StockRiskMetrics,
} from '../../engines/portfolio/portfolio-risk-metrics';
import {
  fetchEastmoneyBasic,
  fetchEastmoneyKLine,
  type DailyBasicData,
  type StockKLine,
  type StockQuote,
} from '../../infrastructure/market-data/stock-api';
import type {
  SecurityClassificationStatus,
  SecurityMasterRecord,
} from '../../infrastructure/market-data/security-master';
import type {
  PortfolioCandidateIdentity,
  PortfolioCandidateSnapshot,
  PortfolioCandidateSource,
} from './all-watchlists-portfolio-candidates';

export const PORTFOLIO_ANALYSIS_CACHE_KEY = 'sec_portfolio_candidate_analysis_cache_v1';
export const PORTFOLIO_ANALYSIS_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
export const PORTFOLIO_ANALYSIS_MAX_CONCURRENCY = 4;

export interface PortfolioCandidateAnalysisDependencies {
  fetchKLine: (code: string, count: number) => Promise<StockKLine[]>;
  fetchBasic: (code: string) => Promise<DailyBasicData | null>;
  calcIndicators: (rows: StockKLine[]) => void;
  scanStrategies: (rows: StockKLine[]) => StrategySignal[];
  scanPatterns: (rows: StockKLine[]) => PatternResult[];
  scoreFundamentals: (quote: StockQuote, rows: StockKLine[], basic: DailyBasicData | null) => FundamentalScore;
  buildMediumTermAdvice: (input: MediumTermBuyAdviceInput) => MediumTermBuyAdvice;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now: () => number;
}

export interface PortfolioCandidateAnalysis {
  code: string;
  name: string;
  quote: StockQuote;
  industry: string | null;
  classificationStatus: SecurityClassificationStatus;
  sources: PortfolioCandidateSource[];
  labels: string[];
  score: number;
  confidence: number;
  mediumTermAdvice: MediumTermBuyAdvice;
  fundamental: FundamentalScore | null;
  strategies: StrategySignal[];
  patterns: PatternResult[];
  risk: StockRiskMetrics;
  returns: DatedReturn[];
  dataCompleteness: { quote: boolean; kline: boolean; fundamental: boolean; industry: boolean };
  dataAsOf: string;
}

export type PortfolioCandidateAnalysisResult =
  | { status: 'success'; candidate: PortfolioCandidateAnalysis }
  | { status: 'error'; code: string; error: string };

export interface AnalyzePortfolioCandidatesOptions {
  force?: boolean;
  maxConcurrency?: number;
  shouldPublish?: () => boolean;
  onUpdate: (completed: number, total: number, result: PortfolioCandidateAnalysisResult) => void;
}

interface AnalysisCacheEntry {
  expiresAt: number;
  candidate: PortfolioCandidateAnalysis;
}
type AnalysisCache = Record<string, AnalysisCacheEntry>;

const defaultDependencies = (): PortfolioCandidateAnalysisDependencies => ({
  fetchKLine: fetchEastmoneyKLine,
  fetchBasic: fetchEastmoneyBasic,
  calcIndicators: calcAllIndicators,
  scanStrategies,
  scanPatterns,
  scoreFundamentals,
  buildMediumTermAdvice: buildMediumTermBuyAdvice,
  storage: globalThis.localStorage,
  now: Date.now,
});

function dependenciesWith(overrides: Partial<PortfolioCandidateAnalysisDependencies>): PortfolioCandidateAnalysisDependencies {
  return { ...defaultDependencies(), ...overrides };
}

function readCache(storage: Pick<Storage, 'getItem'>): AnalysisCache {
  try {
    const raw = storage.getItem(PORTFOLIO_ANALYSIS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AnalysisCache : {};
  } catch {
    return {};
  }
}

function writeCache(storage: Pick<Storage, 'setItem'>, cache: AnalysisCache): void {
  try {
    storage.setItem(PORTFOLIO_ANALYSIS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache failures must not stop deterministic portfolio analysis.
  }
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function signalStrength(value: string): number {
  if (value === '强') return 3;
  if (value === '中') return 2;
  return 1;
}

function calculateScore(
  quote: StockQuote,
  advice: MediumTermBuyAdvice,
  fundamental: FundamentalScore | null,
  strategies: StrategySignal[],
  patterns: PatternResult[],
  risk: StockRiskMetrics,
): number {
  const fundamentalPoints = clamp((fundamental?.totalScore ?? 0) / 100 * 30, 0, 30);
  const technicalPoints = clamp(advice.score / 100 * 25, 0, 25);
  let signalPoints = 7.5;
  for (const signal of strategies) {
    const points = signalStrength(signal.strength);
    if (signal.type === 'buy') signalPoints += points;
    if (signal.type === 'sell') signalPoints -= points;
  }
  for (const pattern of patterns) {
    const points = signalStrength(pattern.strength) * 0.75;
    if (pattern.type === 'bullish') signalPoints += points;
    if (pattern.type === 'bearish') signalPoints -= points;
  }
  signalPoints = clamp(signalPoints, 0, 15);

  let marketPoints = 0;
  if (Number.isFinite(quote.price) && quote.price > 0) marketPoints += 4;
  if (Number.isFinite(quote.amount) && quote.amount >= 1_000_000) marketPoints += 4;
  if (Number.isFinite(quote.turnover) && quote.turnover >= 0.5 && quote.turnover <= 12) marketPoints += 4;
  if (Number.isFinite(quote.totalCap) && quote.totalCap >= 100) marketPoints += 4;
  if ((quote.pe > 0 && quote.pe <= 40) || (quote.pb > 0 && quote.pb <= 5)) marketPoints += 4;

  const volatilityPoints = risk.annualizedVolatility <= 0.35 ? 5 : risk.annualizedVolatility <= 0.7 ? 3 : 0;
  const drawdownPoints = risk.maximumDrawdown <= 0.25 ? 5 : risk.maximumDrawdown <= 0.5 ? 3 : 0;
  return Math.round(clamp(fundamentalPoints + technicalPoints + signalPoints + marketPoints + volatilityPoints + drawdownPoints, 0, 100));
}

function calculateConfidence(input: {
  quote: boolean;
  kline: boolean;
  fundamental: boolean;
  industry: boolean;
  historyLength: number;
}): number {
  let value = 0;
  if (input.quote) value += 20;
  if (input.kline) value += 30;
  if (input.fundamental) value += 25;
  if (input.industry) value += 10;
  if (input.historyLength >= 120) value += 15;
  else if (input.historyLength >= 60) value += 10;
  return clamp(value, 0, 100);
}

function cloneSources(sources: PortfolioCandidateSource[]): PortfolioCandidateSource[] {
  return sources.map(source => ({
    ...source,
    groupIds: [...source.groupIds],
    labels: [...source.labels],
  }));
}

async function analyzeOne(
  identity: PortfolioCandidateIdentity,
  quote: StockQuote | undefined,
  master: SecurityMasterRecord | undefined,
  dependencies: PortfolioCandidateAnalysisDependencies,
): Promise<PortfolioCandidateAnalysis> {
  if (!quote) throw new Error('缺少实时行情');
  const rows = (await dependencies.fetchKLine(identity.code, 120)).map(row => ({ ...row }));
  dependencies.calcIndicators(rows);
  const strategies = dependencies.scanStrategies(rows);
  const patterns = dependencies.scanPatterns(rows);
  const basic = await dependencies.fetchBasic(identity.code).catch(() => null);
  let fundamental: FundamentalScore | null = null;
  if (basic) {
    try {
      fundamental = dependencies.scoreFundamentals(quote, rows, basic);
    } catch {
      fundamental = null;
    }
  }
  const mediumTermAdvice = dependencies.buildMediumTermAdvice({
    quote,
    klines: rows,
    fundamental,
    hasFinancialData: fundamental !== null,
    strategies,
    patterns,
    calculatedAt: new Date(dependencies.now()).toISOString(),
  });
  const risk = calculateStockRiskMetrics(rows);
  const dataCompleteness = {
    quote: Number.isFinite(quote.price) && quote.price > 0,
    kline: rows.length >= 60,
    fundamental: fundamental !== null,
    industry: Boolean(master?.industry),
  };
  return {
    code: identity.code,
    name: quote.name || master?.name || identity.code,
    quote: { ...quote },
    industry: master?.industry ?? null,
    classificationStatus: master?.classificationStatus ?? 'unclassified',
    sources: cloneSources(identity.sources),
    labels: [...identity.labels],
    score: calculateScore(quote, mediumTermAdvice, fundamental, strategies, patterns, risk),
    confidence: calculateConfidence({ ...dataCompleteness, historyLength: rows.length }),
    mediumTermAdvice,
    fundamental,
    strategies: strategies.map(item => ({ ...item, conditions: [...item.conditions] })),
    patterns: patterns.map(item => ({ ...item })),
    risk,
    returns: risk.returns,
    dataCompleteness,
    dataAsOf: rows.at(-1)?.date ?? new Date(dependencies.now()).toISOString(),
  };
}

export async function analyzePortfolioCandidates(
  snapshot: PortfolioCandidateSnapshot,
  quotes: Record<string, StockQuote>,
  securityMaster: Record<string, SecurityMasterRecord>,
  options: AnalyzePortfolioCandidatesOptions,
  overrides: Partial<PortfolioCandidateAnalysisDependencies> = {},
): Promise<PortfolioCandidateAnalysisResult[]> {
  const dependencies = dependenciesWith(overrides);
  const cache = readCache(dependencies.storage);
  const total = snapshot.candidates.length;
  if (total === 0) return [];
  const results = new Array<PortfolioCandidateAnalysisResult>(total);
  const shouldPublish = options.shouldPublish ?? (() => true);
  const requested = options.maxConcurrency ?? PORTFOLIO_ANALYSIS_MAX_CONCURRENCY;
  const workerCount = Math.min(total, Math.min(8, Math.max(1, Math.floor(requested))));
  let cursor = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (cursor < total) {
      const index = cursor++;
      const identity = snapshot.candidates[index];
      const key = `${snapshot.id}:${identity.code}`;
      let result: PortfolioCandidateAnalysisResult;
      const cached = cache[key];
      if (!options.force && cached?.expiresAt > dependencies.now() && cached.candidate?.code === identity.code) {
        result = { status: 'success', candidate: cached.candidate };
      } else {
        try {
          const candidate = await analyzeOne(identity, quotes[identity.code], securityMaster[identity.code], dependencies);
          cache[key] = { expiresAt: dependencies.now() + PORTFOLIO_ANALYSIS_CACHE_TTL_MS, candidate };
          writeCache(dependencies.storage, cache);
          result = { status: 'success', candidate };
        } catch (error) {
          result = {
            status: 'error',
            code: identity.code,
            error: error instanceof Error ? error.message : '候选股分析失败',
          };
        }
      }
      results[index] = result;
      completed += 1;
      if (shouldPublish()) options.onUpdate(completed, total, result);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
