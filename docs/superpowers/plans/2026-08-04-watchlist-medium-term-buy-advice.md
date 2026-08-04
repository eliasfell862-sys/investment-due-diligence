# Watchlist Medium-Term Buy Advice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents for this plan.

**Goal:** Add automatic, deterministic 1–3 month buy advice to every stock in the watchlist while preserving the existing stock-analysis page and row navigation.

**Architecture:** Add a pure medium-term advice engine that combines existing technical indicators, fundamentals, strategies, patterns, risk, and data-completeness rules. Add a separate concurrency-limited orchestration/cache service, a focused table-cell component, and a thin integration in `WatchlistPage`; the stock-analysis page and shared algorithm behavior remain unchanged.

**Tech Stack:** React 19, TypeScript 6, Vitest, Testing Library, browser localStorage, existing InStock-derived technical/strategy modules, existing Eastmoney market-data functions.

## Global Constraints

- Advice horizon is fixed to 1–3 months.
- Advice is deterministic and must not call AI.
- Automatically analyze the active watchlist after quotes load.
- Process at most 4 stocks concurrently.
- Use cache key `sec_watchlist_buy_advice_cache_v1` with a 4-hour TTL.
- Do not modify `StockAnalysisPage.tsx`, its routes, state, layout, tabs, or data-loading behavior.
- Do not change the public behavior of `technical-indicators.ts`, `trading-strategies.ts`, `kline-patterns.ts`, or `fundamental-scorer.ts`.
- Clone K-line records before calling `calcAllIndicators` because it mutates its input.
- Preserve row navigation to `/projects/:projectId/securities/stock/:code`.
- Clicking the advice cell must not navigate.
- Do not modify `sec_watchlists_v2` or `sec_active_watchlist` semantics.
- Do not include `backtest-engine.ts` in the first-version score.
- Do not output target prices, guaranteed returns, or trading execution instructions.
- Preserve the existing unrelated K-line worktree changes and never use `git add .`.
- Do not use subagents.

---

## File Structure

- Create `app/src/engines/market-analysis/medium-term-buy-advice.ts`: pure types, dimension scoring, confidence, hard caps, reasons, and risks.
- Create `app/src/engines/market-analysis/medium-term-buy-advice.test.ts`: deterministic golden cases and degraded-data behavior.
- Create `app/src/features/securities/watchlist-buy-advice-service.ts`: cache, K-line cloning, data loading, single-stock analysis, and four-worker queue.
- Create `app/src/features/securities/watchlist-buy-advice-service.test.ts`: cache, concurrency, isolation, failure, and stale-run behavior.
- Create `app/src/features/securities/WatchlistAdviceCell.tsx`: compact status cell and a separate read-only detail row.
- Create `app/src/features/securities/WatchlistAdviceCell.test.tsx`: status rendering, detail-row content, propagation isolation, and retry.
- Modify `app/src/features/securities/WatchlistPage.tsx`: start/refresh/retry orchestration, progress, advice column, and unchanged row navigation.
- Create `app/src/features/securities/WatchlistPage.test.tsx`: automatic analysis, progressive results, refresh, retry, click isolation, and navigation.

---

### Task 1: Pure Medium-Term Buy Advice Engine

**Files:**
- Create: `app/src/engines/market-analysis/medium-term-buy-advice.ts`
- Test: `app/src/engines/market-analysis/medium-term-buy-advice.test.ts`

**Interfaces:**
- Consumes: `StockQuote`, `StockKLine`, `FundamentalScore`, `StrategySignal`, and `PatternResult`.
- Produces:

```ts
export type MediumTermAdviceAction =
  | 'accumulate'
  | 'cautious_buy'
  | 'watch'
  | 'avoid_buying'
  | 'risk_avoidance'
  | 'insufficient_data';

export interface MediumTermBuyAdviceInput {
  quote: StockQuote;
  klines: StockKLine[];
  fundamental: FundamentalScore | null;
  hasFinancialData: boolean;
  strategies: StrategySignal[];
  patterns: PatternResult[];
  calculatedAt?: string;
}

export interface MediumTermBuyAdvice {
  code: string;
  horizon: '1_3_months';
  action: MediumTermAdviceAction;
  label: '分批买入' | '谨慎买入' | '观察等待' | '暂不买入' | '风险回避' | '数据不足';
  score: number;
  confidence: number;
  confidenceLabel: '高' | '中' | '低';
  reasons: string[];
  risks: string[];
  dataCompleteness: { quote: boolean; kline: boolean; fundamental: boolean };
  calculatedAt: string;
}

export function buildMediumTermBuyAdvice(input: MediumTermBuyAdviceInput): MediumTermBuyAdvice;
```

- [ ] **Step 1: Write failing engine tests**

Create fixtures for a valid quote and 120 K-lines. The final two K-lines should include the indicator fields consumed by the engine:

```ts
const previous = Object.assign(klines.at(-2)!, {
  macd: { dif: 0.2, dea: 0.3, bar: -0.1 },
  kdj: { k: 45, d: 48, j: 39 },
  rsi: { rsi6: 48, rsi12: 50, rsi24: 52 },
  ma: { ma5: 11.8, ma10: 11.5, ma20: 11, ma60: 10 },
  boll: { upper: 13, mid: 11, lower: 9 },
  atr: 0.4,
});
const latest = Object.assign(klines.at(-1)!, {
  close: 12,
  macd: { dif: 0.5, dea: 0.35, bar: 0.15 },
  kdj: { k: 55, d: 50, j: 65 },
  rsi: { rsi6: 58, rsi12: 55, rsi24: 53 },
  ma: { ma5: 12, ma10: 11.7, ma20: 11.2, ma60: 10.2 },
  boll: { upper: 13.2, mid: 11.2, lower: 9.2 },
  atr: 0.42,
});
```

Add these concrete tests:

```ts
it('returns accumulate for complete multi-dimensional bullish evidence', () => {
  const advice = buildMediumTermBuyAdvice({
    quote: quote({ price: 12, pe: 14, pb: 1.4, turnover: 3, totalCap: 800 }),
    klines: bullishKlines(),
    fundamental: fundamental({ totalScore: 82 }),
    hasFinancialData: true,
    strategies: [{ id: 'breakout', name: '平台突破', type: 'buy', strength: '强', description: '放量突破', conditions: [] }],
    patterns: [{ name: '早晨之星', type: 'bullish', strength: '强', description: '底部反转', position: 119 }],
    calculatedAt: '2026-08-04T10:00:00.000Z',
  });
  expect(advice).toMatchObject({ action: 'accumulate', label: '分批买入', horizon: '1_3_months' });
  expect(advice.score).toBeGreaterThanOrEqual(78);
  expect(advice.confidenceLabel).toBe('高');
});

it('caps bullish advice at cautious buy when financial data is missing', () => {
  const advice = buildMediumTermBuyAdvice({
    quote: quote(), klines: bullishKlines(), fundamental: fundamental({ totalScore: 82 }),
    hasFinancialData: false, strategies: bullishStrategies(), patterns: bullishPatterns(),
  });
  expect(advice.action).toBe('cautious_buy');
  expect(advice.score).toBeLessThanOrEqual(77);
  expect(advice.dataCompleteness.fundamental).toBe(false);
  expect(advice.risks).toContain('基本面数据缺失');
});

it('downgrades to watch when strong sell evidence is present', () => {
  const advice = buildMediumTermBuyAdvice({
    quote: quote(), klines: bullishKlines(), fundamental: fundamental({ totalScore: 82 }),
    hasFinancialData: true,
    strategies: [{ id: 'sell', name: '趋势转弱', type: 'sell', strength: '强', description: '强卖出', conditions: [] }],
    patterns: bullishPatterns(),
  });
  expect(advice.score).toBeLessThanOrEqual(67);
  expect(advice.action).toBe('watch');
});

it('returns insufficient data for invalid price or fewer than 60 K-lines', () => {
  expect(buildMediumTermBuyAdvice(baseInput({ quote: quote({ price: 0 }) })).action).toBe('insufficient_data');
  expect(buildMediumTermBuyAdvice(baseInput({ klines: bullishKlines().slice(-30) })).action).toBe('insufficient_data');
});

it('limits score, reasons, and risks', () => {
  const advice = buildMediumTermBuyAdvice(baseInput());
  expect(advice.score).toBeGreaterThanOrEqual(0);
  expect(advice.score).toBeLessThanOrEqual(100);
  expect(advice.reasons.length).toBeLessThanOrEqual(3);
  expect(advice.risks.length).toBeLessThanOrEqual(3);
});
```

- [ ] **Step 2: Run engine tests and verify RED**

Run:

```powershell
npx vitest run src/engines/market-analysis/medium-term-buy-advice.test.ts
```

Expected: FAIL because `medium-term-buy-advice.ts` does not exist.

- [ ] **Step 3: Implement the deterministic score model**

Use these exact dimension rules.

Technical score, clamped to 0–35:

```ts
let technical = 0;
if (last.close >= last.ma.ma20) technical += 7;
if (last.ma.ma20 >= last.ma.ma60) technical += 5;
if (last.macd.dif > last.macd.dea) technical += 6;
if (prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea) technical += 3;
if (last.rsi.rsi6 >= 40 && last.rsi.rsi6 <= 70) technical += 4;
else if (last.rsi.rsi6 < 30) technical += 2;
if (last.kdj.j >= 20 && last.kdj.j <= 80) technical += 3;
if (last.close >= last.boll.mid && last.close <= last.boll.upper) technical += 3;
else if (last.close >= last.boll.lower) technical += 1;
if (input.quote.turnover >= 0.5 && input.quote.turnover <= 12) technical += 4;
```

Fundamental score, clamped to 0–30:

```ts
const fundamentalScore = input.fundamental
  ? Math.round(input.fundamental.totalScore * 0.3)
  : 0;
```

Strategy and pattern score starts at 10 and is clamped to 0–20:

```ts
const strengthPoints = { 强: 4, 中: 3, 弱: 2 } as const;
for (const signal of input.strategies) {
  if (signal.type === 'buy') strategy += strengthPoints[signal.strength];
  if (signal.type === 'sell') strategy -= strengthPoints[signal.strength];
}
for (const pattern of input.patterns) {
  const points = pattern.strength === '强' ? 3 : pattern.strength === '中' ? 2 : 1;
  if (pattern.type === 'bullish') strategy += points;
  if (pattern.type === 'bearish') strategy -= points;
}
```

Risk/liquidity score, clamped to 0–15:

```ts
let risk = input.quote.totalCap >= 500 ? 5 : input.quote.totalCap >= 100 ? 4 : 2;
risk += input.quote.turnover >= 0.5 && input.quote.turnover <= 12 ? 4 : input.quote.turnover <= 20 ? 2 : 0;
const atrPct = last.atr > 0 ? last.atr / last.close * 100 : Infinity;
risk += atrPct <= 3 ? 4 : atrPct <= 6 ? 3 : 1;
risk += strongSellCount === 0 && strongBearishCount === 0 ? 2 : 0;
```

Calculate the total from the four clamped dimensions. Apply hard caps in this order:

```ts
if (!input.hasFinancialData) score = Math.min(score, 77);
if (strongSellCount >= 1 || strongBearishCount >= 2) score = Math.min(score, 67);
```

Map final score to actions using the thresholds from the spec. Return `insufficient_data` before scoring when price is not finite/positive or K-lines have fewer than 60 records.

Confidence rules:

```ts
let confidence = 20; // valid quote
confidence += input.klines.length >= 120 ? 40 : 30;
confidence += input.hasFinancialData ? 25 : 0;
const dimensions = [technical / 35, fundamentalScore / 30, strategy / 20, risk / 15];
const spread = Math.max(...dimensions) - Math.min(...dimensions);
confidence += spread <= 0.25 ? 15 : spread <= 0.45 ? 8 : 3;
confidence = Math.min(input.hasFinancialData ? 100 : 70, confidence);
```

Use `高` for confidence `>= 80`, `中` for `>= 55`, otherwise `低`. Build reasons and risks from named rules, deduplicate them with `Set`, order strong signals first, and slice each collection to three items.

- [ ] **Step 4: Run engine tests and verify GREEN**

Run:

```powershell
npx vitest run src/engines/market-analysis/medium-term-buy-advice.test.ts
```

Expected: all engine tests PASS.

- [ ] **Step 5: Commit the pure engine**

```powershell
git add -- app/src/engines/market-analysis/medium-term-buy-advice.ts app/src/engines/market-analysis/medium-term-buy-advice.test.ts
git commit -m "feat: add medium-term buy advice engine" -- app/src/engines/market-analysis/medium-term-buy-advice.ts app/src/engines/market-analysis/medium-term-buy-advice.test.ts
```

---

### Task 2: Watchlist Advice Cache and Four-Worker Analysis Service

**Files:**
- Create: `app/src/features/securities/watchlist-buy-advice-service.ts`
- Test: `app/src/features/securities/watchlist-buy-advice-service.test.ts`

**Interfaces:**
- Consumes: `buildMediumTermBuyAdvice`, `fetchEastmoneyKLine`, `fetchEastmoneyBasic`, `calcAllIndicators`, `scanStrategies`, `scanPatterns`, and `scoreFundamentals`.
- Produces:

```ts
export const WATCHLIST_ADVICE_CACHE_KEY = 'sec_watchlist_buy_advice_cache_v1';
export const WATCHLIST_ADVICE_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
export const WATCHLIST_ADVICE_MAX_CONCURRENCY = 4;

export type WatchlistAdviceTaskState =
  | { status: 'waiting' }
  | { status: 'loading' }
  | { status: 'success'; advice: MediumTermBuyAdvice }
  | { status: 'error'; error: string };

export interface WatchlistAdviceDependencies {
  fetchKLine: (code: string, count: number) => Promise<StockKLine[]>;
  fetchBasic: (code: string) => Promise<DailyBasicData | null>;
  calcIndicators: (klines: StockKLine[]) => void;
  scanStrategies: (klines: StockKLine[]) => StrategySignal[];
  scanPatterns: (klines: StockKLine[]) => PatternResult[];
  scoreFundamentals: (quote: StockQuote, klines: StockKLine[], financial?: DailyBasicData | null) => FundamentalScore;
  buildAdvice: (input: MediumTermBuyAdviceInput) => MediumTermBuyAdvice;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now: () => number;
}

export interface AnalyzeWatchlistOptions {
  force?: boolean;
  maxConcurrency?: number;
  shouldPublish?: () => boolean;
  onUpdate: (code: string, state: WatchlistAdviceTaskState) => void;
}

export async function analyzeWatchlistStock(
  quote: StockQuote,
  options?: { force?: boolean },
  dependencies?: Partial<WatchlistAdviceDependencies>,
): Promise<MediumTermBuyAdvice>;

export async function analyzeWatchlistQuotes(
  quotes: StockQuote[],
  options: AnalyzeWatchlistOptions,
  dependencies?: Partial<WatchlistAdviceDependencies>,
): Promise<void>;

export function clearWatchlistAdviceCache(
  codes?: string[],
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void;
```

- [ ] **Step 1: Write failing cache, clone, failure, and concurrency tests**

Use deferred promises to measure active requests. Add these cases:

```ts
it('returns a fresh cached advice without requesting market data', async () => {
  const dependencies = depsWithCache(cachedAdvice, { expiresAt: NOW + 1000 });
  const result = await analyzeWatchlistStock(quote(), {}, dependencies);
  expect(result).toEqual(cachedAdvice);
  expect(dependencies.fetchKLine).not.toHaveBeenCalled();
});

it('recomputes an expired cache entry and stores a four-hour expiry', async () => {
  const dependencies = depsWithCache(cachedAdvice, { expiresAt: NOW - 1 });
  await analyzeWatchlistStock(quote(), {}, dependencies);
  expect(dependencies.fetchKLine).toHaveBeenCalledWith('000001', 120);
  expect(readStoredEntry(dependencies.storage, '000001').expiresAt).toBe(NOW + WATCHLIST_ADVICE_CACHE_TTL_MS);
});

it('clones K-lines before indicator calculation', async () => {
  const original = klineFixtures();
  const calcIndicators = vi.fn((rows) => { (rows[0] as any).mutated = true; });
  await analyzeWatchlistStock(quote(), {}, deps({ fetchKLine: vi.fn().mockResolvedValue(original), calcIndicators }));
  expect((original[0] as any).mutated).toBeUndefined();
});

it('degrades successfully when the financial request rejects', async () => {
  const buildAdvice = vi.fn().mockReturnValue(cachedAdvice);
  await analyzeWatchlistStock(quote(), {}, deps({
    fetchBasic: vi.fn().mockRejectedValue(new Error('financial unavailable')),
    buildAdvice,
  }));
  expect(buildAdvice).toHaveBeenCalledWith(expect.objectContaining({ hasFinancialData: false }));
});

it('never runs more than four stocks concurrently', async () => {
  let active = 0;
  let maxActive = 0;
  const fetchKLine = vi.fn(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    return klineFixtures();
  });
  await analyzeWatchlistQuotes(sixQuotes(), { onUpdate: vi.fn() }, deps({ fetchKLine }));
  expect(maxActive).toBeLessThanOrEqual(4);
});

it('publishes one stock failure without stopping successful stocks', async () => {
  const onUpdate = vi.fn();
  await analyzeWatchlistQuotes(twoQuotes(), { onUpdate }, deps({
    fetchKLine: vi.fn(code => code === '000001' ? Promise.reject(new Error('network')) : Promise.resolve(klineFixtures())),
  }));
  expect(onUpdate).toHaveBeenCalledWith('000001', { status: 'error', error: 'network' });
  expect(onUpdate).toHaveBeenCalledWith('600519', expect.objectContaining({ status: 'success' }));
});

it('does not publish stale results when shouldPublish becomes false', async () => {
  const onUpdate = vi.fn();
  await analyzeWatchlistQuotes([quote()], { onUpdate, shouldPublish: () => false }, deps());
  expect(onUpdate).not.toHaveBeenCalled();
});
```

Also test corrupted JSON as an empty cache, `force: true` bypassing cache, and `clearWatchlistAdviceCache(['000001'])` preserving other codes.

- [ ] **Step 2: Run service tests and verify RED**

Run:

```powershell
npx vitest run src/features/securities/watchlist-buy-advice-service.test.ts
```

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement cache and single-stock analysis**

Cache format:

```ts
interface AdviceCacheEntry {
  expiresAt: number;
  advice: MediumTermBuyAdvice;
}
type AdviceCache = Record<string, AdviceCacheEntry>;
```

`analyzeWatchlistStock` must:

1. Return a non-expired cache entry unless `force` is true.
2. Fetch 120 K-lines and financial data together, but convert a rejected financial request to `null` with `fetchBasic(code).catch(() => null)` so only K-line failure rejects the stock.
3. Clone K-lines using `klines.map(row => ({ ...row }))`.
4. Calculate indicators only on the clone.
5. Scan strategies and patterns on the clone.
6. Call `scoreFundamentals(quote, cloned, financial)`.
7. Call `buildMediumTermBuyAdvice` with `hasFinancialData: financial !== null`.
8. Store the result with `expiresAt: now() + WATCHLIST_ADVICE_CACHE_TTL_MS`.
9. Let K-line failures reject so the queue can expose a retry state. A financial result of `null` or a rejected financial request is a supported degraded success.

Parse and write cache inside `try/catch`; corrupted data or storage quota errors must not break the current analysis result.

- [ ] **Step 4: Implement the four-worker queue**

Use a shared cursor and exactly `Math.min(maxConcurrency, quotes.length)` async workers:

```ts
let cursor = 0;
async function worker() {
  while (cursor < quotes.length) {
    const quote = quotes[cursor++];
    if (shouldPublish()) onUpdate(quote.code, { status: 'loading' });
    try {
      const advice = await analyzeWatchlistStock(quote, { force }, deps);
      if (shouldPublish()) onUpdate(quote.code, { status: 'success', advice });
    } catch (error) {
      if (shouldPublish()) onUpdate(quote.code, {
        status: 'error',
        error: error instanceof Error ? error.message : '建议分析失败',
      });
    }
  }
}
await Promise.all(Array.from({ length: workerCount }, () => worker()));
```

Default `shouldPublish` to `() => true`, clamp concurrency to `1–4`, and publish nothing when it returns false.

- [ ] **Step 5: Run service and engine tests**

Run:

```powershell
npx vitest run src/features/securities/watchlist-buy-advice-service.test.ts src/engines/market-analysis/medium-term-buy-advice.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the service**

```powershell
git add -- app/src/features/securities/watchlist-buy-advice-service.ts app/src/features/securities/watchlist-buy-advice-service.test.ts
git commit -m "feat: orchestrate watchlist buy advice" -- app/src/features/securities/watchlist-buy-advice-service.ts app/src/features/securities/watchlist-buy-advice-service.test.ts
```

---

### Task 3: Focused Watchlist Advice Cell

**Files:**
- Create: `app/src/features/securities/WatchlistAdviceCell.tsx`
- Test: `app/src/features/securities/WatchlistAdviceCell.test.tsx`

**Interfaces:**
- Consumes: `WatchlistAdviceTaskState` and `MediumTermBuyAdvice`.
- Produces:

```ts
export interface WatchlistAdviceCellProps {
  stockName: string;
  state: WatchlistAdviceTaskState;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
}

export interface WatchlistAdviceDetailRowProps {
  advice: MediumTermBuyAdvice;
  colSpan: number;
}

export function WatchlistAdviceCell(props: WatchlistAdviceCellProps): React.ReactElement;
export function WatchlistAdviceDetailRow(props: WatchlistAdviceDetailRowProps): React.ReactElement;
```

- [ ] **Step 1: Write failing component tests**

Add these cases:

```tsx
it('renders waiting and loading states without an actionable conclusion', () => {
  const { rerender } = render(<table><tbody><tr><WatchlistAdviceCell stockName="平安银行" state={{ status: 'waiting' }} expanded={false} onToggle={vi.fn()} onRetry={vi.fn()} /></tr></tbody></table>);
  expect(screen.getByText('等待分析')).toBeInTheDocument();
  rerender(<table><tbody><tr><WatchlistAdviceCell stockName="平安银行" state={{ status: 'loading' }} expanded={false} onToggle={vi.fn()} onRetry={vi.fn()} /></tr></tbody></table>);
  expect(screen.getByText('分析中')).toBeInTheDocument();
});

it('shows label, score, and confidence for success', () => {
  renderCell({ status: 'success', advice: advice({ label: '分批买入', score: 82, confidenceLabel: '高' }) });
  expect(screen.getByText('分批买入')).toBeInTheDocument();
  expect(screen.getByText('82分')).toBeInTheDocument();
  expect(screen.getByText('置信度：高')).toBeInTheDocument();
});

it('expands read-only reasons, risks, completeness, and time', async () => {
  render(
    <table><tbody>
      <tr>
        <WatchlistAdviceCell stockName="平安银行" state={{ status: 'success', advice: advice() }} expanded onToggle={vi.fn()} onRetry={vi.fn()} />
      </tr>
      <WatchlistAdviceDetailRow advice={advice()} colSpan={9} />
    </tbody></table>,
  );
  expect(screen.getByText('主要依据')).toBeInTheDocument();
  expect(screen.getByText('主要风险')).toBeInTheDocument();
  expect(screen.getByText(/K线：完整/)).toBeInTheDocument();
  expect(screen.getByText(/基本面：完整/)).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: /主要依据/ })).toHaveAttribute('colspan', '9');
});

it('stops row propagation when toggling advice', async () => {
  const rowClick = vi.fn();
  const onToggle = vi.fn();
  render(<table><tbody><tr onClick={rowClick}><WatchlistAdviceCell stockName="平安银行" state={{ status: 'success', advice: advice() }} expanded={false} onToggle={onToggle} onRetry={vi.fn()} /></tr></tbody></table>);
  await userEvent.click(screen.getByRole('button', { name: '查看平安银行中线建议' }));
  expect(onToggle).toHaveBeenCalledOnce();
  expect(rowClick).not.toHaveBeenCalled();
});

it('offers an isolated retry for error state', async () => {
  const onRetry = vi.fn();
  renderCell({ status: 'error', error: 'network' }, { onRetry });
  await userEvent.click(screen.getByRole('button', { name: '重试平安银行建议' }));
  expect(onRetry).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run component tests and verify RED**

Run:

```powershell
npx vitest run src/features/securities/WatchlistAdviceCell.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the compact cell and separate detail row**

`WatchlistAdviceCell` renders a `<td onClick={event => event.stopPropagation()}>` and one toggle button with `aria-label="查看${stockName}中线建议"`. `WatchlistAdviceDetailRow` renders `<tr><td colSpan={colSpan}>...</td></tr>` so expanded content appears below the stock row. Map actions to explicit colors:

```ts
const actionColors = {
  accumulate: { foreground: '#f6c87a', background: '#5a431f' },
  cautious_buy: { foreground: '#e7bc78', background: '#48391f' },
  watch: { foreground: '#8fd3c8', background: '#173c3a' },
  avoid_buying: { foreground: '#f0b870', background: '#49351e' },
  risk_avoidance: { foreground: '#fca5a5', background: '#4b2328' },
  insufficient_data: { foreground: '#c0c0c0', background: '#303638' },
} as const;
```

Do not rely on color alone: always show the label, score, and confidence text. The separate detail row shows ordered reason/risk lists, `行情/K线/基本面` completeness text, and a localized calculation time. For error state show the error and a dedicated retry button. Waiting/loading states must not expose a buy label.

- [ ] **Step 4: Run component tests and verify GREEN**

Run:

```powershell
npx vitest run src/features/securities/WatchlistAdviceCell.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the advice cell**

```powershell
git add -- app/src/features/securities/WatchlistAdviceCell.tsx app/src/features/securities/WatchlistAdviceCell.test.tsx
git commit -m "feat: display watchlist buy advice" -- app/src/features/securities/WatchlistAdviceCell.tsx app/src/features/securities/WatchlistAdviceCell.test.tsx
```

---

### Task 4: Integrate Automatic Advice Into the Watchlist Page

**Files:**
- Modify: `app/src/features/securities/WatchlistPage.tsx`
- Create: `app/src/features/securities/WatchlistPage.test.tsx`

**Interfaces:**
- Consumes: `analyzeWatchlistQuotes`, `analyzeWatchlistStock`, `clearWatchlistAdviceCache`, `WatchlistAdviceTaskState`, `WatchlistAdviceCell`, and `WatchlistAdviceDetailRow`.
- Preserves: row navigation to `/projects/${projectId || 'default'}/securities/stock/${q.code}`.

- [ ] **Step 1: Write failing page tests for automatic progressive analysis**

Mock `stock-api` with one quote and mock the service so it calls `onUpdate` with loading then success:

```ts
vi.mock('./watchlist-buy-advice-service', () => ({
  analyzeWatchlistQuotes: vi.fn(async (quotes, options) => {
    options.onUpdate(quotes[0].code, { status: 'loading' });
    options.onUpdate(quotes[0].code, { status: 'success', advice: advice() });
  }),
  analyzeWatchlistStock: vi.fn().mockResolvedValue(advice()),
  clearWatchlistAdviceCache: vi.fn(),
}));
```

Seed one watchlist under `sec_watchlists_v2` and its active ID. Add:

```tsx
it('automatically analyzes quotes and renders progress and advice', async () => {
  renderWatchlist();
  expect(await screen.findByRole('columnheader', { name: '中线建议' })).toBeInTheDocument();
  expect(await screen.findByText('分批买入')).toBeInTheDocument();
  expect(screen.getByText('中线建议分析：1 / 1')).toBeInTheDocument();
  expect(analyzeWatchlistQuotes).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ code: '000001' })]),
    expect.objectContaining({ force: false, onUpdate: expect.any(Function), shouldPublish: expect.any(Function) }),
  );
});
```

- [ ] **Step 2: Write failing tests for refresh, retry, click isolation, and row navigation**

Use a `LocationProbe` component inside `MemoryRouter` routes. Add:

```tsx
it('refreshes all advice while keeping existing results visible', async () => {
  const user = userEvent.setup();
  renderWatchlist();
  await screen.findByText('分批买入');
  await user.click(screen.getByRole('button', { name: '刷新全部建议' }));
  expect(clearWatchlistAdviceCache).toHaveBeenCalledWith(['000001']);
  expect(analyzeWatchlistQuotes).toHaveBeenLastCalledWith(
    expect.any(Array),
    expect.objectContaining({ force: true }),
  );
  expect(screen.getByText('分批买入')).toBeInTheDocument();
});

it('clicking advice expands locally without navigating', async () => {
  const user = userEvent.setup();
  renderWatchlistWithLocationProbe();
  await user.click(await screen.findByRole('button', { name: '查看平安银行中线建议' }));
  expect(screen.getByTestId('location')).toHaveTextContent('/projects/default/securities/watchlist');
  expect(screen.getByText('主要依据')).toBeInTheDocument();
});

it('clicking the stock row still navigates to the original analysis route', async () => {
  const user = userEvent.setup();
  renderWatchlistWithLocationProbe();
  await user.click(await screen.findByText('平安银行'));
  expect(screen.getByTestId('location')).toHaveTextContent('/projects/default/securities/stock/000001');
});

it('retries only the failed stock', async () => {
  mockQueueError('000001');
  const user = userEvent.setup();
  renderWatchlist();
  await user.click(await screen.findByRole('button', { name: '重试平安银行建议' }));
  expect(analyzeWatchlistStock).toHaveBeenCalledWith(expect.objectContaining({ code: '000001' }), { force: true });
});
```

- [ ] **Step 3: Run page tests and verify RED**

Run:

```powershell
npx vitest run src/features/securities/WatchlistPage.test.tsx
```

Expected: FAIL because the page has no advice state, column, progress, or controls.

- [ ] **Step 4: Add automatic queue state without changing quote loading**

Add imports for `useRef`, the service, task-state type, and cell component. Add state:

```ts
const [adviceStates, setAdviceStates] = useState<Record<string, WatchlistAdviceTaskState>>({});
const [expandedAdviceCode, setExpandedAdviceCode] = useState('');
const adviceRunRef = useRef(0);
```

Add a helper that preserves old successful states during manual refresh:

```ts
const runAdviceAnalysis = (targetQuotes: StockQuote[], force = false) => {
  const runId = ++adviceRunRef.current;
  setAdviceStates(previous => Object.fromEntries(targetQuotes.map(quote => [
    quote.code,
    force && previous[quote.code]?.status === 'success'
      ? previous[quote.code]
      : { status: 'waiting' as const },
  ])));

  void analyzeWatchlistQuotes(targetQuotes, {
    force,
    shouldPublish: () => adviceRunRef.current === runId,
    onUpdate: (code, state) => {
      if (adviceRunRef.current !== runId) return;
      setAdviceStates(previous => ({ ...previous, [code]: state }));
    },
  });
};
```

Add an effect triggered only by `activeId` and `quotes` after valid quotes exist. On cleanup increment `adviceRunRef.current`; do not change the existing quote-fetching effect.

- [ ] **Step 5: Add progress, refresh, retry, and the table column**

Derive:

```ts
const adviceCompleted = quotes.filter(quote => {
  const state = adviceStates[quote.code];
  return state?.status === 'success' || state?.status === 'error';
}).length;
```

Render `中线建议分析：${adviceCompleted} / ${quotes.length}` and a button named `刷新全部建议`. Refresh must call `clearWatchlistAdviceCache(quotes.map(q => q.code))` then `runAdviceAnalysis(quotes, true)` so the whole active watchlist is refreshed even when a tag filter is active.

Retry must set only that code to loading, call `analyzeWatchlistStock(quote, { force: true })`, and replace only that code with success or error.

Add `<th>中线建议</th>` after market cap. Render:

```tsx
return (
  <Fragment key={q.code}>
    <tr onClick={() => navigate(`/projects/${projectId || 'default'}/securities/stock/${q.code}`)}>
      {/* Existing quote cells remain unchanged. */}
      <WatchlistAdviceCell
        stockName={q.name}
        state={adviceStates[q.code] ?? { status: 'waiting' }}
        expanded={expandedAdviceCode === q.code}
        onToggle={() => setExpandedAdviceCode(code => code === q.code ? '' : q.code)}
        onRetry={() => retryAdvice(q)}
      />
      {/* Existing tag and remove cells remain unchanged. */}
    </tr>
    {expandedAdviceCode === q.code && adviceStates[q.code]?.status === 'success' && (
      <WatchlistAdviceDetailRow
        advice={adviceStates[q.code].advice}
        colSpan={activeWl && activeWl.groups.length > 0 ? 9 : 8}
      />
    )}
  </Fragment>
);
```

Keep the existing row navigation callback unchanged. Import `Fragment` from React, and let the compact cell own event propagation isolation.

- [ ] **Step 6: Run page, cell, service, and engine tests**

Run:

```powershell
npx vitest run src/features/securities/WatchlistPage.test.tsx src/features/securities/WatchlistAdviceCell.test.tsx src/features/securities/watchlist-buy-advice-service.test.ts src/engines/market-analysis/medium-term-buy-advice.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the page integration**

```powershell
git add -- app/src/features/securities/WatchlistPage.tsx app/src/features/securities/WatchlistPage.test.tsx
git commit -m "feat: add automatic advice to watchlist" -- app/src/features/securities/WatchlistPage.tsx app/src/features/securities/WatchlistPage.test.tsx
```

---

### Task 5: Regression and Browser Verification

**Files:**
- Verify only; do not make unrelated production changes.

**Interfaces:**
- Consumes all deliverables from Tasks 1–4.
- Produces a verified watchlist advice feature with an unchanged stock-analysis experience.

- [ ] **Step 1: Run targeted feature tests**

```powershell
npx vitest run src/engines/market-analysis/medium-term-buy-advice.test.ts src/features/securities/watchlist-buy-advice-service.test.ts src/features/securities/WatchlistAdviceCell.test.tsx src/features/securities/WatchlistPage.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run existing algorithm regressions**

```powershell
npx vitest run src/engines/market-analysis/technical-indicators.test.ts src/features/securities/PortfolioAllocationPage.test.tsx src/features/securities/portfolio-group-storage.test.ts
```

Expected: PASS. These tests prove existing technical indicators and the recently added portfolio flow remain intact.

- [ ] **Step 3: Run securities and market-data regressions**

```powershell
npx vitest run src/features/securities src/infrastructure/market-data
```

Expected: all feature-related tests PASS. If the two pre-existing stock-directory classification/result tests still fail with their previously recorded expectations, document them and do not modify stock-directory or individual-stock behavior in this task.

- [ ] **Step 4: Run static and production checks**

```powershell
npm run typecheck
npm run build
git diff --check
```

Expected: all commands succeed; existing Vite chunk-size and ineffective-dynamic-import warnings are informational.

- [ ] **Step 5: Browser-verify the watchlist workflow**

At `http://localhost:5173/projects/default/securities/watchlist`:

1. Confirm the existing watchlist and quote table load.
2. Confirm advice begins automatically and results appear progressively.
3. Confirm progress reaches the number of valid visible stocks.
4. Expand one successful advice cell and verify reasons, risks, completeness, and time.
5. Confirm clicking the advice cell does not navigate.
6. Click the same stock's code or name and confirm navigation to `/projects/default/securities/stock/:code`.
7. Use the browser Back action to return to the watchlist.
8. Click `刷新全部建议` and confirm existing advice remains visible while new results replace it.
9. Confirm a failed stock, if available, exposes a single-stock retry without blocking other rows.

- [ ] **Step 6: Browser-verify that individual stock analysis is unchanged**

At the stock-analysis URL reached from Step 5:

1. Confirm the overview renders its existing metrics.
2. Confirm the K-line chart renders historical bars and moving averages.
3. Confirm the fundamental and strategy sections/tabs remain available.
4. Confirm no watchlist-advice UI appears inside the stock-analysis page.
5. Confirm the browser console has no new errors.

- [ ] **Step 7: Inspect final Git scope**

```powershell
git status --short
git diff --check
git log -6 --oneline
```

Expected: only the known pre-existing K-line worktree files remain uncommitted. The advice files are committed separately, and `StockAnalysisPage.tsx` is unchanged.

- [ ] **Step 8: Commit only test-only corrections if verification changed files**

If verification required corrections limited to the four new test files, commit them explicitly:

```powershell
git add -- app/src/engines/market-analysis/medium-term-buy-advice.test.ts app/src/features/securities/watchlist-buy-advice-service.test.ts app/src/features/securities/WatchlistAdviceCell.test.tsx app/src/features/securities/WatchlistPage.test.tsx
git commit -m "test: verify watchlist buy advice" -- app/src/engines/market-analysis/medium-term-buy-advice.test.ts app/src/features/securities/watchlist-buy-advice-service.test.ts app/src/features/securities/WatchlistAdviceCell.test.tsx app/src/features/securities/WatchlistPage.test.tsx
```

Skip this commit when Tasks 1–4 leave no uncommitted advice-related changes.
