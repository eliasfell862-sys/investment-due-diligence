# Actual Position Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make “我的实际持仓” the default view of the portfolio system and let users view live P/L, add shares, sell shares, change position groups, and open the existing stock-analysis page.

**Architecture:** Keep `sec_stock_position_ledger_v1` as the only actual-position source of truth and `sec_portfolio_groups_v1` as the independent AI-allocation store. Split the current AI allocation implementation into `AiPortfolioAllocationWorkspace`, add a small `PortfolioAllocationPage` tab shell, and isolate actual-position calculations and UI in focused modules that reuse the existing ledger Hook, realtime quote Hook, trade dialog, and ledger change event.

**Tech Stack:** React 19, TypeScript, React Router, Vitest, Testing Library, browser `localStorage`, existing realtime stock quote and position-ledger infrastructure.

## Global Constraints

- Do not modify `app/src/features/securities/StockAnalysisPage.tsx` or its overview, quote, and K-line loading path.
- Actual positions, groups, and transactions remain exclusively under `sec_stock_position_ledger_v1`.
- AI allocation groups remain exclusively under `sec_portfolio_groups_v1`.
- Buying and selling require positive integer share counts divisible by 100.
- A sale cannot exceed the current position.
- Realtime prices refresh every three seconds during trading through the existing quote Hook and remain manually refreshable.
- Missing realtime prices must never be treated as zero when calculating market value or P/L.
- Backtest sell signals remain reminders only; they never automatically sell a position.
- All successful ledger mutations publish `sec-stock-position-ledger-changed` only after persistence succeeds.
- Do not use subagents during implementation because the user explicitly requested inline execution.

---

## File Structure

- Modify `app/src/features/securities/stock-position-ledger.ts`: add group reassignment and enforce board-lot sells.
- Modify `app/src/features/securities/stock-position-ledger.test.ts`: cover group reassignment, event publication, unchanged transactions, and invalid sell lots.
- Create `app/src/features/securities/actual-position-metrics.ts`: pure per-position and portfolio-summary calculations.
- Create `app/src/features/securities/actual-position-metrics.test.ts`: verify priced and unpriced calculations.
- Modify `app/src/features/securities/StockTradeConfirmDialog.tsx`: support a fixed group for an existing-position buy and enforce 100-share sell lots.
- Modify `app/src/features/securities/StockTradeConfirmDialog.test.tsx`: verify fixed-group add-on buys and sell validation.
- Create `app/src/features/securities/ActualPositionGroupDialog.tsx`: focused group-change dialog.
- Create `app/src/features/securities/ActualPositionGroupDialog.test.tsx`: validate existing/new groups and submitting/error states.
- Create `app/src/features/securities/ActualPositionsPanel.tsx`: actual holdings summary, live table, trade operations, group changes, and stock navigation.
- Create `app/src/features/securities/ActualPositionsPanel.test.tsx`: end-to-end component coverage against the real localStorage ledger.
- Rename `app/src/features/securities/PortfolioAllocationPage.tsx` to `app/src/features/securities/AiPortfolioAllocationWorkspace.tsx`: retain the existing AI engine UI without the outer page header.
- Rename `app/src/features/securities/PortfolioAllocationPage.test.tsx` to `app/src/features/securities/AiPortfolioAllocationWorkspace.test.tsx`: preserve all existing AI-allocation regressions.
- Create `app/src/features/securities/PortfolioAllocationPage.tsx`: default actual-position tab plus AI-allocation tab.
- Create `app/src/features/securities/PortfolioAllocationPage.test.tsx`: tab-shell integration and data-store isolation.
- Regression only: watchlist, signal inbox, realtime monitor, router, and stock-analysis tests.

---

### Task 1: Add Position Group Reassignment and Board-Lot Sell Validation

**Files:**
- Modify: `app/src/features/securities/stock-position-ledger.ts`
- Modify: `app/src/features/securities/stock-position-ledger.test.ts`

**Interfaces:**
- Produces:

```ts
export interface UpdateStockPositionGroupInput {
  code: string;
  groupId: string;
  groupName: string;
  updatedAt: string;
}

export function updateStockPositionGroup(
  input: UpdateStockPositionGroupInput,
  options?: StockPositionLedgerOptions,
): { ledger: StockPositionLedger; position: StockPosition };
```

- Keeps `buyStockPosition`, `sellStockPosition`, `loadStockLedger`, and the storage event contract unchanged.

- [ ] **Step 1: Write failing ledger tests**

Add tests proving that group reassignment adds a new named group, changes only the target position, leaves transaction history byte-for-byte unchanged, and publishes one ledger event after persistence:

```ts
it('moves an existing position to a new group without creating a transaction', () => {
  const dependencies = options();
  buyStockPosition({
    code: '000001', name: '平安银行', shares: 100, price: 10,
    groupId: 'default', groupName: '默认持仓', sourceAlertId: 'buy-1',
    tradedAt: '2026-08-05T01:30:00.000Z',
  }, dependencies);
  const before = loadStockLedger(dependencies.storage);
  const listener = vi.fn();
  window.addEventListener(STOCK_POSITION_LEDGER_CHANGED_EVENT, listener);

  const result = updateStockPositionGroup({
    code: '000001', groupId: 'core', groupName: '核心持仓',
    updatedAt: '2026-08-05T02:00:00.000Z',
  }, dependencies);

  expect(result.position).toMatchObject({ code: '000001', groupId: 'core' });
  expect(result.ledger.groups).toContainEqual({ id: 'core', name: '核心持仓' });
  expect(result.ledger.transactions).toEqual(before.transactions);
  expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener(STOCK_POSITION_LEDGER_CHANGED_EVENT, listener);
});
```

Extend the invalid-quantity test:

```ts
expect(() => sellStockPosition({
  code: '000001', shares: 50, price: 11,
  sourceAlertId: 'sell-half-lot', tradedAt: '2026-08-05T02:00:00.000Z',
}, dependencies)).toThrow('卖出股数必须是100股的整数倍');
```

- [ ] **Step 2: Run the ledger test and verify RED**

Run:

```powershell
npm test -- --run src/features/securities/stock-position-ledger.test.ts
```

Expected: FAIL because `updateStockPositionGroup` does not exist and 50-share sells are currently accepted.

- [ ] **Step 3: Implement the minimal ledger behavior**

Add the interface and function. Validate non-empty code, group ID, and trimmed group name; require an existing position; add the group if missing; update `groupId` and `updatedAt`; preserve `transactions`; call the existing `persist` once.

Add this validation in `sellStockPosition` immediately after `assertTradeBase`:

```ts
if (input.shares % 100 !== 0) {
  throw new Error('卖出股数必须是100股的整数倍');
}
```

- [ ] **Step 4: Run tests and typecheck**

```powershell
npm test -- --run src/features/securities/stock-position-ledger.test.ts src/features/securities/useStockPositionLedger.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- app/src/features/securities/stock-position-ledger.ts app/src/features/securities/stock-position-ledger.test.ts
git commit -m "feat: support actual position group changes"
```

---

### Task 2: Add Pure Actual-Position Metrics

**Files:**
- Create: `app/src/features/securities/actual-position-metrics.ts`
- Create: `app/src/features/securities/actual-position-metrics.test.ts`

**Interfaces:**
- Consumes: `StockPosition` and optional `StockQuote`.
- Produces:

```ts
export interface ActualPositionMetrics {
  currentPrice: number | null;
  marketValue: number | null;
  floatingProfit: number | null;
  floatingProfitRate: number | null;
}

export interface ActualPortfolioSummary {
  positionCount: number;
  totalCost: number;
  marketValue: number | null;
  floatingProfit: number | null;
  unpricedCount: number;
}

export function calculateActualPositionMetrics(
  position: StockPosition,
  quote?: StockQuote,
): ActualPositionMetrics;

export function calculateActualPortfolioSummary(
  rows: Array<{ position: StockPosition; metrics: ActualPositionMetrics }>,
): ActualPortfolioSummary;
```

- [ ] **Step 1: Write failing metrics tests**

```ts
it('calculates market value and floating profit from a valid realtime quote', () => {
  expect(calculateActualPositionMetrics(position({ shares: 100, averageCost: 10 }), quote(12)))
    .toEqual({ currentPrice: 12, marketValue: 1200, floatingProfit: 200, floatingProfitRate: 20 });
});

it('returns unavailable metrics instead of zero when realtime price is missing', () => {
  expect(calculateActualPositionMetrics(position(), undefined)).toEqual({
    currentPrice: null, marketValue: null, floatingProfit: null, floatingProfitRate: null,
  });
});

it('marks the portfolio summary unavailable when any position lacks pricing', () => {
  const summary = calculateActualPortfolioSummary([
    { position: position({ code: '000001', totalCost: 1000 }), metrics: metrics(1200, 200) },
    { position: position({ code: '600519', totalCost: 2000 }), metrics: metrics(null, null) },
  ]);
  expect(summary).toEqual({
    positionCount: 2, totalCost: 3000, marketValue: null,
    floatingProfit: null, unpricedCount: 1,
  });
});
```

- [ ] **Step 2: Run the metrics test and verify RED**

```powershell
npm test -- --run src/features/securities/actual-position-metrics.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal rounded calculations**

Use a local two-decimal `roundMoney` helper. Treat a quote as valid only when `Number.isFinite(quote.price) && quote.price > 0`. When any row is unpriced, summary market value and floating profit are `null`, while total cost and position count remain available.

- [ ] **Step 4: Run test and typecheck**

```powershell
npm test -- --run src/features/securities/actual-position-metrics.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- app/src/features/securities/actual-position-metrics.ts app/src/features/securities/actual-position-metrics.test.ts
git commit -m "feat: calculate actual position performance"
```

---

### Task 3: Extend Trade Confirmation for Add-On Buys and Board-Lot Sells

**Files:**
- Modify: `app/src/features/securities/StockTradeConfirmDialog.tsx`
- Modify: `app/src/features/securities/StockTradeConfirmDialog.test.tsx`

**Interfaces:**
- Extends `StockTradeConfirmDialogProps` with:

```ts
fixedBuyGroup?: StockPositionGroup;
```

- When `alert.action === 'buy'` and `fixedBuyGroup` exists, the dialog displays the fixed group as read-only and returns its ID without offering another group or new-group controls.
- Sell inputs use `step={100}` and reject quantities not divisible by 100.

- [ ] **Step 1: Write failing dialog tests**

```tsx
it('locks an add-on buy to the existing position group', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  render(<StockTradeConfirmDialog
    alert={alert('buy')}
    position={position}
    groups={[{ id: 'core', name: '核心持仓' }]}
    fixedBuyGroup={{ id: 'core', name: '核心持仓' }}
    onConfirm={onConfirm}
    onCancel={vi.fn()}
  />);
  expect(screen.getByText('核心持仓')).toBeInTheDocument();
  expect(screen.queryByLabelText('目标持仓组')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '确认买入' }));
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'core' }));
});

it('rejects a sell quantity that is not a 100-share lot', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  render(<StockTradeConfirmDialog
    alert={alert('sell')} position={position} groups={[]}
    onConfirm={onConfirm} onCancel={vi.fn()}
  />);
  await user.clear(screen.getByLabelText('交易股数'));
  await user.type(screen.getByLabelText('交易股数'), '50');
  await user.click(screen.getByRole('button', { name: '确认卖出' }));
  expect(screen.getByRole('alert')).toHaveTextContent('卖出股数必须是100股的整数倍');
  expect(onConfirm).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the dialog test and verify RED**

```powershell
npm test -- --run src/features/securities/StockTradeConfirmDialog.test.tsx
```

Expected: FAIL because fixed buy groups and sell lot validation are unsupported.

- [ ] **Step 3: Implement the minimal extension**

Initialize `groupId` from `fixedBuyGroup?.id ?? 'default'`. For fixed buys render a read-only “持仓组” line. For editable buys retain the existing select and new-group flow. Add sell `% 100` validation before oversell validation and change the sell input step from `1` to `100`.

- [ ] **Step 4: Run dialog and inbox regressions**

```powershell
npm test -- --run src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/SignalInbox.test.tsx src/features/securities/WatchlistPositionCell.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- app/src/features/securities/StockTradeConfirmDialog.tsx app/src/features/securities/StockTradeConfirmDialog.test.tsx
git commit -m "feat: support actual position trade confirmation"
```

---

### Task 4: Build the Position Group Change Dialog

**Files:**
- Create: `app/src/features/securities/ActualPositionGroupDialog.tsx`
- Create: `app/src/features/securities/ActualPositionGroupDialog.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface PositionGroupChange {
  groupId: string;
  newGroupName: string;
}

export interface ActualPositionGroupDialogProps {
  stockName: string;
  currentGroupId: string;
  groups: StockPositionGroup[];
  submitting?: boolean;
  externalError?: string;
  onConfirm(input: PositionGroupChange): void;
  onCancel(): void;
}
```

- [ ] **Step 1: Write failing dialog tests**

Cover preselection of the current group, switching to another existing group, requiring a trimmed new-group name when `__new__` is selected, disabling both buttons while submitting, and displaying an external persistence error.

```tsx
it('submits an existing target group', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  render(<ActualPositionGroupDialog
    stockName="平安银行" currentGroupId="default"
    groups={[{ id: 'default', name: '默认持仓' }, { id: 'core', name: '核心持仓' }]}
    onConfirm={onConfirm} onCancel={vi.fn()}
  />);
  await user.selectOptions(screen.getByLabelText('目标持仓组'), 'core');
  await user.click(screen.getByRole('button', { name: '确认调整' }));
  expect(onConfirm).toHaveBeenCalledWith({ groupId: 'core', newGroupName: '' });
});
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- --run src/features/securities/ActualPositionGroupDialog.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the focused dialog**

Use the visual structure and error/button behavior of `StockTradeConfirmDialog`, but only render the group selector, conditional new-group input, cancel button, and “确认调整” button. Do not access storage inside this component.

- [ ] **Step 4: Run test and typecheck**

```powershell
npm test -- --run src/features/securities/ActualPositionGroupDialog.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- app/src/features/securities/ActualPositionGroupDialog.tsx app/src/features/securities/ActualPositionGroupDialog.test.tsx
git commit -m "feat: add actual position group dialog"
```

---

### Task 5: Build the Actual Positions Panel

**Files:**
- Create: `app/src/features/securities/ActualPositionsPanel.tsx`
- Create: `app/src/features/securities/ActualPositionsPanel.test.tsx`

**Interfaces:**
- Consumes: `useStockPositionLedger`, `useRealtimeStockQuotes`, `RealtimeQuoteStatus`, metrics from Task 2, ledger operations from Task 1, dialogs from Tasks 3-4, and React Router navigation.
- Produces:

```ts
export interface ActualPositionsPanelProps {
  projectId?: string;
}

export function ActualPositionsPanel(props: ActualPositionsPanelProps): JSX.Element;
```

- [ ] **Step 1: Write failing display and empty-state tests**

Seed `sec_stock_position_ledger_v1` with a 100-share position at cost ¥10 and mock realtime price ¥12. Verify:

```tsx
expect(screen.getByText('我的实际持仓')).toBeInTheDocument();
expect(screen.getByText('平安银行')).toBeInTheDocument();
expect(screen.getByText('100 股')).toBeInTheDocument();
expect(screen.getByText('¥1,000.00')).toBeInTheDocument();
expect(screen.getByText('¥1,200.00')).toBeInTheDocument();
expect(screen.getByText('+¥200.00')).toBeInTheDocument();
expect(screen.getByText('+20.00%')).toBeInTheDocument();
expect(mocks.realtimeHook).toHaveBeenCalledWith(['000001']);
```

With no positions, verify the empty state contains “暂无实际持仓” and a link to `/projects/default/securities/watchlist`.

- [ ] **Step 2: Run panel tests and verify RED**

```powershell
npm test -- --run src/features/securities/ActualPositionsPanel.test.tsx
```

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Implement summary, live table, and unavailable-price behavior**

Use a memoized sorted code array from `ledger.positions`. Render summary cards for position count, total cost, market value, and floating profit. When any price is unavailable, render “行情不完整” and `—` for aggregate market value/P&L rather than zero. Render `RealtimeQuoteStatus` with `realtime.refreshNow`.

Each row renders:

- stock name and code;
- resolved ledger group name;
- shares and average cost;
- current price or “暂无行情”;
- market value, floating P/L, and rate or `—`;
- buttons named `补仓 <name>`, `卖出 <name>`, `调整持仓组 <name>`, and `查看个股 <name>`.

- [ ] **Step 4: Write failing operation tests**

Add tests that:

1. click “补仓 平安银行”, confirm the default 100 shares at realtime price, then expect 200 shares and weighted average cost ¥11;
2. click “卖出 平安银行”, confirm all 100 shares, then expect the empty state and no stored position;
3. change to a new group and expect `groupId` to change while transaction count remains unchanged;
4. click “查看个股 平安银行” and expect `/projects/default/securities/stock/000001`;
5. seed corrupted ledger JSON and expect “实际持仓数据损坏” with all mutation buttons absent or disabled.

- [ ] **Step 5: Implement panel operations**

Create stable manual source IDs only when opening a trade:

```ts
manual-portfolio-buy-${code}-${uuid}
manual-portfolio-sell-${code}-${uuid}
```

For add-on buys, pass the position’s existing group through `fixedBuyGroup` and call `buyStockPosition`. For sells, pass the current position and call `sellStockPosition`. For group changes, resolve existing/new group names and call `updateStockPositionGroup`. Keep dialogs open on persistence failure by passing `externalError`; close and reload the ledger only after success.

If no valid realtime price exists, open the trade dialog with price `0`, label it “暂无实时价”, and require the user to enter a positive price before confirmation.

- [ ] **Step 6: Run panel and dependency tests**

```powershell
npm test -- --run src/features/securities/ActualPositionsPanel.test.tsx src/features/securities/actual-position-metrics.test.ts src/features/securities/stock-position-ledger.test.ts src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/ActualPositionGroupDialog.test.tsx
npm run typecheck
npm run lint
```

Expected: tests and typecheck PASS; lint has no new warning in changed files.

- [ ] **Step 7: Commit Task 5**

```powershell
git add -- app/src/features/securities/ActualPositionsPanel.tsx app/src/features/securities/ActualPositionsPanel.test.tsx
git commit -m "feat: add actual position management panel"
```

---

### Task 6: Split the AI Workspace and Add Default Portfolio Tabs

**Files:**
- Rename: `app/src/features/securities/PortfolioAllocationPage.tsx` → `app/src/features/securities/AiPortfolioAllocationWorkspace.tsx`
- Rename: `app/src/features/securities/PortfolioAllocationPage.test.tsx` → `app/src/features/securities/AiPortfolioAllocationWorkspace.test.tsx`
- Create: `app/src/features/securities/PortfolioAllocationPage.tsx`
- Create: `app/src/features/securities/PortfolioAllocationPage.test.tsx`

**Interfaces:**
- Produces `AiPortfolioAllocationWorkspace(): JSX.Element` containing the existing AI allocation configuration, analysis, saving, and version management behavior.
- Produces `PortfolioAllocationPage(): JSX.Element` as the route-level shell with two tabs.

- [ ] **Step 1: Write failing tab-shell tests**

Mock `ActualPositionsPanel` and `AiPortfolioAllocationWorkspace` with distinct test markers:

```tsx
it('shows actual positions by default and switches to AI allocation on demand', async () => {
  const user = userEvent.setup();
  renderPage();
  expect(screen.getByTestId('actual-positions-panel')).toBeInTheDocument();
  expect(screen.queryByTestId('ai-allocation-workspace')).not.toBeInTheDocument();

  await user.click(screen.getByRole('tab', { name: 'AI 持仓分配' }));
  expect(screen.getByTestId('ai-allocation-workspace')).toBeInTheDocument();
  expect(screen.queryByTestId('actual-positions-panel')).not.toBeInTheDocument();
});
```

Also verify both tabs use `aria-selected`, the page retains the existing return link, and the actual panel receives the route `projectId`.

- [ ] **Step 2: Run the new page test and verify RED**

```powershell
npm test -- --run src/features/securities/PortfolioAllocationPage.test.tsx
```

Expected: FAIL because the tab shell does not exist.

- [ ] **Step 3: Rename the existing AI implementation without changing its behavior**

Use `git mv` for both existing files. Rename the exported component and test import. Remove only the old outer return link, `h1`, and introduction paragraph from the AI workspace so the route shell owns them. Do not change its analysis, allocation, storage, or realtime overlay logic.

- [ ] **Step 4: Implement the new route shell**

Create local state:

```ts
const [activeView, setActiveView] = useState<'actual' | 'ai'>('actual');
```

Render the existing return link, “持仓分配系统” heading, and two accessible tab buttons. Render exactly one child at a time:

```tsx
{activeView === 'actual'
  ? <ActualPositionsPanel projectId={projectId} />
  : <AiPortfolioAllocationWorkspace />}
```

- [ ] **Step 5: Run shell and AI regression tests**

```powershell
npm test -- --run src/features/securities/PortfolioAllocationPage.test.tsx src/features/securities/AiPortfolioAllocationWorkspace.test.tsx
npm run typecheck
```

Expected: new default-tab tests PASS and all seven existing AI-allocation tests remain unchanged and PASS.

- [ ] **Step 6: Commit Task 6**

```powershell
git add -- app/src/features/securities/PortfolioAllocationPage.tsx app/src/features/securities/PortfolioAllocationPage.test.tsx app/src/features/securities/AiPortfolioAllocationWorkspace.tsx app/src/features/securities/AiPortfolioAllocationWorkspace.test.tsx
git commit -m "feat: make actual positions the default portfolio view"
```

---

### Task 7: Final Regression, Build, and Browser Verification

**Files:**
- Verify only; do not modify `app/src/features/securities/StockAnalysisPage.tsx`.

- [ ] **Step 1: Run the focused feature suite**

```powershell
npm test -- --run src/features/securities/stock-position-ledger.test.ts src/features/securities/useStockPositionLedger.test.tsx src/features/securities/actual-position-metrics.test.ts src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/ActualPositionGroupDialog.test.tsx src/features/securities/ActualPositionsPanel.test.tsx src/features/securities/PortfolioAllocationPage.test.tsx src/features/securities/AiPortfolioAllocationWorkspace.test.tsx src/features/securities/WatchlistPage.test.tsx src/features/securities/WatchlistPositionCell.test.tsx src/features/securities/SignalInbox.test.tsx src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/realtime-backtest-monitor.test.ts src/features/securities/stock-monitoring-universe.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run quality gates**

```powershell
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: typecheck and build exit 0; lint introduces no warning in changed files; diff check exits 0.

- [ ] **Step 3: Confirm protected files and stores**

```powershell
git diff --name-only HEAD~6..HEAD | Select-String -Pattern 'StockAnalysisPage.tsx'
git diff -- app/src/features/securities/portfolio-group-storage.ts
```

Expected: no output. Verify tests separately prove actual trades write only `sec_stock_position_ledger_v1` and AI saves write only `sec_portfolio_groups_v1`.

- [ ] **Step 4: Verify the live flow in the browser**

Open `http://localhost:5173/projects/default/securities/portfolio` and verify:

1. “我的实际持仓” is selected by default.
2. Actual watchlist-confirmed buys appear with group, shares, cost, realtime price, market value, floating P/L, and P/L rate.
3. Realtime status and “立即刷新” are visible.
4. Add-on buy defaults to 100 shares and the current group.
5. A partial 100-share sale preserves the remaining position; a full sale removes it.
6. Group adjustment changes the displayed group without adding a transaction.
7. Refreshing the page preserves actual holdings.
8. Switching to “AI 持仓分配” shows the existing analysis system and saved AI groups.
9. Clicking “查看个股” opens the existing stock-analysis page with overview and K-line intact.
10. Browser console contains no new runtime error.

- [ ] **Step 5: Report completion**

Report focused test count, typecheck/build status, existing unrelated lint warnings, browser verification, commit IDs, and confirmation that `StockAnalysisPage.tsx` was not modified. Do not create an empty commit.
