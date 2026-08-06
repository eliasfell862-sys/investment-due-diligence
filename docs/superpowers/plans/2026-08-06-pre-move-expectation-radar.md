# 启动预期雷达 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents for this project.

**Goal:** 在股票主页新增独立“启动预期雷达”，预测自选股和板块轮动候选在未来 3–15 个交易日内同时实现 5% 涨幅、3% 沪深 300 超额收益且最大回撤不超过 4% 的可能性。

**Architecture:** 使用两阶段扫描降低全市场请求量：先批量计算行业轮动并选出最多 200 只市场候选，再对候选和全部自选股执行资金、K 线、相对强度和风险深度计算。纯函数信号引擎产生 0–100 信号强度，历史滚动样本通过贝叶斯收缩校准为启动预期概率；独立 Dexie 数据库保存正式收盘快照和前向标签，页面只读展示，不触发交易系统。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、Testing Library、Dexie、现有东方财富/腾讯市场数据适配器、现有技术指标与 A 股交易日历。

## Global Constraints

- 不使用子代理；实施使用 `executing-plans` 在当前会话分批完成。
- 不修改 `StockAnalysisPage.tsx` 的计算和展示逻辑。
- 不发送收件箱消息，不自动写入实际持仓或虚拟仓，不触发交易。
- 扫描范围为全部自选股加最多 200 只板块轮动候选，不逐只深度扫描全部 A 股。
- 预测窗口固定为第 3 至第 15 个 A 股交易日。
- 成功标签必须同时满足：涨幅至少 5%、相对沪深 300 超额至少 3%、目标实现前最大回撤不超过 4%。
- 只有交易日 15:10 后的正式收盘快照进入概率校准；盘中结果仅为预览。
- 正式概率要求全局已完成标签不少于 200 条、相似特征组不少于 30 条；不足时状态最高为“等待确认”。
- 状态只能是“可布局”“等待确认”“暂不布局”。
- 盘中缓存固定 15 分钟，深度请求并发上限固定为 4。
- InStock 的 Apache 2.0 和 efinance 的 MIT 许可声明必须进入商业发行的第三方许可文件。

## File Structure

### Market data adapters

- `app/src/infrastructure/market-data/pre-move-market-data-api.ts`：解析和获取行业资金、个股多日资金、沪深 300 日线。
- `app/src/infrastructure/market-data/pre-move-market-data-api.test.ts`：固定响应解析和部分失败测试。

### Prediction domain

- `app/src/features/securities/pre-move-radar/types.ts`：候选、特征、预测、快照、标签和校准类型。
- `app/src/features/securities/pre-move-radar/prediction-outcome.ts`：3–15 日成功标签计算。
- `app/src/features/securities/pre-move-radar/prediction-outcome.test.ts`：交易窗口、回撤和超额收益测试。
- `app/src/features/securities/pre-move-radar/signal-engine.ts`：五维特征评分、风险门控、解释文本。
- `app/src/features/securities/pre-move-radar/signal-engine.test.ts`：评分与硬过滤测试。
- `app/src/features/securities/pre-move-radar/probability-calibrator.ts`：滚动校准、贝叶斯收缩、阈值选择和状态判定。
- `app/src/features/securities/pre-move-radar/probability-calibrator.test.ts`：样本门槛、概率和状态测试。

### Candidate selection and orchestration

- `app/src/features/securities/pre-move-radar/candidate-universe.ts`：自选股与行业候选合并、去重和上限控制。
- `app/src/features/securities/pre-move-radar/candidate-universe.test.ts`：候选池测试。
- `app/src/features/securities/pre-move-radar/radar-service.ts`：两阶段扫描、缓存、并发、降级和快照保存。
- `app/src/features/securities/pre-move-radar/radar-service.test.ts`：端到端服务测试。

### Persistence and forward evaluation

- `app/src/features/securities/pre-move-radar/radar-db.ts`：独立 Dexie schema。
- `app/src/features/securities/pre-move-radar/radar-repository.ts`：快照、预测、标签和校准读写。
- `app/src/features/securities/pre-move-radar/radar-repository.test.ts`：幂等和查询测试。
- `app/src/features/securities/pre-move-radar/forward-evaluator.ts`：到期预测标签补充与校准样本生成。
- `app/src/features/securities/pre-move-radar/forward-evaluator.test.ts`：3/5/10/15 日到期与无未来数据测试。
- `app/src/features/securities/pre-move-radar/usePreMoveOutcomeScheduler.ts`：全局轻量补做调度。
- `app/src/features/securities/pre-move-radar/usePreMoveOutcomeScheduler.test.tsx`：启动、间隔和并发测试。

### UI integration

- `app/src/features/securities/pre-move-radar/usePreMoveRadar.ts`：页面状态、刷新和筛选。
- `app/src/features/securities/pre-move-radar/usePreMoveRadar.test.tsx`：Hook 测试。
- `app/src/features/securities/PreMoveRadarPage.tsx`：独立页面。
- `app/src/features/securities/PreMoveRadarPage.test.tsx`：页面和个股跳转测试。
- Modify `app/src/features/securities/SecuritiesWorkbenchPage.tsx`：增加入口按钮。
- Modify `app/src/features/securities/SecuritiesWorkbenchPage.test.tsx`：入口测试。
- Modify `app/src/app/router.tsx`：增加根路径与项目路径路由。
- Modify `app/src/app/router.test.tsx`：路由测试。
- Modify `app/src/features/securities/RealtimeBacktestMonitorProvider.tsx`：只挂载前向标签补做 Hook，不改变现有监控返回值。
- Modify `app/src/features/securities/RealtimeBacktestMonitorProvider.test.tsx`：调度 Hook 挂载回归测试。

### Compliance

- `app/THIRD_PARTY_NOTICES.md`：补充 InStock Apache 2.0 和 efinance MIT 来源及用途。

---

### Task 1: Add reproducible market-data adapters

**Files:**
- Create: `app/src/infrastructure/market-data/pre-move-market-data-api.ts`
- Test: `app/src/infrastructure/market-data/pre-move-market-data-api.test.ts`

**Interfaces:**
- Consumes: existing `StockKLine`, `MarketDataResult`, `createMarketDataMeta`, and XHR request pattern.
- Produces:

```ts
export interface IndustryFlowRow {
  industryCode: string;
  industryName: string;
  changePct1d: number;
  mainNet1d: number;
  mainRatio1d: number;
  mainNet5d: number | null;
  mainRatio5d: number | null;
  mainNet10d: number | null;
  mainRatio10d: number | null;
  leadingStockCode: string | null;
}

export interface HistoricalCapitalFlowPoint {
  date: string;
  mainNet: number;
  mainRatio: number;
  superLargeNet: number;
  largeNet: number;
}

export interface MultiDayCapitalFlow {
  code: string;
  changePct3d: number | null;
  changePct5d: number | null;
  changePct10d: number | null;
  mainNet3d: number | null;
  mainRatio3d: number | null;
  mainNet5d: number | null;
  mainRatio5d: number | null;
  mainNet10d: number | null;
  mainRatio10d: number | null;
}

export function parseIndustryFlowResponse(payload: unknown): IndustryFlowRow[];
export function parseMultiDayCapitalFlowResponse(payload: unknown, period: 3 | 5 | 10): MultiDayCapitalFlow[];
export function parseBenchmarkKlineResponse(payload: unknown): StockKLine[];
export function parseHistoricalCapitalFlowResponse(payload: unknown): HistoricalCapitalFlowPoint[];
export async function fetchIndustryFlows(): Promise<MarketDataResult<IndustryFlowRow[]>>;
export async function fetchMultiDayCapitalFlows(period: 3 | 5 | 10): Promise<MarketDataResult<MultiDayCapitalFlow[]>>;
export async function fetchCsi300Klines(days?: number): Promise<MarketDataResult<StockKLine[]>>;
export async function fetchHistoricalCapitalFlow(code: string, days?: number): Promise<MarketDataResult<HistoricalCapitalFlowPoint[]>>;
```

- [ ] **Step 1: Write failing parser tests**

Create literal response fixtures for industry, multi-day individual flow, historical daily flow and benchmark K line using the Eastmoney fields already documented by InStock: industry `f12/f14/f3/f62/f184/f164/f165/f174/f175/f204/f205`; individual 3-day `f127/f267/f268`, 5-day `f109/f164/f165`, and 10-day `f160/f174/f175`.

```ts
it('parses industry one five and ten day fund-flow fields without inventing missing values', () => {
  const rows = parseIndustryFlowResponse({ data: { diff: [{
    f12: 'BK0475', f14: '银行', f3: 1.2,
    f62: 120000000, f184: 3.1, f164: 450000000, f165: 4.6,
    f174: 700000000, f175: 5.2, f204: '600000',
  }] } });
  expect(rows[0]).toMatchObject({
    industryCode: 'BK0475', industryName: '银行', changePct1d: 1.2,
    mainNet1d: 120000000, mainRatio1d: 3.1,
    mainNet5d: 450000000, mainRatio5d: 4.6,
    mainNet10d: 700000000, mainRatio10d: 5.2,
    leadingStockCode: '600000',
  });
});

it('keeps unavailable provider fields null', () => {
  expect(parseIndustryFlowResponse({ data: { diff: [{ f12: 'BK1', f14: '测试' }] } })[0]
    .mainRatio10d).toBeNull();
});
```

- [ ] **Step 2: Run parser tests and verify RED**

Run: `npm test -- pre-move-market-data-api.test.ts`

Expected: FAIL because the adapter module and parser exports do not exist.

- [ ] **Step 3: Implement pure parsers and injectable request transport**

Use explicit numeric conversion that preserves missing values:

```ts
const finiteOrNull = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
```

Use HTTPS Eastmoney endpoints and `MarketDataResult`; do not copy Python or pandas runtime dependencies into the app. Request industry 1-day, 5-day and 10-day rankings separately and merge them by industry code, because the provider exposes period-specific field sets. Return `status: 'unavailable'` with an empty array when a provider fails.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```powershell
npm test -- pre-move-market-data-api.test.ts
npm run typecheck
```

Expected: parser tests PASS; typecheck PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add app/src/infrastructure/market-data/pre-move-market-data-api.ts app/src/infrastructure/market-data/pre-move-market-data-api.test.ts
git commit -m "feat: add pre-move market data adapters"
```

### Task 2: Define prediction types and the exact 3–15 day outcome label

**Files:**
- Create: `app/src/features/securities/pre-move-radar/types.ts`
- Create: `app/src/features/securities/pre-move-radar/prediction-outcome.ts`
- Test: `app/src/features/securities/pre-move-radar/prediction-outcome.test.ts`

**Interfaces:**
- Consumes: `StockKLine` and A-share ordered trading dates.
- Produces:

```ts
export type PreMoveStatus = 'layout_ready' | 'await_confirmation' | 'avoid_layout';
export type PreMoveCandidateSource = 'watchlist' | 'rotation' | 'watchlist_and_rotation';

export interface PreMoveFeatureScores {
  industryRotation: number;
  capitalFlow: number;
  accumulation: number;
  relativeStrength: number;
  upsideRoom: number;
  total: number;
}

export interface IndustryRotationView {
  industry: string;
  rank: number;
  compositeScore: number;
  returnPct1d: number;
  returnPct5d: number | null;
  returnPct10d: number | null;
  mainNet1d: number;
  mainNet5d: number | null;
  mainNet10d: number | null;
  stage: 'watch' | 'accumulating' | 'starting' | 'overheated' | 'weakening';
}

export interface PreMovePrediction {
  code: string;
  name: string;
  industry: string | null;
  source: PreMoveCandidateSource;
  currentPrice: number;
  signalScore: number;
  scores: PreMoveFeatureScores;
  rawFeatures: Record<string, number | null>;
  featureCoverage: string[];
  probability: number;
  confidence: number;
  formalProbability: boolean;
  sampleSize: number;
  similarSampleSize: number;
  status: PreMoveStatus;
  expectedWindow: '3_5' | '5_10' | '10_15';
  positiveEvidence: string[];
  risks: string[];
  invalidationConditions: string[];
  dataCompleteness: number;
  dataSources: string[];
  dataAsOf: string;
}

export interface PredictionOutcomeInput {
  signalDate: string;
  signalClose: number;
  benchmarkSignalClose: number;
  stockBars: StockKLine[];
  benchmarkBars: StockKLine[];
}

export interface PredictionOutcome {
  evaluated: boolean;
  success: boolean | null;
  firstSuccessTradingDay: number | null;
  maxReturnPct: number | null;
  maxExcessReturnPct: number | null;
  maxDrawdownPct: number | null;
  observations: Array<{
    tradingDay: number;
    date: string;
    returnPct: number;
    excessReturnPct: number;
    drawdownPct: number;
  }>;
}

export function evaluatePredictionOutcome(input: PredictionOutcomeInput): PredictionOutcome;
```

- [ ] **Step 1: Write failing success and failure tests**

```ts
it('marks success only when one day from 3 through 15 meets all three targets', () => {
  const result = evaluatePredictionOutcome(fixture({
    stockCloses: [100, 101, 102, 106],
    stockLows: [99, 98, 97, 105],
    benchmarkCloses: [100, 100.5, 101, 102],
  }));
  expect(result).toMatchObject({ success: true, firstSuccessTradingDay: 3 });
});

it('fails when the stock gains five percent but drawdown first exceeds four percent', () => {
  const result = evaluatePredictionOutcome(fixture({
    stockCloses: [100, 99, 98, 106], stockLows: [99, 95, 94, 105],
    benchmarkCloses: [100, 100, 100, 101],
  }));
  expect(result.success).toBe(false);
});

it('does not evaluate before fifteen forward trading bars are available', () => {
  expect(evaluatePredictionOutcome(fixture({ forwardDays: 10 })).evaluated).toBe(false);
});
```

- [ ] **Step 2: Run the outcome test and verify RED**

Run: `npm test -- prediction-outcome.test.ts`

Expected: FAIL because `evaluatePredictionOutcome` does not exist.

- [ ] **Step 3: Implement the label without natural-day arithmetic**

Align stock and benchmark bars by date, number only common bars after `signalDate`, and evaluate indices 3 through 15. For each target day:

```ts
const stockReturnPct = (stock.close / signalClose - 1) * 100;
const benchmarkReturnPct = (benchmark.close / benchmarkSignalClose - 1) * 100;
const excessReturnPct = stockReturnPct - benchmarkReturnPct;
const drawdownPct = (Math.min(...stockBarsThroughTarget.map(bar => bar.low)) / signalClose - 1) * 100;
const success = stockReturnPct >= 5 && excessReturnPct >= 3 && drawdownPct >= -4;
```

Do not use any bar after the first successful target day when reporting the success path.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- prediction-outcome.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add app/src/features/securities/pre-move-radar/types.ts app/src/features/securities/pre-move-radar/prediction-outcome.ts app/src/features/securities/pre-move-radar/prediction-outcome.test.ts
git commit -m "feat: define pre-move prediction outcome"
```

### Task 3: Build the five-dimension signal engine and hard-risk gates

**Files:**
- Create: `app/src/features/securities/pre-move-radar/signal-engine.ts`
- Test: `app/src/features/securities/pre-move-radar/signal-engine.test.ts`

**Interfaces:**
- Consumes: quote, official industry, industry rotation metrics, multi-day capital flow, indicator-enriched K lines, benchmark returns, existing strategy signals and patterns.
- Produces:

```ts
export interface PreMoveFeatureScores {
  industryRotation: number; // 0..30
  capitalFlow: number;      // 0..25
  accumulation: number;     // 0..25
  relativeStrength: number; // 0..10
  upsideRoom: number;       // 0..10
  total: number;            // 0..100
}

export type PreMoveHardRisk =
  | 'special_treatment'
  | 'suspended'
  | 'illiquid'
  | 'overheated'
  | 'core_data_missing'
  | 'capital_outflow_conflict';

export interface PreMoveSignalResult {
  scores: PreMoveFeatureScores;
  hardRisks: PreMoveHardRisk[];
  positiveEvidence: string[];
  risks: string[];
  invalidationConditions: string[];
  dataCompleteness: number;
}

export interface PreMoveIndicatorKLine extends StockKLine {
  ma?: { ma5: number; ma10: number; ma20: number; ma60: number };
  macd?: { dif: number; dea: number; bar: number };
  kdj?: { k: number; d: number; j: number };
  rsi?: { rsi6: number; rsi12: number; rsi24: number };
  boll?: { upper: number; mid: number; lower: number };
  atr?: number;
  obv?: number;
}

export interface PreMoveSignalInput {
  asOfDate: string;
  formal: boolean;
  quote: StockQuote;
  industry: {
    returnPercentile: number | null;
    flowPercentile: number | null;
    breadthPercentile: number | null;
    relativeStrengthSlopePercentile: number | null;
    stage: IndustryRotationView['stage'] | null;
  };
  capitalFlow: MultiDayCapitalFlow | null;
  flowHistory: HistoricalCapitalFlowPoint[];
  klines: PreMoveIndicatorKLine[];
  benchmarkKlines: StockKLine[];
  strategySignals: StrategySignal[];
  patterns: PatternResult[];
  specialTreatment: boolean;
  suspended: boolean;
}

export function calculatePreMoveSignal(input: PreMoveSignalInput): PreMoveSignalResult;
```

- [ ] **Step 1: Write failing score and gate tests**

```ts
it('scores a strengthening industry with positive five and ten day fund flow', () => {
  const result = calculatePreMoveSignal(strengtheningFixture());
  expect(result.scores.industryRotation).toBeGreaterThanOrEqual(22);
  expect(result.positiveEvidence).toContain('行业资金与相对强度同步改善');
});

it('recognizes capital inflow while price has not fully moved', () => {
  const result = calculatePreMoveSignal(flowDivergenceFixture());
  expect(result.scores.capitalFlow).toBeGreaterThanOrEqual(18);
  expect(result.positiveEvidence).toContain('资金先行流入，价格尚未充分启动');
});

it('hard-gates an overheated stock even with a high raw score', () => {
  const result = calculatePreMoveSignal(overheatedFixture());
  expect(result.hardRisks).toContain('overheated');
});

it('hard-gates missing K line or capital-flow core data', () => {
  expect(calculatePreMoveSignal(missingCoreDataFixture()).hardRisks)
    .toContain('core_data_missing');
});
```

- [ ] **Step 2: Run the signal test and verify RED**

Run: `npm test -- signal-engine.test.ts`

Expected: FAIL because the signal engine does not exist.

- [ ] **Step 3: Implement exact bounded dimension formulas**

Use these point allocations:

```ts
const DIMENSION_MAX = {
  industryRotation: 30,
  capitalFlow: 25,
  accumulation: 25,
  relativeStrength: 10,
  upsideRoom: 10,
} as const;
```

Industry rotation: return percentile 8, fund-flow percentile 8, breadth 6, relative-strength slope 4, non-overheated rotation stage 4.

Capital flow: 5/10-day main-flow percentiles 8, positive-flow continuity 5, large-order structure 5, OBV/MFI slope 4, positive price-flow divergence 3.

Accumulation: MA convergence 5, ATR contraction 5, BOLL bandwidth contraction 5, contraction-then-volume-recovery 5, momentum/pattern inflection 5.

Relative strength: improving 5/10/20-day excess-return slope, bounded to 10.

Upside room: start at 10 and deduct for 10-day surge, MA20 deviation, RSI/KDJ overheat, distance to recent high, and near-limit-up state.

Apply gates after scoring. For formal post-close scans, minimum liquidity is current-day traded amount of RMB 50 million; for intraday previews, use turnover of at least 0.3% and mark the liquidity gate provisional until close; overheat is any two of: 5-day gain at least 15%, price at least 10% above MA20, RSI6 at least 80, KDJ-J at least 95.

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
npm test -- signal-engine.test.ts short-term-trading-advice.test.ts medium-term-buy-advice.test.ts
npm run typecheck
```

Expected: all PASS; existing advice engines unchanged.

- [ ] **Step 5: Commit Task 3**

```powershell
git add app/src/features/securities/pre-move-radar/signal-engine.ts app/src/features/securities/pre-move-radar/signal-engine.test.ts
git commit -m "feat: add pre-move signal engine"
```

### Task 4: Calibrate signal strength into probability and three statuses

**Files:**
- Create: `app/src/features/securities/pre-move-radar/probability-calibrator.ts`
- Test: `app/src/features/securities/pre-move-radar/probability-calibrator.test.ts`

**Interfaces:**
- Consumes: labeled historical samples with score, market regime, data completeness, success and realized excess return.
- Produces:

```ts
export interface CalibrationSample {
  id: string;
  code: string;
  modelVersion: string;
  featureCoverage: string[];
  signalDate: string;
  score: number;
  dataCompleteness: number;
  marketRegime: 'strong' | 'sideways' | 'weak';
  success: boolean;
  excessReturnPct: number;
}

export interface CalibratedPrediction {
  probability: number;
  confidence: number;
  formal: boolean;
  sampleSize: number;
  similarSampleSize: number;
  threshold: number;
  status: PreMoveStatus;
  calibrationLabel: 'formal' | 'calibrating';
}

export function selectLayoutThreshold(samples: CalibrationSample[]): number;
export interface CalibrationInput {
  score: number;
  marketRegime: CalibrationSample['marketRegime'];
  featureCoverage: string[];
  dataCompleteness: number;
  hardRisks: PreMoveHardRisk[];
  samples: CalibrationSample[];
}

export function calibrateProbability(input: CalibrationInput): CalibratedPrediction;
```

- [ ] **Step 1: Write failing calibration tests**

```ts
it('shrinks a small perfect sample toward the market base rate', () => {
  const result = calibrateProbability(calibrationFixture({ global: 200, similar: 5, similarWins: 5 }));
  expect(result.probability).toBeLessThan(100);
  expect(result.formal).toBe(false);
  expect(result.status).toBe('await_confirmation');
});

it('never emits layout_ready before 200 global and 30 similar labels', () => {
  const result = calibrateProbability(calibrationFixture({ global: 199, similar: 29 }));
  expect(result.status).not.toBe('layout_ready');
});

it('emits avoid_layout when a hard risk exists', () => {
  expect(calibrateProbability(calibrationFixture({ hardRisks: ['overheated'] })).status)
    .toBe('avoid_layout');
});

it('selects no threshold below fifty-five percent', () => {
  expect(selectLayoutThreshold(validationSamples())).toBeGreaterThanOrEqual(55);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- probability-calibrator.test.ts`

Expected: FAIL because calibrator exports do not exist.

- [ ] **Step 3: Implement Bayesian shrinkage and threshold selection**

Use a prior strength of 20 samples:

```ts
const probability = ((similarSuccesses + baseRate * 20) / (similarCount + 20)) * 100;
```

Choose the lowest threshold from 55 through 80 where validation signals at or above the threshold have at least 60% realized success and positive average excess return. If none qualifies, use 80 and prevent `layout_ready` until a qualifying threshold exists.

Status order:

```ts
if (hardRisks.length > 0 || completeness < 0.8) return 'avoid_layout';
if (!formal || confidence < 60) return 'await_confirmation';
if (probability >= threshold) return 'layout_ready';
if (probability >= baseRate) return 'await_confirmation';
return 'avoid_layout';
```

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- probability-calibrator.test.ts prediction-outcome.test.ts signal-engine.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
git add app/src/features/securities/pre-move-radar/probability-calibrator.ts app/src/features/securities/pre-move-radar/probability-calibrator.test.ts
git commit -m "feat: calibrate pre-move probabilities"
```

### Task 5: Generate historical calibration samples without future leakage

**Files:**
- Create: `app/src/features/securities/pre-move-radar/historical-calibration.ts`
- Test: `app/src/features/securities/pre-move-radar/historical-calibration.test.ts`

**Interfaces:**
- Consumes: historical stock K lines, CSI 300 K lines, point-in-time individual fund-flow rows, Task 2 outcome labels and Task 3 signal engine.
- Produces:

```ts
export interface HistoricalCalibrationInput {
  code: string;
  stockBars: StockKLine[];
  benchmarkBars: StockKLine[];
  flowHistory: HistoricalCapitalFlowPoint[];
  industryHistory?: Array<{
    date: string;
    returnPercentile: number;
    flowPercentile: number;
    breadthPercentile: number;
    relativeStrengthSlopePercentile: number;
    stage: IndustryRotationView['stage'];
  }>;
  startAfterTradingDays?: number;
  strideTradingDays?: number;
  modelVersion: string;
}

export function generateHistoricalCalibrationSamples(
  input: HistoricalCalibrationInput,
  dependencies?: { calculateSignal?: typeof calculatePreMoveSignal },
): CalibrationSample[];
```

- [ ] **Step 1: Write failing walk-forward tests**

```ts
it('passes only data available on each historical signal date into the signal engine', () => {
  generateHistoricalCalibrationSamples(historyFixture({ tradingDays: 120 }), { calculateSignal });
  for (const call of calculateSignal.mock.calls) {
    const signalDate = call[0].asOfDate;
    expect(call[0].klines.every((bar: StockKLine) => bar.date <= signalDate)).toBe(true);
    expect(call[0].flowHistory.every((row: HistoricalCapitalFlowPoint) => row.date <= signalDate)).toBe(true);
  }
});

it('labels each sample using only the third through fifteenth forward trading days', () => {
  const samples = generateHistoricalCalibrationSamples(successfulHistoryFixture());
  expect(samples[0]).toMatchObject({ success: true, signalDate: '2026-01-30' });
});

it('uses only historically available feature dimensions', () => {
  const samples = generateHistoricalCalibrationSamples(historyFixture({ industryHistory: [] }));
  expect(samples[0].featureCoverage).not.toContain('industry_fund_flow');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- historical-calibration.test.ts`

Expected: FAIL because the historical calibration generator does not exist.

- [ ] **Step 3: Implement expanding-window sample generation**

Start after 60 common stock/benchmark trading bars and stop 15 bars before the final date. Generate one signal every 5 trading days by default. For a signal at index `i`, pass only `bars.slice(0, i + 1)` and flow rows with `date <= signalDate` to the signal engine; pass `bars.slice(i + 1, i + 16)` only to `evaluatePredictionOutcome`.

Historical calibration must use a `featureCoverage` list. For each signal date, use only the latest `industryHistory` row whose `date <= signalDate`; when no point-in-time industry row exists, omit every industry-history-only feature from `featureCoverage` and score that dimension from no unavailable input. Do not insert current industry flow, current board membership changes or current fundamentals into past dates. The live probability calibrator compares only the feature subset present in both the live prediction and historical sample. Each returned sample must copy `code`, `modelVersion`, `dataCompleteness`, score, regime and realized result so repository filtering and audit remain deterministic.

- [ ] **Step 4: Persist generated samples idempotently**

Use sample id `${modelVersion}-${code}-${signalDate}`. Repository insertion must use `put`, so rescanning the same history does not duplicate samples. `listCalibrationSamples(modelVersion)` must return only the active model version, preventing labels produced by incompatible feature definitions from entering the live probability. Bootstrap at most 50 rotation candidates plus all watchlist stocks, with four concurrent history loads.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
npm test -- historical-calibration.test.ts prediction-outcome.test.ts signal-engine.test.ts probability-calibrator.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```powershell
git add app/src/features/securities/pre-move-radar/historical-calibration.ts app/src/features/securities/pre-move-radar/historical-calibration.test.ts
git commit -m "feat: generate pre-move calibration history"
```

### Task 6: Build the two-stage candidate universe

**Files:**
- Create: `app/src/features/securities/pre-move-radar/candidate-universe.ts`
- Test: `app/src/features/securities/pre-move-radar/candidate-universe.test.ts`

**Interfaces:**
- Consumes: `loadMonitoringUniverse()`, stock directory, all-market lightweight quotes, industry flows.
- Produces:

```ts
export interface PreMoveCandidateSeed {
  code: string;
  name: string;
  industry: string | null;
  source: 'watchlist' | 'rotation' | 'watchlist_and_rotation';
  industryRank: number | null;
}

export interface IndustryScreenInput {
  industry: string;
  returnPercentile: number;
  flowPercentile: number;
  breadthPercentile: number;
  relativeStrengthSlopePercentile: number;
}

export interface CandidateUniverseInput {
  watchlistCodes: string[];
  directory: AStockDirectoryItem[];
  quotes: StockQuote[];
  industries: Array<IndustryScreenInput & { rank: number }>;
  capitalFlows: MultiDayCapitalFlow[];
  maxRotationCandidates?: number;
}

export function selectStrengtheningIndustries(rows: IndustryScreenInput[], limit?: number): string[];
export function buildPreMoveCandidateUniverse(input: CandidateUniverseInput): PreMoveCandidateSeed[];
```

- [ ] **Step 1: Write failing universe tests**

```ts
it('always includes every watchlist stock even outside the top industries', () => {
  const result = buildPreMoveCandidateUniverse(universeFixture());
  expect(result.map(item => item.code)).toContain('000001');
});

it('adds only official-industry stocks from the top ten strengthening industries', () => {
  const result = buildPreMoveCandidateUniverse(universeFixture());
  expect(result.filter(item => item.source !== 'watchlist').every(item => item.industryRank! <= 10))
    .toBe(true);
});

it('deduplicates overlap and caps rotation candidates at two hundred', () => {
  const result = buildPreMoveCandidateUniverse(largeUniverseFixture());
  expect(new Set(result.map(item => item.code)).size).toBe(result.length);
  expect(result.filter(item => item.source !== 'watchlist').length).toBeLessThanOrEqual(200);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- candidate-universe.test.ts`

Expected: FAIL because candidate selection does not exist.

- [ ] **Step 3: Implement deterministic preselection**

Rank industries by the average of return percentile, fund-flow percentile, breadth percentile and relative-strength slope percentile. Select top 10 only when their composite percentile is at least 60.

Within selected industries, rank lightweight stock candidates by main-flow rank, amount rank, non-overheat score and 5-day relative return. Exclude ST names and zero-price/zero-amount rows before the 200-stock cap. Merge all watchlist codes afterward and mark overlap as `watchlist_and_rotation`.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- candidate-universe.test.ts stock-monitoring-universe.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```powershell
git add app/src/features/securities/pre-move-radar/candidate-universe.ts app/src/features/securities/pre-move-radar/candidate-universe.test.ts
git commit -m "feat: select pre-move candidate universe"
```

### Task 7: Add isolated persistence and forward outcome evaluation

**Files:**
- Create: `app/src/features/securities/pre-move-radar/radar-db.ts`
- Create: `app/src/features/securities/pre-move-radar/radar-repository.ts`
- Test: `app/src/features/securities/pre-move-radar/radar-repository.test.ts`
- Create: `app/src/features/securities/pre-move-radar/forward-evaluator.ts`
- Test: `app/src/features/securities/pre-move-radar/forward-evaluator.test.ts`

**Interfaces:**
- Consumes: prediction records, stock/benchmark K lines and `evaluatePredictionOutcome`.
- Produces:

```ts
export interface PreMoveScanRecord {
  id: string;
  tradingDate: string;
  createdAt: string;
  modelVersion: string;
  formal: boolean;
  marketRegime: 'strong' | 'sideways' | 'weak';
  dataSources: string[];
}

export interface PreMovePredictionRecord extends PreMovePrediction {
  id: string;
  scanId: string;
  tradingDate: string;
  modelVersion: string;
  marketRegime: 'strong' | 'sideways' | 'weak';
  signalClose: number;
  benchmarkSignalClose: number;
}

export interface PreMoveForwardObservation {
  id: string;
  predictionId: string;
  horizon: 3 | 5 | 10 | 15;
  observedTradingDate: string;
  returnPct: number;
  excessReturnPct: number;
  drawdownPct: number;
}

export interface PreMoveOutcomeRecord extends PredictionOutcome {
  id: string;
  predictionId: string;
  completedAt: string;
}

export class PreMoveRadarRepository {
  saveFormalScan(scan: PreMoveScanRecord, predictions: PreMovePredictionRecord[]): Promise<void>;
  getLatestScan(): Promise<{ scan: PreMoveScanRecord; predictions: PreMovePredictionRecord[] } | null>;
  listDuePredictions(asOfTradingDate: string): Promise<PreMovePredictionRecord[]>;
  saveForwardObservation(value: PreMoveForwardObservation): Promise<void>;
  saveCompletedOutcome(outcome: PreMoveOutcomeRecord, sample: CalibrationSample): Promise<void>;
  saveCalibrationSamples(samples: CalibrationSample[]): Promise<void>;
  listCalibrationSamples(modelVersion: string): Promise<CalibrationSample[]>;
}

export interface ForwardEvaluationInput {
  asOfTradingDate: string;
  repository: PreMoveRadarRepository;
  loadStockBars: (code: string, endDate: string) => Promise<StockKLine[]>;
  loadBenchmarkBars: (endDate: string) => Promise<StockKLine[]>;
  now?: () => string;
}

export interface ForwardEvaluationResult {
  savedHorizons: Array<3 | 5 | 10 | 15>;
  completedPredictionIds: string[];
  pendingPredictionIds: string[];
  errors: Array<{ predictionId: string; message: string }>;
}

export async function evaluateDuePredictions(input: ForwardEvaluationInput): Promise<ForwardEvaluationResult>;
```

- [ ] **Step 1: Write failing repository idempotency tests**

Use a unique Dexie database name per test and `fake-indexeddb`:

```ts
it('stores one formal scan per trading date and model version', async () => {
  await repository.saveFormalScan(scan, predictions);
  await repository.saveFormalScan(scan, predictions);
  expect(await db.scans.count()).toBe(1);
  expect(await db.predictions.count()).toBe(predictions.length);
});

it('stores historical calibration samples idempotently', async () => {
  await repository.saveCalibrationSamples(samples);
  await repository.saveCalibrationSamples(samples);
  expect(await db.calibrationSamples.count()).toBe(samples.length);
});
```

- [ ] **Step 2: Write failing forward-evaluation tests**

```ts
it('saves due observations at three five ten and fifteen trading days', async () => {
  const result = await evaluateDuePredictions(evaluatorFixture({ completedForwardDays: 15 }));
  expect(result.savedHorizons).toEqual([3, 5, 10, 15]);
  expect(result.completedPredictionIds).toEqual(['prediction-due']);
  expect(repository.saveCompletedOutcome).toHaveBeenCalledWith(
    expect.objectContaining({ predictionId: 'prediction-due' }),
    expect.objectContaining({ id: 'v1-000001-2026-07-01', modelVersion: 'v1' }),
  );
});

it('keeps the final success label pending before fifteen trading days', async () => {
  const result = await evaluateDuePredictions(evaluatorFixture({ completedForwardDays: 10 }));
  expect(result.savedHorizons).toEqual([3, 5, 10]);
  expect(result.completedPredictionIds).toEqual([]);
});

it('never loads market bars after the evaluation as-of date', async () => {
  await evaluateDuePredictions(evaluatorFixture());
  expect(loadStockBars).toHaveBeenCalledWith(expect.any(String), asOfDate);
});
```

- [ ] **Step 3: Run and verify RED**

Run: `npm test -- radar-repository.test.ts forward-evaluator.test.ts`

Expected: FAIL because DB, repository and evaluator are missing.

- [ ] **Step 4: Implement Dexie schema and transactional writes**

Use database `securities-pre-move-radar` with:

```ts
this.version(1).stores({
  scans: 'id, &[tradingDate+modelVersion], tradingDate, formal',
  predictions: 'id, scanId, code, tradingDate, status',
  observations: 'id, &[predictionId+horizon], predictionId, horizon',
  outcomes: 'id, &predictionId, completedAt',
  calibrationSamples: 'id, modelVersion, code, signalDate, score, marketRegime',
  calibrationRuns: 'id, modelVersion, createdAt',
});
```

Save scans, predictions and audit metadata in one transaction. `listDuePredictions` must exclude rows with a final outcome, while milestone queries must exclude only observation horizons already stored for that prediction.

- [ ] **Step 5: Implement forward evaluation with shared trading dates**

Load at most 40 daily bars after each signal and align stock and benchmark by date. Save immutable milestone observations when horizons 3, 5, 10 and 15 become available; call `evaluatePredictionOutcome` and save the final success label only at horizon 15. At horizon 15, convert the immutable prediction record and outcome into a `CalibrationSample` with id `${modelVersion}-${code}-${tradingDate}`, preserving `featureCoverage`, score, completeness, regime, success and realized excess return, then persist the outcome and sample in one `saveCompletedOutcome` Dexie transaction. Return per-code errors without aborting other predictions.

- [ ] **Step 6: Verify GREEN**

Run:

```powershell
npm test -- radar-repository.test.ts forward-evaluator.test.ts prediction-outcome.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```powershell
git add app/src/features/securities/pre-move-radar/radar-db.ts app/src/features/securities/pre-move-radar/radar-repository.ts app/src/features/securities/pre-move-radar/radar-repository.test.ts app/src/features/securities/pre-move-radar/forward-evaluator.ts app/src/features/securities/pre-move-radar/forward-evaluator.test.ts
git commit -m "feat: persist and evaluate pre-move predictions"
```

### Task 8: Orchestrate the two-stage scan with cache, concurrency and degradation

**Files:**
- Create: `app/src/features/securities/pre-move-radar/radar-service.ts`
- Test: `app/src/features/securities/pre-move-radar/radar-service.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5, 6 and 7 plus existing directory, quote, K-line, basic-data, strategy and pattern functions.
- Produces:

```ts
export interface PreMoveRadarScanResult {
  scanId: string;
  tradingDate: string;
  formal: boolean;
  marketRegime: 'strong' | 'sideways' | 'weak';
  industries: IndustryRotationView[];
  predictions: PreMovePrediction[];
  errors: Array<{ source: string; code?: string; message: string }>;
  dataAsOf: string;
  cacheStatus: 'fresh' | 'cached';
}

export interface PreMoveRadarServiceDependencies {
  now: () => Date;
  loadWatchlistUniverse: () => MonitoringUniverse;
  loadDirectory: () => Promise<AStockDirectoryItem[]>;
  loadAllQuotes: () => Promise<StockQuote[]>;
  loadIndustryFlows: () => Promise<IndustryFlowRow[]>;
  loadCapitalFlows: (period: 3 | 5 | 10) => Promise<MultiDayCapitalFlow[]>;
  loadQuote: (code: string) => Promise<StockQuote | null>;
  loadBars: (code: string, days: number) => Promise<StockKLine[]>;
  loadCapitalFlowHistory: (code: string, days: number) => Promise<HistoricalCapitalFlowPoint[]>;
  loadBenchmarkBars: (days: number) => Promise<StockKLine[]>;
  repository: PreMoveRadarRepository;
}

export async function scanPreMoveRadar(
  options?: { force?: boolean },
  dependencies?: PreMoveRadarServiceDependencies,
): Promise<PreMoveRadarScanResult>;
```

- [ ] **Step 1: Write failing orchestration tests**

```ts
it('deep-scans watchlists plus rotation candidates without scanning the full directory', async () => {
  const result = await scanPreMoveRadar({}, serviceFixture({ directorySize: 5300, watchlists: 20 }));
  expect(result.predictions.length).toBeGreaterThan(0);
  expect(loadBars.mock.calls.length).toBeLessThanOrEqual(220);
});

it('returns a cached scan inside fifteen minutes unless force is true', async () => {
  await scanPreMoveRadar({}, deps);
  const cached = await scanPreMoveRadar({}, deps);
  expect(cached.cacheStatus).toBe('cached');
  expect(loadIndustryFlows).toHaveBeenCalledTimes(1);
});

it('keeps successful candidates when one stock data request fails', async () => {
  const result = await scanPreMoveRadar({}, partialFailureFixture());
  expect(result.predictions.length).toBeGreaterThan(0);
  expect(result.errors).toContainEqual(expect.objectContaining({ code: '000002' }));
});

it('saves only a post-close formal scan', async () => {
  await scanPreMoveRadar({}, preCloseFixture());
  expect(repository.saveFormalScan).not.toHaveBeenCalled();
  await scanPreMoveRadar({ force: true }, postCloseFixture());
  expect(repository.saveFormalScan).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- radar-service.test.ts`

Expected: FAIL because `scanPreMoveRadar` is missing.

- [ ] **Step 3: Implement two-stage orchestration**

Sequence:

1. Return the in-memory or repository cache when it is newer than 15 minutes and `force !== true`.
2. Load directory, all lightweight quotes, watchlist codes, industry flows and benchmark bars in parallel.
3. Build top-industry and stock candidate seeds with Task 6.
4. Read calibration samples only for the active model version. When that set is below 200 completed labels, load 250-day price and point-in-time capital-flow histories for all watchlist stocks plus the top 50 rotation candidates, generate Task 5 walk-forward samples with four workers, and persist them idempotently. Do not backfill current industry flow into history.
5. Reload active-version calibration samples, then load deep current stock data and `loadCapitalFlowHistory(code, 60)` through a four-worker queue.
6. Calculate indicators on cloned K lines; run existing strategy and pattern scanners. Derive market regime from CSI 300 MA20/MA60 direction plus all-market breadth, returning `strong`, `sideways` or `weak` deterministically.
7. Calculate signal strength, calibrate probability and build explanations. Copy current price, raw numeric features, provider names and timestamps into each `PreMovePrediction`; derive `expectedWindow` as `3_5` only for a `starting` industry with confirmed momentum, `5_10` for accumulation with improving relative strength, otherwise `10_15`.
8. Sort by status rank, probability, confidence and signal score.
9. Persist only post-close formal results, keyed by trading date and model version.

Use `Promise.allSettled` at provider and stock boundaries. A failed industry-flow provider caps all statuses at waiting confirmation; missing per-stock K line or capital flow sets that stock to temporarily avoid layout.

- [ ] **Step 4: Verify GREEN and existing engine compatibility**

Run:

```powershell
npm test -- radar-service.test.ts candidate-universe.test.ts signal-engine.test.ts probability-calibrator.test.ts
npm test -- short-term-trading-advice.test.ts medium-term-buy-advice.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 8**

```powershell
git add app/src/features/securities/pre-move-radar/radar-service.ts app/src/features/securities/pre-move-radar/radar-service.test.ts
git commit -m "feat: orchestrate pre-move radar scans"
```

### Task 9: Add the page Hook, independent page, routes and stock-home entry

**Files:**
- Create: `app/src/features/securities/pre-move-radar/usePreMoveRadar.ts`
- Test: `app/src/features/securities/pre-move-radar/usePreMoveRadar.test.tsx`
- Create: `app/src/features/securities/PreMoveRadarPage.tsx`
- Test: `app/src/features/securities/PreMoveRadarPage.test.tsx`
- Modify: `app/src/features/securities/SecuritiesWorkbenchPage.tsx`
- Modify: `app/src/features/securities/SecuritiesWorkbenchPage.test.tsx`
- Modify: `app/src/app/router.tsx`
- Modify: `app/src/app/router.test.tsx`

**Interfaces:**
- Consumes: `scanPreMoveRadar` and its result.
- Produces:

```ts
export type PreMoveRadarFilter = 'all' | 'watchlist' | 'rotation';

export function usePreMoveRadar(): {
  result: PreMoveRadarScanResult | null;
  visiblePredictions: PreMovePrediction[];
  filter: PreMoveRadarFilter;
  setFilter: (value: PreMoveRadarFilter) => void;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};
```

- [ ] **Step 1: Write failing Hook tests**

```ts
it('loads the cached scan on mount and forces a fresh scan on refresh', async () => {
  const { result } = renderHook(() => usePreMoveRadar());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(scan).toHaveBeenCalledWith({ force: false });
  await act(() => result.current.refresh());
  expect(scan).toHaveBeenLastCalledWith({ force: true });
});

it('filters watchlist and rotation candidates without recalculating', async () => {
  const { result } = renderHook(() => usePreMoveRadar());
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.setFilter('watchlist'));
  expect(result.current.visiblePredictions.every(item => item.source !== 'rotation')).toBe(true);
  expect(scan).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Write failing page tests**

Mock the Hook and verify exact user-facing behavior:

```ts
expect(screen.getByRole('heading', { name: '启动预期雷达' })).toBeInTheDocument();
expect(screen.getByText('可布局')).toBeInTheDocument();
expect(screen.getByText('等待确认')).toBeInTheDocument();
expect(screen.getByText('暂不布局')).toBeInTheDocument();
expect(screen.getByText('启动预期 68%')).toBeInTheDocument();
expect(screen.getByText('相似样本 42')).toBeInTheDocument();
expect(screen.getByText('未来3–15个交易日')).toBeInTheDocument();
```

Click a candidate and assert navigation to `/projects/project-1/securities/stock/000001`.

- [ ] **Step 3: Write failing homepage and router tests**

Add to `SecuritiesWorkbenchPage.test.tsx`:

```ts
expect(screen.getByRole('button', { name: /启动预期雷达/ })).toBeInTheDocument();
```

Add router coverage for both `/securities/pre-move-radar` and `/projects/:projectId/securities/pre-move-radar`.

- [ ] **Step 4: Run all new UI tests and verify RED**

Run:

```powershell
npm test -- usePreMoveRadar.test.tsx PreMoveRadarPage.test.tsx SecuritiesWorkbenchPage.test.tsx router.test.tsx
```

Expected: FAIL because Hook, page, route and button are missing.

- [ ] **Step 5: Implement the Hook and page**

Page sections:

1. Header, prediction-success definition, data time and “重新扫描” button.
2. Market regime and top 10 strengthening industries.
3. Tabs: all, watchlist, rotation.
4. Candidate table/cards with probability, confidence, three-state label, five scores, sample count, evidence, risks and invalidation conditions.
5. Partial-source warnings and “样本校准中” badge.

Use existing securities CSS variables and inline panel conventions. Do not import or render `StockAnalysisPage` components.

- [ ] **Step 6: Add routes and homepage button**

Add lazy-independent page import and these routes:

```ts
{ path: 'securities/pre-move-radar', element: <PreMoveRadarPage /> },
{ path: 'projects/:projectId/securities/pre-move-radar', element: <PreMoveRadarPage /> },
```

Place the homepage button next to strategy learning:

```tsx
<button
  className="button"
  onClick={() => navigate(`/projects/${projectId}/securities/pre-move-radar`)}
>
  📡 启动预期雷达
</button>
```

- [ ] **Step 7: Verify GREEN**

Run:

```powershell
npm test -- usePreMoveRadar.test.tsx PreMoveRadarPage.test.tsx SecuritiesWorkbenchPage.test.tsx router.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 9**

```powershell
git add app/src/features/securities/pre-move-radar/usePreMoveRadar.ts app/src/features/securities/pre-move-radar/usePreMoveRadar.test.tsx app/src/features/securities/PreMoveRadarPage.tsx app/src/features/securities/PreMoveRadarPage.test.tsx app/src/features/securities/SecuritiesWorkbenchPage.tsx app/src/features/securities/SecuritiesWorkbenchPage.test.tsx app/src/app/router.tsx app/src/app/router.test.tsx
git commit -m "feat: add pre-move radar workspace"
```

### Task 10: Add automatic forward-label catch-up without coupling trading logic

**Files:**
- Create: `app/src/features/securities/pre-move-radar/usePreMoveOutcomeScheduler.ts`
- Test: `app/src/features/securities/pre-move-radar/usePreMoveOutcomeScheduler.test.tsx`
- Modify: `app/src/features/securities/RealtimeBacktestMonitorProvider.tsx`
- Modify: `app/src/features/securities/RealtimeBacktestMonitorProvider.test.tsx`

**Interfaces:**
- Consumes: `evaluateDuePredictions`, repository and existing visibility scheduling pattern.
- Produces:

```ts
export const PRE_MOVE_OUTCOMES_UPDATED_EVENT = 'sec-pre-move-outcomes-updated';

export function usePreMoveOutcomeScheduler(options?: {
  intervalMs?: number;
  runCatchUp?: () => Promise<{ completed: number; pending: number }>;
}): void;
```

- [ ] **Step 1: Write failing scheduler tests**

```ts
it('checks due prediction outcomes on mount and when the page becomes visible', async () => {
  renderHook(() => usePreMoveOutcomeScheduler({ runCatchUp, intervalMs: 60_000 }));
  await waitFor(() => expect(runCatchUp).toHaveBeenCalledTimes(1));
  document.dispatchEvent(new Event('visibilitychange'));
  await waitFor(() => expect(runCatchUp).toHaveBeenCalledTimes(2));
});

it('does not overlap slow outcome runs', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const runCatchUp = vi.fn(() => new Promise<{ completed: number; pending: number }>(resolve => {
    release = () => resolve({ completed: 0, pending: 1 });
  }));
  renderHook(() => usePreMoveOutcomeScheduler({ runCatchUp, intervalMs: 1_000 }));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(runCatchUp).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
});
```

Add a Provider test that mocks the Hook and asserts it remains mounted without changing monitor context values.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- usePreMoveOutcomeScheduler.test.tsx RealtimeBacktestMonitorProvider.test.tsx
```

Expected: FAIL because the scheduler is missing.

- [ ] **Step 3: Implement the lightweight scheduler**

Run immediately on mount, every 60 minutes, and on transition to visible. Use a ref to prevent overlap. Dispatch `PRE_MOVE_OUTCOMES_UPDATED_EVENT` only when `completed > 0`; dispatch a separate error event on failure. Do not scan candidates or load all A shares from this scheduler.

- [ ] **Step 4: Mount the scheduler in the existing provider**

Call `usePreMoveOutcomeScheduler()` beside `useDailyStrategyReviewScheduler()`. Do not change `RealtimeBacktestMonitorContext` or any trading monitor input.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
npm test -- usePreMoveOutcomeScheduler.test.tsx RealtimeBacktestMonitorProvider.test.tsx RealtimeBacktestDailyReview.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 10**

```powershell
git add app/src/features/securities/pre-move-radar/usePreMoveOutcomeScheduler.ts app/src/features/securities/pre-move-radar/usePreMoveOutcomeScheduler.test.tsx app/src/features/securities/RealtimeBacktestMonitorProvider.tsx app/src/features/securities/RealtimeBacktestMonitorProvider.test.tsx
git commit -m "feat: catch up pre-move outcomes"
```

### Task 11: Add licensing notice and run full feature verification

**Files:**
- Create or Modify: `app/THIRD_PARTY_NOTICES.md`
- Create: `app/licenses/instock-APACHE-2.0.txt`
- Create: `app/licenses/efinance-MIT.txt`
- Test: all files added above plus existing securities regression tests.

**Interfaces:**
- Consumes: completed feature.
- Produces: commercial attribution and verified production build.

- [ ] **Step 1: Add third-party notices**

Copy the complete upstream license texts from `stock-explore/LICENSE` and `efinance-explore/LICENSE` into the two `app/licenses/` files. Include this attribution summary in `app/THIRD_PARTY_NOTICES.md`:

```markdown
## InStock

- Source: local `stock-explore` repository, originally distributed under Apache License 2.0.
- Usage: field mappings and algorithmic references for industry/individual capital flow, volume expansion and platform-breakout analysis.
- License: Apache License 2.0; retain the upstream copyright and license text in distributions.

## efinance

- Source: local `efinance-explore` repository, originally distributed under MIT License.
- Usage: field mappings and algorithmic references for A-share board membership, board quotes and historical capital flow.
- License: MIT; retain the upstream copyright and permission notice in distributions.
```

- [ ] **Step 2: Run the complete focused suite**

Run:

```powershell
npm test -- pre-move-market-data-api.test.ts prediction-outcome.test.ts historical-calibration.test.ts signal-engine.test.ts probability-calibrator.test.ts candidate-universe.test.ts radar-repository.test.ts forward-evaluator.test.ts radar-service.test.ts usePreMoveRadar.test.tsx PreMoveRadarPage.test.tsx usePreMoveOutcomeScheduler.test.tsx SecuritiesWorkbenchPage.test.tsx router.test.tsx RealtimeBacktestMonitorProvider.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 3: Run securities regression tests that must remain untouched**

Run:

```powershell
npm test -- StockAnalysisPage.test.tsx StockAnalysisRealtimeTargets.test.tsx WatchlistPage.test.tsx SignalInbox.test.tsx backtest-signal-trading-runtime.test.ts backtest-signal-t1-pending.test.ts ActualPositionsPanel.test.tsx
```

Expected: all PASS. If an existing unrelated test is already failing, record the exact pre-existing failure and do not alter unrelated production code to hide it.

- [ ] **Step 4: Run project verification**

Run:

```powershell
npm run typecheck
npm run lint
npm run build
```

Expected: typecheck and build exit 0; lint introduces no new warning in files changed by this feature.

- [ ] **Step 5: Verify git scope**

Run:

```powershell
git status --short
git diff --check
```

Confirm no unrelated user files are staged or modified by the feature implementation.

- [ ] **Step 6: Commit Task 11**

```powershell
git add app/THIRD_PARTY_NOTICES.md app/licenses/instock-APACHE-2.0.txt app/licenses/efinance-MIT.txt
git commit -m "docs: attribute pre-move data sources"
```

## Completion Checklist

- [ ] 股票主页显示“启动预期雷达”入口。
- [ ] 独立页面能够扫描全部自选股和最多 200 只轮动候选。
- [ ] 信号强度与启动预期概率分开显示。
- [ ] 成功标签严格使用 3–15 日、5% 涨幅、3% 超额和 4% 回撤条件。
- [ ] 样本不足时不显示“可布局”。
- [ ] 所有候选显示状态、概率、置信度、样本数、依据、风险和失效条件。
- [ ] 正式收盘扫描保存不可变快照，后续自动补充标签。
- [ ] 盘中扫描缓存 15 分钟且不保存训练标签。
- [ ] 单个数据源或股票失败不会导致整页失败。
- [ ] 不影响个股分析、持仓、收件箱、回测交易或 T+1 逻辑。
- [ ] 第三方许可证已记录。
- [ ] focused tests、typecheck、lint 和 production build 通过。
