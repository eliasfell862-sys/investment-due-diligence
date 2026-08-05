# Global Realtime Signal Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continuously monitor only all watchlist stocks and actual positions while the website is open, then deliver executable open, add, reduce, and exit alerts with frozen trigger prices and suggested board-lot quantities.

**Architecture:** Add a pure recommendation layer that combines flat-position and held-position backtest decisions, extend the existing inbox state with independent buy/sell edges and compatible message normalization, and host one `useRealtimeBacktestMonitor` instance in `AppShell` through a Context provider. `SignalInbox` becomes a Context consumer and transaction UI; actual trades continue to write only to `sec_stock_position_ledger_v1`.

**Tech Stack:** React 19, TypeScript, React Router, Vitest, Testing Library, browser `localStorage`, existing realtime quote Hook, K-line/backtest engine, signal inbox store, and actual-position ledger.

## Global Constraints

- Do not use subagents; the user explicitly requires inline execution.
- Monitor only the deduplicated union of all watchlist codes and actual-position codes.
- Do not read the full A-share security directory as a monitoring universe.
- Keep `sec_stock_position_ledger_v1` as the only actual-position ledger.
- Keep `sec_bt_signal_inbox_v2` as the inbox storage key and preserve readable existing messages.
- Realtime processing runs every three seconds only while the market status is `trading`.
- The frontend monitor runs only while the website is open; the UI must say so explicitly.
- Open and add suggestions default to 100 shares.
- Stop-loss and maximum-holding-period exits suggest the complete position.
- Technical reductions suggest 25% of the position, rounded down to a 100-share lot, with a 100-share minimum and never above the position.
- Every persisted alert freezes the realtime trigger price and suggested shares at creation time.
- A held-stock sell signal takes precedence over an add signal in the same snapshot.
- Continuous identical buy or sell directions do not generate duplicate messages; the corresponding direction must return to hold before rearming.
- First buys may select or create a position group; add-on buys remain locked to the existing position group.
- No trade executes automatically. The ledger must persist successfully before an alert is marked executed.
- Do not modify `app/src/features/securities/StockAnalysisPage.tsx` or its quote, overview, and K-line path.

---

## File Structure

- Create `app/src/features/securities/signal-trade-recommendation.ts`: pure signal priority and board-lot sizing.
- Create `app/src/features/securities/signal-trade-recommendation.test.ts`: open/add/reduce/exit and precedence tests.
- Modify `app/src/features/securities/backtest-signal-inbox-store.ts`: enriched alerts, independent edge state, compatible loading, and execution transitions.
- Modify `app/src/features/securities/backtest-signal-inbox-store.test.ts`: migration, edge rearming, frozen price, and quantity tests.
- Modify `app/src/features/securities/realtime-backtest-monitor.ts`: evaluate flat and held paths and pass position shares.
- Modify `app/src/features/securities/realtime-backtest-monitor.test.ts`: dual-path evaluation, sell priority input, and failure isolation.
- Modify `app/src/features/securities/useRealtimeBacktestMonitor.ts`: monitoring counts, position shares, last scan state, and persistence error reporting.
- Modify `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`: counts, persistence errors, and actual-position payload tests.
- Create `app/src/features/securities/RealtimeBacktestMonitorProvider.tsx`: one global provider and guarded Context consumer.
- Create `app/src/features/securities/RealtimeBacktestMonitorProvider.test.tsx`: singleton lifecycle and Context contract tests.
- Modify `app/src/app/AppShell.tsx`: host the provider above every route outlet.
- Modify `app/src/features/securities/SignalInbox.tsx`: consume Context, display monitoring diagnostics and intent-specific trades.
- Modify `app/src/features/securities/SignalInbox.test.tsx`: four intent displays, suggested quantity/price, group behavior, and ledger execution.
- Modify `app/src/features/securities/StockTradeConfirmDialog.tsx`: initialize quantity from the alert recommendation and show intent-aware copy.
- Modify `app/src/features/securities/StockTradeConfirmDialog.test.tsx`: suggested-share initialization and add-on wording.
- Regression only: router, securities workbench, watchlist, actual positions, stock analysis, realtime quote, and ledger tests.

---

### Task 1: Add Pure Signal Recommendation and Sell Sizing

**Files:**
- Create: `app/src/features/securities/signal-trade-recommendation.ts`
- Create: `app/src/features/securities/signal-trade-recommendation.test.ts`

**Interfaces:**
- Consumes: `BacktestBarDecision` from `backtest-strategy.ts`.
- Produces:

```ts
export type SignalIntent = 'open' | 'add' | 'reduce' | 'exit';

export interface SignalTradeRecommendation {
  action: 'buy' | 'sell';
  intent: SignalIntent;
  decision: BacktestBarDecision;
  suggestedShares: number;
}

export interface SelectSignalTradeInput {
  isBuyCandidate: boolean;
  isHeld: boolean;
  positionShares: number;
  buyDecision: BacktestBarDecision;
  sellDecision: BacktestBarDecision;
}

export function calculateTechnicalSellShares(positionShares: number): number;
export function selectSignalTrade(input: SelectSignalTradeInput): SignalTradeRecommendation | null;
```

- [ ] **Step 1: Write the failing sizing and priority tests**

```ts
it.each([
  [1000, 200],
  [500, 100],
  [100, 100],
  [50, 0],
])('sizes a technical reduction for %i shares as %i shares', (held, expected) => {
  expect(calculateTechnicalSellShares(held)).toBe(expected);
});

it('prefers a complete stop-loss exit over a simultaneous add signal', () => {
  expect(selectSignalTrade({
    isBuyCandidate: true,
    isHeld: true,
    positionShares: 500,
    buyDecision: { action: 'buy', reasons: ['RSI超卖'] },
    sellDecision: { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' },
  })).toEqual({
    action: 'sell', intent: 'exit', suggestedShares: 500,
    decision: { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' },
  });
});

it('creates open and add recommendations with one board lot', () => {
  const buyDecision = { action: 'buy' as const, reasons: ['MACD金叉'] };
  const holdDecision = { action: 'hold' as const, reasons: [] };
  expect(selectSignalTrade({
    isBuyCandidate: true, isHeld: false, positionShares: 0,
    buyDecision, sellDecision: holdDecision,
  })?.intent).toBe('open');
  expect(selectSignalTrade({
    isBuyCandidate: false, isHeld: true, positionShares: 300,
    buyDecision, sellDecision: holdDecision,
  })).toMatchObject({ intent: 'add', suggestedShares: 100 });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
npm test -- --run src/features/securities/signal-trade-recommendation.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal pure recommendation layer**

```ts
export function calculateTechnicalSellShares(positionShares: number): number {
  if (!Number.isInteger(positionShares) || positionShares < 100) return 0;
  return Math.min(positionShares, Math.max(100, Math.floor(positionShares * 0.25 / 100) * 100));
}

export function selectSignalTrade(input: SelectSignalTradeInput): SignalTradeRecommendation | null {
  if (input.isHeld && input.sellDecision.action === 'sell') {
    const exit = input.sellDecision.exitReason === 'stop_loss'
      || input.sellDecision.exitReason === 'timeout';
    const suggestedShares = exit
      ? Math.floor(input.positionShares / 100) * 100
      : calculateTechnicalSellShares(input.positionShares);
    return suggestedShares > 0
      ? { action: 'sell', intent: exit ? 'exit' : 'reduce', decision: input.sellDecision, suggestedShares }
      : null;
  }
  const mayBuy = input.isHeld || input.isBuyCandidate;
  if (mayBuy && input.buyDecision.action === 'buy') {
    return {
      action: 'buy', intent: input.isHeld ? 'add' : 'open',
      decision: input.buyDecision, suggestedShares: 100,
    };
  }
  return null;
}
```

- [ ] **Step 4: Run the test and typecheck**

```powershell
npm test -- --run src/features/securities/signal-trade-recommendation.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- app/src/features/securities/signal-trade-recommendation.ts app/src/features/securities/signal-trade-recommendation.test.ts
git commit -m "feat: calculate realtime signal trade recommendations"
```

---

### Task 2: Extend the Inbox Model and Independent Edge State

**Files:**
- Modify: `app/src/features/securities/backtest-signal-inbox-store.ts`
- Modify: `app/src/features/securities/backtest-signal-inbox-store.test.ts`

**Interfaces:**
- Consumes: `SignalIntent` and `selectSignalTrade` from Task 1.
- Replaces the event decision fields with:

```ts
export interface BacktestDecisionEvent {
  code: string;
  name: string;
  price: number;
  buyDecision: BacktestBarDecision;
  sellDecision: BacktestBarDecision;
  isBuyCandidate: boolean;
  isHeld: boolean;
  positionShares: number;
  signalAt: string;
  metrics: BacktestSignalMetrics;
  entryPrice: number;
  stopLoss: number;
}
```

- Extends alerts and stock state:

```ts
export interface BacktestSignalAlert {
  // existing fields
  intent: SignalIntent;
  suggestedShares: number;
  positionSharesAtSignal: number;
}

export interface StockSignalState {
  lastBuyDecision: 'buy' | 'hold';
  lastSellDecision: 'sell' | 'hold';
  updatedAt: string;
}
```

- [ ] **Step 1: Replace the event helper in the store test and add failing intent tests**

Use this event baseline:

```ts
function event(overrides: Partial<BacktestDecisionEvent> = {}): BacktestDecisionEvent {
  return {
    code: '000001', name: '平安银行', price: 10,
    buyDecision: { action: 'buy', reasons: ['MACD金叉'] },
    sellDecision: { action: 'hold', reasons: [] },
    isBuyCandidate: true, isHeld: false, positionShares: 0,
    signalAt: '2026-08-05T01:30:00.000Z', metrics,
    entryPrice: 10, stopLoss: 9.2,
    ...overrides,
  };
}
```

Add assertions:

```ts
expect(first.createdAlert).toMatchObject({
  action: 'buy', intent: 'open', price: 10,
  suggestedShares: 100, positionSharesAtSignal: 0,
});

const add = applyBacktestDecision(createEmptySignalInbox(), event({
  isBuyCandidate: false, isHeld: true, positionShares: 500,
}), { createId: () => 'alert-add-1' });
expect(add.createdAlert).toMatchObject({ intent: 'add', suggestedShares: 100 });

const reduce = applyBacktestDecision(createEmptySignalInbox(), event({
  isHeld: true, positionShares: 1000,
  buyDecision: { action: 'hold', reasons: [] },
  sellDecision: { action: 'sell', reasons: ['MACD死叉'], exitReason: 'signal' },
}), { createId: () => 'alert-reduce-1' });
expect(reduce.createdAlert).toMatchObject({ intent: 'reduce', suggestedShares: 200 });
```

Add a migration test that seeds a valid version-2 alert without the three new fields and expects `loadSignalInbox` to return `intent: 'open'`, `suggestedShares: 100`, and `positionSharesAtSignal: 0` without deleting it.

- [ ] **Step 2: Run the store test and verify RED**

```powershell
npm test -- --run src/features/securities/backtest-signal-inbox-store.test.ts
```

Expected: FAIL because the event, alert, and state shapes are unsupported.

- [ ] **Step 3: Implement compatible normalization and independent edges**

Add focused normalizers:

```ts
function normalizeAlert(alert: BacktestSignalAlert | LegacyBacktestSignalAlert): BacktestSignalAlert;
function normalizeStockState(state: StockSignalState | LegacyStockSignalState): StockSignalState;
```

For legacy alerts, derive `open` for buy and `exit` for sell, use 100 shares for buy, and use 0 for an unknown legacy sell quantity so the UI must revalidate before execution.

In `applyBacktestDecision`:

1. call `selectSignalTrade(event)`;
2. compare a buy recommendation only with `lastBuyDecision`;
3. compare a sell recommendation only with `lastSellDecision`;
4. update both directions from the current event even when no message is created;
5. freeze `event.price`, recommendation quantity, and `event.positionShares` into the alert.

Keep `clearSignalAlerts` from resetting directional state.

- [ ] **Step 4: Run store and ledger-adjacent tests**

```powershell
npm test -- --run src/features/securities/backtest-signal-inbox-store.test.ts src/features/securities/stock-position-ledger.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- app/src/features/securities/backtest-signal-inbox-store.ts app/src/features/securities/backtest-signal-inbox-store.test.ts
git commit -m "feat: persist intent-aware realtime signal alerts"
```

---

### Task 3: Evaluate Buy and Sell Paths in the Realtime Monitor

**Files:**
- Modify: `app/src/features/securities/realtime-backtest-monitor.ts`
- Modify: `app/src/features/securities/realtime-backtest-monitor.test.ts`

**Interfaces:**
- Extends `MonitorPosition`:

```ts
export interface MonitorPosition {
  code: string;
  shares: number;
  averageCost: number;
  openedAt: string;
}
```

- Produces Task 2's dual-decision `BacktestDecisionEvent` for every changed valid quote, including hold events needed to rearm edges.

- [ ] **Step 1: Write failing dual-path monitor tests**

For a held 500-share position, mock `evaluateBar` by position state:

```ts
const evaluateBar = vi.fn((
  _lines: StockKLine[],
  _index: number,
  position: { inPosition: boolean },
) => position.inPosition
  ? { action: 'hold' as const, reasons: [] }
  : { action: 'buy' as const, reasons: ['RSI超卖'] });
```

Expect one event containing:

```ts
expect(result.events[0]).toMatchObject({
  isHeld: true,
  positionShares: 500,
  buyDecision: { action: 'buy' },
  sellDecision: { action: 'hold' },
});
expect(evaluateBar).toHaveBeenCalledTimes(2);
```

Add a second test where the held path returns stop-loss sell and the flat path returns buy; assert both decisions are passed through so Task 2 can enforce sell priority.

- [ ] **Step 2: Run the monitor test and verify RED**

```powershell
npm test -- --run src/features/securities/realtime-backtest-monitor.test.ts
```

Expected: FAIL because held stocks are evaluated only once and position shares are missing.

- [ ] **Step 3: Implement dual evaluation**

For each valid changed quote:

```ts
const buyDecision = dependencies.evaluateBar(
  liveKlines, liveKlines.length - 1, { inPosition: false },
);
const sellDecision = position
  ? dependencies.evaluateBar(liveKlines, liveKlines.length - 1, {
      inPosition: true,
      entryPrice: position.averageCost,
      entryIndex: positionEntryIndex(liveKlines, position.openedAt),
    })
  : { action: 'hold' as const, reasons: [] };
```

Emit both decisions, `positionShares: position?.shares ?? 0`, and the existing metrics. Keep history caching, quote fingerprint skipping, concurrency, and partial failure isolation unchanged.

- [ ] **Step 4: Run monitor and strategy tests**

```powershell
npm test -- --run src/features/securities/realtime-backtest-monitor.test.ts src/engines/market-analysis/backtest-strategy.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- app/src/features/securities/realtime-backtest-monitor.ts app/src/features/securities/realtime-backtest-monitor.test.ts
git commit -m "feat: evaluate realtime add and sell signal paths"
```

---

### Task 4: Expose Monitoring Diagnostics from the Hook

**Files:**
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.ts`
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`

**Interfaces:**
- Extends `UseRealtimeBacktestMonitorResult`:

```ts
monitoringCount: number;
watchlistCount: number;
heldCount: number;
successfulCount: number;
lastScanAt: string | null;
```

- [ ] **Step 1: Write failing Hook contract tests**

Assert the Hook returns the counts from the deduplicated universe, passes `shares` into `processSnapshot`, sets `successfulCount` to `allCodes.length - partialFailureCount`, and updates `lastScanAt` after a completed snapshot.

```ts
expect(result.current).toMatchObject({
  monitoringCount: 2,
  watchlistCount: 2,
  heldCount: 0,
  successfulCount: 2,
  lastScanAt: '2026-08-04T01:30:00.000Z',
});
```

Update the manual-position expectation:

```ts
positions: [expect.objectContaining({ code: '000001', shares: 100 })]
```

Add a storage-failure test by mocking `localStorage.setItem` to throw after an event and expect the Hook's `error` to contain the persistence error instead of silently losing it.

- [ ] **Step 2: Run the Hook test and verify RED**

```powershell
npm test -- --run src/features/securities/useRealtimeBacktestMonitor.test.tsx
```

Expected: FAIL because diagnostics and position shares are not exposed.

- [ ] **Step 3: Implement minimal diagnostics and persistence handling**

- Pass `position.shares` into `processSnapshot`.
- Update `lastScanAt` whenever a snapshot completes, including zero-alert snapshots.
- Derive counts from `universe` and the latest partial failure count.
- Wrap `saveSignalInbox(next)` inside the snapshot state update so a write error sets `monitorError` and leaves the current React state unchanged.
- Preserve non-trading suppression and manual refresh behavior.

- [ ] **Step 4: Run Hook, universe, and inbox-store tests**

```powershell
npm test -- --run src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/stock-monitoring-universe.test.ts src/features/securities/backtest-signal-inbox-store.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- app/src/features/securities/useRealtimeBacktestMonitor.ts app/src/features/securities/useRealtimeBacktestMonitor.test.tsx
git commit -m "feat: expose realtime signal monitoring diagnostics"
```

---

### Task 5: Host One Global Monitor in AppShell

**Files:**
- Create: `app/src/features/securities/RealtimeBacktestMonitorProvider.tsx`
- Create: `app/src/features/securities/RealtimeBacktestMonitorProvider.test.tsx`
- Modify: `app/src/app/AppShell.tsx`

**Interfaces:**
- Produces:

```ts
export interface RealtimeBacktestMonitorProviderProps {
  children: React.ReactNode;
}

export function RealtimeBacktestMonitorProvider(
  props: RealtimeBacktestMonitorProviderProps,
): JSX.Element;

export function useRealtimeBacktestMonitorContext(): UseRealtimeBacktestMonitorResult;
```

- [ ] **Step 1: Write failing provider tests**

Mock `useRealtimeBacktestMonitor`, render two Context consumers under one provider, and assert the Hook is called once while both consumers receive the same result object.

Add a router test that renders `AppShell` with two child routes, navigates between them, and asserts the monitor Hook has still been called only once because the provider remains above `Outlet`.

Add a guard test:

```tsx
expect(() => render(<ConsumerWithoutProvider />))
  .toThrow('useRealtimeBacktestMonitorContext必须在RealtimeBacktestMonitorProvider内使用');
```

- [ ] **Step 2: Run provider tests and verify RED**

```powershell
npm test -- --run src/features/securities/RealtimeBacktestMonitorProvider.test.tsx
```

Expected: FAIL because the provider does not exist.

- [ ] **Step 3: Implement the Context and mount it in AppShell**

```tsx
const RealtimeBacktestMonitorContext = createContext<UseRealtimeBacktestMonitorResult | null>(null);

export function RealtimeBacktestMonitorProvider({ children }: RealtimeBacktestMonitorProviderProps) {
  const monitor = useRealtimeBacktestMonitor();
  return (
    <RealtimeBacktestMonitorContext.Provider value={monitor}>
      {children}
    </RealtimeBacktestMonitorContext.Provider>
  );
}
```

Wrap the existing `AppShell` content once:

```tsx
return (
  <RealtimeBacktestMonitorProvider>
    <div className="app-shell">...</div>
  </RealtimeBacktestMonitorProvider>
);
```

- [ ] **Step 4: Run provider, router, and AppShell-related tests**

```powershell
npm test -- --run src/features/securities/RealtimeBacktestMonitorProvider.test.tsx
npm run typecheck
```


Expected: PASS and one monitor instance across route navigation.

- [ ] **Step 5: Commit Task 5**

```powershell
git add -- app/src/features/securities/RealtimeBacktestMonitorProvider.tsx app/src/features/securities/RealtimeBacktestMonitorProvider.test.tsx app/src/app/AppShell.tsx
git commit -m "feat: keep realtime signal monitoring active globally"
```

---

### Task 6: Make Trade Confirmation Intent-Aware

**Files:**
- Modify: `app/src/features/securities/StockTradeConfirmDialog.tsx`
- Modify: `app/src/features/securities/StockTradeConfirmDialog.test.tsx`

**Interfaces:**
- Consumes: `alert.intent` and `alert.suggestedShares` from Task 2.
- Keeps `StockTradeConfirmation` unchanged.

- [ ] **Step 1: Write failing suggested-quantity and copy tests**

```tsx
it('initializes a reduction from the frozen suggested shares', () => {
  render(<StockTradeConfirmDialog
    alert={alert({ action: 'sell', intent: 'reduce', suggestedShares: 200 })}
    position={position({ shares: 1000 })}
    groups={[]}
    onConfirm={vi.fn()}
    onCancel={vi.fn()}
  />);
  expect(screen.getByLabelText('交易股数')).toHaveValue(200);
  expect(screen.getByRole('heading', { name: '确认部分卖出 平安银行' })).toBeInTheDocument();
});

it('labels an existing-position buy as a locked-group add', () => {
  render(<StockTradeConfirmDialog
    alert={alert({ action: 'buy', intent: 'add', suggestedShares: 100 })}
    position={position()}
    groups={[{ id: 'core', name: '核心持仓' }]}
    fixedBuyGroup={{ id: 'core', name: '核心持仓' }}
    onConfirm={vi.fn()}
    onCancel={vi.fn()}
  />);
  expect(screen.getByRole('heading', { name: '确认补仓 平安银行' })).toBeInTheDocument();
  expect(screen.queryByLabelText('目标持仓组')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the dialog test and verify RED**

```powershell
npm test -- --run src/features/securities/StockTradeConfirmDialog.test.tsx
```

Expected: FAIL because the dialog defaults sell quantities to the full position and uses generic copy.

- [ ] **Step 3: Implement intent-aware defaults and labels**

Initialize shares with:

```ts
const initialShares = Math.min(
  alert.suggestedShares,
  alert.action === 'sell' ? position?.shares ?? 0 : alert.suggestedShares,
);
```

Map headings and buttons:

- `open` -> `确认买入`
- `add` -> `确认补仓`
- `reduce` -> `确认部分卖出`
- `exit` -> `确认全部卖出`

Keep group selection for `open`, require `fixedBuyGroup` display for `add`, and keep board-lot validation.

- [ ] **Step 4: Run dialog regressions and typecheck**

```powershell
npm test -- --run src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/WatchlistPositionCell.test.tsx src/features/securities/ActualPositionsPanel.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```powershell
git add -- app/src/features/securities/StockTradeConfirmDialog.tsx app/src/features/securities/StockTradeConfirmDialog.test.tsx
git commit -m "feat: confirm intent-aware signal trades"
```

---

### Task 7: Refactor SignalInbox into a Global-Monitor Consumer

**Files:**
- Modify: `app/src/features/securities/SignalInbox.tsx`
- Modify: `app/src/features/securities/SignalInbox.test.tsx`

**Interfaces:**
- Consumes: `useRealtimeBacktestMonitorContext` instead of `useRealtimeBacktestMonitor`.
- Consumes the existing actual ledger APIs and Task 6 dialog.

- [ ] **Step 1: Update the Hook mock to the Context mock and write failing display tests**

The mock result must include:

```ts
monitoringCount: 36,
watchlistCount: 36,
heldCount: 2,
successfulCount: 35,
partialFailureCount: 1,
lastScanAt: '2026-08-05T01:30:00.000Z',
```

Add four alert fixtures and assert the inbox shows:

```text
首次买入 · 建议 100 股 · 触发价 ¥10.80
补仓 · 建议 100 股 · 触发价 ¥10.80
部分卖出 · 建议 200 股 · 触发价 ¥10.80
全部卖出 · 建议 1,000 股 · 触发价 ¥10.80
```

Assert the header displays `监控36只 · 自选36只 · 持仓2只`, `成功35只 · 失败1只`, and `网站打开期间持续监听`.

- [ ] **Step 2: Write failing transaction-flow tests**

Cover separately:

1. `open`: user changes 100 to 300 shares, selects an existing group, confirms, and the ledger contains the new 300-share position before `markExecuted` is called;
2. `open`: user creates a new group and the position uses it;
3. `add`: dialog displays the existing group read-only, adds 100 shares, and keeps `groupId` unchanged;
4. `reduce`: defaults to 200 shares for a 1,000-share position and leaves 800 shares;
5. `exit`: defaults to the full current position and removes it;
6. stale sell alert: suggested 500 but current holding is 300, dialog defaults to 300 and displays a quantity-adjustment note;
7. storage failure: ledger and alert execution state remain unchanged and the dialog displays the error.

- [ ] **Step 3: Run the inbox test and verify RED**

```powershell
npm test -- --run src/features/securities/SignalInbox.test.tsx
```

Expected: FAIL because the inbox owns its monitor, lacks intent diagnostics, and ignores suggested quantities.

- [ ] **Step 4: Implement Context consumption and intent UI**

- Replace `useRealtimeBacktestMonitor()` with `useRealtimeBacktestMonitorContext()`.
- Add monitoring diagnostics to the sticky inbox header.
- Use intent-specific labels and expected amount `alert.price * alert.suggestedShares`.
- When opening a sell alert, reread the ledger and create an effective dialog alert whose suggested shares are:

```ts
Math.min(alert.suggestedShares, Math.floor((position?.shares ?? 0) / 100) * 100)
```

- Show a note when this value is lower than the frozen suggestion.
- For `add`, pass the existing position group through `fixedBuyGroup`.
- For `open`, retain selectable existing/new group behavior.
- Call `buyStockPosition` or `sellStockPosition`, then `markExecuted`, then `reloadLedger`; never reverse this order.
- Keep the dialog open on any persistence error.

- [ ] **Step 5: Run inbox and ledger regressions**

```powershell
npm test -- --run src/features/securities/SignalInbox.test.tsx src/features/securities/stock-position-ledger.test.ts src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/ActualPositionsPanel.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```powershell
git add -- app/src/features/securities/SignalInbox.tsx app/src/features/securities/SignalInbox.test.tsx
git commit -m "feat: trade global realtime signals from inbox"
```

---

### Task 8: Final Regression, Build, and Browser Verification

**Files:**
- Verify only; do not modify `app/src/features/securities/StockAnalysisPage.tsx`.

- [ ] **Step 1: Run the focused signal and position suite**

```powershell
npm test -- --run src/features/securities/signal-trade-recommendation.test.ts src/features/securities/backtest-signal-inbox-store.test.ts src/features/securities/realtime-backtest-monitor.test.ts src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/RealtimeBacktestMonitorProvider.test.tsx src/features/securities/SignalInbox.test.tsx src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/stock-monitoring-universe.test.ts src/features/securities/stock-position-ledger.test.ts src/features/securities/useStockPositionLedger.test.tsx src/features/securities/ActualPositionsPanel.test.tsx src/features/securities/WatchlistPage.test.tsx src/features/securities/WatchlistPositionCell.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run protected-page and routing regressions**

```powershell
npm test -- --run src/features/securities/StockAnalysisPage.test.tsx src/features/securities/StockAnalysisRealtimeTargets.test.tsx src/features/securities/SecuritiesWorkbenchPage.test.tsx src/features/securities/PortfolioAllocationPage.test.tsx src/features/securities/AiPortfolioAllocationWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run quality gates**

```powershell
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: typecheck and build exit 0; lint introduces no warning in changed files; diff check exits 0.

- [ ] **Step 4: Confirm protected scope and storage keys**

```powershell
git diff --name-only 2084055..HEAD | Select-String -Pattern 'StockAnalysisPage.tsx'
git diff -- app/src/features/securities/portfolio-group-storage.ts
rg -n "sec_stock_position_ledger_v1|sec_bt_signal_inbox_v2" app/src/features/securities
```

Expected: the first two commands produce no output; the keys remain the existing actual-position and inbox stores.

- [ ] **Step 5: Verify the live flow in the browser**

Open `http://localhost:5173/projects/default/securities` and verify:

1. the inbox header shows monitoring, watchlist, held, successful, failed, and last-scan counts;
2. the scope note says monitoring continues while the website is open;
3. navigating to watchlist, an individual stock, and portfolio allocation does not recreate or stop the monitor;
4. returning to the securities workbench retains newly generated messages;
5. an open alert shows 100 shares and the frozen trigger price, permits group selection, and creates an actual position;
6. an add alert shows 100 shares, the frozen trigger price, and the existing group read-only;
7. a reduction alert defaults to the frozen partial quantity and preserves remaining shares;
8. an exit alert defaults to the whole current position and removes it after confirmation;
9. no alert changes price or suggested shares when realtime quotes later refresh;
10. the browser console contains no new error and the existing stock-analysis overview/K-line page still loads.

- [ ] **Step 6: Report completion**

Report focused test counts, protected-page test counts, typecheck/build status, existing unrelated lint warnings, browser verification, commit IDs, confirmation that no full-A-share monitoring was added, and confirmation that `StockAnalysisPage.tsx` was not modified. Do not create an empty commit.
