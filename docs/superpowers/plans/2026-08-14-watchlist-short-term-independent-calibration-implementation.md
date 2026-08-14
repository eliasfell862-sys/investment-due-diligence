# 自选股短线建议独立校准 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为当前账号全部自选股建立 `watchlist-short-term-v1` 的无未来数据历史校准，并在自选股短线建议详情中展示费用后胜率、成交率、收益风险和数据可信度。

**Architecture:** 新功能放在独立的 `watchlist-short-term-calibration` 目录。校准专用行情读取优先获得东方财富 `f51`–`f61` 历史数据；缺少换手率时仅在校准内部生成 `proxy` 口径。滚动引擎按历史日重建现有短线建议，交易回放负责三日限价等待、T+1、费用和退出，结果只写本地 Dexie；自选股页面只负责传入当前账号全部自选代码并展示状态。

**Tech Stack:** React 19、TypeScript 6、Vitest 4、Dexie 4、Decimal.js、现有短线建议/技术指标/策略/形态/交易费率引擎。

## Global Constraints

- 模型标识固定为 `watchlist-short-term-v1`。
- 当前账号全部自选股去重；不使用默认股池，不扫描全部 A 股。
- 最近最多 500 个交易日，前 60 个交易日只用于指标预热；少于 120 个有效交易日跳过。
- 只校准 `strong_buy` 和 `buy_on_dip`；未成交信号不进入胜率分母。
- 买入信号后等待 3 个交易日，标准成交数量 100 股，严格执行 A 股 T+1。
- 复用当前 `TradingFeeProfile` 和 `calculateActualTradeFees()`；所有收益指标为费用后口径。
- 20–99 笔为 `preliminary`，至少 100 笔且全部有效股票为 `direct` 才能为 `established`。
- 任一有效股票使用 `proxy` 换手率时，整体可信度最高为 `preliminary`。
- 有效股票覆盖率低于 70% 时为 `insufficient`；未来数据泄漏检查失败时为 `blocked`。
- 结果仅存本地 IndexedDB，不新增 Supabase 表或云端存储。
- 不修改现有个股分析页、`fetchEastmoneyKLine()`、持仓、收件箱、实时交易信号或 Kronos 文件。
- 不使用子代理；按本计划在当前会话用 TDD 顺序执行。

---

## File Map

- Create `app/src/infrastructure/market-data/watchlist-calibration-history.ts`: 校准专用东财历史日线解析、failover、换手率代理降级。
- Create `app/src/features/securities/watchlist-short-term-calibration/types.ts`: 校准领域类型和固定版本常量。
- Create `app/src/features/securities/watchlist-short-term-calibration/trade-replay.ts`: 三日成交、T+1 和费用后退出回放。
- Create `app/src/features/securities/watchlist-short-term-calibration/rolling-signals.ts`: 无未来数据地滚动重建短线建议。
- Create `app/src/features/securities/watchlist-short-term-calibration/aggregate.ts`: 指标汇总、分组降级、20/100 门槛和可信度。
- Create `app/src/features/securities/watchlist-short-term-calibration/calibration-db.ts`: 独立 Dexie 数据库。
- Create `app/src/features/securities/watchlist-short-term-calibration/calibration-repository.ts`: 最新结果、最近交易和每日尝试记录。
- Create `app/src/features/securities/watchlist-short-term-calibration/calibration-service.ts`: 全部自选股批处理与进度。
- Create `app/src/features/securities/watchlist-short-term-calibration/useWatchlistShortTermCalibration.ts`: 每日自动一次、手动重跑、保留旧结果。
- Create `app/src/features/securities/watchlist-short-term-calibration/WatchlistShortTermCalibrationCard.tsx`: 校准卡片。
- Modify `app/src/features/securities/WatchlistShortTermAdviceCell.tsx`: 在展开详情中挂载校准卡片槽位。
- Modify `app/src/features/securities/WatchlistPage.tsx`: 汇总全部自选代码、读取费率、接入 Hook。

### Task 1: 校准专用历史日线与换手率口径

**Files:**
- Create: `app/src/infrastructure/market-data/watchlist-calibration-history.ts`
- Test: `app/src/infrastructure/market-data/watchlist-calibration-history.test.ts`

**Interfaces:**
- Produces: `CalibrationHistoryRow`, `CalibrationHistoryResult`, `parseCalibrationHistoryResponse()`, `estimateProxyTurnover()`, `fetchWatchlistCalibrationHistory()`。
- Consumes: `requestWithEastmoneyFailover()`、`fetchEastmoneyKLine()`。

- [ ] **Step 1: 写解析与代理口径失败测试**

```ts
it('parses f51-f61 and marks complete turnover as direct', () => {
  const result = parseCalibrationHistoryResponse({ data: { klines: [
    '2026-08-01,10,10.5,10.8,9.9,1200,1260000,9,5,0.5,3.2',
  ] } });
  expect(result).toEqual([{ date: '2026-08-01', open: 10, close: 10.5, high: 10.8,
    low: 9.9, volume: 1200, amount: 1260000, amplitude: 9, changePct: 5,
    change: 0.5, turnover: 3.2 }]);
});

it('uses only prior volume when estimating proxy turnover', () => {
  const prior = Array.from({ length: 20 }, (_, index) => ({ volume: 100 + index }));
  expect(estimateProxyTurnover(240, prior)).toBeGreaterThan(0);
  expect(estimateProxyTurnover(240, [])).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run (workdir `app`): `npx vitest run src/infrastructure/market-data/watchlist-calibration-history.test.ts`
Expected: FAIL，模块或导出不存在。

- [ ] **Step 3: 实现专用接口与降级**

```ts
export type CalibrationTurnoverMode = 'direct' | 'proxy';

export interface CalibrationHistoryRow extends StockKLine {
  amplitude: number | null;
  changePct: number;
  change: number;
  turnover: number | null;
}

export interface CalibrationHistoryResult {
  rows: CalibrationHistoryRow[];
  turnoverMode: CalibrationTurnoverMode;
  source: string;
  warnings: string[];
}

export function estimateProxyTurnover(
  currentVolume: number,
  priorRows: ReadonlyArray<Pick<StockKLine, 'volume'>>,
): number | null {
  const values = priorRows.slice(-20).map(row => row.volume).filter(value => value > 0);
  if (values.length < 10 || currentVolume <= 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(Math.min(20, Math.max(0.1, currentVolume / mean * 3)) * 100) / 100;
}
```

请求 URL 使用 `push2his.eastmoney.com/api/qt/stock/kline/get`、`klt=101`、`fqt=1`、`lmt<=500`、`fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`。若直接请求失败或任一进入回放区间的换手率无效，则调用现有 `fetchEastmoneyKLine(code, 500)` 并只在返回副本上填入代理值，整只股票标记为 `proxy`。

- [ ] **Step 4: 增加 failover、部分缺失和不污染原数据测试并运行**

Run (workdir `app`): `npx vitest run src/infrastructure/market-data/watchlist-calibration-history.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add app/src/infrastructure/market-data/watchlist-calibration-history.ts app/src/infrastructure/market-data/watchlist-calibration-history.test.ts
git commit -m "feat: load short-term calibration history"
```

### Task 2: 买入成交与 T+1 退出回放

**Files:**
- Create: `app/src/features/securities/watchlist-short-term-calibration/types.ts`
- Create: `app/src/features/securities/watchlist-short-term-calibration/trade-replay.ts`
- Test: `app/src/features/securities/watchlist-short-term-calibration/trade-replay.test.ts`

**Interfaces:**
- Produces: `CalibrationSignal`, `CalibrationTrade`, `CalibrationUnfilledSignal`, `replayCalibrationSignal()`。
- Consumes: `CalibrationHistoryRow`、`TradingFeeProfile`、`calculateActualTradeFees()`。

- [ ] **Step 1: 定义冻结信号和交易结果类型**

```ts
export const WATCHLIST_SHORT_TERM_CALIBRATION_MODEL = 'watchlist-short-term-v1';
export interface CalibrationSignal {
  code: string;
  signalDate: string;
  action: 'strong_buy' | 'buy_on_dip';
  entryRange: { low: number; high: number };
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  maxHoldingTradingDays: number;
}
export type CalibrationReplayResult = CalibrationTrade | CalibrationUnfilledSignal | { kind: 'incomplete' };
```

- [ ] **Step 2: 写成交规则失败测试**

覆盖：开盘在区间内按开盘价、从上方回落按上沿、从下方进入按下沿、三日未触及、成交量为零、单价一字涨跌停不成交。

- [ ] **Step 3: 运行测试确认失败**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/trade-replay.test.ts`
Expected: FAIL，`replayCalibrationSignal` 不存在。

- [ ] **Step 4: 实现成交和退出顺序**

```ts
export function replayCalibrationSignal(input: ReplayCalibrationSignalInput): CalibrationReplayResult {
  const fill = findEntryFill(input.signal, input.futureRows.slice(0, 3));
  if (!fill) return { kind: 'unfilled', code: input.signal.code, signalDate: input.signal.signalDate };
  const exitRows = input.futureRows.slice(fill.futureIndex + 1,
    fill.futureIndex + 1 + input.signal.maxHoldingTradingDays);
  if (exitRows.length === 0) return { kind: 'incomplete' };
  return replayExitWithFees({ ...input, fill, exitRows, shares: 100 });
}
```

退出优先级固定为：T+1 后开盘跳空止损/日内止损 → 第一止盈 → 最长持有期收盘。单日同时触及止损和止盈按止损；第一止盈成交后继续观察原期限内第二止盈路径但不改收益。手续费分别对买入和卖出调用 `calculateActualTradeFees()`；净收益大于 0 才记胜。

- [ ] **Step 5: 增加费用、T+1、同日双触发和第二止盈路径测试并运行**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/trade-replay.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add app/src/features/securities/watchlist-short-term-calibration/types.ts app/src/features/securities/watchlist-short-term-calibration/trade-replay.ts app/src/features/securities/watchlist-short-term-calibration/trade-replay.test.ts
git commit -m "feat: replay calibrated short-term trades"
```

### Task 3: 无未来数据的滚动短线信号

**Files:**
- Create: `app/src/features/securities/watchlist-short-term-calibration/rolling-signals.ts`
- Test: `app/src/features/securities/watchlist-short-term-calibration/rolling-signals.test.ts`

**Interfaces:**
- Produces: `generateRollingCalibrationSignals(code, rows, dependencies)`。
- Consumes: `calcAllIndicators()`、`scanStrategies()`、`scanPatterns()`、`buildShortTermTradingAdvice()`。

- [ ] **Step 1: 写历史报价构造与泄漏测试**

```ts
it('never passes rows after the signal date to indicator or advice builders', () => {
  const seenLastDates: string[] = [];
  generateRollingCalibrationSignals('600000', rows, {
    calcIndicators: slice => { seenLastDates.push(slice.at(-1)!.date); },
    buildAdvice: input => fakeAdvice(input.quote.code, input.dataAsOf),
  });
  expect(seenLastDates.every((date, index) => date === rows[index + 60].date)).toBe(true);
});
```

同时测试历史 `StockQuote` 的 `price=close`、`preClose=前收盘`、`changePct`、`open/high/low/volume/amount/turnover` 均来自信号日或更早数据。

- [ ] **Step 2: 运行测试确认失败**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/rolling-signals.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现滚动生成**

```ts
for (let index = 60; index < rows.length; index += 1) {
  const visible = rows.slice(0, index + 1).map(row => ({ ...row }));
  dependencies.calcIndicators(visible);
  const advice = dependencies.buildAdvice({
    quote: historicalQuote(code, rows[index - 1], rows[index]),
    klines: visible,
    strategies: dependencies.scanStrategies(visible),
    patterns: dependencies.scanPatterns(visible),
    dataAsOf: rows[index].date,
    calculatedAt: `${rows[index].date}T15:00:00+08:00`,
    cacheStatus: 'fresh',
  });
  if ((advice.action === 'strong_buy' || advice.action === 'buy_on_dip') && hasCompletePlan(advice)) {
    signals.push(freezeCalibrationSignal(advice, rows[index].date));
  }
}
```

- [ ] **Step 4: 测试只保留买入信号、冻结价格计划、输入不被修改并运行**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/rolling-signals.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add app/src/features/securities/watchlist-short-term-calibration/rolling-signals.ts app/src/features/securities/watchlist-short-term-calibration/rolling-signals.test.ts
git commit -m "feat: generate leak-free calibration signals"
```

### Task 4: 校准指标汇总与可信度

**Files:**
- Create: `app/src/features/securities/watchlist-short-term-calibration/aggregate.ts`
- Test: `app/src/features/securities/watchlist-short-term-calibration/aggregate.test.ts`
- Modify: `app/src/features/securities/watchlist-short-term-calibration/types.ts`

**Interfaces:**
- Produces: `aggregateCalibrationResult()`、`selectCalibrationMetricsForAction()`、`WatchlistShortTermCalibrationResult`。
- Consumes: 已成交、未成交、跳过股票、`direct/proxy` 股票计数。

- [ ] **Step 1: 写 20/100、覆盖率和 proxy 上限测试**

```ts
expect(aggregateFixture({ completed: 19 }).trust).toBe('insufficient');
expect(aggregateFixture({ completed: 20 }).trust).toBe('preliminary');
expect(aggregateFixture({ completed: 100, proxyStocks: 0 }).trust).toBe('established');
expect(aggregateFixture({ completed: 100, proxyStocks: 1 }).trust).toBe('preliminary');
expect(aggregateFixture({ completed: 100, coverage: 0.69 }).trust).toBe('insufficient');
```

- [ ] **Step 2: 运行测试确认失败**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/aggregate.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现指标**

统一输出：信号数、成交数、成交率、费用后胜率、平均净收益、按退出日期排序并复利生成的最大回撤、盈利总额/亏损总额绝对值的盈亏比、第一止盈率、第二止盈路径率、止损率、到期退出率、未成交率、有效/跳过股票数、覆盖率、截止日期、`direct/proxy` 数量和占比。`strong_buy` 或 `buy_on_dip` 分组少于 20 笔成交时，`selectCalibrationMetricsForAction()` 返回整体买入样本并标记 `overall_fallback`。

- [ ] **Step 4: 增加零分母、负平均收益提示、分组降级和 blocked 测试并运行**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/aggregate.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add app/src/features/securities/watchlist-short-term-calibration/types.ts app/src/features/securities/watchlist-short-term-calibration/aggregate.ts app/src/features/securities/watchlist-short-term-calibration/aggregate.test.ts
git commit -m "feat: aggregate short-term calibration evidence"
```

### Task 5: Dexie 本地仓库与过期判定

**Files:**
- Create: `app/src/features/securities/watchlist-short-term-calibration/calibration-db.ts`
- Create: `app/src/features/securities/watchlist-short-term-calibration/calibration-repository.ts`
- Test: `app/src/features/securities/watchlist-short-term-calibration/calibration-repository.test.ts`

**Interfaces:**
- Produces: `WatchlistShortTermCalibrationDb`、`WatchlistShortTermCalibrationRepository`、`calibrationFingerprint()`、`isCalibrationStale()`。

- [ ] **Step 1: 写账户隔离、事务替换和每日尝试测试**

使用 `fake-indexeddb` 建立两个 scope，验证 `user-a` 不能读取 `user-b`；保存新运行时事务删除旧运行的交易，只保留按退出日期倒序最近 100 笔；`recordAttempt(scopeId, tradingDate)` 可阻止同交易日重复自动运行。

- [ ] **Step 2: 运行测试确认失败**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/calibration-repository.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现数据库和指纹**

```ts
this.version(1).stores({
  runs: '&scopeId, createdAt, tradingDate, modelVersion',
  trades: 'id, runId, code, signalDate, exitDate',
  attempts: '&scopeId, tradingDate, attemptedAt',
});

export function calibrationFingerprint(input: {
  codes: string[]; feeProfile: TradingFeeProfile; modelVersion: string;
}): string {
  return stableFNV1a(JSON.stringify({
    codes: [...new Set(input.codes)].sort(), feeProfile: input.feeProfile,
    modelVersion: input.modelVersion,
  }));
}
```

过期条件包括：模型版本、代码集合、费率快照指纹改变，或进入新的本地交易日且当日尚未完成校准。

- [ ] **Step 4: 测试 IndexedDB 失败时错误可上抛但内存结果仍可用并运行**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/calibration-repository.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add app/src/features/securities/watchlist-short-term-calibration/calibration-db.ts app/src/features/securities/watchlist-short-term-calibration/calibration-repository.ts app/src/features/securities/watchlist-short-term-calibration/calibration-repository.test.ts
git commit -m "feat: persist local short-term calibration"
```

### Task 6: 当前账号全部自选股批处理服务

**Files:**
- Create: `app/src/features/securities/watchlist-short-term-calibration/calibration-service.ts`
- Test: `app/src/features/securities/watchlist-short-term-calibration/calibration-service.test.ts`

**Interfaces:**
- Produces: `runWatchlistShortTermCalibration(input, dependencies)`。
- Consumes: Tasks 1–5 的历史读取、滚动信号、回放、汇总和仓库。

- [ ] **Step 1: 写去重、并发、单股失败继续和覆盖率测试**

输入 `['600000', '000001', '600000']` 必须只请求两只；最大并发固定为 2；一只失败仍返回部分结果及跳过原因；少于 120 行直接跳过。

- [ ] **Step 2: 运行测试确认失败**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/calibration-service.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现批处理和进度**

```ts
export interface RunCalibrationInput {
  scopeId: string;
  codes: string[];
  feeProfile: TradingFeeProfile;
  force: boolean;
  onProgress?: (progress: { completed: number; total: number; currentCode: string }) => void;
}

export async function runWatchlistShortTermCalibration(
  input: RunCalibrationInput,
  dependencies: CalibrationServiceDependencies = defaultDependencies(),
): Promise<WatchlistShortTermCalibrationResult> {
  const codes = [...new Set(input.codes.filter(code => /^\d{6}$/.test(code)))].sort();
  const stockResults = await mapWithConcurrency(codes, 2, code => calibrateOneStock(code, input, dependencies));
  const result = aggregateCalibrationResult(stockResults, codes.length, input.feeProfile);
  try { await dependencies.repository.saveRun(input.scopeId, result); }
  catch { result.persistenceWarning = '本次结果可查看，但无法持久保存到本机'; }
  return result;
}
```

- [ ] **Step 4: 增加泄漏阻断、direct/proxy 统计、保存失败降级测试并运行**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/calibration-service.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add app/src/features/securities/watchlist-short-term-calibration/calibration-service.ts app/src/features/securities/watchlist-short-term-calibration/calibration-service.test.ts
git commit -m "feat: calibrate all watchlist stocks"
```

### Task 7: 每日自动一次与手动重新校准 Hook

**Files:**
- Create: `app/src/features/securities/watchlist-short-term-calibration/useWatchlistShortTermCalibration.ts`
- Test: `app/src/features/securities/watchlist-short-term-calibration/useWatchlistShortTermCalibration.test.tsx`

**Interfaces:**
- Produces: `useWatchlistShortTermCalibration({ scopeId, codes, feeProfile })`。

- [ ] **Step 1: 写旧结果优先显示和每日一次测试**

状态固定为：

```ts
type CalibrationHookState = {
  status: 'loading' | 'ready' | 'running' | 'error';
  result: WatchlistShortTermCalibrationResult | null;
  progress: { completed: number; total: number; currentCode: string } | null;
  error: string;
  stale: boolean;
  recalibrate: () => Promise<void>;
};
```

验证加载到旧结果后立即显示；当日已有 attempt 不自动重跑；新交易日且结果过期自动重跑；手动重跑忽略每日限制；运行失败保留旧结果。

- [ ] **Step 2: 运行测试确认失败**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/useWatchlistShortTermCalibration.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现取消发布保护和自动调度**

使用 `runIdRef` 防止卸载或 codes 变化后的旧任务覆盖新状态。自动运行前先 `recordAttempt()`；实时价格刷新不在依赖数组中，只有 `scopeId`、排序去重后的代码 key、费率指纹和交易日期改变才重新判断。

- [ ] **Step 4: 运行 Hook 测试**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/useWatchlistShortTermCalibration.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add app/src/features/securities/watchlist-short-term-calibration/useWatchlistShortTermCalibration.ts app/src/features/securities/watchlist-short-term-calibration/useWatchlistShortTermCalibration.test.tsx
git commit -m "feat: schedule watchlist calibration runs"
```

### Task 8: 自选股短线详情卡片接入

**Files:**
- Create: `app/src/features/securities/watchlist-short-term-calibration/WatchlistShortTermCalibrationCard.tsx`
- Test: `app/src/features/securities/watchlist-short-term-calibration/WatchlistShortTermCalibrationCard.test.tsx`
- Modify: `app/src/features/securities/WatchlistShortTermAdviceCell.tsx`
- Modify: `app/src/features/securities/WatchlistShortTermAdviceCell.test.tsx`
- Modify: `app/src/features/securities/WatchlistPage.tsx`
- Modify: `app/src/features/securities/WatchlistPage.test.tsx`

**Interfaces:**
- Consumes: Hook 状态、当前行 `ShortTermTradingAdvice.action`。
- Produces: 用户可见校准状态、进度、指标、数据口径和重新校准按钮。

- [ ] **Step 1: 写卡片展示测试**

验证：非买入建议显示“不适用买入胜率”；买入建议优先展示对应 action 分组，少于 20 笔显示“总体样本降级”；显示成交率与胜率两个不同字段；显示 20/100 样本等级；显示 direct/proxy 数量和代理限制；运行中显示 `已处理 x / y` 且旧指标仍可见。

- [ ] **Step 2: 运行测试确认失败**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/WatchlistShortTermCalibrationCard.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现卡片并扩展详情行 props**

```tsx
export interface WatchlistShortTermAdviceDetailRowProps {
  advice: ShortTermTradingAdvice;
  colSpan: number;
  calibration: CalibrationHookState;
}

<WatchlistShortTermCalibrationCard
  action={advice.action}
  state={calibration}
/>
```

- [ ] **Step 4: 在 WatchlistPage 汇总全部自选代码并接入费率**

```tsx
const allWatchlistCodes = useMemo(
  () => [...new Set(watchlists.flatMap(watchlist => watchlist.codes))].sort(),
  [watchlists],
);
const tTrading = useTTradingState();
const calibration = useWatchlistShortTermCalibration({
  scopeId: user?.id ?? 'local',
  codes: allWatchlistCodes,
  feeProfile: tTrading.state.feeProfile,
});
```

只将 `calibration` 传给 `WatchlistShortTermAdviceDetailRow`；不改变现有短线分析、排序、加入持仓、个股跳转和实时刷新 effect。

- [ ] **Step 5: 运行组件与页面回归测试**

Run (workdir `app`): `npx vitest run src/features/securities/watchlist-short-term-calibration/WatchlistShortTermCalibrationCard.test.tsx src/features/securities/WatchlistShortTermAdviceCell.test.tsx src/features/securities/WatchlistPage.test.tsx`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add app/src/features/securities/watchlist-short-term-calibration/WatchlistShortTermCalibrationCard.tsx app/src/features/securities/watchlist-short-term-calibration/WatchlistShortTermCalibrationCard.test.tsx app/src/features/securities/WatchlistShortTermAdviceCell.tsx app/src/features/securities/WatchlistShortTermAdviceCell.test.tsx app/src/features/securities/WatchlistPage.tsx app/src/features/securities/WatchlistPage.test.tsx
git commit -m "feat: show watchlist calibration evidence"
```

### Task 9: 完整验证与边界审计

**Files:**
- Modify only if a failing test identifies a defect in Tasks 1–8.

- [ ] **Step 1: 运行新功能定向测试**

Run (workdir `app`): `npx vitest run src/infrastructure/market-data/watchlist-calibration-history.test.ts src/features/securities/watchlist-short-term-calibration`
Expected: PASS。

- [ ] **Step 2: 运行自选股相关回归测试**

Run (workdir `app`): `npx vitest run src/features/securities/WatchlistPage.test.tsx src/features/securities/WatchlistShortTermAdviceCell.test.tsx src/features/securities/watchlist-short-term-advice-service.test.ts`
Expected: PASS。

- [ ] **Step 3: 运行完整测试、类型检查、lint 和构建**

Run (workdir `app`): `npm run typecheck`
Expected: PASS。

Run (workdir `app`): `npm test`
Expected: PASS。

Run (workdir `app`): `npm run lint`
Expected: PASS；若仅出现项目既有警告，记录文件与数量，不扩大本功能范围修复。

Run (workdir `app`): `npm run build`
Expected: PASS。

- [ ] **Step 4: 检查禁止修改边界与工作区**

Run: `git status --short`

Run: `git diff --name-only HEAD~8..HEAD`
Expected: 不包含个股分析页、现有 K 线函数语义、Supabase migration、持仓、收件箱、交易信号运行时或 Kronos 文件；用户原有未提交 Kronos 文件仍保持未暂存。

- [ ] **Step 5: 最终提交（仅在验证修复产生新改动时）**

```bash
git add app/src/infrastructure/market-data/watchlist-calibration-history.ts app/src/infrastructure/market-data/watchlist-calibration-history.test.ts app/src/features/securities/watchlist-short-term-calibration app/src/features/securities/WatchlistShortTermAdviceCell.tsx app/src/features/securities/WatchlistShortTermAdviceCell.test.tsx app/src/features/securities/WatchlistPage.tsx app/src/features/securities/WatchlistPage.test.tsx
git commit -m "fix: harden watchlist calibration boundaries"
```
