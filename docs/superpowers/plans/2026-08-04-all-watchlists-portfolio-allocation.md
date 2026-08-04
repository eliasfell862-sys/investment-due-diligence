# All-Watchlists Portfolio Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyze every deduplicated stock across all watchlists and produce an explainable, constrained, executable portfolio of at most ten stocks.

**Architecture:** Aggregate all watchlists into an immutable candidate snapshot, analyze every stock through existing InStock-derived engines, then pass complete candidate results through deterministic selection, risk-parity, concentration constraints, and board-lot sizing. Keep AI read-only and keep the stock-analysis page isolated.

**Tech Stack:** React 19, TypeScript 6, Vitest, Testing Library, browser localStorage, existing InStock-derived technical/strategy engines, existing market-data APIs.

## Global Constraints

- Merge every valid record in `sec_watchlists_v2`; normalize and deduplicate by stock code while preserving every source pool, group, and label.
- Analyze the complete immutable snapshot before filtering. Do not preselect by tag, market cap, or a fixed count.
- Select 0–10 stocks; never fill unused slots with stocks below the active quality threshold.
- Score thresholds are conservative 70, balanced 65, aggressive 60.
- Annualized-volatility caps are conservative 35%, balanced 50%, aggressive 70%.
- Maximum-drawdown caps are conservative 25%, balanced 35%, aggressive 50%.
- Minimum cash is conservative 20%, balanced 10%, aggressive 0%.
- Every selected target weight is 5%–20%; official-industry and every watchlist-label exposure are each at most 35%.
- Official industry is the primary classification. Labels are the classification fallback only when official industry is absent, while every label still counts toward label exposure.
- Use simple daily returns. Correlation requires 60 aligned valid days; correlation at or above 0.80 is high, and a retained pair may total at most 25%.
- Base weights use risk parity; singular/failed solutions fall back to inverse volatility, never score-proportional weights.
- Quality tilt uses score and confidence and is clamped to 0.85–1.15.
- Remove weights below 5% and solve again; unallocatable weight becomes cash.
- Size A-share trades by rounding down to multiples of 100 shares.
- AI may explain deterministic output but cannot alter membership, weights, thresholds, or constraints.
- Preserve `sec_portfolio_groups_v1` and add only backward-compatible optional snapshot fields.
- Do not modify `app/src/features/securities/StockAnalysisPage.tsx`, stock overview behavior, or stock K-line behavior.

---

### Task 1: All-Watchlists Candidate Aggregator

**Files:**
- Create: `app/src/features/securities/all-watchlists-portfolio-candidates.ts`
- Create: `app/src/features/securities/all-watchlists-portfolio-candidates.test.ts`

**Interfaces:**

```ts
export interface PortfolioCandidateSource {
  watchlistId: string; watchlistName: string; groupIds: string[]; labels: string[];
}
export interface PortfolioCandidateIdentity {
  code: string; sources: PortfolioCandidateSource[]; labels: string[];
}
export interface PortfolioCandidateSnapshot {
  id: string; createdAt: string; candidates: PortfolioCandidateIdentity[];
  sourceWatchlists: Array<{ id: string; name: string }>; warnings: string[];
}
export function aggregateAllWatchlistCandidates(
  storage?: Pick<Storage, 'getItem'>,
  now?: () => string,
): PortfolioCandidateSnapshot;
```

- [ ] **Step 1: Write the failing aggregation tests**

```ts
it('deduplicates codes and preserves every source and label', () => {
  const result = aggregateAllWatchlistCandidates(storageWith([
    watchlist('a', '核心池', ['000001'], group('价值', ['000001'])),
    watchlist('b', '观察池', ['000001 '], group('低波', ['000001'])),
  ]), fixedNow);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]).toMatchObject({ code: '000001', labels: ['价值', '低波'] });
  expect(result.candidates[0].sources).toHaveLength(2);
});

it('keeps valid pools when another persisted record is malformed', () => {
  const result = aggregateAllWatchlistCandidates(storageWith([{ id: 9 }, watchlist('a', '核心池', ['600519'])]));
  expect(result.candidates.map(item => item.code)).toEqual(['600519']);
  expect(result.warnings).toEqual(['已忽略1个损坏的自选股池记录']);
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/features/securities/all-watchlists-portfolio-candidates.test.ts` from `app/`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement parsing, merge, and stable identity**

```ts
export function aggregateAllWatchlistCandidates(storage = localStorage, now = () => new Date().toISOString()) {
  const { watchlists, warnings } = readValidWatchlists(storage.getItem('sec_watchlists_v2'));
  const byCode = new Map<string, PortfolioCandidateIdentity>();
  for (const watchlist of watchlists) mergeWatchlist(byCode, watchlist);
  const candidates = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { id: fnv1a(stableSnapshotText(candidates)), createdAt: now(), candidates,
    sourceWatchlists: watchlists.map(({ id, name }) => ({ id, name })), warnings };
}
```

The snapshot hash includes sorted codes, source pool IDs, group IDs, and labels, but never `createdAt`.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- src/features/securities/all-watchlists-portfolio-candidates.test.ts`  
Expected: PASS.

```powershell
git add -- app/src/features/securities/all-watchlists-portfolio-candidates.ts app/src/features/securities/all-watchlists-portfolio-candidates.test.ts
git commit -m "feat: aggregate all watchlist candidates"
```

### Task 2: Returns, Volatility, Drawdown, Correlation, and Covariance

**Files:**
- Create: `app/src/engines/portfolio/portfolio-risk-metrics.ts`
- Create: `app/src/engines/portfolio/portfolio-risk-metrics.test.ts`

**Interfaces:**

```ts
export interface DatedReturn { date: string; value: number }
export interface StockRiskMetrics { returns: DatedReturn[]; annualizedVolatility: number; maximumDrawdown: number }
export interface PairCorrelation { leftCode: string; rightCode: string; commonDays: number; correlation: number | null }
export function simpleDailyReturns(rows: Array<{ date: string; close: number }>): DatedReturn[];
export function calculateStockRiskMetrics(rows: Array<{ date: string; close: number }>): StockRiskMetrics;
export function correlateAlignedReturns(left: DatedReturn[], right: DatedReturn[], minimumDays?: number): { commonDays: number; correlation: number | null };
export function covarianceMatrix(seriesByCode: Record<string, DatedReturn[]>): { codes: string[]; matrix: number[][]; commonDays: number };
```

- [ ] **Step 1: Write failing formula and date-alignment tests**

```ts
it('uses simple returns, sample volatility, and running-peak drawdown', () => {
  const result = calculateStockRiskMetrics([{ date: '1', close: 100 }, { date: '2', close: 110 }, { date: '3', close: 99 }]);
  expect(result.returns.map(item => item.value)).toEqual([0.1, -0.1]);
  expect(result.annualizedVolatility).toBeCloseTo(Math.sqrt(0.02) * Math.sqrt(252), 10);
  expect(result.maximumDrawdown).toBeCloseTo(0.1, 10);
});
it('returns null correlation with only fifty-nine common days', () => {
  expect(correlateAlignedReturns(returns(59), returns(59))).toEqual({ commonDays: 59, correlation: null });
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/engines/portfolio/portfolio-risk-metrics.test.ts`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the exact calculations**

```ts
export function simpleDailyReturns(rows: Array<{ date: string; close: number }>): DatedReturn[] {
  const sorted = rows.filter(validClose).sort((a, b) => a.date.localeCompare(b.date));
  return sorted.slice(1).map((row, index) => ({ date: row.date, value: row.close / sorted[index].close - 1 }));
}
```

Use sample standard deviation (`n - 1`) times `sqrt(252)`. Align correlation and covariance by exact date and exclude non-finite values.

- [ ] **Step 4: Add symmetric-covariance coverage, run GREEN, and commit**

```ts
it('builds a symmetric covariance matrix from common dates', () => {
  const result = covarianceMatrix({ A: returns(80, 1), B: returns(80, -1) });
  expect(result.matrix[0][1]).toBeCloseTo(result.matrix[1][0], 12);
  expect(result.commonDays).toBe(80);
});
```

Run: `npm test -- src/engines/portfolio/portfolio-risk-metrics.test.ts`  
Expected: PASS.

```powershell
git add -- app/src/engines/portfolio/portfolio-risk-metrics.ts app/src/engines/portfolio/portfolio-risk-metrics.test.ts
git commit -m "feat: calculate portfolio risk metrics"
```

### Task 3: Full Candidate Analysis Queue

**Files:**
- Create: `app/src/features/securities/portfolio-candidate-analysis.ts`
- Create: `app/src/features/securities/portfolio-candidate-analysis.test.ts`

**Interfaces:**

```ts
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
  code: string; name: string; quote: StockQuote; industry: string | null;
  classificationStatus: SecurityClassificationStatus; sources: PortfolioCandidateSource[]; labels: string[];
  score: number; confidence: number; mediumTermAdvice: MediumTermBuyAdvice;
  fundamental: FundamentalScore | null; strategies: StrategySignal[]; patterns: PatternResult[];
  risk: StockRiskMetrics; returns: DatedReturn[];
  dataCompleteness: { quote: boolean; kline: boolean; fundamental: boolean; industry: boolean };
  dataAsOf: string;
}
export type PortfolioCandidateAnalysisResult =
  | { status: 'success'; candidate: PortfolioCandidateAnalysis }
  | { status: 'error'; code: string; error: string };
export async function analyzePortfolioCandidates(
  snapshot: PortfolioCandidateSnapshot,
  quotes: Record<string, StockQuote>,
  securityMaster: Record<string, SecurityMasterRecord>,
  options: { force?: boolean; maxConcurrency?: number; shouldPublish?: () => boolean;
    onUpdate: (completed: number, total: number, result: PortfolioCandidateAnalysisResult) => void },
  overrides?: Partial<PortfolioCandidateAnalysisDependencies>,
): Promise<PortfolioCandidateAnalysisResult[]>;
```

- [ ] **Step 1: Write failing all-candidate, concurrency, and isolation tests**

```ts
it('analyzes all twelve candidates without preselection', async () => {
  const result = await analyzePortfolioCandidates(snapshot(12), quotes(12), {}, options(), deps());
  expect(result).toHaveLength(12);
  expect(deps().fetchKLine).toHaveBeenCalledWith(expect.any(String), 120);
});
it('caps concurrency at four and isolates one failed stock', async () => {
  const tracker = trackedDependencies({ rejectCode: '000003' });
  const result = await analyzePortfolioCandidates(snapshot(9), quotes(9), {}, options(), tracker.dependencies);
  expect(tracker.maximum()).toBe(4);
  expect(result.filter(item => item.status === 'error')).toHaveLength(1);
  expect(result.filter(item => item.status === 'success')).toHaveLength(8);
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/features/securities/portfolio-candidate-analysis.test.ts`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement immutable analysis snapshots and cache**

```ts
const CACHE_KEY = 'sec_portfolio_candidate_analysis_cache_v1';
const TTL_MS = 4 * 60 * 60 * 1000;
const klines = (await deps.fetchKLine(identity.code, 120)).map(row => ({ ...row }));
deps.calcIndicators(klines);
const strategies = deps.scanStrategies(klines);
const patterns = deps.scanPatterns(klines);
const financial = await deps.fetchBasic(identity.code).catch(() => null);
const fundamental = deps.scoreFundamentals(quote, klines, financial);
const mediumTermAdvice = deps.buildMediumTermAdvice({ quote, klines, fundamental,
  hasFinancialData: financial !== null, strategies, patterns });
```

Score with fixed 30/25/15/20/10 dimensions and record confidence/data completeness. Fundamental failure lowers confidence but is not a queue failure.

- [ ] **Step 4: Test corrupt cache and stale publishing, then commit**

```ts
it('does not publish after shouldPublish becomes false', async () => {
  let publish = true;
  const onUpdate = vi.fn(() => { publish = false; });
  await analyzePortfolioCandidates(snapshot(2), quotes(2), {}, { onUpdate, shouldPublish: () => publish }, deps());
  expect(onUpdate).toHaveBeenCalledTimes(1);
});
```

Run: `npm test -- src/features/securities/portfolio-candidate-analysis.test.ts`  
Expected: PASS.

```powershell
git add -- app/src/features/securities/portfolio-candidate-analysis.ts app/src/features/securities/portfolio-candidate-analysis.test.ts
git commit -m "feat: analyze all portfolio candidates"
```

### Task 4: Risk-Profile Selection and Exclusion Reasons

**Files:**
- Create: `app/src/engines/portfolio/portfolio-candidate-selection.ts`
- Create: `app/src/engines/portfolio/portfolio-candidate-selection.test.ts`

**Interfaces:**

```ts
export type PortfolioExclusionCode = 'invalid_price' | 'trading_abnormal' | 'insufficient_data' |
  'strong_sell' | 'liquidity' | 'volatility_limit' | 'drawdown_limit' |
  'score_threshold' | 'high_correlation' | 'selection_limit';
export interface PortfolioExclusion { code: string; reasonCode: PortfolioExclusionCode; reason: string }
export interface PortfolioSelectionResult {
  selected: PortfolioCandidateAnalysis[]; excluded: PortfolioExclusion[]; highCorrelationPairs: PairCorrelation[];
}
export function selectPortfolioCandidates(candidates: PortfolioCandidateAnalysis[], riskLevel: PortfolioRiskLevel): PortfolioSelectionResult;
```

- [ ] **Step 1: Write failing threshold and hard-risk tests**

```ts
it.each([['conservative', 70], ['balanced', 65], ['aggressive', 60]] as const)(
  'uses the %s threshold', (riskLevel, threshold) => {
    const result = selectPortfolioCandidates([candidate({ score: threshold - 1 })], riskLevel);
    expect(result.excluded[0].reasonCode).toBe('score_threshold');
  });
it('excludes excessive drawdown even with score ninety-nine', () => {
  const result = selectPortfolioCandidates([candidate({ score: 99, maximumDrawdown: 0.40 })], 'conservative');
  expect(result.excluded[0].reasonCode).toBe('drawdown_limit');
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/engines/portfolio/portfolio-candidate-selection.test.ts`  
Expected: FAIL because the selector does not exist.

- [ ] **Step 3: Implement ordered hard gates and deterministic ranking**

```ts
export const PORTFOLIO_RISK_PROFILES = {
  conservative: { score: 70, volatility: 0.35, drawdown: 0.25, stockCap: 0.80, cashFloor: 0.20 },
  balanced: { score: 65, volatility: 0.50, drawdown: 0.35, stockCap: 0.90, cashFloor: 0.10 },
  aggressive: { score: 60, volatility: 0.70, drawdown: 0.50, stockCap: 1.00, cashFloor: 0.00 },
} as const;
```

Gate order is invalid trading data, completeness, strong sell/bearish combination, liquidity/board-lot feasibility, volatility, drawdown, score. Rank survivors by score, confidence, lower volatility, then code.

- [ ] **Step 4: Test maximum ten, no fill, and high correlation; run GREEN and commit**

```ts
it('does not fill ten slots when only six qualify', () => {
  expect(selectPortfolioCandidates([...qualified(6), ...belowThreshold(8)], 'balanced').selected).toHaveLength(6);
});
it('removes the weaker same-industry stock at correlation 0.80', () => {
  const result = selectPortfolioCandidates(correlatedPair({ correlation: 0.80, sameIndustry: true }), 'balanced');
  expect(result.excluded).toContainEqual(expect.objectContaining({ code: 'weaker', reasonCode: 'high_correlation' }));
});
```

Different-official-industry correlated pairs may remain, but must be returned in `highCorrelationPairs` for the 25% pair constraint.

Run: `npm test -- src/engines/portfolio/portfolio-candidate-selection.test.ts`  
Expected: PASS.

```powershell
git add -- app/src/engines/portfolio/portfolio-candidate-selection.ts app/src/engines/portfolio/portfolio-candidate-selection.test.ts
git commit -m "feat: select portfolio candidates"
```

### Task 5: Risk Parity, Fallback, and Quality Tilt

**Files:**
- Create: `app/src/engines/portfolio/portfolio-risk-parity.ts`
- Create: `app/src/engines/portfolio/portfolio-risk-parity.test.ts`

**Interfaces:**

```ts
export interface PortfolioWeightInput { code: string; score: number; confidence: number; annualizedVolatility: number }
export interface PortfolioWeightResult {
  weights: Record<string, number>; riskContributions: Record<string, number>;
  method: 'risk_parity' | 'inverse_volatility'; converged: boolean;
}
export function qualityTilt(input: Pick<PortfolioWeightInput, 'score' | 'confidence'>): number;
export function solveRiskParityWeights(candidates: PortfolioWeightInput[], covariance: number[][]): PortfolioWeightResult;
```

- [ ] **Step 1: Write failing risk-contribution and fallback tests**

```ts
it('equalizes risk for identical independent assets', () => {
  const result = solveRiskParityWeights(inputs('A', 'B'), [[0.04, 0], [0, 0.04]]);
  expect(result.weights.A).toBeCloseTo(0.5, 4);
  expect(result.riskContributions.A).toBeCloseTo(result.riskContributions.B, 4);
});
it('uses inverse volatility for a singular matrix', () => {
  expect(solveRiskParityWeights(inputs('A', 'B'), [[0.04, 0.04], [0.04, 0.04]]).method).toBe('inverse_volatility');
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/engines/portfolio/portfolio-risk-parity.test.ts`  
Expected: FAIL because the solver does not exist.

- [ ] **Step 3: Implement equal-risk iteration and fallback**

```ts
for (let iteration = 0; iteration < 500; iteration += 1) {
  const contributions = componentRiskContributions(weights, covariance);
  const target = sum(contributions) / contributions.length;
  weights = normalize(weights.map((weight, i) => weight * target / Math.max(contributions[i], 1e-12)));
  if (maximumRelativeGap(contributions, target) <= 1e-7) return result(weights, 'risk_parity', true);
}
return inverseVolatilityResult(candidates);
```

Reject non-square, non-finite, non-positive-diagonal, or singular matrices before iteration.

- [ ] **Step 4: Test and implement quality tilt, run GREEN, and commit**

```ts
expect(qualityTilt({ score: 100, confidence: 100 })).toBe(1.15);
expect(qualityTilt({ score: 0, confidence: 0 })).toBe(0.85);
```

Apply tilt after base weights, normalize, then recompute risk contributions.

Run: `npm test -- src/engines/portfolio/portfolio-risk-parity.test.ts`  
Expected: PASS.

```powershell
git add -- app/src/engines/portfolio/portfolio-risk-parity.ts app/src/engines/portfolio/portfolio-risk-parity.test.ts
git commit -m "feat: solve risk-parity portfolio weights"
```

### Task 6: Portfolio Concentration and Cash Constraints

**Files:**
- Create: `app/src/engines/portfolio/portfolio-constraints.ts`
- Create: `app/src/engines/portfolio/portfolio-constraints.test.ts`

**Interfaces:**

```ts
export interface ConstrainedCandidate { code: string; industry: string | null; labels: string[]; score: number; confidence: number }
export interface PortfolioConstraintResult {
  weights: Record<string, number>; removed: Array<{ code: string; reason: string }>;
  stockWeight: number; minimumCash: number; constraintCash: number;
  exposures: { industries: Record<string, number>; labels: Record<string, number> };
}
export function constrainPortfolioWeights(
  candidates: ConstrainedCandidate[], initialWeights: Record<string, number>,
  riskLevel: PortfolioRiskLevel, highCorrelationPairs: PairCorrelation[],
): PortfolioConstraintResult;
```

- [ ] **Step 1: Write failing stock, industry, label, and cash tests**

```ts
it('keeps stock weights between five and twenty percent with balanced cash at least ten percent', () => {
  const result = constrainPortfolioWeights(candidates(), { A: 0.70, B: 0.20, C: 0.10 }, 'balanced', []);
  expect(Math.max(...Object.values(result.weights))).toBeLessThanOrEqual(0.20);
  expect(Math.min(...Object.values(result.weights))).toBeGreaterThanOrEqual(0.05);
  expect(result.minimumCash).toBe(0.10);
});
it('counts multi-label positions against every label', () => {
  const result = constrainPortfolioWeights(multiLabelCandidates(), weights(), 'aggressive', []);
  expect(result.exposures.labels.成长).toBeLessThanOrEqual(0.35);
  expect(result.exposures.labels.科技).toBeLessThanOrEqual(0.35);
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/engines/portfolio/portfolio-constraints.test.ts`  
Expected: FAIL because the constraint engine does not exist.

- [ ] **Step 3: Implement deterministic iterative redistribution**

```ts
while (iteration++ < 100) {
  capStocks(0.20); capOfficialIndustries(0.35); capEveryLabel(0.35); capCorrelatedPairs(0.25);
  redistributeOnlyToCandidatesWithRemainingCapacity(profile.stockCap);
  const belowFive = activeCodes.filter(code => weights[code] > 0 && weights[code] < 0.05);
  if (belowFive.length === 0) break;
  removeLowestRanked(belowFive);
}
```

- [ ] **Step 4: Test pair cap and minimum-weight removal; run GREEN and commit**

```ts
it('caps a retained high-correlation pair at twenty-five percent', () => {
  const result = constrainPortfolioWeights(pairCandidates(), { A: 0.20, B: 0.20 }, 'aggressive', [pair('A', 'B', 0.85)]);
  expect(result.weights.A + result.weights.B).toBeLessThanOrEqual(0.25);
});
it('removes a position below five percent and transfers excess to cash', () => {
  const result = constrainPortfolioWeights(candidates(), { A: 0.96, B: 0.04 }, 'aggressive', []);
  expect(result.weights.B).toBeUndefined();
  expect(result.removed).toContainEqual(expect.objectContaining({ code: 'B' }));
});
```

Run: `npm test -- src/engines/portfolio/portfolio-constraints.test.ts`  
Expected: PASS.

```powershell
git add -- app/src/engines/portfolio/portfolio-constraints.ts app/src/engines/portfolio/portfolio-constraints.test.ts
git commit -m "feat: constrain portfolio concentrations"
```

### Task 7: Board-Lot Trade Sizing and Cash Reconciliation

**Files:**
- Create: `app/src/engines/portfolio/portfolio-trade-sizing.ts`
- Create: `app/src/engines/portfolio/portfolio-trade-sizing.test.ts`

**Interfaces:**

```ts
export interface PortfolioSizingInput { code: string; name: string; price: number; targetWeight: number }
export interface SizedPortfolioPosition extends PortfolioSizingInput {
  targetAmount: number; shares: number; actualAmount: number; actualWeight: number; weightDeviation: number;
}
export interface PortfolioSizingResult {
  positions: SizedPortfolioPosition[]; investedAmount: number; actualStockWeight: number;
  minimumCashAmount: number; constraintCashAmount: number; boardLotCashAmount: number; totalCashAmount: number;
}
export function sizePortfolioTrades(
  capital: number, inputs: PortfolioSizingInput[], minimumCashWeight: number, constraintCashWeight: number,
): PortfolioSizingResult;
```

- [ ] **Step 1: Write the failing sizing test**

```ts
it('uses one-hundred-share lots and never exceeds capital', () => {
  const result = sizePortfolioTrades(100000, [{ code: 'A', name: 'A', price: 12.34, targetWeight: 0.20 }], 0.10, 0.70);
  expect(result.positions[0].shares % 100).toBe(0);
  expect(result.investedAmount + result.totalCashAmount).toBeCloseTo(100000, 2);
  expect(result.investedAmount).toBeLessThanOrEqual(100000);
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/engines/portfolio/portfolio-trade-sizing.test.ts`  
Expected: FAIL because the sizing module does not exist.

- [ ] **Step 3: Implement sizing with the existing helper**

```ts
const targetAmount = capital * input.targetWeight;
const shares = currentBoardLotShares(targetAmount, input.price);
const actualAmount = roundMoney(shares * input.price);
const actualWeight = actualAmount / capital;
```

Calculate minimum cash first, then constraint cash, then the residual created by board-lot rounding. Reconcile to two decimals so invested amount plus all cash equals capital.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- src/engines/portfolio/portfolio-trade-sizing.test.ts src/features/securities/portfolio-live-pricing.test.ts`  
Expected: PASS.

```powershell
git add -- app/src/engines/portfolio/portfolio-trade-sizing.ts app/src/engines/portfolio/portfolio-trade-sizing.test.ts
git commit -m "feat: size executable portfolio trades"
```

### Task 8: End-to-End Portfolio Orchestrator

**Files:**
- Create: `app/src/features/securities/all-watchlists-portfolio-service.ts`
- Create: `app/src/features/securities/all-watchlists-portfolio-service.test.ts`

**Interfaces:**

```ts
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
export interface AllWatchlistsPortfolioRequest { capital: number; riskLevel: PortfolioRiskLevel; force?: boolean }
export interface AllWatchlistsPortfolioProgress {
  snapshotId: string; completed: number; total: number; successes: number; failures: number;
}
export interface DeterministicPortfolioResult {
  algorithmVersion: 'all-watchlists-risk-parity-v1'; snapshot: PortfolioCandidateSnapshot;
  riskLevel: PortfolioRiskLevel; parameters: Record<string, number>;
  selected: PortfolioCandidateAnalysis[]; excluded: PortfolioExclusion[];
  targetWeights: Record<string, number>; riskContributions: Record<string, number>;
  sizing: PortfolioSizingResult;
  metrics: { annualizedVolatility: number; concentration: number; maximumPairCorrelation: number | null };
  dataAsOf: string; stale: boolean;
}
export async function buildAllWatchlistsPortfolio(
  request: AllWatchlistsPortfolioRequest,
  options: { shouldPublish?: () => boolean; onProgress?: (progress: AllWatchlistsPortfolioProgress) => void },
  overrides?: Partial<AllWatchlistsPortfolioDependencies>,
): Promise<DeterministicPortfolioResult>;
```

- [ ] **Step 1: Write failing pipeline and progress tests**

```ts
it('does not build the portfolio until every candidate has finished analysis', async () => {
  const progress: string[] = [];
  const result = await buildAllWatchlistsPortfolio(request(), { onProgress: p => progress.push(`${p.completed}/${p.total}`) }, deps());
  expect(progress.at(-1)).toBe('12/12');
  expect(result.snapshot.candidates).toHaveLength(12);
  expect(result.selected.length).toBeLessThanOrEqual(10);
});
it('reuses analysis when only risk preference changes', async () => {
  const d = deps();
  await buildAllWatchlistsPortfolio(request('balanced'), {}, d);
  await buildAllWatchlistsPortfolio(request('conservative'), {}, d);
  expect(d.analyzeCandidates).toHaveBeenCalledTimes(1);
  expect(d.selectCandidates).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/features/securities/all-watchlists-portfolio-service.test.ts`  
Expected: FAIL because the orchestrator does not exist.

- [ ] **Step 3: Implement the fixed pipeline order**

```ts
const snapshot = deps.aggregateCandidates();
const quotes = await deps.fetchQuotes(snapshot.candidates.map(item => item.code));
const analyses = await deps.analyzeCandidates(snapshot, quotes, securityMaster, analysisOptions);
const selection = deps.selectCandidates(successes(analyses), request.riskLevel);
const covariance = deps.covariance(selectedReturns(selection.selected));
const base = deps.solveRiskParity(weightInputs(selection.selected), covariance.matrix);
const constrained = deps.constrain(selection.selected, base.weights, request.riskLevel, selection.highCorrelationPairs);
const sizing = deps.sizeTrades(request.capital, sizingInputs(constrained), profile.cashFloor, constrained.constraintCash);
```

- [ ] **Step 4: Test stale runs and total quote failure, run GREEN, and commit**

```ts
it('marks an old completed snapshot stale', async () => {
  let publish = true;
  const result = await buildAllWatchlistsPortfolio(request(), { shouldPublish: () => publish,
    onProgress: () => { publish = false; } }, deps());
  expect(result.stale).toBe(true);
});
it('throws NO_QUOTES so the page can preserve its last successful result', async () => {
  await expect(buildAllWatchlistsPortfolio(request(), {}, deps({ fetchQuotes: async () => ({}) })))
    .rejects.toMatchObject({ code: 'NO_QUOTES' });
});
```

Run: `npm test -- src/features/securities/all-watchlists-portfolio-service.test.ts`  
Expected: PASS.

```powershell
git add -- app/src/features/securities/all-watchlists-portfolio-service.ts app/src/features/securities/all-watchlists-portfolio-service.test.ts
git commit -m "feat: orchestrate all-watchlists portfolios"
```

### Task 9: Backward-Compatible Saved Portfolio Snapshots

**Files:**
- Modify: `app/src/features/securities/portfolio-group-storage.ts`
- Modify: `app/src/features/securities/portfolio-group-storage.test.ts`

**Interfaces:**

```ts
// Optional PortfolioVersion fields
algorithmVersion?: string;
candidateSnapshotId?: string;
sourceWatchlists?: Array<{ id: string; name: string }>;
parameters?: Record<string, number | string | boolean>;
dataAsOf?: string;
cashBreakdown?: { minimumCashAmount: number; constraintCashAmount: number; boardLotCashAmount: number; totalCashAmount: number };
portfolioMetrics?: { annualizedVolatility: number; concentration: number; maximumPairCorrelation: number | null };
excludedSummary?: Array<{ code: string; reasonCode: string; reason: string }>;

// Optional PortfolioPositionSnapshot fields
targetAllocation?: number;
actualAllocation?: number;
riskContribution?: number;
industry?: string | null;
sourceWatchlistIds?: string[];
tags?: string[];
confidence?: number;
risks?: string[];
```

- [ ] **Step 1: Write failing old-version and deep-copy tests**

```ts
it('still loads old v1 versions without snapshot fields', () => {
  expect(loadPortfolioGroups(storageWith(oldV1Group()))).toHaveLength(1);
});
it('saves and deep-copies nested reproducibility data', () => {
  const draft = completeDraft();
  const saved = savePortfolioVersion({ newGroupName: '全股池组合' }, draft, options).version;
  draft.positions[0].tags!.push('mutated');
  expect(saved.algorithmVersion).toBe('all-watchlists-risk-parity-v1');
  expect(saved.positions[0].tags).not.toContain('mutated');
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/features/securities/portfolio-group-storage.test.ts`  
Expected: FAIL on the new nested snapshot assertions.

- [ ] **Step 3: Add optional fields and explicit nested cloning**

```ts
positions: draft.positions.map(position => ({ ...position,
  sourceWatchlistIds: position.sourceWatchlistIds ? [...position.sourceWatchlistIds] : undefined,
  tags: position.tags ? [...position.tags] : undefined,
  risks: position.risks ? [...position.risks] : undefined,
})),
sourceWatchlists: draft.sourceWatchlists?.map(item => ({ ...item })),
excludedSummary: draft.excludedSummary?.map(item => ({ ...item })),
```

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- src/features/securities/portfolio-group-storage.test.ts`  
Expected: PASS.

```powershell
git add -- app/src/features/securities/portfolio-group-storage.ts app/src/features/securities/portfolio-group-storage.test.ts
git commit -m "feat: save reproducible portfolio snapshots"
```

### Task 10: Portfolio Allocation Page Integration

**Files:**
- Modify: `app/src/features/securities/PortfolioAllocationPage.tsx`
- Modify: `app/src/features/securities/PortfolioAllocationPage.test.tsx`

**Interfaces:**
- Consumes: `buildAllWatchlistsPortfolio`, `DeterministicPortfolioResult`, realtime quotes, Task 9 storage.
- Produces: full-pool progress, result/exclusion/cash panels, stale-result protection, deterministic save, read-only AI explanation.

- [ ] **Step 1: Mock the orchestrator and write failing full-pool tests**

```tsx
it('analyzes the merged all-watchlists snapshot', async () => {
  seedWatchlists([{ id: 'a', codes: ['000001'] }, { id: 'b', codes: ['600519', '000001'] }]);
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: /开始分析全部自选股/ }));
  expect(mocks.buildAllWatchlistsPortfolio).toHaveBeenCalledWith(
    expect.objectContaining({ capital: 100000, riskLevel: 'balanced' }),
    expect.objectContaining({ onProgress: expect.any(Function), shouldPublish: expect.any(Function) }),
  );
  expect(await screen.findByText('正在分析全部自选股：2 / 2')).toBeInTheDocument();
});
it('does not fill a ten-stock display when only six qualify', async () => {
  mocks.buildAllWatchlistsPortfolio.mockResolvedValue(resultWithPositions(6));
  renderPage(); await startAnalysis();
  expect(screen.getByText('未达到质量门槛，不强制补位')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/features/securities/PortfolioAllocationPage.test.tsx`  
Expected: FAIL because the page still analyzes only the active pool and preselects at most eight.

- [ ] **Step 3: Delete the page-local preselection/scoring path and call the service**

```ts
const runId = ++analysisRunRef.current;
const result = await buildAllWatchlistsPortfolio({ capital, riskLevel, force }, {
  shouldPublish: () => analysisRunRef.current === runId,
  onProgress: next => analysisRunRef.current === runId && setProgress(next),
});
if (analysisRunRef.current === runId) setPortfolioResult(result);
```

Keep portfolio-group management and presentation in the page. Changing risk level reruns selection/weighting without `force`; manual refresh uses `force: true`.

- [ ] **Step 4: Add failing result, exclusion, cash, and save tests**

```tsx
expect(screen.getByText('目标股票仓位 78%')).toBeInTheDocument();
expect(screen.getByText('最低现金 10%')).toBeInTheDocument();
expect(screen.getByText('约束现金 8%')).toBeInTheDocument();
expect(screen.getByText('整手零碎现金 4%')).toBeInTheDocument();
await userEvent.click(screen.getByRole('button', { name: '查看全部未入选股票' }));
expect(screen.getByText('相关性过高')).toBeInTheDocument();
```

- [ ] **Step 5: Implement display and complete saved drafts**

Each selected row shows target/actual weight, shares, amount, score, confidence, risk contribution, official industry, source pools, labels, reasons, and risks. Save algorithm version, candidate snapshot ID, all sources, parameters, data time, cash split, metrics, positions, and exclusion summary. AI summary remains a separate optional string.

- [ ] **Step 6: Preserve realtime overlays and error fallback**

Realtime prices update marked current values without rerunning candidate analysis. On `NO_QUOTES`, retain the last successful portfolio and display a stale-data warning.

- [ ] **Step 7: Run GREEN and commit**

Run: `npm test -- src/features/securities/PortfolioAllocationPage.test.tsx src/features/securities/portfolio-group-storage.test.ts src/features/securities/portfolio-live-pricing.test.ts`  
Expected: PASS.

```powershell
git add -- app/src/features/securities/PortfolioAllocationPage.tsx app/src/features/securities/PortfolioAllocationPage.test.tsx
git commit -m "feat: allocate portfolios from all watchlists"
```

### Task 11: Regression and Protected-Page Verification

**Files:**
- Verify only; do not modify `app/src/features/securities/StockAnalysisPage.tsx`.

**Interfaces:**
- Consumes: Tasks 1–10.
- Produces: verified implementation and an exact list of unrelated pre-existing failures/warnings.

- [ ] **Step 1: Run all new portfolio suites**

```powershell
npm test -- src/features/securities/all-watchlists-portfolio-candidates.test.ts src/engines/portfolio/portfolio-risk-metrics.test.ts src/features/securities/portfolio-candidate-analysis.test.ts src/engines/portfolio/portfolio-candidate-selection.test.ts src/engines/portfolio/portfolio-risk-parity.test.ts src/engines/portfolio/portfolio-constraints.test.ts src/engines/portfolio/portfolio-trade-sizing.test.ts src/features/securities/all-watchlists-portfolio-service.test.ts src/features/securities/portfolio-group-storage.test.ts src/features/securities/PortfolioAllocationPage.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run affected securities regressions**

```powershell
npm test -- src/features/securities/WatchlistPage.test.tsx src/features/securities/watchlist-buy-advice-service.test.ts src/engines/market-analysis/medium-term-buy-advice.test.ts src/features/securities/portfolio-live-pricing.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck, lint, build, and the broader suite**

Run: `npm run typecheck`  
Expected: PASS.

Run: `npm run lint`  
Expected: exit 0; report existing unrelated warnings and introduce no new warning in changed files.

Run: `npm run build`  
Expected: PASS; pre-existing chunk-size and ineffective-dynamic-import warnings may remain.

Run: `npm test`  
Expected: all new and affected tests pass. If stock-directory tests still report expected `31` versus actual `32`, or expected `partial` versus actual `success`, record those failures and do not modify them.

- [ ] **Step 4: Verify protected paths and workspace cleanliness**

```powershell
git diff --name-only be4ba68..HEAD
git diff --check
git status --short
```

Expected: no `app/src/features/securities/StockAnalysisPage.tsx`, no whitespace errors, and no unrelated files.

