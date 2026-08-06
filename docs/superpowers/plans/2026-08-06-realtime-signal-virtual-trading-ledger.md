# Realtime Signal Virtual Trading Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every new realtime strategy buy/add/sell inbox message correspond to an idempotent virtual execution, and expose a separate forward-simulation ledger without changing the actual-position ledger or historical backtest results.

**Architecture:** Add a pure virtual-ledger domain module, embed it with alerts and edge state in a single V3 runtime object, and apply signal events through one pure transition before one storage write. Realtime monitoring will calculate separate virtual-position and actual-position sell decisions; the former drives virtual executions, while the latter can create clearly labeled actual-position risk alerts. The inbox will gain a forward-simulation tab that reads the same V3 state.

**Tech Stack:** React 19, TypeScript 6, Vitest 4, Testing Library, localStorage, existing A-share trading calendar and realtime quote infrastructure.

## Global Constraints

- Do not modify historical backtest strategy logic or mix historical-backtest metrics with forward-simulation metrics.
- Keep `sec_stock_position_ledger_v1` independent; virtual execution must never mutate actual positions automatically.
- New virtual buys and adds execute exactly 100 shares at the signal snapshot price.
- Virtual sells use the strategy-recommended board-lot quantity, capped by virtual T+1 available shares.
- Only a state transition from `hold` to `buy` or `sell` may create a new execution; continuous signals are idempotent.
- A message labeled as a virtual execution must reference exactly one persisted virtual transaction.
- Legacy V2 alerts remain visible but are marked `legacy_untracked` and never contribute to forward-simulation metrics.
- Use the existing 2025-2026 A-share trading calendar. Unsupported calendar years must remain explicit errors rather than silently treating every weekday as tradable.
- Do not touch the individual stock-analysis page.
- Do not add new runtime dependencies.
- Preserve all unrelated uncommitted cycle-strategy changes in the working tree.

---

## File Structure

### New files

- `app/src/features/securities/virtual-trading-ledger.ts` — pure virtual positions, transactions, cycles, T+1 availability and mutations.
- `app/src/features/securities/virtual-trading-ledger.test.ts` — ledger unit tests.
- `app/src/features/securities/forward-simulation-summary.ts` — derives current holdings and closed-cycle metrics without mutating state.
- `app/src/features/securities/forward-simulation-summary.test.ts` — summary and win-rate tests.
- `app/src/features/securities/backtest-signal-trading-runtime.ts` — turns one realtime decision event into an atomic V3 state transition.
- `app/src/features/securities/backtest-signal-trading-runtime.test.ts` — execution, edge, T+1 and actual-risk-alert tests.
- `app/src/features/securities/ForwardSimulationPanel.tsx` — forward positions, transactions, cycles and metrics UI.
- `app/src/features/securities/ForwardSimulationPanel.test.tsx` — UI tests.

### Modified files

- `app/src/features/securities/backtest-signal-inbox-store.ts` — V3 types, V2 migration, single-key persistence, alert read/actual-execution state and message trimming.
- `app/src/features/securities/backtest-signal-inbox-store.test.ts` — migration and persistence coverage.
- `app/src/features/securities/realtime-backtest-monitor.ts` — separate virtual and actual sell decisions.
- `app/src/features/securities/realtime-backtest-monitor.test.ts` — dual-position decision tests.
- `app/src/features/securities/useRealtimeBacktestMonitor.ts` — merges monitoring universes, commits one V3 transition and exposes the virtual ledger.
- `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx` — hook integration and persistence-failure tests.
- `app/src/features/securities/SignalInbox.tsx` — virtual-execution, legacy, blocked and actual-risk presentation plus messages/forward tabs.
- `app/src/features/securities/SignalInbox.test.tsx` — message semantics, tab and actual-ledger isolation tests.
- `app/src/features/securities/RealtimeBacktestMonitorProvider.test.tsx` — context contract update if the exposed result shape changes.

---

### Task 1: Build the pure virtual trading ledger

**Files:**
- Create: `app/src/features/securities/virtual-trading-ledger.ts`
- Create: `app/src/features/securities/virtual-trading-ledger.test.ts`
- Reuse: `app/src/features/securities/a-share-trading-calendar.ts`

**Interfaces:**
- Consumes: `shanghaiDateKey(value)`, `nextAStockTradingDay(date)`, `isAStockTradingDay(date)`.
- Produces:

```ts
export type VirtualTradeIntent = 'open' | 'add' | 'reduce' | 'exit';
export type VirtualCycleStatus = 'open' | 'closed';

export interface VirtualPosition {
  id: string;
  cycleId: string;
  strategyId: string;
  strategyVersion: string;
  code: string;
  name: string;
  shares: number;
  averageCost: number;
  totalCost: number;
  openedAt: string;
  updatedAt: string;
  sourceTradeIds: string[];
}

export interface VirtualTransaction {
  id: string;
  sourceSignalId: string;
  cycleId: string;
  strategyId: string;
  strategyVersion: string;
  code: string;
  name: string;
  type: 'buy' | 'sell';
  intent: VirtualTradeIntent;
  shares: number;
  price: number;
  amount: number;
  tradedAt: string;
  positionSharesAfter: number;
  availableSharesAfter: number;
  realizedProfit: number;
  reasons: string[];
}

export interface VirtualTradeCycle {
  id: string;
  strategyId: string;
  strategyVersion: string;
  code: string;
  name: string;
  status: VirtualCycleStatus;
  openedAt: string;
  closedAt: string | null;
  buyAmount: number;
  sellAmount: number;
  realizedProfit: number;
  returnPct: number | null;
  transactionIds: string[];
}

export interface VirtualTradingLedger {
  version: 1;
  positions: VirtualPosition[];
  transactions: VirtualTransaction[];
  cycles: VirtualTradeCycle[];
}

export interface VirtualAvailability {
  totalShares: number;
  availableShares: number;
  frozenShares: number;
  nextAvailableDate: string | null;
}

export interface BuyVirtualPositionInput {
  sourceSignalId: string;
  strategyId: string;
  strategyVersion: string;
  code: string;
  name: string;
  shares: number;
  price: number;
  tradedAt: string;
  reasons: string[];
}

export interface SellVirtualPositionInput extends BuyVirtualPositionInput {}

export interface VirtualLedgerOptions {
  createId?: (kind: 'position' | 'transaction' | 'cycle') => string;
}

export interface VirtualLedgerMutation {
  ledger: VirtualTradingLedger;
  position: VirtualPosition | null;
  transaction: VirtualTransaction;
  cycle: VirtualTradeCycle;
}

export function createEmptyVirtualTradingLedger(): VirtualTradingLedger;
export function findVirtualPosition(
  ledger: VirtualTradingLedger,
  code: string,
  strategyId: string,
): VirtualPosition | null;
export function calculateVirtualAvailability(
  ledger: VirtualTradingLedger,
  code: string,
  strategyId: string,
  asOf: Date | string,
): VirtualAvailability;
export function buyVirtualPosition(
  ledger: VirtualTradingLedger,
  input: BuyVirtualPositionInput,
  options?: VirtualLedgerOptions,
): VirtualLedgerMutation;
export function sellVirtualPosition(
  ledger: VirtualTradingLedger,
  input: SellVirtualPositionInput,
  options?: VirtualLedgerOptions,
): VirtualLedgerMutation;
```

- [ ] **Step 1: Write failing tests for opening and adding 100-share positions**

```ts
let deterministicSequence = 0;

function deterministicIds(): VirtualLedgerOptions {
  return { createId: kind => kind + '-' + (++deterministicSequence) };
}

function buyInput(
  overrides: Partial<BuyVirtualPositionInput> = {},
): BuyVirtualPositionInput {
  return {
    sourceSignalId: 'signal-1',
    strategyId: 'technical-v1',
    strategyVersion: '1',
    code: '000001',
    name: '平安银行',
    shares: 100,
    price: 10,
    tradedAt: '2026-08-06T02:00:00.000Z',
    reasons: ['测试信号'],
    ...overrides,
  };
}

function sellInput(
  overrides: Partial<SellVirtualPositionInput> = {},
): SellVirtualPositionInput {
  return buyInput({
    sourceSignalId: 'sell-signal-1',
    tradedAt: '2026-08-07T02:00:00.000Z',
    ...overrides,
  });
}

function openAt(
  price: number,
  sourceSignalId: string,
  tradedAt = '2026-08-06T02:00:00.000Z',
): VirtualLedgerMutation {
  return buyVirtualPosition(
    createEmptyVirtualTradingLedger(),
    buyInput({ price, sourceSignalId, tradedAt }),
    deterministicIds(),
  );
}

function openAndUnlock(shares: number, price: number): VirtualTradingLedger {
  return buyVirtualPosition(
    createEmptyVirtualTradingLedger(),
    buyInput({ shares, price, tradedAt: '2026-08-05T02:00:00.000Z' }),
    deterministicIds(),
  ).ledger;
}

it('opens 100 shares and creates one open cycle', () => {
  const result = buyVirtualPosition(createEmptyVirtualTradingLedger(), {
    sourceSignalId: 'signal-1', strategyId: 'technical-v1', strategyVersion: '1',
    code: '600519', name: '贵州茅台', shares: 100, price: 1500,
    tradedAt: '2026-08-06T02:00:00.000Z', reasons: ['MACD金叉'],
  }, deterministicIds());

  expect(result.position).toMatchObject({ shares: 100, averageCost: 1500 });
  expect(result.transaction).toMatchObject({ type: 'buy', intent: 'open', positionSharesAfter: 100 });
  expect(result.cycle).toMatchObject({ status: 'open', buyAmount: 150000 });
});

it('adds 100 shares and recalculates weighted average cost', () => {
  const opened = openAt(10, 'signal-1');
  const result = buyVirtualPosition(opened.ledger, buyInput({
    sourceSignalId: 'signal-2', price: 14, tradedAt: '2026-08-07T02:00:00.000Z',
  }), deterministicIds());

  expect(result.position).toMatchObject({ shares: 200, averageCost: 12, totalCost: 2400 });
  expect(result.transaction.intent).toBe('add');
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
cd app
npx vitest run src/features/securities/virtual-trading-ledger.test.ts
```

Expected: FAIL because `virtual-trading-ledger.ts` does not exist.

- [ ] **Step 3: Implement ledger types, validation, immutable buy mutation and duplicate-signal rejection**

Implementation requirements:

```ts
function assertUniqueSignal(ledger: VirtualTradingLedger, sourceSignalId: string): void {
  if (ledger.transactions.some(item => item.sourceSignalId === sourceSignalId)) {
    throw new Error('该虚拟信号已经成交');
  }
}

function positionKey(code: string, strategyId: string): string {
  return `${strategyId}:${code}`;
}
```

Use two-decimal money rounding. Reject non-positive price, non-positive integer shares, and buy quantities that are not multiples of100.

- [ ] **Step 4: Write failing tests for T+1 availability, partial sells and cycle closure**

```ts
it('freezes same-day buys until the next A-share trading day', () => {
  const opened = openAt(10, 'signal-1', '2026-08-06T02:00:00.000Z');
  expect(calculateVirtualAvailability(opened.ledger, '000001', 'technical-v1', '2026-08-06'))
    .toEqual({ totalShares: 100, availableShares: 0, frozenShares: 100, nextAvailableDate: '2026-08-07' });
});

it('records a partial sell without closing the cycle', () => {
  const ledger = openAndUnlock(400, 10);
  const result = sellVirtualPosition(ledger, sellInput({ shares: 100, price: 12 }), deterministicIds());
  expect(result.position?.shares).toBe(300);
  expect(result.transaction).toMatchObject({ intent: 'reduce', realizedProfit: 200 });
  expect(result.cycle.status).toBe('open');
});

it('closes the cycle when remaining shares reach zero', () => {
  const ledger = openAndUnlock(100, 10);
  const result = sellVirtualPosition(ledger, sellInput({ shares: 100, price: 12 }), deterministicIds());
  expect(result.position).toBeNull();
  expect(result.transaction.intent).toBe('exit');
  expect(result.cycle).toMatchObject({ status: 'closed', realizedProfit: 200, returnPct: 20 });
});
```

- [ ] **Step 5: Implement availability and sell mutations**

Use buy transactions to determine frozen batches. Cap nothing inside `sellVirtualPosition`; instead reject any request above `calculateVirtualAvailability(...).availableShares`, so the runtime remains responsible for board-lot capping.

- [ ] **Step 6: Run ledger tests and typecheck**

```bash
cd app
npx vitest run src/features/securities/virtual-trading-ledger.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the ledger domain**

```bash
git add app/src/features/securities/virtual-trading-ledger.ts app/src/features/securities/virtual-trading-ledger.test.ts
git commit -m "feat: add virtual trading ledger"
```

---

### Task 2: Derive forward-simulation metrics without mutating the ledger

**Files:**
- Create: `app/src/features/securities/forward-simulation-summary.ts`
- Create: `app/src/features/securities/forward-simulation-summary.test.ts`
- Consume: `app/src/features/securities/virtual-trading-ledger.ts`

**Interfaces:**
- Consumes: `VirtualTradingLedger`, `VirtualPosition`, `VirtualTradeCycle`.
- Produces:

```ts
export interface ForwardPositionSummary {
  position: VirtualPosition;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedProfit: number | null;
  unrealizedReturnPct: number | null;
}

export interface ForwardSimulationSummary {
  closedCycles: number;
  winningCycles: number;
  winRate: number;
  realizedProfit: number;
  unrealizedProfit: number;
  totalProfit: number;
  openPositions: ForwardPositionSummary[];
}

export function summarizeForwardSimulation(
  ledger: VirtualTradingLedger,
  prices: Record<string, number>,
): ForwardSimulationSummary;
```

- [ ] **Step 1: Write failing tests for closed-cycle win rate and open-position exclusion**

```ts
it('counts only closed cycles in win rate', () => {
  const summary = summarizeForwardSimulation(ledgerWithCycles([
    closedCycle(200), closedCycle(-50), openCycle(),
  ]), {});
  expect(summary).toMatchObject({ closedCycles: 2, winningCycles: 1, winRate: 50 });
});

it('marks open positions to market without adding them to cycle wins', () => {
  const summary = summarizeForwardSimulation(openLedgerAt(10), { '000001': 12 });
  expect(summary.openPositions[0]).toMatchObject({ marketValue: 1200, unrealizedProfit: 200, unrealizedReturnPct: 20 });
  expect(summary.closedCycles).toBe(0);
});
```

- [ ] **Step 2: Run the test and verify failure**

```bash
cd app
npx vitest run src/features/securities/forward-simulation-summary.test.ts
```

- [ ] **Step 3: Implement pure aggregation and null-price behavior**

If a current price is missing or invalid, keep market value and unrealized fields `null`; never substitute average cost and present it as live P/L.

- [ ] **Step 4: Run tests and commit**

```bash
cd app
npx vitest run src/features/securities/forward-simulation-summary.test.ts
git add src/features/securities/forward-simulation-summary.ts src/features/securities/forward-simulation-summary.test.ts
git commit -m "feat: summarize forward simulation performance"
```

---

### Task 3: Upgrade inbox persistence from V2 to atomic V3 runtime state

**Files:**
- Modify: `app/src/features/securities/backtest-signal-inbox-store.ts`
- Modify: `app/src/features/securities/backtest-signal-inbox-store.test.ts`
- Consume: `app/src/features/securities/virtual-trading-ledger.ts`

**Interfaces:**
- Replace `BACKTEST_SIGNAL_INBOX_KEY` writes with `BACKTEST_SIGNAL_RUNTIME_KEY = 'sec_bt_signal_runtime_v3'`.
- Keep `BACKTEST_SIGNAL_INBOX_KEY = 'sec_bt_signal_inbox_v2'` for migration reads only.
- Produce:

```ts
export type VirtualTrackingStatus =
  | 'executed'
  | 'blocked_t1'
  | 'actual_risk_only'
  | 'legacy_untracked';

export interface BacktestSignalAlertV3 extends BacktestSignalAlert {
  messageKind: 'virtual_execution' | 'virtual_blocked' | 'actual_position_risk' | 'legacy';
  virtualTrackingStatus: VirtualTrackingStatus;
  virtualTradeId: string | null;
  virtualCycleId: string | null;
  virtualShares: number;
  virtualPrice: number | null;
  virtualPositionSharesAfter: number | null;
  virtualAvailableSharesAfter: number | null;
  strategyId: string;
  strategyVersion: string;
}

export interface StockSignalStateV3 extends StockSignalState {
  blockedSellUntil: string | null;
  blockedSellNotifiedOn: string | null;
}

export interface BacktestSignalRuntimeState {
  version: 3;
  alerts: BacktestSignalAlertV3[];
  stocks: Record<string, StockSignalStateV3>;
  virtualLedger: VirtualTradingLedger;
}

export interface StorageAccess {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class SignalRuntimeCorruptionError extends Error {
  readonly code = 'signal_runtime_corrupt';
}

export function createEmptySignalRuntime(): BacktestSignalRuntimeState;
export function loadSignalRuntime(storage?: Pick<StorageAccess, 'getItem'>): BacktestSignalRuntimeState;
export function saveSignalRuntime(state: BacktestSignalRuntimeState, storage?: Pick<StorageAccess, 'setItem'>): void;
```

- [ ] **Step 1: Replace V2 load tests with failing V3 and migration tests**

```ts
it('migrates V2 alerts as legacy untracked without creating virtual positions', () => {
  const storage = memoryStorage({ [BACKTEST_SIGNAL_INBOX_KEY]: JSON.stringify(v2State()) });
  const state = loadSignalRuntime(storage);
  expect(state.version).toBe(3);
  expect(state.alerts[0]).toMatchObject({
    messageKind: 'legacy', virtualTrackingStatus: 'legacy_untracked', virtualTradeId: null,
  });
  expect(state.virtualLedger.positions).toEqual([]);
});

it('prefers an existing valid V3 state over V2 migration input', () => {
  const state = loadSignalRuntime(memoryStorageWithV2AndV3());
  expect(state.alerts[0].id).toBe('v3-alert');
});

it('throws a typed error for corrupt V3 instead of silently resetting the ledger', () => {
  const storage = memoryStorage({
    [BACKTEST_SIGNAL_RUNTIME_KEY]: '{"version":3,"alerts":[]}',
  });
  expect(() => loadSignalRuntime(storage)).toThrow(SignalRuntimeCorruptionError);
  expect(storage.setItem).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused tests and verify failure**

```bash
cd app
npx vitest run src/features/securities/backtest-signal-inbox-store.test.ts
```

- [ ] **Step 3: Implement V3 validation, migration and one-key persistence**

Requirements:

- Never delete V2 during load.
- If the V3 key exists but JSON parsing, version validation or required-field validation fails, throw `SignalRuntimeCorruptionError`; do not return an empty ledger and do not write storage.
- Only write V3 after a complete valid state exists.
- Preserve `status`, `readAt`, `executedAt`, reasons and frozen recommendation fields from V2.
- `clearSignalAlerts` clears `alerts` only; it must preserve `stocks` and `virtualLedger`.
- `trimAlerts` may remove old alert projections but cannot remove transactions or cycles.

- [ ] **Step 4: Update read and actual-execution reducers for V3 alerts**

Keep actual-action semantics unchanged:

```ts
markSignalAlertExecuted(state, alertId, 'bought' | 'sold', options)
```

This status records the user's actual-position action only. It must not modify the virtual ledger.

- [ ] **Step 5: Run tests and commit**

```bash
cd app
npx vitest run src/features/securities/backtest-signal-inbox-store.test.ts
npm run typecheck
git add src/features/securities/backtest-signal-inbox-store.ts src/features/securities/backtest-signal-inbox-store.test.ts
git commit -m "feat: migrate signal inbox to v3 runtime state"
```

---

### Task 4: Calculate separate virtual and actual sell decisions

**Files:**
- Modify: `app/src/features/securities/realtime-backtest-monitor.ts`
- Modify: `app/src/features/securities/realtime-backtest-monitor.test.ts`

**Interfaces:**
- Replace the single position input with two optional positions:

```ts
export interface MonitorSnapshotPosition {
  code: string;
  shares: number;
  availableShares: number;
  averageCost: number;
  openedAt: string;
}

export interface MonitorSnapshotInput {
  quotes: Record<string, StockQuote>;
  buyCodes: string[];
  virtualPositions: MonitorSnapshotPosition[];
  actualPositions: MonitorSnapshotPosition[];
  tradingDate: string;
  signalAt: string;
}

export interface BacktestDecisionEvent {
  code: string;
  name: string;
  price: number;
  buyDecision: BacktestBarDecision;
  virtualSellDecision: BacktestBarDecision;
  actualSellDecision: BacktestBarDecision;
  virtualPositionShares: number;
  virtualAvailableShares: number;
  actualPositionShares: number;
  actualAvailableShares: number;
  signalAt: string;
  strategyId: string;
  strategyVersion: string;
  metrics: BacktestSignalMetrics;
  stopLoss: number;
}
```

- [ ] **Step 1: Write failing tests for distinct cost bases and virtual-only holdings**

```ts
it('evaluates virtual and actual sell decisions with their own entry prices', async () => {
  await monitor.processSnapshot(snapshot({
    virtualPositions: [position({ averageCost: 10 })],
    actualPositions: [position({ averageCost: 14 })],
  }));
  expect(evaluateBar).toHaveBeenCalledWith(expect.anything(), expect.any(Number),
    expect.objectContaining({ inPosition: true, entryPrice: 10 }));
  expect(evaluateBar).toHaveBeenCalledWith(expect.anything(), expect.any(Number),
    expect.objectContaining({ inPosition: true, entryPrice: 14 }));
});

it('keeps evaluating a virtual holding when there is no actual position', async () => {
  const result = await monitor.processSnapshot(snapshot({
    virtualPositions: [position()], actualPositions: [],
  }));
  expect(result.events[0].virtualSellDecision.action).toBe('sell');
});
```

- [ ] **Step 2: Run the tests and verify failure**

```bash
cd app
npx vitest run src/features/securities/realtime-backtest-monitor.test.ts
```

- [ ] **Step 3: Implement dual sell evaluation and fingerprinting**

Include both position snapshots in `quoteFingerprint`; otherwise a virtual unlock or cost change could be skipped as a duplicate quote.

Use a stable strategy identity for the existing engine:

```ts
const REALTIME_TECHNICAL_STRATEGY_ID = 'realtime-technical';
const REALTIME_TECHNICAL_STRATEGY_VERSION = '1';
```

- [ ] **Step 4: Run tests and commit**

```bash
cd app
npx vitest run src/features/securities/realtime-backtest-monitor.test.ts
git add src/features/securities/realtime-backtest-monitor.ts src/features/securities/realtime-backtest-monitor.test.ts
git commit -m "feat: separate virtual and actual signal decisions"
```

---

### Task 5: Execute decision events through one atomic trading runtime

**Files:**
- Create: `app/src/features/securities/backtest-signal-trading-runtime.ts`
- Create: `app/src/features/securities/backtest-signal-trading-runtime.test.ts`
- Modify: `app/src/features/securities/backtest-signal-inbox-store.ts` only for shared exported types if required.
- Consume: `virtual-trading-ledger.ts`, `signal-trade-recommendation.ts`, `a-share-trading-calendar.ts`.

**Interfaces:**

```ts
export interface ApplySignalEventOptions {
  createSignalId?: () => string;
  createLedgerId?: VirtualLedgerOptions['createId'];
}

export interface ApplySignalEventResult {
  state: BacktestSignalRuntimeState;
  createdAlerts: BacktestSignalAlertV3[];
  createdTransactions: VirtualTransaction[];
}

export function applySignalDecisionEvent(
  state: BacktestSignalRuntimeState,
  event: BacktestDecisionEvent,
  options?: ApplySignalEventOptions,
): ApplySignalEventResult;
```

- [ ] **Step 1: Write failing tests for an atomic buy execution and continuous-edge suppression**

```ts
it('executes 100 shares before projecting a buy alert', () => {
  const result = applySignalDecisionEvent(createEmptySignalRuntime(), buyEvent(), ids());
  expect(result.createdTransactions).toHaveLength(1);
  expect(result.createdTransactions[0]).toMatchObject({ shares: 100, price: 12.34, intent: 'open' });
  expect(result.createdAlerts[0]).toMatchObject({
    messageKind: 'virtual_execution', virtualTrackingStatus: 'executed',
    virtualTradeId: result.createdTransactions[0].id,
  });
});

it('does not execute the same continuous buy edge twice', () => {
  const first = applySignalDecisionEvent(createEmptySignalRuntime(), buyEvent(), ids());
  const second = applySignalDecisionEvent(first.state, buyEvent({ signalAt: '2026-08-06T02:00:03Z' }), ids());
  expect(second.createdTransactions).toEqual([]);
  expect(second.createdAlerts).toEqual([]);
});

it('keeps the buy edge suppressed after persisted state is reloaded', () => {
  const first = applySignalDecisionEvent(createEmptySignalRuntime(), buyEvent(), ids());
  const reloaded = JSON.parse(JSON.stringify(first.state)) as BacktestSignalRuntimeState;
  const repeated = applySignalDecisionEvent(reloaded, buyEvent({ signalAt: '2026-08-06T02:01:00Z' }), ids());
  expect(repeated.createdTransactions).toEqual([]);
});

it('does not create a transaction or executed alert for an invalid snapshot price', () => {
  const result = applySignalDecisionEvent(
    createEmptySignalRuntime(),
    buyEvent({ price: Number.NaN }),
    ids(),
  );
  expect(result.createdTransactions).toEqual([]);
  expect(result.createdAlerts).toEqual([]);
});
```

- [ ] **Step 2: Run the test and verify failure**

```bash
cd app
npx vitest run src/features/securities/backtest-signal-trading-runtime.test.ts
```

- [ ] **Step 3: Implement buy/add execution and reset-to-hold rearming**

Use virtual position presence, not actual position presence, to choose `open` versus `add`. The recommendation is always100 shares for buy/add.

- [ ] **Step 4: Write failing tests for sell capping, T+1 blocking and retry**

```ts
it('caps a technical sell to virtual available board lots', () => {
  const state = runtimeWithUnlockedVirtualPosition(500);
  const result = applySignalDecisionEvent(state, virtualSellEvent(), ids());
  expect(result.createdTransactions[0]).toMatchObject({ type: 'sell', shares: 100, intent: 'reduce' });
});

it('creates one blocked alert when all virtual shares are T+1 frozen', () => {
  const state = runtimeWithSameDayVirtualBuy();
  const first = applySignalDecisionEvent(state, virtualSellEvent(), ids());
  const repeated = applySignalDecisionEvent(first.state, virtualSellEvent({ signalAt: '2026-08-06T03:00:00Z' }), ids());
  expect(first.createdTransactions).toEqual([]);
  expect(first.createdAlerts[0]).toMatchObject({
    messageKind: 'virtual_blocked', virtualTrackingStatus: 'blocked_t1',
  });
  expect(repeated.createdAlerts).toEqual([]);
});

it('retries the blocked sell on the next trading day when the sell decision remains active', () => {
  const blocked = blockedRuntimeState();
  const result = applySignalDecisionEvent(blocked, virtualSellEvent({
    signalAt: '2026-08-07T02:00:00Z',
  }), ids());
  expect(result.createdTransactions[0].type).toBe('sell');
});
```

- [ ] **Step 5: Implement sell and blocked-order transitions**

Rules:

- Stop-loss or timeout exits sell all available board lots.
- Ordinary technical sell uses `calculateTechnicalSellShares(availableShares)`.
- A completely blocked sell creates no transaction.
- Do not set `lastSellDecision = 'sell'` in a way that permanently suppresses the next-day retry; use `blockedSellUntil` and `blockedSellNotifiedOn`.
- Once the virtual sell succeeds, clear blocked fields and set the sell edge.

- [ ] **Step 6: Write failing tests for actual-position-only risk alerts**

```ts
it('creates an actual risk alert without a virtual transaction', () => {
  const result = applySignalDecisionEvent(createEmptySignalRuntime(), actualOnlySellEvent(), ids());
  expect(result.createdTransactions).toEqual([]);
  expect(result.createdAlerts[0]).toMatchObject({
    messageKind: 'actual_position_risk', virtualTrackingStatus: 'actual_risk_only', virtualTradeId: null,
  });
});
```

- [ ] **Step 7: Implement actual-risk projection and run all runtime tests**

```bash
cd app
npx vitest run src/features/securities/backtest-signal-trading-runtime.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit the runtime**

```bash
git add app/src/features/securities/backtest-signal-trading-runtime.ts app/src/features/securities/backtest-signal-trading-runtime.test.ts app/src/features/securities/backtest-signal-inbox-store.ts
git commit -m "feat: execute realtime signals in virtual ledger"
```

---

### Task 6: Integrate V3 runtime into the realtime monitor hook

**Files:**
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.ts`
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`
- Modify: `app/src/features/securities/RealtimeBacktestMonitorProvider.test.tsx` if fixtures require the new result fields.

**Interfaces:**
- Consume: `loadSignalRuntime`, `saveSignalRuntime`, `applySignalDecisionEvent`, `calculateVirtualAvailability`.
- Extend `UseRealtimeBacktestMonitorResult`:

```ts
runtime: BacktestSignalRuntimeState;
virtualLedger: VirtualTradingLedger;
```

- [ ] **Step 1: Write failing hook tests for virtual execution, one storage write and corrupt-state blocking**

```ts
it('surfaces corrupt V3 state and does not process snapshots', async () => {
  vi.mocked(loadSignalRuntime).mockImplementation(() => {
    throw new SignalRuntimeCorruptionError('前向模拟数据损坏，请导出或清理后重试');
  });
  renderHook();
  await waitFor(() => expect(result.current.error).toContain('前向模拟数据损坏'));
  expect(processSnapshot).not.toHaveBeenCalled();
  expect(saveSignalRuntime).not.toHaveBeenCalled();
});

it('persists one v3 state containing both the virtual trade and alert', async () => {
  renderHookWithBuyEvent();
  await waitFor(() => expect(saveSignalRuntime).toHaveBeenCalledTimes(1));
  const state = vi.mocked(saveSignalRuntime).mock.calls[0][0];
  expect(state.virtualLedger.transactions).toHaveLength(1);
  expect(state.alerts[0].virtualTradeId).toBe(state.virtualLedger.transactions[0].id);
});
```

- [ ] **Step 2: Write a failing test that virtual positions extend the monitoring universe**

```ts
it('continues monitoring a virtual holding removed from the watchlist and absent from actual positions', async () => {
  loadSignalRuntime.mockReturnValue(runtimeWithVirtualPosition('600519'));
  renderHook();
  await waitFor(() => expect(syncUniverse).toHaveBeenCalledWith(expect.arrayContaining(['600519'])));
});
```

- [ ] **Step 3: Implement merged universe and dual position snapshots**

The effective universe is the union of:

- watchlist buy codes;
- actual held codes;
- virtual held codes.

Build virtual availability from the runtime ledger at `realtime.lastUpdatedAt`. Pass `virtualPositions` and `actualPositions` separately to `processSnapshot`.

- [ ] **Step 4: Replace per-event inbox reducers with the atomic runtime transition**

```ts
let next = runtimeRef.current;
for (const event of result.events) {
  next = applySignalDecisionEvent(next, event).state;
}
commitRuntime(next);
```

Load V3 through a guarded initializer. If `loadSignalRuntime` throws `SignalRuntimeCorruptionError`, retain the error in hook state, expose it through `error`, and do not call `processSnapshot` or `saveSignalRuntime` until the user explicitly repairs or clears that data in a later feature.

If `saveSignalRuntime` throws, do not update the ref or React state. Preserve the existing visible error behavior so the next quote can retry.

- [ ] **Step 5: Update mark-read, actual-executed and clear-alert callbacks to V3**

These callbacks must preserve `virtualLedger` byte-for-byte except for alert-only operations.

- [ ] **Step 6: Run hook/provider tests and commit**

```bash
cd app
npx vitest run src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/RealtimeBacktestMonitorProvider.test.tsx
npm run typecheck
git add src/features/securities/useRealtimeBacktestMonitor.ts src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/RealtimeBacktestMonitorProvider.test.tsx
git commit -m "feat: connect realtime monitor to virtual runtime"
```

---

### Task 7: Show unambiguous virtual, blocked, risk-only and legacy messages

**Files:**
- Modify: `app/src/features/securities/SignalInbox.tsx`
- Modify: `app/src/features/securities/SignalInbox.test.tsx`

**Interfaces:**
- Consume: `BacktestSignalAlertV3`, existing actual-position dialog and ledger functions.
- No changes to `buyStockPosition` or `sellStockPosition` semantics.

- [ ] **Step 1: Update test fixtures to V3 and write failing semantic-label tests**

```tsx
it('shows the virtual execution price, shares and post-trade position', () => {
  renderInbox({ alerts: [virtualBuyAlert()] });
  expect(screen.getByText('虚拟已买入')).toBeInTheDocument();
  expect(screen.getByText(/100 股/)).toBeInTheDocument();
  expect(screen.getByText(/¥12.34/)).toBeInTheDocument();
  expect(screen.getByText(/虚拟持仓 100/)).toBeInTheDocument();
});

it('labels legacy alerts as excluded from forward simulation', () => {
  renderInbox({ alerts: [legacyAlert()] });
  expect(screen.getByText('历史信号，未纳入虚拟交易')).toBeInTheDocument();
});

it('labels actual-position-only sell advice without claiming a virtual sale', () => {
  renderInbox({ alerts: [actualRiskAlert()] });
  expect(screen.getByText('实际持仓风控提醒')).toBeInTheDocument();
  expect(screen.queryByText('虚拟已卖出')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run SignalInbox tests and verify failure**

```bash
cd app
npx vitest run src/features/securities/SignalInbox.test.tsx
```

- [ ] **Step 3: Implement message badges and frozen virtual details**

Required labels:

- `virtual_execution + open` → `虚拟已买入`
- `virtual_execution + add` → `虚拟已补仓`
- `virtual_execution + reduce` → `虚拟已部分卖出`
- `virtual_execution + exit` → `虚拟已全部卖出`
- `virtual_blocked` → `卖出受T+1限制`
- `actual_position_risk` → `实际持仓风控提醒`
- `legacy` → `历史信号，未纳入虚拟交易`

Show virtual trade and cycle IDs in an expandable details area rather than the main headline.

- [ ] **Step 4: Preserve actual trade dialog behavior and add isolation tests**

Existing actual buy/sell tests must still pass. Add an assertion that confirming an actual trade calls `monitor.markExecuted` but does not call any virtual-ledger mutation function.

- [ ] **Step 5: Run tests and commit**

```bash
cd app
npx vitest run src/features/securities/SignalInbox.test.tsx
git add src/features/securities/SignalInbox.tsx src/features/securities/SignalInbox.test.tsx
git commit -m "feat: distinguish virtual and actual signal messages"
```

---

### Task 8: Add the forward-simulation records panel

**Files:**
- Create: `app/src/features/securities/ForwardSimulationPanel.tsx`
- Create: `app/src/features/securities/ForwardSimulationPanel.test.tsx`
- Modify: `app/src/features/securities/SignalInbox.tsx`
- Modify: `app/src/features/securities/SignalInbox.test.tsx`

**Interfaces:**

```ts
export interface ForwardSimulationPanelProps {
  ledger: VirtualTradingLedger;
  prices: Record<string, number>;
  onViewStock(code: string): void;
  onViewAlert(alertId: string): void;
}
```

- [ ] **Step 1: Write failing panel tests for metrics, positions, transactions and cycles**

```tsx
it('shows separate realized, unrealized and total profit', () => {
  render(<ForwardSimulationPanel ledger={sampleLedger()} prices={{ '000001': 12 }} {...callbacks()} />);
  expect(screen.getByText('已实现盈亏')).toBeInTheDocument();
  expect(screen.getByText('未实现盈亏')).toBeInTheDocument();
  expect(screen.getByText('总盈亏')).toBeInTheDocument();
});

it('counts only closed cycles in the displayed win rate', () => {
  render(<ForwardSimulationPanel ledger={ledgerWithOneWinOneOpen()} prices={{}} {...callbacks()} />);
  expect(screen.getByText('胜率 100.00%')).toBeInTheDocument();
  expect(screen.getByText('已结束周期 1')).toBeInTheDocument();
});
```

- [ ] **Step 2: Implement a compact three-section panel**

Sections:

1. Summary cards: realized, unrealized, total P/L, closed cycles, win rate and open positions.
2. Current virtual positions: total/available shares, average cost, realtime price and unrealized P/L.
3. Records with sub-tabs: transaction details and complete cycles.

Use existing securities CSS variables. Do not introduce a chart dependency or modify the stock-analysis page.

- [ ] **Step 3: Add messages/forward-simulation tabs to the inbox popover**

The popover header gains:

```text
消息 | 前向模拟记录
```

Increase the popover width only while the forward tab is active, capped by `96vw`. Keep the actual trade dialog accessible from the messages tab.

- [ ] **Step 4: Wire current prices from the monitor result**

Extend the hook result with a read-only `quotes` or `prices` projection. Prefer:

```ts
prices: Record<string, number>;
```

Do not expose mutable quote objects to the panel.

- [ ] **Step 5: Run panel and inbox tests**

```bash
cd app
npx vitest run src/features/securities/ForwardSimulationPanel.test.tsx src/features/securities/SignalInbox.test.tsx
npm run typecheck
```

- [ ] **Step 6: Commit the forward-simulation UI**

```bash
git add src/features/securities/ForwardSimulationPanel.tsx src/features/securities/ForwardSimulationPanel.test.tsx src/features/securities/SignalInbox.tsx src/features/securities/SignalInbox.test.tsx src/features/securities/useRealtimeBacktestMonitor.ts
git commit -m "feat: show forward simulation records"
```

---

### Task 9: Run regression checks and document the three-ledger semantics

**Files:**
- Modify: `README.md`
- Verify without changing: individual stock-analysis files.

**Interfaces:**
- No new runtime interface.

- [ ] **Step 1: Add README documentation**

Add a concise section under securities capabilities:

```markdown
### 三套独立交易记录

- 历史回测：使用历史K线验证策略。
- 前向模拟：实时信号触发后自动进行100股虚拟成交，并记录T+1、持仓和盈亏。
- 实际持仓：只有用户确认交易后才更新，绝不与虚拟账本混算。
```

- [ ] **Step 2: Run all touched tests**

```bash
cd app
npx vitest run \
  src/features/securities/virtual-trading-ledger.test.ts \
  src/features/securities/forward-simulation-summary.test.ts \
  src/features/securities/backtest-signal-inbox-store.test.ts \
  src/features/securities/backtest-signal-trading-runtime.test.ts \
  src/features/securities/realtime-backtest-monitor.test.ts \
  src/features/securities/useRealtimeBacktestMonitor.test.tsx \
  src/features/securities/RealtimeBacktestMonitorProvider.test.tsx \
  src/features/securities/ForwardSimulationPanel.test.tsx \
  src/features/securities/SignalInbox.test.tsx \
  src/features/securities/SecuritiesWorkbenchPage.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run project validation**

```bash
cd app
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: all commands exit0. If unrelated pre-existing failures occur, capture their exact command and output; do not modify unrelated cycle-strategy files to make this feature pass.

- [ ] **Step 4: Verify no individual stock-analysis file changed**

```bash
git diff --name-only HEAD~8..HEAD | rg "StockAnalysis|stock-analysis|StockDetail"
```

Expected: no output.

- [ ] **Step 5: Commit documentation and any test-only fixes**

```bash
git add README.md
git commit -m "docs: explain forward simulation ledger"
```

- [ ] **Step 6: Final acceptance audit**

Manually verify with one watchlist stock during a mocked or real trading snapshot:

1. A new buy edge creates one100-share virtual transaction and one inbox message.
2. Refreshing does not duplicate the transaction.
3. The forward tab shows the open virtual position and unrealized P/L.
4. Clicking actual buy updates only the actual ledger.
5. A same-day virtual sell is marked T+1 blocked, not sold.
6. A next-day continuing sell closes or reduces the virtual position at the new price.
7. The closed cycle changes forward win rate but not historical-backtest metrics.
