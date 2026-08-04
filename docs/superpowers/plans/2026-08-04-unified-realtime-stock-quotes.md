# Unified Realtime Stock Quotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents for this plan.

**Goal:** Give every A-share latest-price surface one shared, transaction-hours-aware 3-second quote stream with manual refresh, stale/error status, and preserved analytical snapshots.

**Architecture:** Add a testable market-session utility and singleton quote store that merges subscriptions, batches codes, prevents overlapping requests, preserves last-good quotes, and backs off after failures. Expose it through one React Hook and one status control, then migrate stock pages to overlay live quote fields without automatically rerunning K-line, fundamental, recommendation, ranking, advice, or allocation algorithms.

**Tech Stack:** React 19, TypeScript 6, Vitest 4, Testing Library, browser Page Visibility/Focus APIs, existing `fetchStockQuotes`/`StockQuote` market-data types.

## Global Constraints

- Trading windows use `Asia/Shanghai`: 09:25–11:35 and 12:55–15:05 on weekdays.
- Refresh active subscriptions every 3 seconds only during trading windows.
- Pause automatic requests while the document is hidden; refresh immediately when visibility or focus returns.
- Do not create overlapping quote requests; a manual refresh reuses an in-flight request.
- Preserve the last valid quote when a request fails or omits one code.
- Retry failures after 3, 6, 12, 24, then at most 30 seconds; reset after success.
- Mark quotes stale only when the market is trading and the last success is older than 60 seconds.
- Do not add a public-holiday calendar in this version.
- Do not automatically rerun K-line indicators, fundamentals, strategy signals, backtests, recommendation scoring/ranking, watchlist advice, or portfolio allocation.
- Every covered page must expose an `立即刷新` button, market status, and last successful update time.
- Saved portfolio prices and amounts are immutable historical snapshot fields.
- Do not change `StockQuote`, `sec_watchlists_v2`, `sec_active_watchlist`, stock-analysis routes, or watchlist-advice cache semantics.
- Preserve the existing unrelated K-line worktree changes and never use `git add .`.
- Do not use subagents.

---

## File Structure

- Create `app/src/infrastructure/market-data/stock-market-session.ts`: Shanghai trading-window status and next-session wake time.
- Create `app/src/infrastructure/market-data/stock-market-session.test.ts`: exact boundary and weekend cases.
- Create `app/src/infrastructure/market-data/realtime-stock-quotes.ts`: subscription store, batching, timer lifecycle, merge, retry, focus/visibility handling, and singleton.
- Create `app/src/infrastructure/market-data/realtime-stock-quotes.test.ts`: fake-clock store tests.
- Create `app/src/features/securities/useRealtimeStockQuotes.ts`: React subscription Hook and stable code normalization.
- Create `app/src/features/securities/useRealtimeStockQuotes.test.tsx`: Hook subscribe/change/unmount/manual-refresh tests.
- Create `app/src/features/securities/RealtimeQuoteStatus.tsx`: reusable status line and manual refresh button.
- Create `app/src/features/securities/RealtimeQuoteStatus.test.tsx`: status, stale, failure, and click tests.
- Create `app/src/features/securities/realtime-quote-merge.ts`: pure overlay helpers that preserve analytical fields and order.
- Create `app/src/features/securities/realtime-quote-merge.test.ts`: overlay/order/immutability tests.
- Modify `app/src/features/securities/SecuritiesWorkbenchPage.tsx`: remove local stock timer; migrate stock list, selected stock, and fund holdings component prices.
- Modify `app/src/features/securities/SecuritiesWorkbenchPage.test.tsx`: verify shared subscription and no direct interval/fund quote request.
- Modify `app/src/features/securities/StockAnalysisPage.tsx`: live quote display, immutable analysis snapshot, local refresh button.
- Create `app/src/features/securities/StockAnalysisPage.test.tsx`: live update and no heavy-analysis recomputation regressions.
- Modify `app/src/features/securities/WatchlistPage.tsx`: live quotes and status without rerunning advice.
- Modify `app/src/features/securities/WatchlistPage.test.tsx`: live-refresh/advice-isolation/manual-refresh tests.
- Create `app/src/features/securities/portfolio-live-pricing.ts`: pure current-value/P&L and current candidate share calculations.
- Create `app/src/features/securities/portfolio-live-pricing.test.ts`: immutable saved values and mark-to-market formulas.
- Modify `app/src/features/securities/PortfolioAllocationPage.tsx`: live candidates and saved portfolio mark-to-market columns.
- Modify `app/src/features/securities/PortfolioAllocationPage.test.tsx`: price overlay, P&L, and allocation preservation tests.
- Modify `app/src/features/securities/StockScreenerPage.tsx`: live result fields without rank/score changes.
- Create `app/src/features/securities/StockScreenerPage.test.tsx`: ranking-preservation and refresh-control tests.
- Modify `app/src/features/securities/StockRecommendPage.tsx`: live recommendation fields without recomputation.
- Create `app/src/features/securities/StockRecommendPage.test.tsx`: recommendation-preservation and refresh-control tests.

---

### Task 1: Shanghai Stock-Market Session Rules

**Files:**
- Create: `app/src/infrastructure/market-data/stock-market-session.ts`
- Test: `app/src/infrastructure/market-data/stock-market-session.test.ts`

**Interfaces:**
- Consumes: a `Date` whose clock is interpreted in `Asia/Shanghai`.
- Produces:

```ts
export type StockMarketSessionStatus = 'trading' | 'lunch_break' | 'closed' | 'weekend';

export function getStockMarketSessionStatus(now: Date): StockMarketSessionStatus;
export function millisecondsUntilNextTradingWindow(now: Date): number;
```

- [ ] **Step 1: Write failing boundary tests**

Use ISO strings with `+08:00` so tests do not depend on the machine timezone:

```ts
it.each([
  ['2026-08-03T09:24:59+08:00', 'closed'],
  ['2026-08-03T09:25:00+08:00', 'trading'],
  ['2026-08-03T11:34:59+08:00', 'trading'],
  ['2026-08-03T11:35:00+08:00', 'lunch_break'],
  ['2026-08-03T12:55:00+08:00', 'trading'],
  ['2026-08-03T15:05:00+08:00', 'closed'],
  ['2026-08-08T10:00:00+08:00', 'weekend'],
])('maps %s to %s', (iso, expected) => {
  expect(getStockMarketSessionStatus(new Date(iso))).toBe(expected);
});

it('wakes at the afternoon session during lunch', () => {
  expect(millisecondsUntilNextTradingWindow(new Date('2026-08-03T11:35:00+08:00'))).toBe(80 * 60 * 1000);
});

it('skips the weekend when calculating the next opening', () => {
  expect(millisecondsUntilNextTradingWindow(new Date('2026-08-07T15:05:00+08:00')))
    .toBe(new Date('2026-08-10T09:25:00+08:00').getTime() - new Date('2026-08-07T15:05:00+08:00').getTime());
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run src/infrastructure/market-data/stock-market-session.test.ts
```

Expected: FAIL because `stock-market-session.ts` does not exist.

- [ ] **Step 3: Implement exact session boundaries**

Convert the date to Shanghai weekday/hour/minute/second parts with an `Intl.DateTimeFormat` configured with `{ timeZone: 'Asia/Shanghai', hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }`. Treat seconds when comparing boundaries so 11:34:59 remains trading and 11:35:00 becomes lunch. `millisecondsUntilNextTradingWindow` returns the positive delay to today's 09:25, today's 12:55, or the next weekday 09:25; it never returns a negative value.

- [ ] **Step 4: Run the session tests and verify GREEN**

Run the Task 1 test command. Expected: all cases PASS.

- [ ] **Step 5: Commit the session utility**

```powershell
git add -- app/src/infrastructure/market-data/stock-market-session.ts app/src/infrastructure/market-data/stock-market-session.test.ts
git commit -m "feat: define stock market refresh sessions" -- app/src/infrastructure/market-data/stock-market-session.ts app/src/infrastructure/market-data/stock-market-session.test.ts
```

---

### Task 2: Shared Realtime Quote Store

**Files:**
- Create: `app/src/infrastructure/market-data/realtime-stock-quotes.ts`
- Test: `app/src/infrastructure/market-data/realtime-stock-quotes.test.ts`

**Interfaces:**
- Consumes: Task 1 session functions and `fetchStockQuotes` from `stock-api.ts`.
- Produces:

```ts
export interface RealtimeQuoteSnapshot {
  quotes: Record<string, StockQuote>;
  refreshing: boolean;
  marketStatus: StockMarketSessionStatus;
  lastUpdatedAt: string | null;
  stale: boolean;
  error: string;
}

export interface RealtimeStockQuoteDependencies {
  fetchQuotes: (codes: string[]) => Promise<StockQuote[]>;
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  isVisible: () => boolean;
  addVisibilityListener: (listener: () => void) => () => void;
  addFocusListener: (listener: () => void) => () => void;
  queueMicrotask: (callback: () => void) => void;
}

export interface RealtimeStockQuoteStore {
  subscribe(codes: string[], listener: (snapshot: RealtimeQuoteSnapshot) => void): () => void;
  refresh(codes?: string[]): Promise<void>;
  dispose(): void;
}

export function normalizeStockCodes(codes: string[]): string[];
export function createRealtimeStockQuoteStore(
  dependencies?: Partial<RealtimeStockQuoteDependencies>,
): RealtimeStockQuoteStore;
export const realtimeStockQuoteStore: RealtimeStockQuoteStore;
```

- [ ] **Step 1: Write failing normalization, merge, and lifecycle tests**

Use `vi.useFakeTimers()` and dependency injection. Include:

```ts
it('normalizes, deduplicates, and sorts subscribed codes', () => {
  expect(normalizeStockCodes(['600519', '000001', '600519', '', ' 000001 ']))
    .toEqual(['000001', '600519']);
});

it('merges overlapping subscribers into one immediate batch request', async () => {
  const { store, fetchQuotes } = setupTradingStore();
  const stopOne = store.subscribe(['000001', '600519'], vi.fn());
  const stopTwo = store.subscribe(['600519', '000333'], vi.fn());
  await vi.runAllTicks();
  expect(fetchQuotes).toHaveBeenCalledTimes(1);
  expect(fetchQuotes).toHaveBeenCalledWith(['000001', '000333', '600519']);
  stopOne(); stopTwo();
});

it('refreshes every three seconds during trading hours', async () => {
  const { store, fetchQuotes } = setupTradingStore();
  store.subscribe(['000001'], vi.fn());
  await vi.runAllTicks();
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchQuotes).toHaveBeenCalledTimes(2);
});

it('does not issue automatic requests during lunch and wakes at 12:55', async () => {
  const clock = mutableClock('2026-08-03T11:35:00+08:00');
  const { store, fetchQuotes } = setupStore({ now: clock.now });
  store.subscribe(['000001'], vi.fn());
  await vi.runAllTicks();
  expect(fetchQuotes).toHaveBeenCalledTimes(1); // initial subscription only
  clock.set('2026-08-03T12:55:00+08:00');
  await vi.advanceTimersByTimeAsync(80 * 60 * 1000);
  expect(fetchQuotes).toHaveBeenCalledTimes(2);
});

it('pauses while hidden and refreshes immediately after visibility returns', async () => {
  const visible = mutableVisibility(false);
  const { store, fetchQuotes } = setupStore(visible.dependencies);
  store.subscribe(['000001'], vi.fn());
  await vi.advanceTimersByTimeAsync(9000);
  expect(fetchQuotes).toHaveBeenCalledTimes(1);
  visible.show();
  await vi.runAllTicks();
  expect(fetchQuotes).toHaveBeenCalledTimes(2);
});
```

The initial subscription request is allowed outside trading time; only periodic polling stops.

Define the test helpers in the same test file with these contracts:

```ts
function quote(code: string, price: number): StockQuote;
function createDeferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
function mutableClock(initialIso: string): { now: () => number; set(iso: string): void };
function mutableVisibility(initial: boolean): { dependencies: Partial<RealtimeStockQuoteDependencies>; show(): void; hide(): void };
function setupStore(overrides?: Partial<RealtimeStockQuoteDependencies>): { store: RealtimeStockQuoteStore; fetchQuotes: ReturnType<typeof vi.fn> };
function setupTradingStore(overrides?: Partial<RealtimeStockQuoteDependencies>): ReturnType<typeof setupStore>;
function lastSnapshot(listener: ReturnType<typeof vi.fn>): RealtimeQuoteSnapshot;
```

- [ ] **Step 2: Write failing concurrency and resilience tests**

Add:

```ts
it('reuses the in-flight request instead of overlapping manual refreshes', async () => {
  const deferred = createDeferred<StockQuote[]>();
  const fetchQuotes = vi.fn().mockReturnValue(deferred.promise);
  const { store } = setupTradingStore({ fetchQuotes });
  store.subscribe(['000001'], vi.fn());
  const first = store.refresh(['000001']);
  const second = store.refresh(['000001']);
  expect(first).toBe(second);
  expect(fetchQuotes).toHaveBeenCalledTimes(1);
  deferred.resolve([quote('000001', 12)]);
  await first;
});

it('preserves the last good quote when a later batch omits the code', async () => {
  const fetchQuotes = vi.fn()
    .mockResolvedValueOnce([quote('000001', 12), quote('600519', 1300)])
    .mockResolvedValueOnce([quote('600519', 1301)]);
  const listener = vi.fn();
  const { store } = setupTradingStore({ fetchQuotes });
  store.subscribe(['000001', '600519'], listener);
  await vi.runAllTicks();
  await store.refresh();
  expect(lastSnapshot(listener).quotes['000001'].price).toBe(12);
  expect(lastSnapshot(listener).quotes['600519'].price).toBe(1301);
});

it('preserves quotes and exposes an error after a failed refresh', async () => {
  const fetchQuotes = vi.fn()
    .mockResolvedValueOnce([quote('000001', 12)])
    .mockRejectedValueOnce(new Error('network'));
  const listener = vi.fn();
  const { store } = setupTradingStore({ fetchQuotes });
  store.subscribe(['000001'], listener);
  await vi.runAllTicks();
  await store.refresh();
  expect(lastSnapshot(listener)).toMatchObject({ error: 'network' });
  expect(lastSnapshot(listener).quotes['000001'].price).toBe(12);
});

it('backs off 3, 6, 12, 24, then 30 seconds and resets after success', async () => {
  const fetchQuotes = vi.fn()
    .mockRejectedValueOnce(new Error('1'))
    .mockRejectedValueOnce(new Error('2'))
    .mockRejectedValueOnce(new Error('3'))
    .mockRejectedValueOnce(new Error('4'))
    .mockRejectedValueOnce(new Error('5'))
    .mockResolvedValue([quote('000001', 12)]);
  const { store } = setupTradingStore({ fetchQuotes });
  store.subscribe(['000001'], vi.fn());
  for (const delay of [3000, 6000, 12000, 24000, 30000]) await vi.advanceTimersByTimeAsync(delay);
  expect(fetchQuotes).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchQuotes).toHaveBeenCalledTimes(7);
});
```

Also test: valid price must be finite and positive, listeners receive only their subscribed codes, stale becomes true after 60 seconds of trading-time failures, last unsubscribe clears timers/listeners, and `dispose()` is idempotent.

- [ ] **Step 3: Run the store tests and verify RED**

```powershell
npx vitest run src/infrastructure/market-data/realtime-stock-quotes.test.ts
```

Expected: FAIL because the store module does not exist.

- [ ] **Step 4: Implement the store minimally**

Implementation rules:

1. Store subscribers in a `Map<symbol, { codes: string[]; listener: (snapshot: RealtimeQuoteSnapshot) => void }>`.
   The first refresh is queued in one microtask so subscriptions created in the same React commit share one union request.
   Implement `refresh` as a normal function returning `inFlight` directly, not as an `async` wrapper, so concurrent callers receive the same Promise object.
2. Compute the active union only when subscriptions change.
3. Split batches into at most 80 codes before calling `fetchQuotes`; combine the batch promises into one logical refresh.
4. Merge only finite, positive-price quotes into the cache.
5. Notify subscribers with filtered quote records.
6. Use one `inFlight: Promise<void> | null`; `refresh()` returns it while non-null.
7. Use one-shot timers, not `setInterval`, so backoff and market transitions are deterministic.
8. When trading and visible, schedule 3 seconds after success or the current backoff after failure.
9. During lunch/closed/weekend, schedule a wake-up callback using `millisecondsUntilNextTradingWindow` without issuing periodic requests.
10. Attach focus/visibility listeners only while at least one subscriber exists.
11. Calculate `stale` as `marketStatus === 'trading' && lastUpdatedAt !== null && now - lastUpdatedAt > 60_000`.

- [ ] **Step 5: Run session and store tests and verify GREEN**

```powershell
npx vitest run src/infrastructure/market-data/stock-market-session.test.ts src/infrastructure/market-data/realtime-stock-quotes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the quote store**

```powershell
git add -- app/src/infrastructure/market-data/realtime-stock-quotes.ts app/src/infrastructure/market-data/realtime-stock-quotes.test.ts
git commit -m "feat: add shared realtime stock quote store" -- app/src/infrastructure/market-data/realtime-stock-quotes.ts app/src/infrastructure/market-data/realtime-stock-quotes.test.ts
```

---

### Task 3: React Hook, Status Control, and Pure Quote Overlay

**Files:**
- Create: `app/src/features/securities/useRealtimeStockQuotes.ts`
- Create: `app/src/features/securities/useRealtimeStockQuotes.test.tsx`
- Create: `app/src/features/securities/RealtimeQuoteStatus.tsx`
- Create: `app/src/features/securities/RealtimeQuoteStatus.test.tsx`
- Create: `app/src/features/securities/realtime-quote-merge.ts`
- Create: `app/src/features/securities/realtime-quote-merge.test.ts`

**Interfaces:**

```ts
export function useRealtimeStockQuotes(codes: string[]): RealtimeQuoteSnapshot & {
  refreshNow: () => Promise<void>;
};

export interface RealtimeQuoteStatusProps {
  refreshing: boolean;
  marketStatus: StockMarketSessionStatus;
  lastUpdatedAt: string | null;
  stale: boolean;
  error: string;
  onRefresh: () => void;
}

export function RealtimeQuoteStatus(props: RealtimeQuoteStatusProps): React.ReactElement;

export function overlayRealtimeQuote<T extends { code: string }>(saved: T, live?: StockQuote): T;
export function overlayRealtimeQuotesPreservingOrder<T extends { code: string }>(saved: T[], live: Record<string, StockQuote>): T[];
```

- [ ] **Step 1: Write failing Hook tests**

Mock the singleton store and assert:

```tsx
it('subscribes with normalized codes and unsubscribes on unmount', () => {
  const unsubscribe = vi.fn();
  mockedStore.subscribe.mockReturnValue(unsubscribe);
  const { unmount } = renderHook(() => useRealtimeStockQuotes(['600519', '000001', '600519']));
  expect(mockedStore.subscribe).toHaveBeenCalledWith(['000001', '600519'], expect.any(Function));
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('does not resubscribe when only the code order changes', () => {
  const { rerender } = renderHook(({ codes }) => useRealtimeStockQuotes(codes), {
    initialProps: { codes: ['000001', '600519'] },
  });
  rerender({ codes: ['600519', '000001'] });
  expect(mockedStore.subscribe).toHaveBeenCalledTimes(1);
});

it('refreshes only the Hook code set', async () => {
  const { result } = renderHook(() => useRealtimeStockQuotes(['000001']));
  await act(() => result.current.refreshNow());
  expect(mockedStore.refresh).toHaveBeenCalledWith(['000001']);
});
```

- [ ] **Step 2: Write failing status and overlay tests**

```tsx
it('renders trading status, update time, and manual refresh', async () => {
  const onRefresh = vi.fn();
  render(<RealtimeQuoteStatus refreshing={false} marketStatus="trading" lastUpdatedAt="2026-08-04T02:00:00.000Z" stale={false} error="" onRefresh={onRefresh} />);
  expect(screen.getByText('交易中 · 3秒自动刷新')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '立即刷新' }));
  expect(onRefresh).toHaveBeenCalledOnce();
});

it('keeps the refresh button disabled while refreshing', () => {
  renderStatus({ refreshing: true });
  expect(screen.getByRole('button', { name: '刷新中' })).toBeDisabled();
});

it('shows stale and last-good-data warnings without hiding the update time', () => {
  renderStatus({ stale: true, error: 'network', lastUpdatedAt: '2026-08-04T02:00:00.000Z' });
  expect(screen.getByText('行情可能已延迟')).toBeInTheDocument();
  expect(screen.getByText('行情暂时不可用，显示上次有效数据')).toBeInTheDocument();
  expect(screen.getByText(/最后更新：/)).toBeInTheDocument();
});
```

Overlay tests must prove that live quote fields replace quote fields while custom `score`, `signalCount`, `signals`, and array order remain unchanged, and that source objects are not mutated.

- [ ] **Step 3: Run all Task 3 tests and verify RED**

```powershell
npx vitest run src/features/securities/useRealtimeStockQuotes.test.tsx src/features/securities/RealtimeQuoteStatus.test.tsx src/features/securities/realtime-quote-merge.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the Hook**

Use a normalized comma-joined key as the effect dependency:

```ts
const normalizedCodes = useMemo(() => normalizeStockCodes(codes), [codes.join(',')]);
const codeKey = normalizedCodes.join(',');

useEffect(() => realtimeStockQuoteStore.subscribe(
  normalizedCodes,
  next => setState(next),
), [codeKey]);
```

Return `refreshNow: () => realtimeStockQuoteStore.refresh(normalizedCodes)`. Empty code sets return an empty snapshot and must not subscribe.

- [ ] **Step 5: Implement the status component and overlay helpers**

Map market status exactly:

```ts
const labels = {
  trading: '交易中 · 3秒自动刷新',
  lunch_break: '午间休市',
  closed: '已收盘',
  weekend: '周末休市',
} as const;
```

Always render the button. Use `刷新中` and `disabled` during refresh. Format the update time with `toLocaleTimeString('zh-CN', { hour12: false })`.

`overlayRealtimeQuote` returns a new object and copies only realtime quote keys that already matter to consumers: `name`, `market`, `price`, `change`, `changePct`, `open`, `high`, `low`, `volume`, `amount`, `preClose`, `turnover`, `pe`, `pb`, `totalShares`, `floatShares`, `totalCap`, and `floatCap`. It accepts any `{ code: string }` record, so full screener quotes and reduced `StockRecommendation` records both work. Fields such as `score`, `signalCount`, `signals`, `summary`, `allocation`, and `rationale` remain untouched.

- [ ] **Step 6: Run Task 3 tests and typecheck**

```powershell
npx vitest run src/features/securities/useRealtimeStockQuotes.test.tsx src/features/securities/RealtimeQuoteStatus.test.tsx src/features/securities/realtime-quote-merge.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the React realtime primitives**

```powershell
git add -- app/src/features/securities/useRealtimeStockQuotes.ts app/src/features/securities/useRealtimeStockQuotes.test.tsx app/src/features/securities/RealtimeQuoteStatus.tsx app/src/features/securities/RealtimeQuoteStatus.test.tsx app/src/features/securities/realtime-quote-merge.ts app/src/features/securities/realtime-quote-merge.test.ts
git commit -m "feat: expose realtime stock quotes to React" -- app/src/features/securities/useRealtimeStockQuotes.ts app/src/features/securities/useRealtimeStockQuotes.test.tsx app/src/features/securities/RealtimeQuoteStatus.tsx app/src/features/securities/RealtimeQuoteStatus.test.tsx app/src/features/securities/realtime-quote-merge.ts app/src/features/securities/realtime-quote-merge.test.ts
```

---

### Task 4: Migrate the Securities Workbench and Fund Holdings

**Files:**
- Modify: `app/src/features/securities/SecuritiesWorkbenchPage.tsx`
- Modify: `app/src/features/securities/SecuritiesWorkbenchPage.test.tsx`

**Interfaces:**
- Consumes: `useRealtimeStockQuotes`, `RealtimeQuoteStatus`, `overlayRealtimeQuote`.
- Preserves: stock search, selected-stock navigation, stock-directory loading, fund NAV behavior, and non-stock modules.

- [ ] **Step 1: Write failing stock-workbench tests**

Mock the Hook with two snapshots and add:

```tsx
it('renders stock watchlist prices from the shared realtime Hook', async () => {
  mockRealtimeQuotes({ '000001': quote({ code: '000001', price: 12.34 }) });
  renderWorkbench();
  expect(await screen.findByText('12.34')).toBeInTheDocument();
  expect(useRealtimeStockQuotes).toHaveBeenCalledWith(expect.arrayContaining(['000001']));
});

it('uses the shared manual refresh control instead of a page-local timer', async () => {
  const refreshNow = vi.fn();
  mockRealtimeQuotes({}, { refreshNow });
  renderWorkbench();
  await userEvent.click(screen.getByRole('button', { name: '立即刷新' }));
  expect(refreshNow).toHaveBeenCalledOnce();
});
```

Remove any test expectations tied to the old 3-second `setInterval` implementation.

- [ ] **Step 2: Write failing fund-holdings stock-price test**

Return a holding with stock code `000001`, switch to the `持仓 (1)` tab, and assert its displayed price/change come from the realtime Hook. Assert `fetchTencentQuotes` is not called for holding stock prices.

- [ ] **Step 3: Run workbench tests and verify RED**

```powershell
npx vitest run src/features/securities/SecuritiesWorkbenchPage.test.tsx
```

Expected: FAIL because the page still owns its timer and fund holdings still call `fetchTencentQuotes`.

- [ ] **Step 4: Replace the stock workbench timer**

Remove `doRefresh`, the local transaction-time function, and `setInterval`. Subscribe with:

```ts
const realtime = useRealtimeStockQuotes(watchlist.map(stock => stock.code));
const quotes = watchlist
  .map(stock => realtime.quotes[stock.code])
  .filter((quote): quote is StockQuote => Boolean(quote));
```

Keep `selectedStock` as a selected code or overlay it from `realtime.quotes` so quote updates do not reset the selection. Render `RealtimeQuoteStatus` once above the stock table.

- [ ] **Step 5: Replace the fund-holding stock quote request**

Remove `stockQuotes` state and the `fetchTencentQuotes(stockCodes)` call from `FundDetailPanel`. Subscribe to `holdings.map(h => h.stockCode)`, read `price` and `changePct`, and render the shared status control inside the holdings tab. Do not change fund NAV or fund-position calculations.

- [ ] **Step 6: Run workbench tests and verify GREEN**

Run the Task 4 test command and `npm run typecheck`. Expected: PASS.

- [ ] **Step 7: Commit the workbench migration**

```powershell
git add -- app/src/features/securities/SecuritiesWorkbenchPage.tsx app/src/features/securities/SecuritiesWorkbenchPage.test.tsx
git commit -m "feat: migrate securities workbench to shared quotes" -- app/src/features/securities/SecuritiesWorkbenchPage.tsx app/src/features/securities/SecuritiesWorkbenchPage.test.tsx
```

---

### Task 5: Realtime Quotes on Individual Stock Analysis

**Files:**
- Modify: `app/src/features/securities/StockAnalysisPage.tsx`
- Create: `app/src/features/securities/StockAnalysisPage.test.tsx`

**Interfaces:**
- Consumes: Task 3 Hook/status.
- Preserves: route, K-line loading, tabs, strategies, fundamentals, backtest, research, debate, and watchlist toggle.

- [ ] **Step 1: Write failing initial/live quote tests**

Mock the Hook and K-line/fundamental dependencies:

```tsx
it('renders the live quote and exposes local manual refresh', async () => {
  const refreshNow = vi.fn();
  mockRealtimeHook({ quotes: { '000001': quote({ price: 12.34, changePct: 1.2 }) }, refreshNow });
  renderStockAnalysis('/projects/default/securities/stock/000001');
  expect(await screen.findByText('12.34')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '立即刷新' }));
  expect(refreshNow).toHaveBeenCalledOnce();
});

it('keeps the selected tab when the live quote changes', async () => {
  const view = renderStockAnalysis('/projects/default/securities/stock/000001');
  await userEvent.click(await screen.findByRole('button', { name: '📈 K线与指标' }));
  publishRealtimeQuote(quote({ price: 12.50 }));
  view.rerender(app());
  expect(screen.getByText('K线走势 (近120日)')).toBeInTheDocument();
  expect(screen.getByText('12.50')).toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing analytical-isolation test**

Spy on `scoreFundamentals` and `runBacktest`. After the first live quote renders, publish only a price update. Assert the displayed price changes but the fundamental scorer and backtest call counts do not increase.

- [ ] **Step 3: Run stock-analysis tests and verify RED**

```powershell
npx vitest run src/features/securities/StockAnalysisPage.test.tsx
```

Expected: FAIL because the page still performs a one-shot `fetchSinaQuotes` and reloads the whole window manually.

- [ ] **Step 4: Integrate live and immutable analysis quote states**

Use the Hook for `[code]`. Capture the first valid quote per route code as `analysisStock` and never replace it on ordinary price updates:

```ts
const realtime = useRealtimeStockQuotes([code]);
const liveStock = realtime.quotes[code] ?? null;
const [analysisStock, setAnalysisStock] = useState<StockQuote | null>(null);
useEffect(() => { setAnalysisStock(null); }, [code]);
useEffect(() => {
  if (liveStock?.code === code && !analysisStock) setAnalysisStock(liveStock);
}, [code, liveStock, analysisStock]);
```

Pass both to `StockDashboard`. Use `liveStock` for visible quote cards and direct current-price targets. Use `analysisStock` for `scoreFundamentals` and any memoized analytical snapshot that must not rerun every 3 seconds. User-triggered research/debate may use the latest `liveStock` at click time.

- [ ] **Step 5: Replace the full-page refresh control**

Remove `window.location.reload()`. Render `RealtimeQuoteStatus` in `PageShell` or the dashboard header with `onRefresh={() => void realtime.refreshNow()}`. Keep the watchlist toggle unchanged.

- [ ] **Step 6: Run the new test and existing stock regressions**

```powershell
npx vitest run src/features/securities/StockAnalysisPage.test.tsx src/engines/market-analysis/technical-indicators.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit stock-analysis integration**

```powershell
git add -- app/src/features/securities/StockAnalysisPage.tsx app/src/features/securities/StockAnalysisPage.test.tsx
git commit -m "feat: stream live quotes into stock analysis" -- app/src/features/securities/StockAnalysisPage.tsx app/src/features/securities/StockAnalysisPage.test.tsx
```

---

### Task 6: Realtime Watchlist Without Advice Recalculation

**Files:**
- Modify: `app/src/features/securities/WatchlistPage.tsx`
- Modify: `app/src/features/securities/WatchlistPage.test.tsx`

**Interfaces:**
- Consumes: Task 3 Hook/status.
- Preserves: active pool storage, grouping, row navigation, advice cache, advice refresh, and advice details.

- [ ] **Step 1: Write failing live-watchlist test**

```tsx
it('subscribes to the entire active pool and renders realtime prices', async () => {
  mockRealtimeHook({ quotes: { '000001': stock({ price: 12.34 }) } });
  renderWatchlist();
  expect(useRealtimeStockQuotes).toHaveBeenCalledWith(['000001']);
  expect(await screen.findByText('12.34')).toBeInTheDocument();
});

it('keeps the entire pool subscribed while a tag filter is active', async () => {
  seedTwoStockTaggedWatchlist();
  renderWatchlist();
  await userEvent.click(screen.getByRole('button', { name: '价值投资 (1)+0%' }));
  expect(useRealtimeStockQuotes).toHaveBeenLastCalledWith(expect.arrayContaining(['000001', '600519']));
});
```

- [ ] **Step 2: Write failing advice-isolation and manual-refresh tests**

After initial advice success, publish a new quote with the same code and assert `analyzeWatchlistQuotes` call count does not increase. Click the行情区域的 `立即刷新` button and assert only `refreshNow` runs; click `刷新全部建议` and assert the existing advice service still runs separately.

- [ ] **Step 3: Run watchlist tests and verify RED**

```powershell
npx vitest run src/features/securities/WatchlistPage.test.tsx
```

Expected: FAIL because the page still fetches quotes once and its advice effect depends on quote objects.

- [ ] **Step 4: Replace quote fetching with the Hook**

Subscribe to `activeWl?.codes ?? []`. Derive `quotes` in active-watchlist code order from the Hook record. Render `RealtimeQuoteStatus` near the advice status, with separate buttons and labels.

- [ ] **Step 5: Stabilize the advice trigger**

Create a code-only readiness key:

```ts
const adviceReadyKey = quotes.map(quote => quote.code).sort().join(',');
```

The automatic advice effect depends on `activeId` and `adviceReadyKey`, not the quote array identity or price fields. It runs again only when a code first becomes available, the pool changes, or the active pool changes. Manual `刷新全部建议` behavior remains unchanged.

- [ ] **Step 6: Run watchlist, advice, and Hook tests**

```powershell
npx vitest run src/features/securities/WatchlistPage.test.tsx src/features/securities/watchlist-buy-advice-service.test.ts src/features/securities/useRealtimeStockQuotes.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit watchlist integration**

```powershell
git add -- app/src/features/securities/WatchlistPage.tsx app/src/features/securities/WatchlistPage.test.tsx
git commit -m "feat: stream realtime quotes into watchlists" -- app/src/features/securities/WatchlistPage.tsx app/src/features/securities/WatchlistPage.test.tsx
```

---

### Task 7: Portfolio Candidate and Saved-Group Mark-to-Market

**Files:**
- Create: `app/src/features/securities/portfolio-live-pricing.ts`
- Create: `app/src/features/securities/portfolio-live-pricing.test.ts`
- Modify: `app/src/features/securities/PortfolioAllocationPage.tsx`
- Modify: `app/src/features/securities/PortfolioAllocationPage.test.tsx`

**Interfaces:**

```ts
export interface MarkedPortfolioPosition {
  savedPrice: number;
  currentPrice: number;
  currentValue: number;
  unrealizedPnl: number;
  returnPct: number;
}

export function markPortfolioPosition(
  position: PortfolioPositionSnapshot,
  liveQuote?: StockQuote,
): MarkedPortfolioPosition;

export function currentBoardLotShares(amount: number, currentPrice: number): number;
```

- [ ] **Step 1: Write failing pure pricing tests**

```ts
it('keeps the saved price while calculating current value and return', () => {
  const position = savedPosition({ price: 10, amount: 10000, shares: 1000 });
  const marked = markPortfolioPosition(position, quote({ price: 12 }));
  expect(marked).toEqual({
    savedPrice: 10,
    currentPrice: 12,
    currentValue: 12000,
    unrealizedPnl: 2000,
    returnPct: 20,
  });
  expect(position.price).toBe(10);
  expect(position.amount).toBe(10000);
});

it('falls back to the saved price when live data is missing', () => {
  const marked = markPortfolioPosition(savedPosition({ price: 10, amount: 10000, shares: 1000 }));
  expect(marked.currentPrice).toBe(10);
  expect(marked.unrealizedPnl).toBe(0);
});

it('recalculates board-lot shares from fixed amount and current price', () => {
  expect(currentBoardLotShares(10000, 12)).toBe(800);
  expect(currentBoardLotShares(10000, 0)).toBe(0);
});
```

- [ ] **Step 2: Run pricing tests and verify RED**

```powershell
npx vitest run src/features/securities/portfolio-live-pricing.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure formulas**

Round currency values to two decimals and return percentage to two decimals. Use `position.amount` as the immutable cost basis and `position.shares` as the immutable saved share count for historical mark-to-market. `currentBoardLotShares` uses `Math.floor(amount / price / 100) * 100`.

- [ ] **Step 4: Write failing page-integration tests**

Add tests proving:

- Candidate latest price changes to the Hook price.
- Candidate score, allocation, amount, group, rationale, and row order remain unchanged.
- Candidate suggested shares use the live price.
- Saved position shows separate `保存价格`, `当前价`, `当前市值`, `浮动盈亏`, and `收益率` columns.
- Manual refresh calls `refreshNow` without calling `runAnalysis`.

- [ ] **Step 5: Integrate the portfolio page**

Subscribe to the union of candidate codes and the currently managed saved-version codes. Derive live candidate rows without writing them back to `candidates`. Derive marked saved positions during render without writing them to `portfolioGroups` or localStorage. Render one shared status control above current and saved tables.

- [ ] **Step 6: Run portfolio tests and regressions**

```powershell
npx vitest run src/features/securities/portfolio-live-pricing.test.ts src/features/securities/PortfolioAllocationPage.test.tsx src/features/securities/portfolio-group-storage.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit portfolio mark-to-market**

```powershell
git add -- app/src/features/securities/portfolio-live-pricing.ts app/src/features/securities/portfolio-live-pricing.test.ts app/src/features/securities/PortfolioAllocationPage.tsx app/src/features/securities/PortfolioAllocationPage.test.tsx
git commit -m "feat: mark portfolio positions to realtime prices" -- app/src/features/securities/portfolio-live-pricing.ts app/src/features/securities/portfolio-live-pricing.test.ts app/src/features/securities/PortfolioAllocationPage.tsx app/src/features/securities/PortfolioAllocationPage.test.tsx
```

---

### Task 8: Live Price Overlays for Screener and Recommendations

**Files:**
- Modify: `app/src/features/securities/StockScreenerPage.tsx`
- Create: `app/src/features/securities/StockScreenerPage.test.tsx`
- Modify: `app/src/features/securities/StockRecommendPage.tsx`
- Create: `app/src/features/securities/StockRecommendPage.test.tsx`

**Interfaces:**
- Consumes: Task 3 Hook/status/overlay helper.
- Preserves: current screen/recommend actions, scores, signal counts, recommendation summaries, ranking, and navigation.

- [ ] **Step 1: Write failing screener tests**

Seed two results with scores 90 and 70, then publish live quotes whose prices reverse their relative size. Assert the first row remains the score-90 code, both displayed prices update, scores remain unchanged, and `立即刷新` calls only `refreshNow`.

Concrete assertions:

```tsx
expect(screen.getAllByRole('row')[1]).toHaveTextContent('000001');
expect(screen.getAllByRole('row')[1]).toHaveTextContent('90');
expect(screen.getAllByRole('row')[1]).toHaveTextContent('8.00');
expect(refreshNow).toHaveBeenCalledOnce();
expect(fetchSinaQuotes).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Write failing recommendation tests**

Seed Top 2 recommendations. Publish new quotes and assert names, `#1/#2`, score, summary, and signal tags remain in the same order while price/change fields update. The manual quote button must not call `recommendStocks` again.

- [ ] **Step 3: Run page tests and verify RED**

```powershell
npx vitest run src/features/securities/StockScreenerPage.test.tsx src/features/securities/StockRecommendPage.test.tsx
```

Expected: FAIL because neither result page subscribes to live prices or renders the shared control.

- [ ] **Step 4: Implement non-destructive overlays**

Subscribe only when results exist. Create `displayResults`/`displayRecommendations` with `overlayRealtimeQuotesPreservingOrder`. Render the shared status control above each result section. Do not write live quotes back to scored state, sort again, or call the analysis action from `refreshNow`.

- [ ] **Step 5: Run the new tests and typecheck**

Run the Task 8 test command and `npm run typecheck`. Expected: PASS.

- [ ] **Step 6: Commit result-page overlays**

```powershell
git add -- app/src/features/securities/StockScreenerPage.tsx app/src/features/securities/StockScreenerPage.test.tsx app/src/features/securities/StockRecommendPage.tsx app/src/features/securities/StockRecommendPage.test.tsx
git commit -m "feat: refresh stock result prices without reranking" -- app/src/features/securities/StockScreenerPage.tsx app/src/features/securities/StockScreenerPage.test.tsx app/src/features/securities/StockRecommendPage.tsx app/src/features/securities/StockRecommendPage.test.tsx
```

---

### Task 9: Full Regression, Production Build, and Browser Verification

**Files:**
- Verify only; make corrections only in files introduced or explicitly modified by Tasks 1–8.

- [ ] **Step 1: Run realtime primitive tests**

```powershell
npx vitest run src/infrastructure/market-data/stock-market-session.test.ts src/infrastructure/market-data/realtime-stock-quotes.test.ts src/features/securities/useRealtimeStockQuotes.test.tsx src/features/securities/RealtimeQuoteStatus.test.tsx src/features/securities/realtime-quote-merge.test.ts src/features/securities/portfolio-live-pricing.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run all affected page tests**

```powershell
npx vitest run src/features/securities/SecuritiesWorkbenchPage.test.tsx src/features/securities/StockAnalysisPage.test.tsx src/features/securities/WatchlistPage.test.tsx src/features/securities/PortfolioAllocationPage.test.tsx src/features/securities/StockScreenerPage.test.tsx src/features/securities/StockRecommendPage.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run analytical isolation regressions**

```powershell
npx vitest run src/engines/market-analysis/technical-indicators.test.ts src/features/securities/watchlist-buy-advice-service.test.ts src/features/securities/portfolio-group-storage.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run securities and market-data regression suites**

```powershell
npx vitest run src/features/securities src/infrastructure/market-data
```

Expected: all new and affected tests PASS. If the two pre-existing stock-directory classification/result tests retain their previously recorded failures, document them without changing stock-directory behavior.

- [ ] **Step 5: Run static and production checks**

```powershell
npm run typecheck
npm run build
git diff --check
```

Expected: success; existing Vite chunk-size and ineffective-dynamic-import warnings remain informational.

- [ ] **Step 6: Browser-verify automatic and manual refresh**

At `http://localhost:5173` verify each page below:

1. Securities workbench stock table: status line appears; price changes do not change the selected stock.
2. Individual stock analysis: price fields refresh; current tab remains selected; `立即刷新` does not reload the page.
3. Watchlist: all pool prices refresh; group filter and expanded advice remain; advice calculation does not restart.
4. Portfolio allocation: current candidate price/share display refreshes; scores and allocations remain; saved group shows immutable saved price and live P&L.
5. Screener: result order/score remain while quote fields refresh.
6. Recommendations: ranking/score/signals remain while quote fields refresh.
7. Fund holding component stocks: latest price/change use the shared status and refresh.

Check a hidden/visible transition if browser controls support it; otherwise rely on the fake-timer visibility tests.

- [ ] **Step 7: Browser-verify failure retention**

Temporarily use the browser's offline/network-blocking capability only if supported without changing application code. Confirm the warning appears and last-good values remain. If the capability is unavailable, rely on store/component tests and record that browser-level failure simulation was not available.

- [ ] **Step 8: Inspect final Git scope**

```powershell
git status --short
git diff --check
git log -10 --oneline
git diff --name-only HEAD -- app/src/infrastructure/market-data/stock-api.ts app/public/_redirects app/vite.config.ts app/src/infrastructure/market-data/stock-kline-proxy.test.ts
```

Expected: the known K-line files remain untouched by realtime-quote commits; all new realtime work is committed in task-sized commits.

