# Watchlist Short-Term Advice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic 3–10 trading-day advice, executable price targets, and realtime-aware refresh behavior to every stock in the active watchlist.

**Architecture:** Build a pure short-term scoring engine over quotes and precomputed InStock-derived indicators, strategies, and patterns. Wrap it in a separate cached service that owns K-line loading, concurrency, 30-second quote-driven recalculation, and stale-run isolation, then expose the result through a dedicated cell/detail component in the existing watchlist table.

**Tech Stack:** React 19, TypeScript 6, Vitest, Testing Library, browser localStorage, existing market-data APIs and InStock-derived technical/strategy engines.

## Global Constraints

- Advice horizon is exactly 3–10 trading days.
- Do not modify `app/src/features/securities/StockAnalysisPage.tsx` or any stock overview/K-line behavior.
- Do not modify the existing medium-term scoring engine or its cache contract.
- AI must not select the action or calculate entry, stop-loss, or take-profit prices.
- A buy action requires a risk/reward ratio of at least 1.5.
- Full K-line analysis uses 60 daily rows, requires at least 30 valid rows, caches for 30 minutes, and runs at maximum concurrency 4.
- Realtime quote-driven recalculation reuses the cached base snapshot and publishes at most once per stock per 30 seconds.
- One stock's failure must not stop the remaining queue.
- Use test-first Red-Green-Refactor for every production change.

---

### Task 1: Pure Short-Term Advice Engine

**Files:**
- Create: `app/src/engines/market-analysis/short-term-trading-advice.ts`
- Create: `app/src/engines/market-analysis/short-term-trading-advice.test.ts`

**Interfaces:**
- Consumes: `StockQuote`, indicator-enriched `StockKLine[]`, `StrategySignal[]`, and `PatternResult[]`.
- Produces: `ShortTermTradingAdvice`, `ShortTermAdviceBaseInput`, and `buildShortTermTradingAdvice(input)`.

- [ ] **Step 1: Write failing tests for the public result contract and insufficient data**

```ts
it('returns insufficient data without thirty valid indicator rows', () => {
  const result = buildShortTermTradingAdvice(baseInput({ klines: bullishRows().slice(-29) }));
  expect(result).toMatchObject({ action: 'insufficient_data', entryRange: null, stopLoss: null });
});

it('returns executable ordered prices for a qualified setup', () => {
  const result = buildShortTermTradingAdvice(baseInput());
  expect(result.entryRange!.low).toBeLessThanOrEqual(result.entryRange!.high);
  expect(result.stopLoss).toBeLessThan(result.entryRange!.low);
  expect(result.takeProfit1).toBeGreaterThan(result.entryRange!.high);
  expect(result.takeProfit2).toBeGreaterThan(result.takeProfit1!);
  expect(result.riskRewardRatio).toBeGreaterThanOrEqual(1.5);
});
```

- [ ] **Step 2: Verify the tests fail because the engine does not exist**

Run: `npm test -- src/engines/market-analysis/short-term-trading-advice.test.ts` from `app/`  
Expected: FAIL because `short-term-trading-advice` cannot be imported.

- [ ] **Step 3: Implement the result types, input validation, five score dimensions, and price construction**

```ts
export interface ShortTermAdviceBaseInput {
  quote: StockQuote;
  klines: IndicatorKLine[];
  strategies: StrategySignal[];
  patterns: PatternResult[];
  dataAsOf: string;
  calculatedAt?: string;
  cacheStatus?: 'fresh' | 'cached';
}

export function buildShortTermTradingAdvice(input: ShortTermAdviceBaseInput): ShortTermTradingAdvice {
  // Validate quote, >=30 rows, and MA/MACD/RSI/KDJ/BOLL/ATR.
  // Score trend, momentum, volume-price, strategy-pattern, and risk/reward at 20 points each.
  // Build entry range from price, MA5, MA10, BOLL mid, and ATR.
  // Build stop and two targets, then apply forced downgrade rules.
}
```

Use explicit helpers `scoreTrend`, `scoreMomentum`, `scoreVolumePrice`, `scoreStrategiesAndPatterns`, `buildPricePlan`, `actionForScore`, and `applyForcedDowngrades`. Clamp each dimension to 0–20 and the final score to 0–100. Round prices with a shared two-decimal helper.

- [ ] **Step 4: Add failing boundary and downgrade tests**

```ts
it.each([[80, 'strong_buy'], [70, 'buy_on_dip'], [58, 'hold_watch'], [45, 'avoid'], [44, 'reduce_sell']])(
  'maps score %i to %s', (score, action) => expect(actionForShortTermScore(score)).toBe(action),
);

it('caps a setup below 1.5 reward to risk at hold watch', () => {
  const result = buildShortTermTradingAdvice(baseInput({ resistancePrice: 10.4 }));
  expect(['hold_watch', 'avoid', 'reduce_sell']).toContain(result.action);
});
```

- [ ] **Step 5: Implement thresholds, limit-up/overbought/breakdown downgrades, confidence, reasons, and risks**

Expose `actionForShortTermScore(score)` for exact threshold tests. Deduplicate and limit `reasons` and `risks` to three. Return `maxHoldingTradingDays` between 3 and 10 for valid results.

- [ ] **Step 6: Run the engine test and commit**

Run: `npm test -- src/engines/market-analysis/short-term-trading-advice.test.ts`  
Expected: PASS.

```powershell
git add -- app/src/engines/market-analysis/short-term-trading-advice.ts app/src/engines/market-analysis/short-term-trading-advice.test.ts
git commit -m "feat: add watchlist short-term advice engine"
```

### Task 2: Cached Watchlist Short-Term Advice Service

**Files:**
- Create: `app/src/features/securities/watchlist-short-term-advice-service.ts`
- Create: `app/src/features/securities/watchlist-short-term-advice-service.test.ts`

**Interfaces:**
- Consumes: `buildShortTermTradingAdvice`, `fetchEastmoneyKLine`, `calcAllIndicators`, `scanStrategies`, and `scanPatterns`.
- Produces: `analyzeWatchlistShortTermStock`, `analyzeWatchlistShortTermQuotes`, `recalculateWatchlistShortTermStock`, `clearWatchlistShortTermAdviceCache`, and `WatchlistShortTermTaskState`.

- [ ] **Step 1: Write failing tests for full analysis and the 30-minute base cache**

```ts
it('loads sixty rows once and reuses the base snapshot within thirty minutes', async () => {
  await analyzeWatchlistShortTermStock(quote(), {}, dependencies);
  await analyzeWatchlistShortTermStock(quote({ price: 10.2 }), {}, dependencies);
  expect(dependencies.fetchKLine).toHaveBeenCalledTimes(1);
  expect(dependencies.fetchKLine).toHaveBeenCalledWith('000001', 60);
  expect(dependencies.buildAdvice).toHaveBeenLastCalledWith(expect.objectContaining({ quote: expect.objectContaining({ price: 10.2 }) }));
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/features/securities/watchlist-short-term-advice-service.test.ts`  
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement base-snapshot caching and full/snapshot-only calculation**

```ts
export const WATCHLIST_SHORT_TERM_CACHE_KEY = 'sec_watchlist_short_term_advice_cache_v1';
export const WATCHLIST_SHORT_TERM_CACHE_TTL_MS = 30 * 60 * 1000;
export const WATCHLIST_SHORT_TERM_RECALCULATE_MS = 30 * 1000;
export const WATCHLIST_SHORT_TERM_MAX_CONCURRENCY = 4;

export type WatchlistShortTermTaskState =
  | { status: 'waiting' }
  | { status: 'loading' }
  | { status: 'success'; advice: ShortTermTradingAdvice }
  | { status: 'error'; error: string; previousAdvice?: ShortTermTradingAdvice };
```

Cache only the immutable enriched K-line/strategy/pattern base snapshot. Every successful publication calls the pure engine with the latest quote so prices are never taken from a stale cached quote.

- [ ] **Step 4: Add failing tests for throttling, force refresh, concurrency, isolation, and corrupt storage**

```ts
it('does not publish the same stock twice inside thirty seconds', async () => {
  await recalculateWatchlistShortTermStock(quote(), { onPublish }, dependencies);
  clock += 29_000;
  await recalculateWatchlistShortTermStock(quote({ price: 10.3 }), { onPublish }, dependencies);
  expect(onPublish).toHaveBeenCalledTimes(1);
});

it('isolates a failed stock and continues the remaining queue', async () => {
  await analyzeWatchlistShortTermQuotes([quote({ code: 'bad' }), quote({ code: 'good' })], options, dependencies);
  expect(options.onUpdate).toHaveBeenCalledWith('bad', expect.objectContaining({ status: 'error' }));
  expect(options.onUpdate).toHaveBeenCalledWith('good', expect.objectContaining({ status: 'success' }));
});
```

- [ ] **Step 5: Implement the bounded worker queue, force clearing, stale-run guard, and graceful cache recovery**

Match the established medium-term service's `shouldPublish` and `onUpdate` pattern. Clamp configured concurrency to 1–4. Storage parse/write errors remain non-fatal.

- [ ] **Step 6: Run both service suites and commit**

Run: `npm test -- src/features/securities/watchlist-short-term-advice-service.test.ts src/features/securities/watchlist-buy-advice-service.test.ts`  
Expected: PASS.

```powershell
git add -- app/src/features/securities/watchlist-short-term-advice-service.ts app/src/features/securities/watchlist-short-term-advice-service.test.ts
git commit -m "feat: analyze short-term watchlist setups"
```

### Task 3: Short-Term Advice Cell and Detail Row

**Files:**
- Create: `app/src/features/securities/WatchlistShortTermAdviceCell.tsx`
- Create: `app/src/features/securities/WatchlistShortTermAdviceCell.test.tsx`

**Interfaces:**
- Consumes: `WatchlistShortTermTaskState` and `ShortTermTradingAdvice`.
- Produces: `WatchlistShortTermAdviceCell` and `WatchlistShortTermAdviceDetailRow`.

- [ ] **Step 1: Write failing rendering and event-isolation tests**

```tsx
it('shows action and executable prices', () => {
  renderCell(successAdvice());
  expect(screen.getByText('逢低买入')).toBeInTheDocument();
  expect(screen.getByText(/买入 10.00–10.20/)).toBeInTheDocument();
  expect(screen.getByText(/止损 9.50/)).toBeInTheDocument();
  expect(screen.getByText(/止盈 11.25/)).toBeInTheDocument();
});

it('does not bubble its toggle to the stock row', async () => {
  await userEvent.click(screen.getByRole('button', { name: '查看平安银行短线建议' }));
  expect(rowClick).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/features/securities/WatchlistShortTermAdviceCell.test.tsx`  
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement accessible state, price summary, cache badge, retry, and detail row**

The cell must use a button with `aria-label="查看{stockName}短线建议"`. The detail row shows second target, risk/reward ratio, holding days, reasons, risks, completeness, `dataAsOf`, and `calculatedAt`. All handlers stop propagation.

- [ ] **Step 4: Run component tests and commit**

Run: `npm test -- src/features/securities/WatchlistShortTermAdviceCell.test.tsx`  
Expected: PASS.

```powershell
git add -- app/src/features/securities/WatchlistShortTermAdviceCell.tsx app/src/features/securities/WatchlistShortTermAdviceCell.test.tsx
git commit -m "feat: display short-term watchlist advice"
```

### Task 4: Integrate Short-Term Advice into the Watchlist Page

**Files:**
- Modify: `app/src/features/securities/WatchlistPage.tsx`
- Modify: `app/src/features/securities/WatchlistPage.test.tsx`

**Interfaces:**
- Consumes: Task 2 service functions and Task 3 components.
- Produces: automatic full analysis on active-pool changes, quote-driven lightweight refresh, combined manual refresh, isolated retry, and independent expanded rows.

- [ ] **Step 1: Extend page mocks and write failing integration tests**

```tsx
it('renders independent short-term and medium-term columns', async () => {
  renderWatchlist();
  expect(await screen.findByRole('columnheader', { name: '短线建议' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: '中线建议' })).toBeInTheDocument();
  expect(await screen.findByText('逢低买入')).toBeInTheDocument();
});

it('refreshes both caches from the existing refresh-all action', async () => {
  await userEvent.click(screen.getByRole('button', { name: '刷新全部建议' }));
  expect(mocks.clearWatchlistAdviceCache).toHaveBeenCalledWith(['000001']);
  expect(mocks.clearWatchlistShortTermAdviceCache).toHaveBeenCalledWith(['000001']);
});
```

- [ ] **Step 2: Verify existing page passes but new assertions fail**

Run: `npm test -- src/features/securities/WatchlistPage.test.tsx`  
Expected: FAIL because the short-term column and service integration are absent.

- [ ] **Step 3: Add independent state/run refs and automatic full analysis**

Add `shortTermStates`, `expandedShortTermCode`, and `shortTermRunRef`. Build the full-analysis dependency key from sorted stock codes, not prices, so a quote tick cannot trigger K-line reload.

- [ ] **Step 4: Add realtime lightweight recalculation effect**

Use a stable quote fingerprint containing code and price. Call `recalculateWatchlistShortTermStock` for successful stocks; the service owns the 30-second per-stock throttle. Use the current run id before publishing.

- [ ] **Step 5: Add the new table column, detail row, progress, retry, and combined refresh**

Place “短线建议” immediately before “中线建议”. Keep row navigation unchanged. Adjust detail-row `colSpan` from 8/9 to 9/10 after the added column.

- [ ] **Step 6: Run page and both cell suites and commit**

Run: `npm test -- src/features/securities/WatchlistPage.test.tsx src/features/securities/WatchlistAdviceCell.test.tsx src/features/securities/WatchlistShortTermAdviceCell.test.tsx`  
Expected: PASS.

```powershell
git add -- app/src/features/securities/WatchlistPage.tsx app/src/features/securities/WatchlistPage.test.tsx
git commit -m "feat: add short-term advice to watchlists"
```

### Task 5: Regression and Build Verification

**Files:**
- Verify only; no stock-analysis-page modifications are permitted.

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: tested and buildable short-term watchlist advice without stock-analysis regressions.

- [ ] **Step 1: Run all targeted short- and medium-term suites**

Run:

```powershell
npm test -- src/engines/market-analysis/short-term-trading-advice.test.ts src/engines/market-analysis/medium-term-buy-advice.test.ts src/features/securities/watchlist-short-term-advice-service.test.ts src/features/securities/watchlist-buy-advice-service.test.ts src/features/securities/WatchlistShortTermAdviceCell.test.tsx src/features/securities/WatchlistAdviceCell.test.tsx src/features/securities/WatchlistPage.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run type, lint, and production build checks**

Run: `npm run typecheck`  
Expected: PASS.

Run: `npm run lint`  
Expected: PASS or only pre-existing unrelated findings recorded verbatim.

Run: `npm run build`  
Expected: PASS.

- [ ] **Step 3: Verify the protected page and inspect the final diff**

Run:

```powershell
git diff --name-only HEAD~4..HEAD
git diff --check
git status --short
```

Expected: no path matching `app/src/features/securities/StockAnalysisPage.tsx`, no whitespace errors, and no unrelated user files staged.

- [ ] **Step 4: Commit any test-only final adjustments**

```powershell
git add -- app/src/engines/market-analysis/short-term-trading-advice.test.ts app/src/features/securities/watchlist-short-term-advice-service.test.ts app/src/features/securities/WatchlistShortTermAdviceCell.test.tsx app/src/features/securities/WatchlistPage.test.tsx
git commit -m "test: verify watchlist short-term advice"
```

