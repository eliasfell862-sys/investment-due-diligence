# 自选股管理池综合评分排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让自选股管理池按中线 60%、短线 40% 的综合评分降序展示，并将低评分、回避和数据不足股票排到后面。

**Architecture:** 新建一个无副作用的纯排序模块，集中负责评分提取、加权、建议等级映射和稳定排序。`WatchlistPage` 只把现有行情与建议状态交给该模块并渲染返回的副本，原自选股数组、分组、持仓和监控数据均不修改。

**Tech Stack:** React 19、TypeScript 6、Vitest、Testing Library。

## Global Constraints

- 综合评分固定为中线评分 60% + 短线评分 40%。
- 只有一种有效评分时直接使用该评分。
- 两项评分均缺失、失败或为 `insufficient_data` 时放到末尾。
- 同分时按买入、观望、回避排序，再按原始自选股顺序稳定排序。
- 仅改变展示顺序，不改变本地存储顺序、分组、持仓、回测监控或个股分析页面。
- 不使用子代理实施。

---

### Task 1: 建立综合评分纯排序模块

**Files:**
- Create: `app/src/features/securities/watchlist-score-sort.ts`
- Create: `app/src/features/securities/watchlist-score-sort.test.ts`

**Interfaces:**
- Consumes: `WatchlistAdviceTaskState`、`WatchlistShortTermTaskState` 和任意带 `code: string` 的只读项目数组。
- Produces:

```ts
export type WatchlistAdvicePriority = 'buy' | 'watch' | 'avoid' | 'unrated';

export interface WatchlistSortMetric {
  combinedScore: number | null;
  priority: WatchlistAdvicePriority;
}

export function deriveWatchlistSortMetric(
  mediumState: WatchlistAdviceTaskState | undefined,
  shortState: WatchlistShortTermTaskState | undefined,
): WatchlistSortMetric;

export function sortWatchlistItemsByAdvice<T extends { code: string }>(
  items: readonly T[],
  mediumStates: Readonly<Record<string, WatchlistAdviceTaskState>>,
  shortStates: Readonly<Record<string, WatchlistShortTermTaskState>>,
): T[];
```

- [ ] **Step 1: 写双评分加权和稳定排序的失败测试**

在 `watchlist-score-sort.test.ts` 中建立精简 advice 工厂，并断言：中线 80、短线 50 得到 68；中线 70、短线 90 得到 78，因此第二只股票排在第一只之前，同时原输入数组顺序不变。

```ts
it('weights medium score at 60 percent and short score at 40 percent without mutating input', () => {
  const items = [{ code: 'A' }, { code: 'B' }];
  const original = [...items];
  const result = sortWatchlistItemsByAdvice(items, {
    A: mediumSuccess(80, 'accumulate'),
    B: mediumSuccess(70, 'accumulate'),
  }, {
    A: shortSuccess(50, 'buy_on_dip'),
    B: shortSuccess(90, 'buy_on_dip'),
  });

  expect(result.map(item => item.code)).toEqual(['B', 'A']);
  expect(items).toEqual(original);
  expect(deriveWatchlistSortMetric(
    mediumSuccess(80, 'accumulate'),
    shortSuccess(50, 'buy_on_dip'),
  ).combinedScore).toBe(68);
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run:

```powershell
npm test -- --run src/features/securities/watchlist-score-sort.test.ts
```

Expected: FAIL，提示无法解析 `./watchlist-score-sort`。

- [ ] **Step 3: 实现评分提取和 60/40 加权**

在 `watchlist-score-sort.ts` 中仅接受 `status === 'success'` 且 action 不为 `insufficient_data` 的评分。

```ts
function validMedium(state: WatchlistAdviceTaskState | undefined) {
  return state?.status === 'success' && state.advice.action !== 'insufficient_data'
    ? state.advice
    : null;
}

function validShort(state: WatchlistShortTermTaskState | undefined) {
  return state?.status === 'success' && state.advice.action !== 'insufficient_data'
    ? state.advice
    : null;
}

function combinedScore(mediumScore: number | null, shortScore: number | null): number | null {
  if (mediumScore !== null && shortScore !== null) return mediumScore * 0.6 + shortScore * 0.4;
  return mediumScore ?? shortScore;
}
```

- [ ] **Step 4: 写单评分、无评分和建议等级的失败测试**

覆盖以下断言：

```ts
expect(deriveWatchlistSortMetric(mediumSuccess(76, 'watch'), undefined).combinedScore).toBe(76);
expect(deriveWatchlistSortMetric(undefined, shortSuccess(64, 'hold_watch')).combinedScore).toBe(64);
expect(deriveWatchlistSortMetric({ status: 'error', error: 'failed' }, undefined)).toEqual({
  combinedScore: null,
  priority: 'unrated',
});
```

再构造四只同分股票并断言顺序为 `buy -> watch -> avoid -> unrated`。动作映射必须是：

```ts
const BUY_ACTIONS = new Set(['accumulate', 'cautious_buy', 'strong_buy', 'buy_on_dip']);
const WATCH_ACTIONS = new Set(['watch', 'hold_watch']);
const AVOID_ACTIONS = new Set(['avoid_buying', 'risk_avoidance', 'avoid', 'reduce_sell']);
```

当一只股票两种建议冲突时，使用更积极的等级作为同分排序等级；例如中线 `watch`、短线 `avoid` 的整体等级为 `watch`。

- [ ] **Step 5: 实现建议等级和稳定排序**

排序键依次为：有效评分存在性、综合评分降序、`buy=0/watch=1/avoid=2/unrated=3`、原始索引。先用 `items.map((item, index) => ...)` 保存原始索引，再对新数组排序，禁止直接调用 `items.sort()`。

- [ ] **Step 6: 运行纯排序模块测试**

Run:

```powershell
npm test -- --run src/features/securities/watchlist-score-sort.test.ts
```

Expected: PASS，覆盖双评分、单评分、数据不足、错误、等级冲突、稳定顺序和输入不可变。

- [ ] **Step 7: 提交纯排序模块**

```powershell
git add app/src/features/securities/watchlist-score-sort.ts app/src/features/securities/watchlist-score-sort.test.ts
git commit -m "feat: rank watchlist stocks by combined advice score"
```

---

### Task 2: 将综合排序接入自选股表格

**Files:**
- Modify: `app/src/features/securities/WatchlistPage.tsx`
- Modify: `app/src/features/securities/WatchlistPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `sortWatchlistItemsByAdvice(filteredQuotes, adviceStates, shortTermStates)`。
- Produces: `WatchlistPage` 按最新建议状态渲染排序后的行情列表，但继续以 `activeWl.codes` 订阅行情和保存自选股。

- [ ] **Step 1: 写页面排序的失败测试**

在 `WatchlistPage.test.tsx` 新增两只股票场景：本地自选顺序为低分股票在前、高分股票在后；mock 两类分析服务按股票代码返回不同评分。

```ts
it('renders higher combined advice scores before lower scores without changing the saved pool order', async () => {
  localStorage.setItem('sec_watchlists_v2', JSON.stringify([{
    id: 'default', name: '测试股池', codes: ['000001', '600519'],
    createdAt: '2026-08-04', groups: [], codeGroups: {},
  }]));

  // 000001: medium 40, short 40 => 40
  // 600519: medium 90, short 80 => 86
  renderWatchlist();

  const rows = await screen.findAllByRole('row');
  expect(rows[1]).toHaveTextContent('600519');
  expect(rows[2]).toHaveTextContent('000001');
  expect(JSON.parse(localStorage.getItem('sec_watchlists_v2')!)[0].codes)
    .toEqual(['000001', '600519']);
});
```

mock 的 `analyzeWatchlistQuotes` 与 `analyzeWatchlistShortTermQuotes` 必须遍历传入 quotes，并按 code 调用 `options.onUpdate`，以验证异步评分完成后页面自动重新排序。

- [ ] **Step 2: 运行页面测试并确认仍按原始自选顺序失败**

Run:

```powershell
npm test -- --run src/features/securities/WatchlistPage.test.tsx
```

Expected: 新测试 FAIL，首个数据行仍为 `000001`。

- [ ] **Step 3: 在页面创建排序后的展示副本**

导入 Task 1 的排序函数，将现有：

```ts
const filteredQuotes = quotes.filter(q => filteredCodes.has(q.code));
```

替换为不改变订阅和存储的两步计算：

```ts
const filteredQuotes = sortWatchlistItemsByAdvice(
  quotes.filter(quote => filteredCodes.has(quote.code)),
  adviceStates,
  shortTermStates,
);
```

不得改变 `quotes` 的构造顺序、`activeWl.codes`、分析任务输入或 `useRealtimeStockQuotes` 参数。纯排序函数只生成展示副本，因此不需要为这一小规模自选列表增加额外缓存层。

- [ ] **Step 4: 运行页面和排序模块测试**

Run:

```powershell
npm test -- --run src/features/securities/watchlist-score-sort.test.ts src/features/securities/WatchlistPage.test.tsx
```

Expected: PASS。

- [ ] **Step 5: 运行证券相关回归测试和类型检查**

Run:

```powershell
npm test -- --run src/features/securities/WatchlistPage.test.tsx src/features/securities/WatchlistAdviceCell.test.tsx src/features/securities/WatchlistShortTermAdviceCell.test.tsx src/features/securities/watchlist-buy-advice-service.test.ts src/features/securities/watchlist-short-term-advice-service.test.ts
npm run typecheck
```

Expected: 所有测试 PASS，TypeScript 退出码 0。

- [ ] **Step 6: 手工验证边界**

在 `http://localhost:5173/securities/watchlist` 验证：

- 建议逐只完成时，高分股票自动上移。
- “刷新全部建议”后重新按最新评分排列。
- 分组筛选后仅对可见股票排序。
- 点击股票仍进入原个股分析路径。
- 删除、标签和加入持仓按钮仍作用于正确股票。
- 刷新页面后本地存储的 `codes` 顺序未被改写。

- [ ] **Step 7: 提交页面集成**

```powershell
git add app/src/features/securities/WatchlistPage.tsx app/src/features/securities/WatchlistPage.test.tsx
git commit -m "feat: sort watchlist display by advice score"
```

---

### Task 3: 最终验证与交付检查

**Files:**
- Verify only; no production file changes expected.

**Interfaces:**
- Consumes: Task 1 的纯排序模块和 Task 2 的页面集成。
- Produces: 可复核的测试结果与最终工作区状态。

- [ ] **Step 1: 运行完整相关测试**

```powershell
npm test -- --run src/features/securities/watchlist-score-sort.test.ts src/features/securities/WatchlistPage.test.tsx src/features/securities/WatchlistAdviceCell.test.tsx src/features/securities/WatchlistShortTermAdviceCell.test.tsx src/features/securities/watchlist-buy-advice-service.test.ts src/features/securities/watchlist-short-term-advice-service.test.ts src/features/securities/useRealtimeStockQuotes.test.tsx
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行静态检查**

```powershell
npm run typecheck
npm run lint
```

Expected: typecheck 退出码 0；lint 无新增错误。项目原有 warning 如仍存在，需确认与本次文件无关。

- [ ] **Step 3: 检查改动范围**

```powershell
git diff -- app/src/features/securities/watchlist-score-sort.ts app/src/features/securities/watchlist-score-sort.test.ts app/src/features/securities/WatchlistPage.tsx app/src/features/securities/WatchlistPage.test.tsx
git status --short
```

确认未修改 `StockAnalysisPage.tsx`、持仓账本、回测引擎、云端 Worker 或用户/Claude 的其他未提交文件。

- [ ] **Step 4: 汇报结果**

向用户说明实际排序公式、缺失数据处理、是否保持原保存顺序、测试结果和刷新页面方式；不要声称未实际验证的行为。

