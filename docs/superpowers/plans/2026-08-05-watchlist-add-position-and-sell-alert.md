# Watchlist Position Entry and Sell Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-stock “加入持仓” workflow to the watchlist, persist confirmed buys in the existing actual-position ledger, display “已加入持仓” while shares remain, and ensure held stocks continue producing deduplicated sell alerts in the existing inbox.

**Architecture:** Keep `sec_stock_position_ledger_v1` as the only actual-position source of truth. Add a small ledger subscription Hook for same-tab, cross-tab, and focus-driven synchronization; isolate the new table interaction in `WatchlistPositionCell`; reuse `StockTradeConfirmDialog` and the existing realtime backtest monitor rather than adding a second position store or sell algorithm.

**Tech Stack:** React 19, TypeScript, React Router, Vitest, Testing Library, browser `localStorage`, existing realtime quote and backtest-monitor infrastructure.

## Global Constraints

- Do not modify `app/src/features/securities/StockAnalysisPage.tsx` or its K-line/data-loading path.
- Do not modify AI portfolio allocation snapshots stored under `sec_portfolio_groups_v1`.
- Actual positions and transactions must remain under `sec_stock_position_ledger_v1`.
- Buying requires a positive finite price and a positive integer number of shares divisible by 100.
- Default buy quantity is exactly 100 shares; default buy price is the latest valid realtime quote.
- Sell signals create inbox reminders only; they must never automatically change positions.
- A continuously active sell state creates exactly one alert until the signal clears and later reappears.
- A stock with any remaining shares displays “已加入持仓”; a full sale restores “加入持仓”.
- Clicking the position button or dialog must not navigate to the stock-analysis route.
- Preserve the uncommitted short-term-advice changes already present in the worktree; stage and commit only files named by each task.

---

## File Structure

- Create `app/src/features/securities/useStockPositionLedger.ts`: safe ledger loading plus same-tab, cross-tab, and focus synchronization.
- Create `app/src/features/securities/useStockPositionLedger.test.tsx`: Hook synchronization and corruption tests.
- Create `app/src/features/securities/WatchlistPositionCell.tsx`: button state, manual-buy dialog, persistence, and error UI for one watchlist row.
- Create `app/src/features/securities/WatchlistPositionCell.test.tsx`: isolated cell behavior and ledger persistence tests.
- Modify `app/src/features/securities/stock-position-ledger.ts`: publish a ledger-changed event after successful persistence.
- Modify `app/src/features/securities/stock-position-ledger.test.ts`: verify notification occurs only after successful writes.
- Modify `app/src/features/securities/StockTradeConfirmDialog.tsx`: support a caller-provided price label, submitting state, and external persistence errors.
- Modify `app/src/features/securities/StockTradeConfirmDialog.test.tsx`: verify manual-buy copy and double-submit protection.
- Modify `app/src/features/securities/WatchlistPage.tsx`: render the position column and keep expanded-row colspans correct.
- Modify `app/src/features/securities/WatchlistPage.test.tsx`: integration coverage for buy, held state, full-sale restoration, and route isolation.
- Modify `app/src/features/securities/useRealtimeBacktestMonitor.ts`: consume the shared ledger Hook so manual watchlist buys immediately enter held-stock monitoring.
- Modify `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`: prove ledger change refreshes held positions used by signal processing.
- Regression only: `app/src/features/securities/backtest-signal-inbox-store.test.ts`, `app/src/features/securities/realtime-backtest-monitor.test.ts`, `app/src/features/securities/SignalInbox.test.tsx`, and `app/src/features/securities/stock-monitoring-universe.test.ts`.

---

### Task 1: Publish and Subscribe to Actual-Position Ledger Changes

**Files:**
- Modify: `app/src/features/securities/stock-position-ledger.ts:1-1,119-121`
- Modify: `app/src/features/securities/stock-position-ledger.test.ts`
- Create: `app/src/features/securities/useStockPositionLedger.ts`
- Create: `app/src/features/securities/useStockPositionLedger.test.tsx`

**Interfaces:**
- Produces: `STOCK_POSITION_LEDGER_CHANGED_EVENT: 'sec-stock-position-ledger-changed'`.
- Produces: `useStockPositionLedger(): { ledger: StockPositionLedger; error: string; reload(): void }`.
- Consumes: existing `loadStockLedger()` and `STOCK_POSITION_LEDGER_KEY`.

- [ ] **Step 1: Write the failing ledger notification test**

Add this test to `stock-position-ledger.test.ts`:

```ts
it('publishes a ledger change only after a successful persisted trade', () => {
  const listener = vi.fn();
  window.addEventListener(STOCK_POSITION_LEDGER_CHANGED_EVENT, listener);
  const dependencies = options();

  buyStockPosition({
    code: '000001', name: '平安银行', shares: 100, price: 10,
    groupId: 'default', groupName: '默认持仓', sourceAlertId: 'manual-1',
    tradedAt: '2026-08-05T01:30:00.000Z',
  }, dependencies);

  expect(listener).toHaveBeenCalledOnce();
  expect(() => buyStockPosition({
    code: '000001', name: '平安银行', shares: 50, price: 10,
    groupId: 'default', groupName: '默认持仓', sourceAlertId: 'manual-bad',
    tradedAt: '2026-08-05T01:31:00.000Z',
  }, dependencies)).toThrow('买入股数必须是100股的整数倍');
  expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener(STOCK_POSITION_LEDGER_CHANGED_EVENT, listener);
});
```

Add `vi` and `STOCK_POSITION_LEDGER_CHANGED_EVENT` to the test imports.

- [ ] **Step 2: Run the notification test and verify RED**

Run:

```powershell
npm test -- --run src/features/securities/stock-position-ledger.test.ts
```

Expected: FAIL because `STOCK_POSITION_LEDGER_CHANGED_EVENT` is not exported and successful persistence emits no event.

- [ ] **Step 3: Implement notification after persistence**

Add to `stock-position-ledger.ts`:

```ts
export const STOCK_POSITION_LEDGER_CHANGED_EVENT = 'sec-stock-position-ledger-changed';

function notifyLedgerChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(STOCK_POSITION_LEDGER_CHANGED_EVENT));
}
```

Change `persist` to:

```ts
function persist(storage: StorageAccess, ledger: StockPositionLedger) {
  storage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify(ledger));
  notifyLedgerChanged();
}
```

Do not emit before `setItem`; a storage exception must not publish a false successful state.

- [ ] **Step 4: Run the ledger test and verify GREEN**

Run the command from Step 2.

Expected: all ledger tests PASS.

- [ ] **Step 5: Write failing Hook synchronization tests**

Create `useStockPositionLedger.test.tsx` with these behaviors:

```tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  STOCK_POSITION_LEDGER_CHANGED_EVENT,
  STOCK_POSITION_LEDGER_KEY,
} from './stock-position-ledger';
import { useStockPositionLedger } from './useStockPositionLedger';

const heldLedger = {
  version: 1 as const,
  groups: [{ id: 'default', name: '默认持仓' }],
  positions: [{
    id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
    shares: 100, averageCost: 10, totalCost: 1_000,
    openedAt: '2026-08-05T01:30:00.000Z', updatedAt: '2026-08-05T01:30:00.000Z',
    sourceAlertIds: ['manual-1'],
  }],
  transactions: [],
};

describe('useStockPositionLedger', () => {
  beforeEach(() => localStorage.clear());

  it('reloads after same-tab, cross-tab, and focus notifications', () => {
    const { result } = renderHook(() => useStockPositionLedger());
    expect(result.current.ledger.positions).toEqual([]);

    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify(heldLedger));
    act(() => window.dispatchEvent(new Event(STOCK_POSITION_LEDGER_CHANGED_EVENT)));
    expect(result.current.ledger.positions[0]).toMatchObject({ code: '000001', shares: 100 });

    localStorage.removeItem(STOCK_POSITION_LEDGER_KEY);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: STOCK_POSITION_LEDGER_KEY })));
    expect(result.current.ledger.positions).toEqual([]);

    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify(heldLedger));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current.ledger.positions).toHaveLength(1);
  });

  it('reports corrupted storage without overwriting it', () => {
    localStorage.setItem(STOCK_POSITION_LEDGER_KEY, '{broken');
    const { result } = renderHook(() => useStockPositionLedger());
    expect(result.current.error).toBe('实际持仓数据损坏');
    expect(result.current.ledger.positions).toEqual([]);
    expect(localStorage.getItem(STOCK_POSITION_LEDGER_KEY)).toBe('{broken');
  });
});
```

- [ ] **Step 6: Run the Hook test and verify RED**

Run:

```powershell
npm test -- --run src/features/securities/useStockPositionLedger.test.tsx
```

Expected: FAIL because the Hook does not exist.

- [ ] **Step 7: Implement the shared ledger Hook**

Create `useStockPositionLedger.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import {
  STOCK_POSITION_LEDGER_CHANGED_EVENT,
  STOCK_POSITION_LEDGER_KEY,
  loadStockLedger,
  type StockPositionLedger,
} from './stock-position-ledger';

const EMPTY_LEDGER: StockPositionLedger = {
  version: 1, groups: [], positions: [], transactions: [],
};

export function useStockPositionLedger() {
  const [ledger, setLedger] = useState<StockPositionLedger>(EMPTY_LEDGER);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    try {
      setLedger(loadStockLedger());
      setError('');
    } catch (loadError) {
      setLedger(EMPTY_LEDGER);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key === STOCK_POSITION_LEDGER_KEY) reload();
    };
    window.addEventListener(STOCK_POSITION_LEDGER_CHANGED_EVENT, reload);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', reload);
    return () => {
      window.removeEventListener(STOCK_POSITION_LEDGER_CHANGED_EVENT, reload);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', reload);
    };
  }, [reload]);

  return { ledger, error, reload };
}
```

- [ ] **Step 8: Run Task 1 tests and commit**

Run:

```powershell
npm test -- --run src/features/securities/stock-position-ledger.test.ts src/features/securities/useStockPositionLedger.test.tsx
npm run typecheck
```

Expected: PASS.

Commit:

```powershell
git add -- app/src/features/securities/stock-position-ledger.ts app/src/features/securities/stock-position-ledger.test.ts app/src/features/securities/useStockPositionLedger.ts app/src/features/securities/useStockPositionLedger.test.tsx
git commit -m "feat: synchronize actual position ledger"
```

---

### Task 2: Extend the Existing Trade Confirmation Dialog for Manual Watchlist Buys

**Files:**
- Modify: `app/src/features/securities/StockTradeConfirmDialog.tsx:12-18,20-31,67-72,126-145`
- Modify: `app/src/features/securities/StockTradeConfirmDialog.test.tsx`

**Interfaces:**
- Extends `StockTradeConfirmDialogProps` with `priceLabel?: string`, `submitting?: boolean`, and `externalError?: string`.
- Keeps the existing `alert`, `position`, `groups`, `onConfirm`, and `onCancel` contract intact for `SignalInbox`.
- Produces UI behavior consumed by `WatchlistPositionCell` in Task 3.

- [ ] **Step 1: Write failing manual-copy and busy-state tests**

Add to `StockTradeConfirmDialog.test.tsx`:

```tsx
it('shows a latest-price label and blocks duplicate submission while saving', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  render(<StockTradeConfirmDialog
    alert={alert('buy')}
    position={null}
    groups={[]}
    priceLabel="最新价"
    submitting
    externalError="存储空间不足"
    onConfirm={onConfirm}
    onCancel={vi.fn()}
  />);

  expect(screen.getByText(/最新价 ¥10.80/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('存储空间不足');
  expect(screen.getByRole('button', { name: '提交中...' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '提交中...' }));
  expect(onConfirm).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the dialog test and verify RED**

Run:

```powershell
npm test -- --run src/features/securities/StockTradeConfirmDialog.test.tsx
```

Expected: FAIL because the new props and copy are unsupported.

- [ ] **Step 3: Implement the minimal dialog extension**

Add optional props:

```ts
export interface StockTradeConfirmDialogProps {
  alert: BacktestSignalAlert;
  position: StockPosition | null;
  groups: StockPositionGroup[];
  priceLabel?: string;
  submitting?: boolean;
  externalError?: string;
  onConfirm(input: StockTradeConfirmation): void;
  onCancel(): void;
}
```

Default them during destructuring:

```ts
priceLabel = '信号价',
submitting = false,
externalError = '',
```

Change the reference-price line and error/button rendering:

```tsx
{alert.code} · {priceLabel} ¥{alert.price.toFixed(2)}

{(externalError || error) && (
  <div role="alert" style={{ color: '#f87171', fontSize: '0.78rem', marginBottom: 12 }}>
    {externalError || error}
  </div>
)}

<button type="button" onClick={submit} disabled={submitting}>
  {submitting ? '提交中...' : isBuy ? '确认买入' : '确认卖出'}
</button>
```

Also disable the cancel button while submitting so the parent cannot be unmounted midway through persistence.

- [ ] **Step 4: Run dialog and inbox regressions**

Run:

```powershell
npm test -- --run src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/SignalInbox.test.tsx
npm run typecheck
```

Expected: PASS; existing inbox copy continues to use “信号价”.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- app/src/features/securities/StockTradeConfirmDialog.tsx app/src/features/securities/StockTradeConfirmDialog.test.tsx
git commit -m "feat: support manual stock trade confirmation"
```

---

### Task 3: Build the Isolated Watchlist Position Cell

**Files:**
- Create: `app/src/features/securities/WatchlistPositionCell.tsx`
- Create: `app/src/features/securities/WatchlistPositionCell.test.tsx`

**Interfaces:**
- Consumes: `StockQuote`, `StockPositionLedger`, `findStockPosition`, `buyStockPosition`, `StockTradeConfirmDialog`.
- Produces:

```ts
export interface WatchlistPositionCellProps {
  quote: StockQuote;
  ledger: StockPositionLedger;
  ledgerError: string;
  onLedgerChanged(): void;
}
```

- [ ] **Step 1: Write failing cell tests**

Create `WatchlistPositionCell.test.tsx` covering the unheld, confirmed, held, invalid-price, and storage-error paths:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStockLedger, type StockPositionLedger } from './stock-position-ledger';
import { WatchlistPositionCell } from './WatchlistPositionCell';

const quote = {
  code: '000001', name: '平安银行', market: 'sz' as const, price: 10.8,
  change: 0, changePct: 0, open: 10.8, high: 10.8, low: 10.8,
  volume: 1_000, amount: 10_800, preClose: 10.8, turnover: 1,
  pe: 10, pb: 1, totalShares: 1, floatShares: 1, totalCap: 1, floatCap: 1,
};
const emptyLedger: StockPositionLedger = {
  version: 1, groups: [], positions: [], transactions: [],
};

describe('WatchlistPositionCell', () => {
  beforeEach(() => localStorage.clear());

  it('confirms a manual buy at the realtime price and persists it', async () => {
    const user = userEvent.setup();
    const onLedgerChanged = vi.fn();
    render(<table><tbody><tr><WatchlistPositionCell
      quote={quote} ledger={emptyLedger} ledgerError="" onLedgerChanged={onLedgerChanged}
    /></tr></tbody></table>);

    await user.click(screen.getByRole('button', { name: '加入持仓 平安银行' }));
    expect(screen.getByLabelText('交易股数')).toHaveValue(100);
    expect(screen.getByLabelText('成交价格')).toHaveValue(10.8);
    expect(screen.getByText(/最新价 ¥10.80/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认买入' }));

    expect(loadStockLedger().positions[0]).toMatchObject({
      code: '000001', shares: 100, averageCost: 10.8, groupId: 'default',
    });
    expect(loadStockLedger().transactions[0].sourceAlertId)
      .toMatch(/^manual-watchlist-000001-/);
    expect(onLedgerChanged).toHaveBeenCalledOnce();
  });

  it('shows a disabled held state and blocks writes when the ledger is invalid', () => {
    const heldLedger: StockPositionLedger = {
      ...emptyLedger,
      positions: [{
        id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
        shares: 100, averageCost: 10.8, totalCost: 1_080,
        openedAt: '2026-08-05T01:30:00.000Z', updatedAt: '2026-08-05T01:30:00.000Z',
        sourceAlertIds: ['manual-1'],
      }],
    };
    const { rerender } = render(<table><tbody><tr><WatchlistPositionCell
      quote={quote} ledger={heldLedger} ledgerError="" onLedgerChanged={vi.fn()}
    /></tr></tbody></table>);
    expect(screen.getByRole('button', { name: '已加入持仓 平安银行' })).toBeDisabled();

    rerender(<table><tbody><tr><WatchlistPositionCell
      quote={quote} ledger={emptyLedger} ledgerError="实际持仓数据损坏" onLedgerChanged={vi.fn()}
    /></tr></tbody></table>);
    expect(screen.getByRole('button', { name: '持仓状态异常 平安银行' })).toBeDisabled();
  });
});
```

Add a third test that renders `quote={{ ...quote, price: 0 }}`, clicks the cell button, and expects `当前没有有效实时价格，请先刷新行情` without opening the dialog.

- [ ] **Step 2: Run the cell test and verify RED**

Run:

```powershell
npm test -- --run src/features/securities/WatchlistPositionCell.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `WatchlistPositionCell`**

Use this component structure:

```tsx
import { useState } from 'react';
import type { StockQuote } from '../../infrastructure/market-data/stock-api';
import type { BacktestSignalAlert } from './backtest-signal-inbox-store';
import {
  buyStockPosition,
  findStockPosition,
  type StockPositionLedger,
} from './stock-position-ledger';
import { StockTradeConfirmDialog, type StockTradeConfirmation } from './StockTradeConfirmDialog';

export interface WatchlistPositionCellProps {
  quote: StockQuote;
  ledger: StockPositionLedger;
  ledgerError: string;
  onLedgerChanged(): void;
}

function createManualAlert(quote: StockQuote): BacktestSignalAlert {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `manual-watchlist-${quote.code}-${suffix}`,
    code: quote.code,
    name: quote.name,
    price: quote.price,
    action: 'buy',
    reasons: ['用户从自选股确认买入'],
    signalAt: new Date().toISOString(),
    status: 'pending', readAt: null, executedAt: null,
    entryPrice: quote.price, stopLoss: quote.price,
    metrics: {
      totalTrades: 0, winRate: 0, sharpeRatio: 0,
      maxDrawdown: 0, annualReturn: 0, profitFactor: 0,
    },
  };
}
```

Inside the component:

- Derive `position = findStockPosition(ledger, quote.code)`.
- Render `持仓状态异常`, `已加入持仓`, or `加入持仓` in that order.
- In every `<td>` and button click, call `event.stopPropagation()`.
- On an invalid `quote.price`, set the exact error `当前没有有效实时价格，请先刷新行情`.
- Create the manual alert only when opening the dialog so one confirmation uses one stable source ID.
- Resolve the selected group exactly as `SignalInbox` does:

```ts
const groupId = input.groupId === '__new__' ? `group-${Date.now()}` : input.groupId;
const groupName = input.groupId === '__new__'
  ? input.newGroupName
  : ledger.groups.find(group => group.id === groupId)?.name ?? '默认持仓';
```

- Call `buyStockPosition` with `sourceAlertId: manualAlert.id` and `tradedAt: new Date().toISOString()`.
- On success, call `onLedgerChanged()` and close the dialog.
- On error, keep the dialog open and pass the message as `externalError`.
- Use `submitting` to prevent a second click while the write is in progress.

- [ ] **Step 4: Run cell, dialog, and ledger tests**

Run:

```powershell
npm test -- --run src/features/securities/WatchlistPositionCell.test.tsx src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/stock-position-ledger.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- app/src/features/securities/WatchlistPositionCell.tsx app/src/features/securities/WatchlistPositionCell.test.tsx
git commit -m "feat: add watchlist position entry cell"
```

---

### Task 4: Integrate the Position Cell into the Watchlist Table

**Files:**
- Modify: `app/src/features/securities/WatchlistPage.tsx:1-20,55-80,539-596`
- Modify: `app/src/features/securities/WatchlistPage.test.tsx`

**Interfaces:**
- Consumes: `useStockPositionLedger()` from Task 1.
- Consumes: `<WatchlistPositionCell quote ledger ledgerError onLedgerChanged />` from Task 3.
- Produces: watchlist table column `持仓操作` and immediate page-level position-state synchronization.

- [ ] **Step 1: Write failing watchlist integration tests**

Add imports for `STOCK_POSITION_LEDGER_KEY` and add these tests to `WatchlistPage.test.tsx`:

```tsx
it('buys from the watchlist without navigating and then shows the held state', async () => {
  const user = userEvent.setup();
  renderWatchlist();

  await user.click(await screen.findByRole('button', { name: '加入持仓 平安银行' }));
  expect(screen.getByTestId('location')).toHaveTextContent('/projects/default/securities/watchlist');
  expect(screen.getByLabelText('交易股数')).toHaveValue(100);
  expect(screen.getByLabelText('成交价格')).toHaveValue(12);
  await user.click(screen.getByRole('button', { name: '确认买入' }));

  expect(await screen.findByRole('button', { name: '已加入持仓 平安银行' })).toBeDisabled();
  expect(screen.getByTestId('location')).toHaveTextContent('/projects/default/securities/watchlist');
});

it('restores the add button after the position is fully removed from the ledger', async () => {
  localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify({
    version: 1,
    groups: [{ id: 'default', name: '默认持仓' }],
    positions: [{
      id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
      shares: 100, averageCost: 12, totalCost: 1_200,
      openedAt: '2026-08-05T01:30:00.000Z', updatedAt: '2026-08-05T01:30:00.000Z',
      sourceAlertIds: ['manual-1'],
    }],
    transactions: [],
  }));
  renderWatchlist();
  expect(await screen.findByRole('button', { name: '已加入持仓 平安银行' })).toBeDisabled();

  localStorage.setItem(STOCK_POSITION_LEDGER_KEY, JSON.stringify({
    version: 1, groups: [{ id: 'default', name: '默认持仓' }],
    positions: [], transactions: [],
  }));
  window.dispatchEvent(new Event('sec-stock-position-ledger-changed'));
  expect(await screen.findByRole('button', { name: '加入持仓 平安银行' })).toBeEnabled();
});
```

Update existing expanded-row assertions to expect `colspan="11"` when labels are present and `colspan="10"` without labels.

- [ ] **Step 2: Run the watchlist test and verify RED**

Run:

```powershell
npm test -- --run src/features/securities/WatchlistPage.test.tsx
```

Expected: FAIL because there is no position column or ledger Hook integration.

- [ ] **Step 3: Integrate the Hook and cell**

In `WatchlistPage.tsx`:

```ts
import { useStockPositionLedger } from './useStockPositionLedger';
import { WatchlistPositionCell } from './WatchlistPositionCell';
```

Inside `WatchlistPage`:

```ts
const positionLedger = useStockPositionLedger();
```

Add the header after `中线建议`:

```tsx
<th>持仓操作</th>
```

Add the cell after `WatchlistAdviceCell`:

```tsx
<WatchlistPositionCell
  quote={q}
  ledger={positionLedger.ledger}
  ledgerError={positionLedger.error}
  onLedgerChanged={positionLedger.reload}
/>
```

Increase both detail-row colspans by exactly one:

```tsx
colSpan={activeWl && activeWl.groups.length > 0 ? 11 : 10}
```

Do not change the `<tr onClick>` stock-analysis route.

- [ ] **Step 4: Run watchlist regressions and typecheck**

Run:

```powershell
npm test -- --run src/features/securities/WatchlistPage.test.tsx src/features/securities/WatchlistPositionCell.test.tsx src/features/securities/WatchlistShortTermAdviceCell.test.tsx
npm run typecheck
```

Expected: PASS; advice expansion and row navigation remain unchanged.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- app/src/features/securities/WatchlistPage.tsx app/src/features/securities/WatchlistPage.test.tsx
git commit -m "feat: add actual position actions to watchlist"
```

---

### Task 5: Make Manual Watchlist Buys Immediately Enter Sell Monitoring

**Files:**
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.ts:6-14,47-53,68-75,195-198`
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`

**Interfaces:**
- Consumes: `useStockPositionLedger()` from Task 1.
- Keeps `UseRealtimeBacktestMonitorResult.reloadLedger(): void` unchanged for `SignalInbox`.
- Continues to pass actual positions to `processSnapshot({ positions })`.

- [ ] **Step 1: Write the failing ledger-change monitoring test**

Refactor the test mock so `useStockPositionLedger` returns a mutable result:

```ts
const mocks = vi.hoisted(() => ({
  // existing fields...
  ledgerHook: {} as any,
  useStockPositionLedger: vi.fn(),
}));

vi.mock('./useStockPositionLedger', () => ({
  useStockPositionLedger: mocks.useStockPositionLedger,
}));
```

In `beforeEach`, reset the shared result and connect the mock:

```ts
mocks.ledgerHook = {
  ledger: { version: 1, groups: [], positions: [], transactions: [] },
  error: '',
  reload: vi.fn(),
};
mocks.useStockPositionLedger.mockImplementation(() => mocks.ledgerHook);
```


Add:

```tsx
it('passes a manually added watchlist position into sell-signal processing', async () => {
  mocks.ledgerHook.ledger = {
    version: 1, groups: [{ id: 'default', name: '默认持仓' }],
    positions: [{
      id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
      shares: 100, averageCost: 10.8, totalCost: 1_080,
      openedAt: '2026-08-05T01:30:00.000Z', updatedAt: '2026-08-05T01:30:00.000Z',
      sourceAlertIds: ['manual-watchlist-000001-1'],
    }],
    transactions: [],
  };
  renderHook(() => useRealtimeBacktestMonitor());

  await waitFor(() => expect(mocks.processSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({
      positions: [expect.objectContaining({
        code: '000001', averageCost: 10.8,
        openedAt: '2026-08-05T01:30:00.000Z',
      })],
    }),
  ));
});
```

Change the existing `reloadLedger` assertion to expect `mocks.ledgerHook.reload`.

- [ ] **Step 2: Run the monitor Hook test and verify RED**

Run:

```powershell
npm test -- --run src/features/securities/useRealtimeBacktestMonitor.test.tsx
```

Expected: FAIL because the monitor still owns a separate ledger state and ignores the shared Hook.

- [ ] **Step 3: Replace the private ledger state with the shared Hook**

In `useRealtimeBacktestMonitor.ts`:

- Remove the `loadStockLedger` import and local `loadLedgerSafely` function.
- Remove `const [ledger, setLedger] = useState(...)`.
- Add:

```ts
import { useStockPositionLedger } from './useStockPositionLedger';

const positionLedger = useStockPositionLedger();
const ledger = positionLedger.ledger;
```

- Keep the public method but delegate it:

```ts
const reloadLedger = useCallback(() => {
  positionLedger.reload();
  setUniverse(loadUniverseSafely());
}, [positionLedger.reload]);
```

The existing `positionKey` and `processSnapshot` effect must continue deriving from `ledger.positions`. A same-tab buy event updates the Hook, changes `positionKey`, and triggers signal processing without waiting for a page reload.

- [ ] **Step 4: Run monitor, state-machine, universe, and inbox tests**

Run:

```powershell
npm test -- --run src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/realtime-backtest-monitor.test.ts src/features/securities/backtest-signal-inbox-store.test.ts src/features/securities/stock-monitoring-universe.test.ts src/features/securities/SignalInbox.test.tsx
npm run typecheck
```

Expected: PASS. These suites prove held stocks remain monitored, sell edges are deduplicated, and inbox execution still supports partial/full sells.

- [ ] **Step 5: Commit Task 5**

```powershell
git add -- app/src/features/securities/useRealtimeBacktestMonitor.ts app/src/features/securities/useRealtimeBacktestMonitor.test.tsx
git commit -m "feat: monitor manual watchlist positions for sell signals"
```

---

### Task 6: Final Regression, Build, and Manual Browser Verification

**Files:**
- Verify only; do not modify `app/src/features/securities/StockAnalysisPage.tsx`.

**Interfaces:**
- Consumes all Task 1-5 deliverables.
- Produces a verified end-to-end flow from watchlist buy confirmation to held state and sell-alert monitoring.

- [ ] **Step 1: Run the focused feature suite**

```powershell
npm test -- --run src/features/securities/stock-position-ledger.test.ts src/features/securities/useStockPositionLedger.test.tsx src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/WatchlistPositionCell.test.tsx src/features/securities/WatchlistPage.test.tsx src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/realtime-backtest-monitor.test.ts src/features/securities/backtest-signal-inbox-store.test.ts src/features/securities/stock-monitoring-universe.test.ts src/features/securities/SignalInbox.test.tsx src/features/securities/WatchlistShortTermAdviceCell.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run quality gates**

```powershell
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: typecheck and build exit 0; lint introduces no new warning in changed files; `git diff --check` exits 0.

- [ ] **Step 3: Confirm the protected page was not modified**

```powershell
git diff --name-only | Select-String -Pattern 'StockAnalysisPage.tsx'
```

Expected: no output.

- [ ] **Step 4: Verify the live watchlist flow in the browser**

Open `http://localhost:5173/projects/default/securities/watchlist` and verify:

1. Every row has a `持仓操作` column.
2. An unheld stock shows `加入持仓`.
3. Clicking it does not change the URL.
4. The dialog defaults to 100 shares, the visible latest price, and `默认持仓`.
5. Confirming changes the row to disabled `已加入持仓`.
6. Reloading the page preserves `已加入持仓`.
7. The inbox monitor includes that stock as a held code.
8. A test sell edge creates one unread sell message; repeated snapshots with the same sell state create no duplicate.
9. Confirming a full sell restores `加入持仓`.
10. Clicking the stock name still opens the existing stock-analysis page with overview and K-line intact.

- [ ] **Step 5: Commit any test-only corrections, then report known unrelated failures separately**

If verification required no correction, do not create an empty commit. If a test-only correction was required, stage only that test file and commit with:

```powershell
git commit -m "test: verify watchlist position and sell alert flow"
```

When reporting completion, distinguish focused feature results from existing unrelated full-suite failures in dashboard and stock-directory tests. Do not change those unrelated modules as part of this plan.
