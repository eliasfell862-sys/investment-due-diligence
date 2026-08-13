# 证券统一状态源渐进改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents for this project.

**Goal:** 在不增加云表或云端数据副本的前提下，让实际持仓、自选股、回测监控、信号收件箱、做 T 和策略复盘共享同一份当前账号证券状态，并消除重复请求、旧响应覆盖和跨模块不同步。

**Architecture:** 在 React 认证上下文内部建立应用级 `SecuritiesStateProvider`。Provider 只管理实际持仓与自选结构，Supabase 仍是云模式权威源；受限本地缓存只负责首屏恢复。现有 hooks 保留兼容降级，分三阶段迁移，任何阶段验证失败都停止后续改造。

**Tech Stack:** React 19、TypeScript 6、Vitest、Testing Library、Supabase JS、Vite 8、oxlint。

## Global Constraints

- 不新增或修改 Supabase 业务表，不增加云端业务数据副本。
- 不缓存行情、K 线、短中线建议、报告、信号历史、虚拟仓或做 T 结果。
- 不修改个股分析页、`stock-api.ts` 和现有行情来源。
- 不引入 Redux、Zustand、React Query 或其他状态依赖。
- 保留当前账号隔离、24 小时过期、500 KB 总上限和退出登录清理规则。
- Supabase 始终是登录模式的权威数据源；云失败不得清空最近可用状态。
- 未挂载统一 Provider 的测试和独立组件必须安全降级，不得整页抛错。
- 不使用子代理；实施期间不提交、不推送，除非用户另行批准。

---

## 文件结构

- Create: `app/src/features/securities/state/securities-request-coordinator.ts` — 合并同资源并发读取并阻止旧响应发布。
- Create: `app/src/features/securities/state/securities-request-coordinator.test.ts` — 请求协调器单元测试。
- Create: `app/src/features/securities/state/SecuritiesStateProvider.tsx` — 账号级持仓与自选统一状态及写操作。
- Create: `app/src/features/securities/state/SecuritiesStateProvider.test.tsx` — Provider 集成测试。
- Create: `app/src/features/securities/state/securities-monitoring-universe.ts` — 由自选与持仓计算监控集合的纯函数。
- Create: `app/src/features/securities/state/securities-monitoring-universe.test.ts` — 监控集合测试。
- Modify: `app/src/main.tsx` — 不改；认证边界保持原状。
- Modify: `app/src/app/AppShellBase.tsx` — 在常驻回测 Provider 外挂载统一证券 Provider。
- Modify: `app/src/features/securities/useStockPositionLedgerBase.ts` — 增加可禁用的兼容实现。
- Modify: `app/src/features/securities/useStockPositionLedger.ts` — 优先返回统一状态，无 Provider 时降级。
- Modify: `app/src/features/securities/cloud/SecuritiesDataSourceProvider.tsx` — 变为统一状态的兼容桥，避免重复云读取。
- Modify: `app/src/features/securities/WatchlistPage.tsx` — 迁移自选云读写，保留行情和建议逻辑。
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.ts` — 订阅统一自选与实际持仓，删除重复 universe 读取。
- Modify: `app/src/features/securities/RealtimeBacktestMonitorProvider.tsx` — 将统一状态传给复盘调度入口。
- Modify: `app/src/features/securities/cloud/CloudSignalInbox.tsx` — 继续使用兼容桥，不再独立触发持仓读取。
- Modify: `app/src/features/securities/strategy-learning/daily-review-orchestrator.ts` — 支持使用统一快照生成当日复盘。

---

### Task 1: 请求合并与旧响应保护

**Files:**
- Create: `app/src/features/securities/state/securities-request-coordinator.ts`
- Test: `app/src/features/securities/state/securities-request-coordinator.test.ts`

**Interfaces:**

```ts
export interface CoordinatedResult<T> {
  value: T;
  current: boolean;
  version: number;
}

export interface RequestCoordinator<T> {
  run(loader: () => Promise<T>, options?: { force?: boolean }): Promise<CoordinatedResult<T>>;
  invalidate(): void;
  version(): number;
}

export function createRequestCoordinator<T>(): RequestCoordinator<T>;
```

- [ ] **Step 1: 写并发合并失败测试**

```ts
it('shares one loader promise for concurrent non-force reads', async () => {
  const deferred = createDeferred<number>();
  const loader = vi.fn(() => deferred.promise);
  const coordinator = createRequestCoordinator<number>();

  const first = coordinator.run(loader);
  const second = coordinator.run(loader);
  expect(loader).toHaveBeenCalledOnce();

  deferred.resolve(7);
  expect((await first).value).toBe(7);
  expect((await second).value).toBe(7);
});
```

- [ ] **Step 2: 运行测试确认因模块不存在而失败**

Run: `npm test -- securities-request-coordinator.test.ts`
Expected: FAIL，无法导入 `createRequestCoordinator`。

- [ ] **Step 3: 写旧响应保护失败测试**

```ts
it('marks an older response stale after a forced refresh', async () => {
  const slow = createDeferred<string>();
  const fast = createDeferred<string>();
  const coordinator = createRequestCoordinator<string>();

  const oldRequest = coordinator.run(() => slow.promise);
  const newRequest = coordinator.run(() => fast.promise, { force: true });
  fast.resolve('new');
  slow.resolve('old');

  expect(await newRequest).toMatchObject({ value: 'new', current: true });
  expect(await oldRequest).toMatchObject({ value: 'old', current: false });
});
```

- [ ] **Step 4: 实现最小请求协调器**

使用闭包保存 `currentVersion` 和 `inflight`。普通 `run` 复用进行中的 Promise；`force` 递增版本并启动新请求；完成时通过版本相等判断 `current`；`invalidate` 递增版本并清空可复用引用。失败 Promise 也必须清理自身引用，但不能清理后来启动的新请求。

- [ ] **Step 5: 验证 Task 1**

Run: `npm test -- securities-request-coordinator.test.ts`
Expected: PASS。

---

### Task 2: 建立实际持仓统一 Provider

**Files:**
- Create: `app/src/features/securities/state/SecuritiesStateProvider.tsx`
- Test: `app/src/features/securities/state/SecuritiesStateProvider.test.tsx`
- Modify: `app/src/features/securities/useStockPositionLedgerBase.ts`

**Interfaces:**

```ts
export interface SecuritiesResourceState<T> {
  data: T;
  loading: boolean;
  refreshing: boolean;
  error: string;
  updatedAt: string | null;
}

export interface SecuritiesStateValue {
  mode: 'local' | 'cloud';
  userId: string;
  positions: SecuritiesResourceState<StockPositionLedger>;
  watchlists: SecuritiesResourceState<CloudWatchlist[]>;
  reloadPositions(options?: { force?: boolean }): Promise<StockPositionLedger>;
  buyPosition(input: BuyStockPositionInput): Promise<void>;
  sellPosition(input: SellStockPositionInput): Promise<void>;
  movePositionGroup(input: UpdateStockPositionGroupInput): Promise<void>;
  reloadWatchlists(options?: { force?: boolean }): Promise<CloudWatchlist[]>;
  replaceWatchlists(next: CloudWatchlist[]): Promise<void>;
}

export function SecuritiesStateProvider({ children }: { children: ReactNode }): JSX.Element;
export function useOptionalSecuritiesState(): SecuritiesStateValue | null;
export function useSecuritiesState(): SecuritiesStateValue;
```

- [ ] **Step 1: 写“两个消费者只读云一次”失败测试**

在 `AuthProvider` 和云仓库 mock 下同时渲染两个消费者，两者读取 `positions.data`。让 `loadPositionLedger` 返回 deferred Promise，断言只调用一次并且两者最终显示相同 shares。

- [ ] **Step 2: 写缓存先显示、云失败保留失败测试**

先调用 `writeCachedPositionLedger('user-a', cachedLedger)`，令云读取 reject。断言缓存持仓仍显示且 `positions.error === 'cloud down'`。

- [ ] **Step 3: 写账号切换隔离失败测试**

用可变 auth mock 从 `user-a` 切到 `user-b` 并 rerender；在 B 的云响应返回前，断言页面不再显示 A 的持仓；A 的慢响应之后返回也不得写入 B 状态。

- [ ] **Step 4: 运行测试确认失败**

Run: `npm test -- SecuritiesStateProvider.test.tsx`
Expected: FAIL，Provider 尚不存在。

- [ ] **Step 5: 实现 Provider 的实际持仓资源**

Provider 初始化时：云模式先读 `readCachedPositionLedger(userId)`，再通过 Task 1 协调器调用一次 `loadPositionLedger()`；成功后更新状态和 `writeCachedPositionLedger`；失败只更新错误。账号变化时调用 `invalidate()` 并从新账号缓存重新初始化。

本地模式调用现有 `loadStockLedger()`，继续监听 `STOCK_POSITION_LEDGER_CHANGED_EVENT`、storage 和 focus；事件监听必须使用稳定函数并正确注销。

- [ ] **Step 6: 给旧 hook 实现增加 `enabled`**

将旧实现改为：

```ts
export function useStockPositionLedgerBase(options: { enabled?: boolean } = {})
```

当 `enabled === false` 时不执行读取、不注册监听器、不触发云请求。返回类型保持现有 `{ ledger, error, reload, buy, sell, moveGroup }`。

- [ ] **Step 7: 验证 Task 2**

Run: `npm test -- SecuritiesStateProvider.test.tsx useStockPositionLedger.test.tsx useStockPositionLedger.cloud.test.tsx`
Expected: PASS。

---

### Task 3: 统一持仓写操作与兼容 hook

**Files:**
- Modify: `app/src/features/securities/state/SecuritiesStateProvider.tsx`
- Modify: `app/src/features/securities/useStockPositionLedger.ts`
- Test: `app/src/features/securities/state/SecuritiesStateProvider.test.tsx`
- Test: `app/src/features/securities/useStockPositionLedger.cloud.test.tsx`

**Interfaces:**
- Consumes: Task 2 `SecuritiesStateValue`。
- Produces: 现有 `useStockPositionLedger()` API，不改变页面调用方式。

- [ ] **Step 1: 写写入成功后统一刷新失败测试**

渲染两个 Provider 消费者。执行 `buyPosition`，mock `executeManualBuy` 成功并让第二次 `loadPositionLedger` 返回新账本。断言写 RPC 一次、权威刷新一次、两个消费者同时显示新 shares。

- [ ] **Step 2: 写写入失败保持原状态失败测试**

令 `executeManualSell` reject，断言原 positions 不变、Promise reject，且不调用后续 `loadPositionLedger`。

- [ ] **Step 3: 运行红灯测试**

Run: `npm test -- SecuritiesStateProvider.test.tsx`
Expected: FAIL，统一 mutation 尚未完成。

- [ ] **Step 4: 实现持仓 mutation**

云模式依次执行现有 RPC 和 `reloadPositions({ force: true })`；写入前调用协调器 `invalidate()`，使 mutation 前的慢读取失效。本地模式调用现有 ledger mutation 后强制刷新。不得在 RPC 成功前伪造持仓。

- [ ] **Step 5: 改造兼容 hook**

`useStockPositionLedger()` 始终调用 `useOptionalSecuritiesState()` 和 `useStockPositionLedgerBase({ enabled: !shared })`；若共享状态存在，映射为原 API：

```ts
return shared ? {
  ledger: shared.positions.data,
  error: shared.positions.error,
  reload: () => shared.reloadPositions({ force: true }),
  buy: shared.buyPosition,
  sell: shared.sellPosition,
  moveGroup: shared.movePositionGroup,
} : fallback;
```

- [ ] **Step 6: 验证 Task 3**

Run: `npm test -- SecuritiesStateProvider.test.tsx useStockPositionLedger.cloud.test.tsx ActualPositionsPanel.test.tsx`
Expected: PASS。

---

### Task 4: 挂载唯一 Provider 并消除持仓兼容层重复读取

**Files:**
- Modify: `app/src/app/AppShellBase.tsx`
- Modify: `app/src/features/securities/cloud/SecuritiesDataSourceProvider.tsx`
- Modify: `app/src/features/securities/cloud/SecuritiesRouteBoundary.tsx`
- Test: `app/src/features/securities/cloud/SecuritiesDataSourceProvider.test.tsx`
- Test: `app/src/features/securities/RealtimeBacktestMonitorProvider.test.tsx`
- Test: `app/src/app/router.test.tsx`

- [ ] **Step 1: 写 DataSource 复用统一持仓失败测试**

在 `SecuritiesStateProvider` 内挂载两个 `SecuritiesDataSourceProvider` 消费者，断言云仓库 `loadPositionLedger` 仍只调用一次，且 `reloadLedger` 委托 `reloadPositions({ force: true })`。

- [ ] **Step 2: 写无统一 Provider 安全降级测试**

单独挂载 `SecuritiesDataSourceProvider`，断言仍能使用现有本地/云兼容实现，不抛 “must be used within” 错误。

- [ ] **Step 3: 运行红灯测试**

Run: `npm test -- SecuritiesDataSourceProvider.test.tsx`
Expected: FAIL，当前 DataSource 仍独立读取。

- [ ] **Step 4: 挂载 Provider**

将 `AppShellBase` 的层级改为：

```tsx
<SecuritiesStateProvider>
  <RealtimeBacktestMonitorProvider>
    {/* existing shell */}
  </RealtimeBacktestMonitorProvider>
</SecuritiesStateProvider>
```

不移动 `AuthProvider`，它继续位于 `main.tsx` 外层。

- [ ] **Step 5: 将 DataSourceProvider 变为兼容桥**

若 `useOptionalSecuritiesState()` 存在，直接提供统一 positions；不存在时运行当前内部读取逻辑。`SecuritiesRouteBoundary` 保留，以兼容直接路由测试，但不得创建第二套实际持仓状态。

- [ ] **Step 6: 验证第一阶段检查点**

Run:

```powershell
npm test -- SecuritiesStateProvider.test.tsx useStockPositionLedger.cloud.test.tsx ActualPositionsPanel.test.tsx SecuritiesDataSourceProvider.test.tsx RealtimeBacktestMonitorProvider.test.tsx router.test.tsx
npm run typecheck
npm run lint
npm run build
```

Expected: 测试、类型检查和构建通过；lint 无新增 warning。通过后才进入 Task 5。

---

### Task 5: 将自选股迁入统一状态

**Files:**
- Modify: `app/src/features/securities/state/SecuritiesStateProvider.tsx`
- Modify: `app/src/features/securities/WatchlistPage.tsx`
- Test: `app/src/features/securities/state/SecuritiesStateProvider.test.tsx`
- Test: `app/src/features/securities/WatchlistPage.test.tsx`

- [ ] **Step 1: 写自选并发合并和缓存恢复失败测试**

两个消费者同时调用/订阅 `reloadWatchlists()`，断言 `loadWatchlists` 一次；缓存先显示后由云端覆盖；云失败保留缓存并设置 watchlists error。

- [ ] **Step 2: 写保存成功后权威刷新失败测试**

调用 `replaceWatchlists(next)`；断言先执行 `saveWatchlists(next)`，再执行一次强制 `loadWatchlists`，所有消费者最终收到云端规范化后的列表。

- [ ] **Step 3: 写保存失败不伪造状态失败测试**

令 `saveWatchlists` reject，断言 Provider 中原列表不变且不执行刷新。

- [ ] **Step 4: 实现 Provider 自选资源**

复用 Task 1 请求协调器；云模式使用现有缓存工具和仓库，本地模式读取/保存 `sec_watchlists_v2`。账号切换时清除前账号内存并废弃旧请求。

- [ ] **Step 5: 迁移 WatchlistPage**

删除页面中的 `loadWatchlists`/`saveWatchlists` 云 effect 和 `skipNextCloudSaveRef`。界面从 `shared.watchlists.data` 初始化；所有新增、删除、分组和代码变更构造完整 next 列表并调用 `replaceWatchlists(next)`。保存中禁用对应操作，失败显示原有云同步错误区域。行情、短线/中线建议和个股跳转逻辑保持不变。

- [ ] **Step 6: 验证第二阶段检查点**

Run:

```powershell
npm test -- SecuritiesStateProvider.test.tsx WatchlistPage.test.tsx securities-account-cache.test.ts AuthProvider.test.tsx
npm run typecheck
npm run lint
npm run build
```

Expected: PASS；无新增云表、缓存种类或依赖。

---

### Task 6: 统一监控股票集合

**Files:**
- Create: `app/src/features/securities/state/securities-monitoring-universe.ts`
- Test: `app/src/features/securities/state/securities-monitoring-universe.test.ts`
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.ts`
- Test: `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`

**Interface:**

```ts
export interface SecuritiesMonitoringUniverse {
  buyCodes: string[];
  heldCodes: string[];
  allCodes: string[];
}

export function buildSecuritiesMonitoringUniverse(
  watchlists: Array<{ codes: string[] }>,
  ledger: StockPositionLedger,
): SecuritiesMonitoringUniverse;
```

- [ ] **Step 1: 写账号集合纯函数测试**

覆盖去重、非法代码过滤、排序、空自选但有持仓，以及结果严格等于自选与实际持仓并集。

- [ ] **Step 2: 实现纯函数并验证**

Run: `npm test -- securities-monitoring-universe.test.ts`
Expected: PASS。

- [ ] **Step 3: 写监控不再重复读取 universe 失败测试**

在统一 Provider 下渲染 monitor，断言 monitor 使用 Provider 的 watchlists/positions，并且自身不调用仓库 `loadWatchlists` 或 `loadPositionLedger`；`loadSignalRuntime` 等信号运行时读取保持不变。

- [ ] **Step 4: 改造 monitor**

删除 `cloudPositionLedger`、`reloadCloudUniverse` 及其 0↔N 震荡路径。通过 `useSecuritiesState()` 获取当前账号 watchlists 和 positions，用纯函数计算 universe。刷新入口调用 Provider 的 `reloadWatchlists` 与 `reloadPositions`，但普通并发会被协调器合并。

- [ ] **Step 5: 验证监控和 T+1/T 信号回归**

Run:

```powershell
npm test -- securities-monitoring-universe.test.ts useRealtimeBacktestMonitor.test.tsx RealtimeBacktestMonitorProvider.test.tsx ActualPositionsPanel.test.tsx
```

Expected: PASS；持仓代码始终进入 K 线同步集合。

---

### Task 7: 收件箱、做 T 与复盘共享统一快照

**Files:**
- Modify: `app/src/features/securities/cloud/CloudSignalInbox.tsx`
- Modify: `app/src/features/securities/RealtimeBacktestMonitorProvider.tsx`
- Modify: `app/src/features/securities/strategy-learning/daily-review-orchestrator.ts`
- Test: `app/src/features/securities/cloud/CloudSignalInbox.test.tsx`
- Test: `app/src/features/securities/RealtimeBacktestDailyReview.test.tsx`
- Test: `app/src/features/securities/strategy-learning/daily-review-orchestrator.test.ts`

- [ ] **Step 1: 写收件箱共享账本测试**

在统一 Provider 内打开 CloudSignalInbox，断言它读取与实际持仓面板相同的 ledger 对象/版本，不触发额外 `loadPositionLedger`。

- [ ] **Step 2: 写复盘统一快照测试**

为 orchestrator 增加显式快照入口：

```ts
export interface DailyReviewSecuritiesSnapshot {
  watchlists: Array<{ codes: string[] }>;
  positionLedger: StockPositionLedger;
}

export function runDailyReviewCatchUpFromSnapshot(
  snapshot: DailyReviewSecuritiesSnapshot,
  source: Omit<CloudDailyReviewSource, 'loadWatchlists' | 'loadPositionLedger'>,
): Promise<DailyReviewCatchUpResult>;
```

测试断言复盘使用传入账号自选和持仓，不再次读取这两类云数据。

- [ ] **Step 3: 实现复盘快照入口**

复用现有复盘计算与持久化，只替换 watchlists/positionLedger 来源；不得改变虚拟交易、信号历史和复盘存储格式。

- [ ] **Step 4: 改造 RealtimeBacktestMonitorProvider 调度**

从 `useSecuritiesState()` 取得统一数据，调用 `runDailyReviewCatchUpFromSnapshot`。若两类资源仍在首次加载，则跳过本轮并等待下一次调度；不得使用默认自选替代账号数据。

- [ ] **Step 5: 验证第三阶段检查点**

Run:

```powershell
npm test -- CloudSignalInbox.test.tsx RealtimeBacktestDailyReview.test.tsx daily-review-orchestrator.test.ts useRealtimeBacktestMonitor.test.tsx
npm run typecheck
npm run lint
npm run build
```

Expected: PASS。

---

### Task 8: 故障隔离和完整链路回归

**Files:**
- Test: `app/src/features/securities/state/SecuritiesStateProvider.test.tsx`
- Test: `app/src/features/securities/ActualPositionsPanel.test.tsx`
- Test: `app/src/features/securities/WatchlistPage.test.tsx`
- Test: `app/src/features/securities/cloud/CloudSignalInbox.test.tsx`
- Test: `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`

- [ ] **Step 1: 添加资源隔离测试**

持仓读取失败时自选仍可用；自选读取失败时已有持仓仍进入监控集合；错误只出现在对应资源，不抛路由级异常。

- [ ] **Step 2: 添加端到端式集成测试**

覆盖：账号自选包含 `000001` → 执行买入 → 权威持仓刷新出现 `000001` → monitor universe 同时包含 buyCodes/heldCodes → 收件箱执行卖出后持仓数量刷新 → 所有消费者版本一致。

- [ ] **Step 3: 添加旧请求跨账号保护测试**

A 账号慢请求未完成时切换 B；A 随后返回，断言 B 的自选、持仓和监控集合均不含 A 数据。

- [ ] **Step 4: 运行完整相关回归**

Run:

```powershell
npm test -- securities-account-cache.test.ts AuthProvider.test.tsx SecuritiesStateProvider.test.tsx useStockPositionLedger.cloud.test.tsx WatchlistPage.test.tsx ActualPositionsPanel.test.tsx SecuritiesDataSourceProvider.test.tsx useRealtimeBacktestMonitor.test.tsx RealtimeBacktestMonitorProvider.test.tsx CloudSignalInbox.test.tsx RealtimeBacktestDailyReview.test.tsx daily-review-orchestrator.test.ts StockAnalysisPage.test.tsx
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: 全部通过；lint 允许既有 warning，但不得出现本次文件新增 warning；生产构建成功。

- [ ] **Step 5: 本地人工烟雾验证**

打开 `http://localhost:5173`，以同一账号依次检查证券主页、自选股、实际持仓、云端收件箱和策略学习页。确认页面切换后数据不消失、无黑屏、无 Provider 异常，持仓和自选数量在各模块一致。

- [ ] **Step 6: 汇报但不提交**

列出完成任务、测试结果、已知既有 warning 和工作区文件；等待用户明确批准后才能 commit 或 push。
