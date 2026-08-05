# A 股 T+1 可用持仓 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在实际持仓、账本卖出校验和实时信号收件箱中区分全部持仓与 T+1 可用持仓，阻止当天买入股份被卖出。

**Architecture:** 保持 `StockPosition.shares` 和 `sec_stock_position_ledger_v1` 不变，通过交易流水和独立的 A 股交易日历动态计算 `availableShares`。账本是最终卖出校验边界；实际持仓、全局监控和收件箱只消费同一个纯计算结果，避免不同页面产生不一致的可卖数量。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、浏览器 `localStorage`、现有实际持仓账本和全局实时回测监控。

## Global Constraints

- 不使用子代理；用户要求内联执行。
- 不修改 `app/src/features/securities/StockAnalysisPage.tsx` 及其概览、实时行情和 K 线路径。
- 保留 `sec_stock_position_ledger_v1`，不升级或替换实际持仓存储键。
- 保留 `sec_bt_signal_inbox_v2`，旧消息必须兼容读取。
- 所有交易日期按 `Asia/Shanghai` 计算。
- 周末和沪深交易所法定休市日不算下一交易日。
- 旧持仓缺少完整交易流水时，无法解释的存量股份默认可用。
- 持仓表格列标题使用“全部 / 可用”，单元格只上下显示两个数字，不重复中文标签。
- 卖出按钮、卖出弹窗、实时卖出建议和账本写入均不得超过当前可用持仓。
- 可用持仓为 0 时，不创建不可执行的卖出消息。
- 账本保存成功后才能标记收件箱消息已执行。

---

## File Structure

- Create `app/src/features/securities/a-share-trading-calendar.ts`: 上海日期转换、支持年份、休市日和下一交易日计算。
- Create `app/src/features/securities/a-share-trading-calendar.test.ts`: 周末、春节/国庆休市、跨年和覆盖范围测试。
- Create `app/src/features/securities/stock-position-availability.ts`: 从账本动态计算全部、可用、冻结和下一可卖日期。
- Create `app/src/features/securities/stock-position-availability.test.ts`: 首次买入、补仓、同日卖出、分批解锁和旧持仓兼容测试。
- Modify `app/src/features/securities/stock-position-ledger.ts`: 在最终持久化前执行 T+1 可用数量校验。
- Modify `app/src/features/securities/stock-position-ledger.test.ts`: 拒绝当日卖出和允许下一交易日卖出。
- Modify `app/src/features/securities/StockTradeConfirmDialog.tsx`: 支持独立的最大可卖数量。
- Modify `app/src/features/securities/StockTradeConfirmDialog.test.tsx`: 默认数量和上限使用可用持仓。
- Modify `app/src/features/securities/ActualPositionsPanel.tsx`: “全部 / 可用”上下数字展示，卖出按钮按可用数量禁用。
- Modify `app/src/features/securities/ActualPositionsPanel.test.tsx`: UI、当日补仓冻结和卖出按钮测试。
- Modify `app/src/features/securities/signal-trade-recommendation.ts`: 可执行卖出数量基于 `availableShares`。
- Modify `app/src/features/securities/signal-trade-recommendation.test.ts`: 可用为 0、部分卖出和退出数量测试。
- Modify `app/src/features/securities/realtime-backtest-monitor.ts`: 在监控事件中传递全部与可用数量。
- Modify `app/src/features/securities/realtime-backtest-monitor.test.ts`: 双数量事件测试。
- Modify `app/src/features/securities/backtest-signal-inbox-store.ts`: 固化 `availableSharesAtSignal` 并按可执行卖出边沿去重。
- Modify `app/src/features/securities/backtest-signal-inbox-store.test.ts`: 旧消息迁移、零可用解锁后重新触发测试。
- Modify `app/src/features/securities/useRealtimeBacktestMonitor.ts`: 从账本计算每只持仓的可用数量并传给监控器。
- Modify `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`: 监控持仓 payload 测试。
- Modify `app/src/features/securities/SignalInbox.tsx`: 执行前按当前可用数量重新限额。
- Modify `app/src/features/securities/SignalInbox.test.tsx`: 历史建议下调、可用为 0 和冻结剩余持仓测试。

---

### Task 1: Add the A-share Trading Calendar

**Files:**
- Create: `app/src/features/securities/a-share-trading-calendar.ts`
- Create: `app/src/features/securities/a-share-trading-calendar.test.ts`

**Interfaces:**
- Produces:

```ts
export class UnsupportedTradingCalendarYearError extends Error {}
export const A_SHARE_CALENDAR_COVERAGE: { firstYear: 2025; lastYear: 2026 };
export function shanghaiDateKey(value: Date | string): string;
export function isAStockTradingDay(date: string): boolean;
export function nextAStockTradingDay(date: string): string;
```

- [ ] **Step 1: Write failing calendar tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  isAStockTradingDay,
  nextAStockTradingDay,
  shanghaiDateKey,
} from './a-share-trading-calendar';

describe('A-share trading calendar', () => {
  it.each([
    ['2026-08-05', true],
    ['2026-08-08', false],
    ['2026-10-01', false],
    ['2026-10-08', true],
  ])('classifies %s as trading=%s', (date, expected) => {
    expect(isAStockTradingDay(date)).toBe(expected);
  });

  it('moves Friday purchases to the next Monday', () => {
    expect(nextAStockTradingDay('2026-08-07')).toBe('2026-08-10');
  });

  it('moves a pre-National-Day purchase to the first post-holiday session', () => {
    expect(nextAStockTradingDay('2026-09-30')).toBe('2026-10-08');
  });

  it('uses the Shanghai date at the UTC day boundary', () => {
    expect(shanghaiDateKey('2026-08-04T16:30:00.000Z')).toBe('2026-08-05');
  });

  it('fails closed outside the supported calendar coverage', () => {
    expect(() => isAStockTradingDay('2031-01-02'))
      .toThrow('A股交易日历暂不支持2031年');
  });
});
```

- [ ] **Step 2: Run the calendar test and verify RED**

Run:

```powershell
npm test -- --run src/features/securities/a-share-trading-calendar.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the calendar module**

Use explicit supported years and an exchange-closure set. The initial implementation must cover 2025 and 2026 because current ledger fixtures cross those years.

```ts
export const A_SHARE_CALENDAR_COVERAGE = { firstYear: 2025, lastYear: 2026 } as const;
const SUPPORTED_YEARS = new Set([2025, 2026]);

const MARKET_CLOSURES = new Set([
  '2025-01-01',
  '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31',
  '2025-02-03', '2025-02-04',
  '2025-04-04',
  '2025-05-01', '2025-05-02', '2025-05-05',
  '2025-06-02',
  '2025-10-01', '2025-10-02', '2025-10-03',
  '2025-10-06', '2025-10-07', '2025-10-08',
  '2026-01-01', '2026-01-02',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-23',
  '2026-04-06',
  '2026-05-01', '2026-05-04', '2026-05-05',
  '2026-06-19',
  '2026-09-25',
  '2026-10-01', '2026-10-02', '2026-10-05',
  '2026-10-06', '2026-10-07',
]);
```

Validate `YYYY-MM-DD`, reject unsupported years, treat Saturday/Sunday and `MARKET_CLOSURES` as closed, and iterate calendar days in `nextAStockTradingDay` until a trading day is found.

- [ ] **Step 4: Run calendar tests and typecheck**

```powershell
npm test -- --run src/features/securities/a-share-trading-calendar.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- app/src/features/securities/a-share-trading-calendar.ts app/src/features/securities/a-share-trading-calendar.test.ts
git commit -m "feat: add A-share trading calendar"
```

---

### Task 2: Calculate Dynamic Available Shares

**Files:**
- Create: `app/src/features/securities/stock-position-availability.ts`
- Create: `app/src/features/securities/stock-position-availability.test.ts`

**Interfaces:**
- Consumes: type-only `StockPositionLedger` and Task 1 calendar functions. It must not import `findStockPosition`, avoiding a runtime cycle when the ledger imports this calculator in Task 3.
- Produces:

```ts
export interface StockPositionAvailability {
  totalShares: number;
  availableShares: number;
  frozenShares: number;
  nextAvailableDate: string | null;
}

export function calculateStockPositionAvailability(
  ledger: StockPositionLedger,
  code: string,
  asOf: Date | string,
): StockPositionAvailability;
```

- [ ] **Step 1: Write failing availability tests**

Build ledger fixtures directly so the pure function is independent from storage. Use these cases:

```ts
it('freezes a same-day first buy', () => {
  expect(calculateStockPositionAvailability(
    ledger({ shares: 100, buys: [['2026-08-05T01:30:00.000Z', 100]] }),
    '000001', '2026-08-05T06:00:00.000Z',
  )).toEqual({
    totalShares: 100, availableShares: 0, frozenShares: 100,
    nextAvailableDate: '2026-08-06',
  });
});

it('unlocks the buy on the next trading day', () => {
  expect(calculateStockPositionAvailability(
    ledger({ shares: 100, buys: [['2026-08-05T01:30:00.000Z', 100]] }),
    '000001', '2026-08-06T01:30:00.000Z',
  ).availableShares).toBe(100);
});

it('keeps historical baseline shares available while freezing a same-day add', () => {
  expect(calculateStockPositionAvailability(
    ledger({ shares: 500, buys: [['2026-08-05T01:30:00.000Z', 200]] }),
    '000001', '2026-08-05T06:00:00.000Z',
  )).toMatchObject({ totalShares: 500, availableShares: 300, frozenShares: 200 });
});

it('reduces available shares after a same-day sale without unlocking the add', () => {
  expect(calculateStockPositionAvailability(
    ledger({
      shares: 400,
      buys: [['2026-08-05T01:30:00.000Z', 200]],
      sells: [['2026-08-05T03:00:00.000Z', 100]],
    }),
    '000001', '2026-08-05T06:00:00.000Z',
  )).toMatchObject({ totalShares: 400, availableShares: 200, frozenShares: 200 });
});
```

Add these exact cases:

```ts
it('keeps a pre-holiday buy frozen until the first post-holiday session', () => {
  const input = ledger({ shares: 100, buys: [['2026-09-30T01:30:00.000Z', 100]] });
  expect(calculateStockPositionAvailability(input, '000001', '2026-10-07T06:00:00.000Z'))
    .toMatchObject({ availableShares: 0, nextAvailableDate: '2026-10-08' });
  expect(calculateStockPositionAvailability(input, '000001', '2026-10-08T01:30:00.000Z'))
    .toMatchObject({ availableShares: 100, frozenShares: 0 });
});

it('treats an unexplained historical position as fully available', () => {
  expect(calculateStockPositionAvailability(
    ledger({ shares: 500, buys: [] }), '000001', '2026-08-05T06:00:00.000Z',
  )).toEqual({
    totalShares: 500, availableShares: 500, frozenShares: 0, nextAvailableDate: null,
  });
});
```

- [ ] **Step 2: Run the availability test and verify RED**

```powershell
npm test -- --run src/features/securities/stock-position-availability.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure calculator**

Implementation outline:

```ts
const position = ledger.positions.find(item => item.code === code) ?? null;
if (!position) return { totalShares: 0, availableShares: 0, frozenShares: 0, nextAvailableDate: null };

const asOfDate = shanghaiDateKey(asOf);
const lockedBuys = ledger.transactions
  .filter(transaction => transaction.code === code && transaction.type === 'buy')
  .map(transaction => ({
    shares: transaction.shares,
    availableOn: nextAStockTradingDay(shanghaiDateKey(transaction.tradedAt)),
  }))
  .filter(batch => batch.availableOn > asOfDate);

const frozenShares = Math.min(
  position.shares,
  lockedBuys.reduce((sum, batch) => sum + batch.shares, 0),
);
return {
  totalShares: position.shares,
  availableShares: position.shares - frozenShares,
  frozenShares,
  nextAvailableDate: lockedBuys.map(batch => batch.availableOn).sort()[0] ?? null,
};
```

Validate the `asOfDate` year first. A buy whose year is earlier than `A_SHARE_CALENDAR_COVERAGE.firstYear` is an unlocked historical transaction; otherwise call `nextAStockTradingDay`. A current or future date outside coverage throws, preserving fail-closed selling while keeping pre-2025 holdings usable.

- [ ] **Step 4: Run availability and calendar tests**

```powershell
npm test -- --run src/features/securities/stock-position-availability.test.ts src/features/securities/a-share-trading-calendar.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- app/src/features/securities/stock-position-availability.ts app/src/features/securities/stock-position-availability.test.ts
git commit -m "feat: calculate T+1 available stock shares"
```

---

### Task 3: Enforce T+1 at the Ledger Boundary

**Files:**
- Modify: `app/src/features/securities/stock-position-ledger.ts`
- Modify: `app/src/features/securities/stock-position-ledger.test.ts`

**Interfaces:**
- Consumes: `calculateStockPositionAvailability` from Task 2.
- Keeps public `SellStockPositionInput` unchanged and uses `input.tradedAt` as the availability timestamp.

- [ ] **Step 1: Add failing ledger tests**

Add three tests:

```ts
it('rejects selling shares bought on the same trading day', () => {
  const dependencies = options();
  buyStockPosition({
    code: '000001', name: '平安银行', shares: 100, price: 10,
    groupId: 'default', groupName: '默认持仓', sourceAlertId: 'buy-today',
    tradedAt: '2026-08-05T01:30:00.000Z',
  }, dependencies);

  expect(() => sellStockPosition({
    code: '000001', shares: 100, price: 10.5,
    sourceAlertId: 'sell-today', tradedAt: '2026-08-05T06:00:00.000Z',
  }, dependencies)).toThrow('卖出数量不能超过可用持仓');
});

it('allows selling the shares on the next trading day', () => {
  const dependencies = options();
  buyStockPosition({
    code: '000001', name: '平安银行', shares: 100, price: 10,
    groupId: 'default', groupName: '默认持仓', sourceAlertId: 'buy-day-1',
    tradedAt: '2026-08-05T01:30:00.000Z',
  }, dependencies);
  const result = sellStockPosition({
    code: '000001', shares: 100, price: 10.5,
    sourceAlertId: 'sell-day-2', tradedAt: '2026-08-06T01:30:00.000Z',
  }, dependencies);
  expect(result.position).toBeNull();
});

it('allows selling only the historical portion after a same-day add', () => {
  const seeded = JSON.stringify({
    version: 1,
    groups: [{ id: 'default', name: '默认持仓' }],
    positions: [{
      id: 'position-old', groupId: 'default', code: '000001', name: '平安银行',
      shares: 300, averageCost: 9, totalCost: 2700,
      openedAt: '2025-01-02T01:30:00.000Z', updatedAt: '2025-01-02T01:30:00.000Z',
      sourceAlertIds: [],
    }],
    transactions: [],
  });
  const dependencies = options(memoryStorage(seeded));
  buyStockPosition({
    code: '000001', name: '平安银行', shares: 200, price: 10,
    groupId: 'default', groupName: '默认持仓', sourceAlertId: 'buy-add',
    tradedAt: '2026-08-05T01:30:00.000Z',
  }, dependencies);
  expect(() => sellStockPosition({
    code: '000001', shares: 400, price: 10.5,
    sourceAlertId: 'sell-too-much', tradedAt: '2026-08-05T06:00:00.000Z',
  }, dependencies)).toThrow('卖出数量不能超过可用持仓');
  const result = sellStockPosition({
    code: '000001', shares: 300, price: 10.5,
    sourceAlertId: 'sell-available', tradedAt: '2026-08-05T06:00:00.000Z',
  }, dependencies);
  expect(result.position?.shares).toBe(200);
});
```

- [ ] **Step 2: Run the ledger test and verify RED**

```powershell
npm test -- --run src/features/securities/stock-position-ledger.test.ts
```

Expected: the same-day sale succeeds incorrectly.

- [ ] **Step 3: Add the final availability validation**

Immediately after loading the current ledger and finding the position in `sellStockPosition`:

```ts
const availability = calculateStockPositionAvailability(
  current,
  input.code,
  input.tradedAt,
);
if (input.shares > availability.availableShares) {
  throw new Error('卖出数量不能超过可用持仓');
}
```

Keep the existing total-position, lot-size, repeated-alert and persistence ordering checks.

- [ ] **Step 4: Run ledger and availability tests**

```powershell
npm test -- --run src/features/securities/stock-position-ledger.test.ts src/features/securities/stock-position-availability.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- app/src/features/securities/stock-position-ledger.ts app/src/features/securities/stock-position-ledger.test.ts
git commit -m "feat: enforce A-share T+1 sales in ledger"
```

---

### Task 4: Show Total and Available Shares in Actual Positions

**Files:**
- Modify: `app/src/features/securities/StockTradeConfirmDialog.tsx`
- Modify: `app/src/features/securities/StockTradeConfirmDialog.test.tsx`
- Modify: `app/src/features/securities/ActualPositionsPanel.tsx`
- Modify: `app/src/features/securities/ActualPositionsPanel.test.tsx`

**Interfaces:**
- Extends `StockTradeConfirmDialogProps`:

```ts
maxSellShares?: number;
```

- Consumes `calculateStockPositionAvailability` for each actual position.

- [ ] **Step 1: Write failing dialog tests**

```tsx
it('uses an independent available-share limit for a sale', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  render(<StockTradeConfirmDialog
    alert={alert('sell', { intent: 'exit', suggestedShares: 500 })}
    position={position({ shares: 500 })}
    maxSellShares={300}
    groups={[]}
    onConfirm={onConfirm}
    onCancel={vi.fn()}
  />);
  expect(screen.getByLabelText('交易股数')).toHaveValue(300);
  await user.clear(screen.getByLabelText('交易股数'));
  await user.type(screen.getByLabelText('交易股数'), '400');
  await user.click(screen.getByRole('button', { name: '确认全部卖出' }));
  expect(screen.getByRole('alert')).toHaveTextContent('卖出数量不能超过可用持仓');
});
```

- [ ] **Step 2: Write failing actual-position UI tests**

Freeze system time with `vi.setSystemTime('2026-08-05T06:00:00.000Z')`. Seed a 500-share position containing a same-day 200-share buy, then assert:

```tsx
expect(screen.getByRole('columnheader', { name: '全部 / 可用' })).toBeInTheDocument();
const shareCell = screen.getByRole('cell', { name: '500 300' });
expect(within(shareCell).getAllByText(/500|300/)).toHaveLength(2);
```

Add the exact UI assertions:

```tsx
expect(screen.getByRole('button', { name: '卖出 平安银行' })).toBeDisabled();
expect(screen.getByRole('cell', { name: '500 500' })).toBeInTheDocument();
```

Use separate renders: the first seeds a same-day 500-share buy; the second seeds a 500-share historical position without transactions.

- [ ] **Step 3: Run dialog and panel tests and verify RED**

```powershell
npm test -- --run src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/ActualPositionsPanel.test.tsx
```

Expected: missing prop behavior, old “股数” header, and enabled zero-available sell button.

- [ ] **Step 4: Implement the dialog maximum**

```ts
const sellLimit = maxSellShares ?? position?.shares ?? 0;
const [shares, setShares] = useState(
  isBuy ? alert.suggestedShares : Math.min(alert.suggestedShares, sellLimit),
);
```

Validate sell input against `sellLimit` and use the exact error copy `卖出数量不能超过可用持仓`.

- [ ] **Step 5: Implement the panel display and sell behavior**

Extend each memoized row with availability calculated at `new Date()`.

Render:

```tsx
<th>全部 / 可用</th>
...
<td aria-label={`${availability.totalShares} ${availability.availableShares}`}>
  <div>{availability.totalShares}</div>
  <div style={{ color: 'var(--sec-text-muted, #94a3b8)', marginTop: 2 }}>
    {availability.availableShares}
  </div>
</td>
```

Create manual sell alerts with `suggestedShares: availability.availableShares`, pass `maxSellShares`, and disable the sell button when `availability.availableShares < 100`.

- [ ] **Step 6: Run UI and ledger regressions**

```powershell
npm test -- --run src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/ActualPositionsPanel.test.tsx src/features/securities/stock-position-ledger.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- app/src/features/securities/StockTradeConfirmDialog.tsx app/src/features/securities/StockTradeConfirmDialog.test.tsx app/src/features/securities/ActualPositionsPanel.tsx app/src/features/securities/ActualPositionsPanel.test.tsx
git commit -m "feat: show total and available stock shares"
```

---

### Task 5: Make Realtime Sell Signals Executable under T+1

**Files:**
- Modify: `app/src/features/securities/signal-trade-recommendation.ts`
- Modify: `app/src/features/securities/signal-trade-recommendation.test.ts`
- Modify: `app/src/features/securities/realtime-backtest-monitor.ts`
- Modify: `app/src/features/securities/realtime-backtest-monitor.test.ts`
- Modify: `app/src/features/securities/backtest-signal-inbox-store.ts`
- Modify: `app/src/features/securities/backtest-signal-inbox-store.test.ts`
- Modify: `app/src/features/securities/ActualPositionsPanel.tsx`
- Modify: `app/src/features/securities/WatchlistPositionCell.tsx`
- Modify: `app/src/features/securities/StockTradeConfirmDialog.test.tsx`
- Modify: `app/src/features/securities/SignalInbox.test.tsx`

**Interfaces:**
- Extends `SelectSignalTradeInput`, `MonitorPosition`, and `BacktestDecisionEvent` with:

```ts
availableShares: number;
```

- Extends `BacktestSignalAlert` with:

```ts
availableSharesAtSignal: number;
```

- [ ] **Step 1: Write failing recommendation tests**

```ts
it('does not recommend a sale when no shares are available', () => {
  expect(selectSignalTrade({
    isBuyCandidate: false, isHeld: true,
    positionShares: 500, availableShares: 0,
    buyDecision: { action: 'hold', reasons: [] },
    sellDecision: { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' },
  })).toBeNull();
});

it('caps an exit at all available shares', () => {
  expect(selectSignalTrade({
    isBuyCandidate: false, isHeld: true,
    positionShares: 500, availableShares: 300,
    buyDecision: { action: 'hold', reasons: [] },
    sellDecision: { action: 'sell', reasons: ['止损'], exitReason: 'stop_loss' },
  })).toMatchObject({ intent: 'exit', suggestedShares: 300 });
});
```

Update technical reduction tests so the 25% calculation receives `availableShares`.

- [ ] **Step 2: Write failing monitor and store tests**

For a held 500-share position with 300 available, assert the monitor event contains both values. In the store, assert the alert freezes:

```ts
expect(createdAlert).toMatchObject({
  positionSharesAtSignal: 500,
  availableSharesAtSignal: 300,
  suggestedShares: 300,
});
```

Add the critical edge test:

1. sell decision with `availableShares: 0` creates no alert;
2. the next snapshot keeps the same raw sell decision but changes `availableShares` to 300;
3. one sell alert is created.

This requires directional state to track executable recommendations rather than the raw sell decision.

- [ ] **Step 3: Run recommendation, monitor, and store tests and verify RED**

```powershell
npm test -- --run src/features/securities/signal-trade-recommendation.test.ts src/features/securities/realtime-backtest-monitor.test.ts src/features/securities/backtest-signal-inbox-store.test.ts
```

Expected: missing `availableShares`, incorrect sell sizing, and zero-available edge suppression failure.

- [ ] **Step 4: Implement available-share recommendation sizing**

For a sell recommendation:

```ts
const executableShares = Math.floor(input.availableShares / 100) * 100;
if (executableShares < 100) return null;
const suggestedShares = exit
  ? executableShares
  : calculateTechnicalSellShares(executableShares);
```

Keep buy/open/add behavior unchanged.

- [ ] **Step 5: Pass both quantities through monitor events**

`MonitorPosition` must carry `shares` and `availableShares`. Emit:

```ts
positionShares: position?.shares ?? 0,
availableShares: position?.availableShares ?? 0,
```

- [ ] **Step 6: Persist compatible alert data and executable edges**

Update manual alert creators and typed test fixtures in `ActualPositionsPanel.tsx`, `WatchlistPositionCell.tsx`, `StockTradeConfirmDialog.test.tsx`, and `SignalInbox.test.tsx` with the appropriate `availableSharesAtSignal` value. Buy/open fixtures use `0`; held-position fixtures use the calculated or fixture-available quantity.

Legacy alert normalization:

```ts
availableSharesAtSignal: Number.isInteger(alert.availableSharesAtSignal)
  ? alert.availableSharesAtSignal
  : alert.positionSharesAtSignal ?? 0,
```

When updating stock state, derive the sell direction from the recommendation:

```ts
const sellDirection = recommendation?.action === 'sell' ? 'sell' : 'hold';
```

This keeps a zero-available sell signal rearmed so it can notify immediately after shares unlock while the raw strategy remains on sell.

- [ ] **Step 7: Run signal tests and typecheck**

```powershell
npm test -- --run src/features/securities/signal-trade-recommendation.test.ts src/features/securities/realtime-backtest-monitor.test.ts src/features/securities/backtest-signal-inbox-store.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```powershell
git add -- app/src/features/securities/signal-trade-recommendation.ts app/src/features/securities/signal-trade-recommendation.test.ts app/src/features/securities/realtime-backtest-monitor.ts app/src/features/securities/realtime-backtest-monitor.test.ts app/src/features/securities/backtest-signal-inbox-store.ts app/src/features/securities/backtest-signal-inbox-store.test.ts app/src/features/securities/ActualPositionsPanel.tsx app/src/features/securities/WatchlistPositionCell.tsx app/src/features/securities/StockTradeConfirmDialog.test.tsx app/src/features/securities/SignalInbox.test.tsx
git commit -m "feat: apply T+1 availability to sell signals"
```

---

### Task 6: Feed Availability into the Global Monitor and Inbox

**Files:**
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.ts`
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`
- Modify: `app/src/features/securities/SignalInbox.tsx`
- Modify: `app/src/features/securities/SignalInbox.test.tsx`

**Interfaces:**
- Consumes Task 2 availability calculator and Task 4 `maxSellShares` dialog prop.

- [ ] **Step 1: Write failing Hook payload tests**

Freeze system time on 2026-08-05 and provide a 500-share position with a same-day 200-share buy. Assert `processSnapshot` receives:

```ts
positions: [expect.objectContaining({
  code: '000001', shares: 500, availableShares: 300,
})],
```

Add `availableShares` to the position signature so a trading-day unlock causes a new snapshot even when total shares do not change.

- [ ] **Step 2: Write failing inbox transaction tests**

Add these three transaction-flow cases using the existing `setupMonitor`, `signalAlert`, `openInbox`, and `openTrade` helpers. Extend the test ledger helper with `transactions` and add a `buyTransaction` fixture factory.

```tsx
it('caps a historical sell suggestion to current available shares', async () => {
  const user = userEvent.setup();
  setupMonitor([signalAlert('reduce', { suggestedShares: 500 })]);
  mocks.loadStockLedger.mockReturnValue(ledger({
    shares: 500,
    transactions: [buyTransaction({ shares: 200, tradedAt: '2026-08-05T01:30:00.000Z' })],
  }));
  vi.setSystemTime('2026-08-05T06:00:00.000Z');
  renderInbox();
  await openInbox(user);
  await openTrade(user, '执行部分卖出 平安银行');
  expect(screen.getByLabelText('交易股数')).toHaveValue(300);
  expect(screen.getByText('当前可用持仓少于历史建议数量，已调整为最多可卖 300 股。'))
    .toBeInTheDocument();
});

it('disables a sell signal when current available shares are zero', async () => {
  const user = userEvent.setup();
  setupMonitor([signalAlert('exit', { suggestedShares: 100 })]);
  mocks.loadStockLedger.mockReturnValue(ledger({
    shares: 100,
    transactions: [buyTransaction({ shares: 100, tradedAt: '2026-08-05T01:30:00.000Z' })],
  }));
  vi.setSystemTime('2026-08-05T06:00:00.000Z');
  renderInbox();
  await openInbox(user);
  expect(screen.getByRole('button', { name: '执行全部卖出 平安银行' })).toBeDisabled();
});

it('marks a sell executed with a remaining frozen position', async () => {
  const user = userEvent.setup();
  setupMonitor([signalAlert('exit', { suggestedShares: 500 })]);
  mocks.loadStockLedger.mockReturnValue(ledger({
    shares: 500,
    transactions: [buyTransaction({ shares: 200, tradedAt: '2026-08-05T01:30:00.000Z' })],
  }));
  mocks.sellStockPosition.mockReturnValue({
    ledger: ledger({ shares: 200 }),
    position: ledger({ shares: 200 }).positions[0],
  });
  vi.setSystemTime('2026-08-05T06:00:00.000Z');
  renderInbox();
  await openInbox(user);
  await openTrade(user, '执行全部卖出 平安银行');
  await user.click(screen.getByRole('button', { name: '确认全部卖出' }));
  expect(mocks.sellStockPosition).toHaveBeenCalledWith(expect.objectContaining({ shares: 300 }));
  expect(mocks.monitor.markExecuted).toHaveBeenCalledWith('alert-exit', 'sold', true);
});
```

- [ ] **Step 3: Run Hook and inbox tests and verify RED**

```powershell
npm test -- --run src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/SignalInbox.test.tsx
```

Expected: monitor payload lacks availability and inbox caps against total shares.

- [ ] **Step 4: Calculate availability in the global Hook**

For each ledger position:

```ts
const availability = calculateStockPositionAvailability(ledger, position.code, realtime.lastUpdatedAt);
return {
  code: position.code,
  shares: position.shares,
  availableShares: availability.availableShares,
  averageCost: position.averageCost,
  openedAt: position.openedAt,
};
```

If the calendar is unavailable, set a monitor error and pass `availableShares: 0` so the system fails closed for selling.

- [ ] **Step 5: Revalidate current availability in SignalInbox**

When rendering and opening sell alerts, calculate current availability from the latest ledger. Replace the existing total-position cap with:

```ts
const maxSellable = Math.floor(availability.availableShares / 100) * 100;
const effectiveShares = Math.min(alert.suggestedShares, maxSellable);
```

Pass `maxSellShares={maxSellable}` to the dialog. Disable sell execution when `maxSellable < 100`. Keep `positionRemaining` based on the ledger result, so selling all currently available shares does not incorrectly remove frozen shares.

- [ ] **Step 6: Run Hook, inbox, ledger, and provider regressions**

```powershell
npm test -- --run src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/SignalInbox.test.tsx src/features/securities/stock-position-ledger.test.ts src/features/securities/RealtimeBacktestMonitorProvider.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```powershell
git add -- app/src/features/securities/useRealtimeBacktestMonitor.ts app/src/features/securities/useRealtimeBacktestMonitor.test.tsx app/src/features/securities/SignalInbox.tsx app/src/features/securities/SignalInbox.test.tsx
git commit -m "feat: enforce T+1 in global signal trading"
```

---

### Task 7: Final Regression, Build, and Browser Verification

**Files:**
- Verify only; do not modify `app/src/features/securities/StockAnalysisPage.tsx`.

- [ ] **Step 1: Run the focused T+1 and position suite**

```powershell
npm test -- --run src/features/securities/a-share-trading-calendar.test.ts src/features/securities/stock-position-availability.test.ts src/features/securities/stock-position-ledger.test.ts src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/ActualPositionsPanel.test.tsx src/features/securities/signal-trade-recommendation.test.ts src/features/securities/realtime-backtest-monitor.test.ts src/features/securities/backtest-signal-inbox-store.test.ts src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/SignalInbox.test.tsx src/features/securities/RealtimeBacktestMonitorProvider.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run adjacent securities regressions**

```powershell
npm test -- --run src/features/securities/useStockPositionLedger.test.tsx src/features/securities/WatchlistPage.test.tsx src/features/securities/WatchlistPositionCell.test.tsx src/features/securities/SecuritiesWorkbenchPage.test.tsx src/features/securities/PortfolioAllocationPage.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run protected stock-analysis tests**

```powershell
npm test -- --run src/features/securities/StockAnalysisPage.test.tsx src/features/securities/StockAnalysisRealtimeTargets.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run quality gates**

```powershell
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: typecheck, lint, build and diff check exit 0; existing unrelated warnings may remain, but changed files introduce no new lint warning.

- [ ] **Step 5: Confirm protected scope and storage keys**

```powershell
git diff --name-only a135108..HEAD | Select-String -Pattern 'StockAnalysisPage.tsx'
rg -n "sec_stock_position_ledger_v1|sec_bt_signal_inbox_v2" app/src/features/securities
```

Expected: `StockAnalysisPage.tsx` is absent and both existing storage keys remain unchanged.

- [ ] **Step 6: Verify the live flow in the browser**

Open `http://localhost:5173/projects/default/securities/portfolio` and verify:

1. the column heading reads `全部 / 可用`;
2. each holding cell displays only two vertically stacked numbers;
3. an existing fully available holding displays the same number twice;
4. after adding 100 shares, total increases by 100 while available remains unchanged;
5. the sell dialog defaults to available shares and rejects a larger number;
6. a zero-available holding has a disabled sell button;
7. after moving the test clock or fixture to the next trading day, the bought shares become available without a storage migration;
8. the signal inbox never suggests more shares than currently available;
9. selling all available shares while frozen shares remain keeps the position in the ledger;
10. the stock overview, realtime quote, suggested prices and K-line tabs still load;
11. the browser console contains no new error.

- [ ] **Step 7: Report completion**

Report commit IDs, focused and protected test counts, typecheck/lint/build status, browser verification, calendar coverage years, confirmation that both storage keys stayed unchanged, and confirmation that `StockAnalysisPage.tsx` was not modified. Do not create an empty commit.
