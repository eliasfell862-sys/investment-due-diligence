# 实时回测信号收件箱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网站打开期间，以现有 3 秒实时行情驱动全部自选股的回测买入提醒及实际持仓的卖出提醒，并允许用户从收件箱确认交易。

**Architecture:** 抽取回测与实时监听共用的纯策略决策函数；实时监听只首次加载历史 K 线，随后将共享行情 Store 的最新报价合并进当日临时 K 线。收件箱状态机、实际持仓账本和 UI 分层实现，信号刷新不触发评分、荐股、排序、持仓分配或个股分析重算。

**Tech Stack:** React 19、TypeScript 6、Vitest、Testing Library、现有实时行情 Store、浏览器 localStorage。

## Global Constraints

- 不使用子代理；实施时使用 `executing-plans` 在当前会话逐项执行。
- 不修改个股分析页面的信号计算、K 线加载、K 线展示或路由行为。
- 不新增第二套实时行情定时器；交易时段复用现有 3 秒共享行情 Store。
- 午休、收盘和周末暂停；恢复焦点由共享行情 Store 立即刷新。
- 行情更新不得重新计算评分、建议、排名、策略推荐或 AI 持仓分配。
- 所有生产代码必须先有预期失败的测试，再写最小实现。
- 不执行 `git add .`；每次只暂存本任务明确列出的文件。

## File Structure

- Create `app/src/engines/market-analysis/backtest-strategy.ts`: 回测和实时监听共用的单柱交易决策。
- Create `app/src/engines/market-analysis/backtest-strategy.test.ts`: 买入、卖出、止损、超时及持有规则测试。
- Modify `app/src/engines/market-analysis/backtest-engine.ts`: 改为调用统一策略内核。
- Modify `app/src/engines/market-analysis/backtest-engine.test.ts`: 证明回测结果保持兼容。
- Create `app/src/features/securities/stock-monitoring-universe.ts`: 合并全部自选股与实际持仓并去重。
- Create `app/src/features/securities/stock-monitoring-universe.test.ts`: 自选股、持仓和损坏存储测试。
- Create `app/src/features/securities/stock-position-ledger.ts`: 实际持仓、持仓组和交易记录的原子账本。
- Create `app/src/features/securities/stock-position-ledger.test.ts`: 买入、加仓、部分卖出、全部卖出和重复执行测试。
- Create `app/src/features/securities/backtest-signal-inbox-store.ts`: 收件箱消息及每只股票的信号状态机。
- Create `app/src/features/securities/backtest-signal-inbox-store.test.ts`: 信号边沿、去重、持仓约束和持久化测试。
- Create `app/src/features/securities/realtime-backtest-monitor.ts`: 历史 K 线缓存、实时柱合并及单次增量扫描。
- Create `app/src/features/securities/realtime-backtest-monitor.test.ts`: 增量计算、失败隔离和算法隔离测试。
- Create `app/src/features/securities/useRealtimeBacktestMonitor.ts`: 将监控集合、共享行情 Hook、历史加载和收件箱状态连接起来。
- Create `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`: 订阅、集合变化、行情更新和卸载测试。
- Create `app/src/features/securities/StockTradeConfirmDialog.tsx`: 买入/卖出确认窗口。
- Create `app/src/features/securities/StockTradeConfirmDialog.test.tsx`: 默认一手、数量校验、部分/全部卖出测试。
- Rewrite `app/src/features/securities/SignalInbox.tsx`: 展示新消息、阅读状态和交易执行结果。
- Create `app/src/features/securities/SignalInbox.test.tsx`: 收件箱端到端组件行为测试。
- Modify `app/src/features/securities/SecuritiesWorkbenchPage.test.tsx`: 增加个股分析路由与现有工作台隔离回归断言。

---

### Task 1: 抽取回测统一策略内核

**Files:**
- Create: `app/src/engines/market-analysis/backtest-strategy.ts`
- Create: `app/src/engines/market-analysis/backtest-strategy.test.ts`
- Modify: `app/src/engines/market-analysis/backtest-engine.ts`
- Modify: `app/src/engines/market-analysis/backtest-engine.test.ts`

**Interfaces:**
- Consumes: `StockKLine[]` 及已经由 `calcAllIndicators` 写入 K 线对象的技术指标。
- Produces: `evaluateBacktestBar(klines, index, position, options): BacktestBarDecision`。

- [ ] **Step 1: 写统一决策函数的失败测试**

```ts
function indicatorSeries(length: number): StockKLine[] {
  return Array.from({ length }, (_, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, '0')}`,
    open: 10, close: 10, high: 10.2, low: 9.8, volume: 1000, amount: 10000,
    macd: { dif: 0, dea: 0, bar: 0 },
    kdj: { k: 50, d: 50, j: 50 },
    rsi: { rsi6: 50, rsi12: 50, rsi24: 50 },
    boll: { upper: 12, mid: 10, lower: 8 },
    ma: { ma5: 10, ma10: 10, ma20: 10, ma60: 10 },
  })) as unknown as StockKLine[];
}

const flat = indicatorSeries(70);
expect(evaluateBacktestBar(flat, 69, { inPosition: false })).toEqual({
  action: 'hold', reasons: [],
});

const golden = indicatorSeries(70) as Array<StockKLine & { macd: { dif: number; dea: number } }>;
golden[68].macd = { dif: 0, dea: 1 };
golden[69].macd = { dif: 2, dea: 1 };
expect(evaluateBacktestBar(golden, 69, { inPosition: false }).action).toBe('buy');

const deadCross = indicatorSeries(70) as Array<StockKLine & { macd: { dif: number; dea: number } }>;
deadCross[68].macd = { dif: 2, dea: 1 };
deadCross[69].macd = { dif: 0, dea: 1 };
expect(evaluateBacktestBar(deadCross, 69, {
  inPosition: true, entryPrice: 10, entryIndex: 60,
}).action).toBe('sell');
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `npx vitest run src/engines/market-analysis/backtest-strategy.test.ts`

Expected: FAIL，提示无法解析 `backtest-strategy` 或 `evaluateBacktestBar` 未导出。

- [ ] **Step 3: 实现最小统一决策 API**

```ts
export interface BacktestPositionState {
  inPosition: boolean;
  entryPrice?: number;
  entryIndex?: number;
}

export interface BacktestStrategyOptions {
  stopLossPct: number;
  maxHoldingDays: number;
}

export interface BacktestBarDecision {
  action: 'buy' | 'sell' | 'hold';
  reasons: string[];
  exitReason?: 'signal' | 'stop_loss' | 'timeout';
}

export function evaluateBacktestBar(
  klines: StockKLine[],
  index: number,
  position: BacktestPositionState,
  options: BacktestStrategyOptions = { stopLossPct: 8, maxHoldingDays: 60 },
): BacktestBarDecision;
```

买入规则保持现有回测语义：MACD 金叉、KDJ J<20、RSI6<30、触及 BOLL 下轨或向上突破 MA20，任一条件即可开仓。持仓时优先检查止损，其次超时，再检查 MACD 死叉或 KDJ J>85。

- [ ] **Step 4: 运行统一策略测试并确认通过**

Run: `npx vitest run src/engines/market-analysis/backtest-strategy.test.ts`

Expected: PASS。

- [ ] **Step 5: 写回测引擎兼容性失败测试**

在 `backtest-engine.test.ts` 固定一组指标序列，断言交易日期、退出原因和总交易数；同时用 spy 证明引擎调用 `evaluateBacktestBar`，而不是保留重复规则。

- [ ] **Step 6: 改造回测循环并运行测试**

Run: `npx vitest run src/engines/market-analysis/backtest-engine.test.ts src/engines/market-analysis/backtest-strategy.test.ts`

Expected: PASS，原 `BacktestResult` 公共结构不变。

- [ ] **Step 7: 提交**

```powershell
git add -- app/src/engines/market-analysis/backtest-strategy.ts app/src/engines/market-analysis/backtest-strategy.test.ts app/src/engines/market-analysis/backtest-engine.ts app/src/engines/market-analysis/backtest-engine.test.ts
git commit -m "refactor: share backtest trading decisions"
```

### Task 2: 建立实际持仓原子账本

**Files:**
- Create: `app/src/features/securities/stock-position-ledger.ts`
- Create: `app/src/features/securities/stock-position-ledger.test.ts`

**Interfaces:**
- Produces: `loadStockLedger`、`buyStockPosition`、`sellStockPosition`、`findStockPosition`。
- Storage key: `sec_stock_position_ledger_v1`。

- [ ] **Step 1: 写买入和卖出的失败测试**

```ts
const bought = buyStockPosition({
  code: '000001', name: '平安银行', shares: 100, price: 10,
  groupId: 'default', groupName: '默认持仓', sourceAlertId: 'alert-buy-1',
  tradedAt: '2026-08-04T01:30:00.000Z',
}, { storage });
expect(bought.position).toMatchObject({ shares: 100, averageCost: 10, totalCost: 1000 });
expect(bought.ledger.groups[0].name).toBe('默认持仓');

const sold = sellStockPosition({
  code: '000001', shares: 40, price: 12,
  sourceAlertId: 'alert-sell-1', tradedAt: '2026-08-05T02:00:00.000Z',
}, { storage });
expect(sold.position?.shares).toBe(60);
expect(sold.transaction.realizedProfit).toBe(80);
```

另写测试覆盖：加权平均成本、全部卖出移除持仓、卖出超量拒绝、股数不是正整数拒绝、同一 `sourceAlertId` 重复执行拒绝且存储不变、损坏 JSON 返回错误但不覆盖原内容。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run src/features/securities/stock-position-ledger.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现一个键内的账本结构**

```ts
export interface StockPositionLedger {
  version: 1;
  groups: StockPositionGroup[];
  positions: StockPosition[];
  transactions: StockTransaction[];
}

export interface StockPosition {
  id: string; groupId: string; code: string; name: string;
  shares: number; averageCost: number; totalCost: number;
  openedAt: string; updatedAt: string; sourceAlertIds: string[];
}
```

先在内存中完成校验与新账本计算，最后只调用一次 `storage.setItem`，保证持仓与交易记录同时写入。初次买入自动创建“默认持仓”组；传入已有 `groupId` 时写入该组，传入新组名称时创建该组。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npx vitest run src/features/securities/stock-position-ledger.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add -- app/src/features/securities/stock-position-ledger.ts app/src/features/securities/stock-position-ledger.test.ts
git commit -m "feat: add stock position transaction ledger"
```

### Task 3: 合并全部自选股与持仓监控集合

**Files:**
- Create: `app/src/features/securities/stock-monitoring-universe.ts`
- Create: `app/src/features/securities/stock-monitoring-universe.test.ts`

**Interfaces:**
- Consumes: `sec_watchlists_v2` 和 `loadStockLedger()`。
- Produces: `loadMonitoringUniverse(storage): MonitoringUniverse`。

- [ ] **Step 1: 写失败测试**

```ts
expect(loadMonitoringUniverse(storage)).toEqual({
  buyCodes: ['000001', '600519'],
  heldCodes: ['000001', '300750'],
  allCodes: ['000001', '300750', '600519'],
});
```

测试数据必须包含两个自选股池、重复代码、一只仅持仓股票、空数组及损坏自选股 JSON。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run src/features/securities/stock-monitoring-universe.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现读取和稳定排序**

```ts
export interface MonitoringUniverse {
  buyCodes: string[];
  heldCodes: string[];
  allCodes: string[];
}

export function loadMonitoringUniverse(
  storage: Pick<Storage, 'getItem'> = localStorage,
): MonitoringUniverse;
```

所有数组去重并按代码排序。损坏自选股数据按空自选股处理，但不得影响从实际持仓读取卖出监控集合。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npx vitest run src/features/securities/stock-monitoring-universe.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add -- app/src/features/securities/stock-monitoring-universe.ts app/src/features/securities/stock-monitoring-universe.test.ts
git commit -m "feat: monitor all watchlists and stock positions"
```

### Task 4: 实现信号收件箱状态机与持久化

**Files:**
- Create: `app/src/features/securities/backtest-signal-inbox-store.ts`
- Create: `app/src/features/securities/backtest-signal-inbox-store.test.ts`

**Interfaces:**
- Produces: `loadSignalInbox`、`applyBacktestDecision`、`markSignalAlertRead`、`markSignalAlertExecuted`、`clearSignalAlerts`。
- Storage key: `sec_bt_signal_inbox_v2`。

- [ ] **Step 1: 写信号边沿失败测试**

```ts
const metrics = {
  totalTrades: 12, winRate: 58, sharpeRatio: 1.1,
  maxDrawdown: 12, annualReturn: 18, profitFactor: 1.4,
};
const buyEvent = {
  code: '000001', name: '平安银行', price: 10,
  decision: { action: 'buy', reasons: ['MACD金叉'] },
  isBuyCandidate: true, isHeld: false,
  signalAt: '2026-08-04T01:30:00.000Z', metrics,
} as const;
const first = applyBacktestDecision(emptyState, buyEvent);
expect(first.createdAlert?.action).toBe('buy');

const duplicate = applyBacktestDecision(first.state, buyEvent);
expect(duplicate.createdAlert).toBeNull();
```

再覆盖：`hold` 解除买入边沿、下一次 buy 可再次提醒、未持仓 sell 被忽略、持仓 sell 只提醒一次、部分卖出后持续 sell 不重复提醒、全部卖出后回到等待买入、消息单独已读、执行状态不可重复改写。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run src/features/securities/backtest-signal-inbox-store.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现状态和消息类型**

```ts
export type SignalPhase = 'waiting_buy' | 'buy_notified' | 'holding' | 'sell_notified';
export type SignalAlertStatus = 'pending' | 'bought' | 'sold';

export interface BacktestSignalAlert {
  id: string; code: string; name: string; price: number;
  action: 'buy' | 'sell'; reasons: string[]; signalAt: string;
  status: SignalAlertStatus; readAt: string | null;
  entryPrice: number; stopLoss: number;
  metrics: BacktestSignalMetrics;
}
```

状态转换函数保持纯函数；存储包装器负责一次性写入完整 inbox state。保留最多 100 条消息，删除时优先清理最旧且已执行的消息。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npx vitest run src/features/securities/backtest-signal-inbox-store.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add -- app/src/features/securities/backtest-signal-inbox-store.ts app/src/features/securities/backtest-signal-inbox-store.test.ts
git commit -m "feat: add realtime backtest signal state machine"
```

### Task 5: 实现历史缓存和实时 K 线增量扫描

**Files:**
- Create: `app/src/features/securities/realtime-backtest-monitor.ts`
- Create: `app/src/features/securities/realtime-backtest-monitor.test.ts`

**Interfaces:**
- Consumes: `StockQuote`、`StockKLine[]`、`calcAllIndicators`、`runBacktest`、`evaluateBacktestBar`。
- Produces: `mergeRealtimeQuoteIntoDailyBar`、`createRealtimeBacktestMonitor`。

- [ ] **Step 1: 写实时柱合并失败测试**

```ts
const result = mergeRealtimeQuoteIntoDailyBar(history, quote, '2026-08-04');
expect(result.at(-1)).toMatchObject({
  date: '2026-08-04', open: 10, close: 10.8, high: 11, low: 9.9,
});
expect(history.at(-1)?.close).not.toBe(10.8);
```

覆盖同交易日更新现有临时柱、新交易日追加临时柱、价格无效时返回 `null`、不修改调用方原数组。

- [ ] **Step 2: 写监控器失败隔离测试**

使用依赖注入模拟两只股票：一只历史 K 线加载失败，另一只成功触发 buy。断言成功股票仍产生事件；第二个报价快照不重复加载历史 K 线；相同信号只交给状态机一次；`runBacktest` 只在历史数据首次加载或重载时计算证据，不在每个 3 秒 tick 全量回测。

- [ ] **Step 3: 运行测试并确认失败**

Run: `npx vitest run src/features/securities/realtime-backtest-monitor.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现有限并发加载和增量扫描**

```ts
export interface RealtimeBacktestMonitor {
  syncUniverse(codes: string[]): Promise<void>;
  processSnapshot(input: MonitorSnapshotInput): Promise<MonitorSnapshotResult>;
  reload(codes?: string[]): Promise<void>;
  dispose(): void;
}

export function createRealtimeBacktestMonitor(
  dependencies: RealtimeBacktestMonitorDependencies,
): RealtimeBacktestMonitor;
```

历史加载最大并发设为 4；每只股票缓存原始历史 K 线和回测指标。每个行情 tick 只复制该股票序列、合并当日临时柱、计算指标并调用最后一柱的统一策略函数。`dispose` 后忽略所有迟到的异步结果。

- [ ] **Step 5: 运行测试并确认通过**

Run: `npx vitest run src/features/securities/realtime-backtest-monitor.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add -- app/src/features/securities/realtime-backtest-monitor.ts app/src/features/securities/realtime-backtest-monitor.test.ts
git commit -m "feat: evaluate backtest signals from realtime quotes"
```

### Task 6: 用 React Hook 连接共享 3 秒行情

**Files:**
- Create: `app/src/features/securities/useRealtimeBacktestMonitor.ts`
- Create: `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`

**Interfaces:**
- Consumes: `loadMonitoringUniverse`、`useRealtimeStockQuotes`、`createRealtimeBacktestMonitor`、inbox store。
- Produces: `useRealtimeBacktestMonitor(): UseRealtimeBacktestMonitorResult`。

- [ ] **Step 1: 写 Hook 失败测试**

```ts
const { result, rerender, unmount } = renderHook(() => useRealtimeBacktestMonitor());
expect(mockUseRealtimeStockQuotes).toHaveBeenCalledWith(['000001', '600519']);

emitQuoteSnapshot({ '000001': quote });
await waitFor(() => expect(result.current.alerts).toHaveLength(1));
unmount();
expect(dispose).toHaveBeenCalledOnce();
```

覆盖：自选股多个池去重、每 3 秒行情快照触发增量扫描、市场状态非 `trading` 时不计算、行情错误不产生消息、手动刷新调用共享 Store `refreshNow` 和历史 `reload`、每 3 秒轻量比较 localStorage 中的监听集合并在变化时重订阅、恢复焦点由共享 Store 新快照补检。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run src/features/securities/useRealtimeBacktestMonitor.test.tsx`

Expected: FAIL，Hook 不存在。

- [ ] **Step 3: 实现 Hook**

```ts
export interface UseRealtimeBacktestMonitorResult {
  alerts: BacktestSignalAlert[];
  unreadCount: number;
  checking: boolean;
  partialFailureCount: number;
  marketStatus: StockMarketSessionStatus;
  lastUpdatedAt: string | null;
  error: string;
  refreshNow(): Promise<void>;
  markRead(alertId: string): void;
  clearAlerts(): void;
  reloadLedger(): void;
}
```

Hook 不创建行情计时器，只调用 `useRealtimeStockQuotes(universe.allCodes)`。允许一个仅用于比较 localStorage 监听集合签名的 3 秒轻量定时器；它不得下载行情、K 线或执行策略。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npx vitest run src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/useRealtimeStockQuotes.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add -- app/src/features/securities/useRealtimeBacktestMonitor.ts app/src/features/securities/useRealtimeBacktestMonitor.test.tsx
git commit -m "feat: connect realtime quotes to backtest monitor"
```

### Task 7: 增加买卖确认窗口

**Files:**
- Create: `app/src/features/securities/StockTradeConfirmDialog.tsx`
- Create: `app/src/features/securities/StockTradeConfirmDialog.test.tsx`

**Interfaces:**
- Consumes: `BacktestSignalAlert` 和可选 `StockPosition`。
- Produces: `StockTradeConfirmDialog`，通过 `onConfirm({ shares, price, groupId, newGroupName })` 返回用户确认数据。

- [ ] **Step 1: 写组件失败测试**

```tsx
render(<StockTradeConfirmDialog alert={buyAlert} position={null} onConfirm={onConfirm} onCancel={vi.fn()} />);
expect(screen.getByLabelText('交易股数')).toHaveValue(100);
expect(screen.getByLabelText('成交价格')).toHaveValue(10.8);
expect(screen.getByLabelText('目标持仓组')).toHaveValue('default');
await user.click(screen.getByRole('button', { name: '确认买入' }));
expect(onConfirm).toHaveBeenCalledWith({ shares: 100, price: 10.8, groupId: 'default', newGroupName: '' });
```

卖出测试默认全部持仓；允许部分卖出；拒绝 0、负数、非整数、超过持仓和非 100 股整数手的买入；卖出允许非整手以兼容历史零股。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run src/features/securities/StockTradeConfirmDialog.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现可访问表单**

对话框使用 `role="dialog"`、明确的 label、取消按钮和错误文本。买入默认 100 股，价格默认采用消息中的最新实时价，目标组默认“默认持仓”，并允许选择已有组或输入新组名；卖出默认当前全部持仓且沿用原持仓组。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npx vitest run src/features/securities/StockTradeConfirmDialog.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add -- app/src/features/securities/StockTradeConfirmDialog.tsx app/src/features/securities/StockTradeConfirmDialog.test.tsx
git commit -m "feat: confirm stock trades from signal alerts"
```

### Task 8: 重写收件箱并接通实际交易

**Files:**
- Rewrite: `app/src/features/securities/SignalInbox.tsx`
- Create: `app/src/features/securities/SignalInbox.test.tsx`
- Modify: `app/src/features/securities/SecuritiesWorkbenchPage.test.tsx`

**Interfaces:**
- Consumes: `useRealtimeBacktestMonitor`、账本 API、`StockTradeConfirmDialog`、React Router。
- Produces: 完整实时回测信号收件箱。

- [ ] **Step 1: 写收件箱失败测试**

覆盖以下用户行为：

```tsx
expect(screen.getByTitle('实时回测买卖信号')).toHaveTextContent('1');
await user.click(screen.getByTitle('实时回测买卖信号'));
expect(screen.getByText('平安银行 (000001)')).toBeInTheDocument();
expect(screen.getByText('MACD金叉')).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: '确认买入 平安银行' }));
await user.click(screen.getByRole('button', { name: '确认买入' }));
expect(buyStockPosition).toHaveBeenCalledWith(expect.objectContaining({
  code: '000001', shares: 100, groupId: 'default', sourceAlertId: buyAlert.id,
}), expect.anything());
expect(markSignalAlertExecuted).toHaveBeenCalledWith(buyAlert.id, 'bought', expect.anything());
```

另写测试覆盖：打开收件箱不把全部消息标已读；点击单条消息标已读；卖出弹窗默认全部持仓；部分/全部卖出成功；存储失败时不标记已执行；已执行按钮禁用；部分监听失败提示；“立即刷新”调用 Hook；“查看个股”跳转到现有股票分析路由。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run src/features/securities/SignalInbox.test.tsx`

Expected: FAIL，现有组件仍使用 5 分钟扫描且没有交易按钮。

- [ ] **Step 3: 删除旧的独立扫描逻辑并实现新 UI**

从 `SignalInbox.tsx` 删除 `setInterval(..., 300000)`、直接调用 `fetchStockQuotes`/`fetchEastmoneyKLine`、重复的 `detectBacktestSignal` 和旧 `sec_bt_inbox_v1` 写入。组件仅使用 Hook 提供的状态和账本 API。

买入成功顺序：写入账本 → 标记消息 `bought` → 让 Hook 重载持仓集合。卖出同理。任一步失败都显示错误，不提前改变消息状态。

- [ ] **Step 4: 运行组件测试并确认通过**

Run: `npx vitest run src/features/securities/SignalInbox.test.tsx src/features/securities/SecuritiesWorkbenchPage.test.tsx`

Expected: PASS。

- [ ] **Step 5: 增加算法隔离回归断言**

在工作台测试中记录 `runBacktest`、荐股/评分模块和个股分析相关 mock 的调用次数，发出实时行情快照后断言只有新监控器运行；点击“查看个股”仍导航至 `/projects/:projectId/securities/stock/:code`。

- [ ] **Step 6: 提交**

```powershell
git add -- app/src/features/securities/SignalInbox.tsx app/src/features/securities/SignalInbox.test.tsx app/src/features/securities/SecuritiesWorkbenchPage.test.tsx
git commit -m "feat: trade realtime backtest alerts from inbox"
```

### Task 9: 完整回归和浏览器验收

**Files:**
- Modify only if a new failing regression proves an in-scope defect in Tasks 1-8.

- [ ] **Step 1: 运行定向测试**

Run:

```powershell
npx vitest run src/engines/market-analysis/backtest-strategy.test.ts src/engines/market-analysis/backtest-engine.test.ts src/features/securities/stock-position-ledger.test.ts src/features/securities/stock-monitoring-universe.test.ts src/features/securities/backtest-signal-inbox-store.test.ts src/features/securities/realtime-backtest-monitor.test.ts src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/StockTradeConfirmDialog.test.tsx src/features/securities/SignalInbox.test.tsx
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行证券模块回归**

Run: `npx vitest run src/features/securities src/infrastructure/market-data/realtime-stock-quotes.test.ts src/infrastructure/market-data/stock-market-session.test.ts src/engines/market-analysis`

Expected: 新增测试全部通过；若仍存在此前已记录的股票目录两个既有失败，单独记录且不得误报为本功能通过。

- [ ] **Step 3: 运行质量检查**

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm run build`

Run: `npm audit --audit-level=high`

Expected: Lint、类型检查和构建无错误；依赖审计结果如包含破坏性升级风险，只记录，不运行 `npm audit fix`。

- [ ] **Step 4: 浏览器验收**

在 `http://localhost:5173/securities` 验证：

1. 收件箱显示“实时回测买卖信号”，不存在“每 5 分钟扫描”文案。
2. 监听范围包含全部自选股池的去重股票数。
3. 手动测试信号可产生一条买入消息，同一持续信号不重复。
4. 确认买入后实际持仓出现股票、100 股默认数量及正确成本。
5. 模拟卖出信号后出现提醒，部分和全部卖出正确更新持仓。
6. “查看个股”正常进入原有个股分析页，概览和 K 线正常。
7. 浏览器控制台无新增错误。

- [ ] **Step 5: 检查改动范围**

Run: `git diff --check`

Run: `git status --short`

Run: `git diff --name-only HEAD -- app/src/features/securities/StockAnalysisPage.tsx app/src/infrastructure/market-data/stock-api.ts app/vite.config.ts app/public/_redirects`

Expected: 个股分析、股票行情 API、Vite 配置和重定向文件没有被本计划修改。

- [ ] **Step 6: 提交必要的最终测试调整**

只有 Step 1-5 产生了明确且属于本功能的修复时才提交对应文件：

使用 `git status --short` 列出的本功能测试修复文件逐个明确传给 `git add --`，然后提交信息使用 `test: verify realtime backtest signal workflow`。

若没有额外改动，不创建空提交。

