# 虚拟仓每日复盘与策略学习实验室实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有虚拟交易账本上建立每日复盘、半月候选生成、样本外与前向验证、月度人工审批和完整审计闭环。

**Architecture:** 新功能位于独立的 strategy-learning 目录并使用独立 Dexie 数据库。每日复盘只读取冻结快照；候选策略与正式策略隔离，只有审批事务可以新增正式版本。

**Tech Stack:** React 19、TypeScript 6、Vite 8、Vitest 4、Testing Library、Dexie 4。

## Global Constraints

- 每日复盘不修改正式策略、实际持仓或自动下单。
- 每10个交易日生成受控候选；每月仅提交通过门槛的候选。
- 候选至少完成20个交易日前向观察和30笔闭环交易。
- 未来行情只能用于结果验证，不得进入决策时点特征。
- 默认阈值与设计规格一致，变更必须写入审计轨迹。
- 不修改 StockAnalysisPage.tsx 或个股分析路由。
- 不覆盖现有未提交周期策略文件和 analysis 目录。
- 每项任务执行 RED → GREEN → REFACTOR 并独立提交。

## Test Fixture Convention

Every helper shown in a test snippet is a test-local typed builder. Define builders with the exported domain type and shallow overrides:

```ts
const fixture = <T>(base: T, overrides: Partial<T> = {}): T => ({ ...base, ...overrides });
```

---

### Task 1: 领域模型与独立仓库

**Files:**
- Create: `app/src/features/securities/strategy-learning/types.ts`
- Create: `app/src/features/securities/strategy-learning/strategy-learning-db.ts`
- Create: `app/src/features/securities/strategy-learning/strategy-learning-repository.ts`
- Test: `app/src/features/securities/strategy-learning/strategy-learning-repository.test.ts`

**Interfaces:** Produces `StrategyLearningRepository` and all review, pattern, candidate, validation, approval and audit types.

- [ ] **Step 1: Write failing idempotency and audit tests**

```ts
it('stores one review per date and strategy version', async () => {
  await repository.saveDailyReview(review('review-1'));
  await expect(repository.saveDailyReview(review('review-2')))
    .rejects.toThrow('该交易日和策略版本已经完成复盘');
});
it('keeps audit events append-only', async () => {
  await repository.appendAudit(audit('audit-1', 2));
  await repository.appendAudit(audit('audit-2', 3));
  expect(await repository.listAuditEvents('settings', 'promotion-gates')).toHaveLength(2);
});
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/strategy-learning-repository.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement types and Dexie schema**

Required statuses:

```ts
export type CandidateStatus =
  | 'draft' | 'validating' | 'observing' | 'rejected'
  | 'approval_ready' | 'approval_ready_with_risk'
  | 'active' | 'superseded' | 'rolled_back';
export type EvidenceKind =
  | 'fact' | 'calculation' | 'model_judgment'
  | 'hypothesis' | 'insufficient_evidence';
```

Required tables and indexes:

```ts
this.version(1).stores({
  snapshots: 'id, &[tradingDate+strategyId+strategyVersion], tradingDate',
  dailyReviews: 'id, &[tradingDate+strategyId+strategyVersion], status',
  decisionReviews: 'id, dailyReviewId, code, virtualTradeId, virtualCycleId',
  patterns: 'id, &patternKey, lastSeenAt, candidateEligible',
  strategyVersions: 'id, &[strategyId+version], strategyId, status',
  candidates: 'id, &[baseStrategyId+candidateVersion], status',
  validationRuns: 'id, candidateId, validationType, createdAt',
  forwardObservations: 'id, &[candidateId+tradingDate], candidateId',
  approvals: 'id, candidateId, action, createdAt',
  auditEvents: 'id, [entityType+entityId], eventType, createdAt',
});
```

Repository must clone inputs, reject duplicate daily keys, expose typed list/get methods, and never update or delete audit rows.

Also expose `exportBundle(): Promise<StrategyLearningExportV1>`; it returns schemaVersion1 plus every table sorted by stable key. Add a test that two unchanged exports are deeply equal.

- [ ] **Step 4: Run GREEN and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/strategy-learning-repository.test.ts
.\node_modules\.bin\oxlint.cmd src/features/securities/strategy-learning
.\node_modules\.bin\tsc.cmd -b --pretty false
git add app/src/features/securities/strategy-learning
git commit -m "feat: add strategy learning repository"
```

---

### Task 2: 版本化技术策略配置

**Files:**
- Create: `app/src/features/securities/strategy-learning/technical-strategy-config.ts`
- Test: `app/src/features/securities/strategy-learning/technical-strategy-config.test.ts`
- Modify: `app/src/engines/market-analysis/backtest-strategy.ts`
- Test: `app/src/engines/market-analysis/backtest-strategy.test.ts`

**Interfaces:** Produces `TechnicalStrategyConfig`, `DEFAULT_TECHNICAL_STRATEGY_CONFIG`, `evaluateConfiguredBacktestBar`.

- [ ] **Step 1: Write failing compatibility and safety tests**

```ts
expect(evaluateConfiguredBacktestBar(
  klinesWithRsi6(25), 60, { inPosition: false }, DEFAULT_TECHNICAL_STRATEGY_CONFIG,
)).toMatchObject({ action: 'buy', reasons: ['RSI超卖'] });
expect(() => validateTechnicalStrategyConfig({
  ...DEFAULT_TECHNICAL_STRATEGY_CONFIG, stopLossPct: 35,
})).toThrow('止损比例必须在3%到15%之间');
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/technical-strategy-config.test.ts src/engines/market-analysis/backtest-strategy.test.ts
```

- [ ] **Step 3: Implement config and evaluator**

Config contains buy/sell score thresholds; weights for MACD、KDJ、RSI、BOLL、MA20; KDJ/RSI/BOLL thresholds; stop loss and maximum holding days.

Safe ranges: weights0–2; scores0.5–5; KDJ buy5–35; KDJ sell65–95; RSI15–40; BOLL tolerance0–3%; stop loss3–15%; holding days5–120.

Default weights and score thresholds are1, so any existing single signal still triggers. Existing `evaluateBacktestBar` delegates to the configured evaluator with default config.

- [ ] **Step 4: Verify compatibility and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/engines/market-analysis/backtest-strategy.test.ts src/engines/market-analysis/backtest-engine.test.ts src/features/securities/realtime-backtest-monitor.test.ts
.\node_modules\.bin\tsc.cmd -b --pretty false
git add app/src/features/securities/strategy-learning app/src/engines/market-analysis/backtest-strategy.ts app/src/engines/market-analysis/backtest-strategy.test.ts
git commit -m "feat: add versioned technical strategy config"
```

---

### Task 3: 冻结每日决策快照

**Files:**
- Create: `app/src/features/securities/strategy-learning/daily-snapshot-builder.ts`
- Test: `app/src/features/securities/strategy-learning/daily-snapshot-builder.test.ts`
- Modify: repository, database and types from Task1.

**Interfaces:** `buildDailyReviewSnapshot(input): Promise<StrategyLearningSnapshot>`.

- [ ] **Step 1: Write failing no-lookahead test**

```ts
const snapshot = await buildDailyReviewSnapshot(input({
  tradingDate: '2026-08-06',
  bars: [bar('2026-08-05'), bar('2026-08-06'), bar('2026-08-07')],
}));
expect(snapshot.stocks['000001'].bars.map(item => item.date))
  .toEqual(['2026-08-05', '2026-08-06']);
expect((await buildDailyReviewSnapshot(input())).id)
  .toBe((await buildDailyReviewSnapshot(input())).id);
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/daily-snapshot-builder.test.ts
```

- [ ] **Step 3: Implement snapshot construction**

Normalize union of watchlist, actual and virtual positions; load250 bars with concurrency8; remove future bars; calculate indicators on clones; mark fewer than60 bars blocking; freeze ledgers and strategy config; calculate canonical SHA-256 input hash; use ID `snapshot-{date}-{strategyId}-{version}-{hash12}`.

- [ ] **Step 4: Run GREEN and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/daily-snapshot-builder.test.ts src/features/securities/strategy-learning/strategy-learning-repository.test.ts
.\node_modules\.bin\tsc.cmd -b --pretty false
git add app/src/features/securities/strategy-learning
git commit -m "feat: freeze daily strategy snapshots"
```

---

### Task 4: 逐笔归因与每日复盘

**Files:**
- Create: `app/src/features/securities/strategy-learning/decision-attribution.ts`, `app/src/features/securities/strategy-learning/daily-review-engine.ts`
- Test: `app/src/features/securities/strategy-learning/decision-attribution.test.ts`, `app/src/features/securities/strategy-learning/daily-review-engine.test.ts`

**Interfaces:** `attributeVirtualTransaction(input)`; `runDailyStrategyReview(input)`.

- [ ] **Step 1: Write failing process-vs-result tests**

```ts
const result = attributeVirtualTransaction(input({
  reason: 'RSI超卖', rsi6: 26, nextDayReturnPct: null,
}));
expect(result.processQuality).toBe('good');
expect(result.resultQuality).toBe('pending_follow_up');
expect(attributeVirtualTransaction(blockingInput()).confidence).toBe(0);
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/decision-attribution.test.ts src/features/securities/strategy-learning/daily-review-engine.test.ts
```

- [ ] **Step 3: Implement deterministic attribution**

Check frozen indicator evidence, execution price, ATR distance, existing loss before add, T+1 eligibility and data quality. Emit fact/calculation/judgment/hypothesis badges. Blocking data emits only `insufficient_evidence`.

Use 510300 as the market proxy. Calculate industry attribution from the equal-weight return of watchlist stocks sharing the same official industry; fewer than3 peers produces `insufficient_evidence`.

Daily engine returns existing review for the same date/version; otherwise saves snapshot, decision reviews and summary in one repository transaction.

- [ ] **Step 4: Run GREEN and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/decision-attribution.test.ts src/features/securities/strategy-learning/daily-review-engine.test.ts
git add app/src/features/securities/strategy-learning
git commit -m "feat: add daily virtual trade review"
```

---

### Task 5: 漏掉机会与受控反事实

**Files:** Create `app/src/features/securities/strategy-learning/opportunity-cost.ts`, `app/src/features/securities/strategy-learning/opportunity-cost.test.ts`, `app/src/features/securities/strategy-learning/counterfactual-analysis.ts`, `app/src/features/securities/strategy-learning/counterfactual-analysis.test.ts`; modify `app/src/features/securities/strategy-learning/daily-review-engine.ts`.

- [ ] **Step 1: Write failing constraint tests**

```ts
expect(findMissedOpportunities(opportunityInput({ availableCash: 100000 }))[0])
  .toMatchObject({ status: 'awaiting_follow_up', day5ReturnPct: null });
expect(findMissedOpportunities(opportunityInput({ availableCash: 0 }))[0])
  .toMatchObject({ status: 'blocked_by_constraint', constraintReason: '可用资金不足' });
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/opportunity-cost.test.ts src/features/securities/strategy-learning/counterfactual-analysis.test.ts
```

- [ ] **Step 3: Implement**

Re-evaluate every watchlist code at the frozen final bar; reapply cash,10-position limit,30% industry limit,100-share lot and liquidity constraints. Follow-up returns stay null until day1/5/10/20.

Export `updateDueFollowUps(tradingDate, barsByCode, repository)`; it fills only horizons whose target trading date has arrived and never rewrites an already stored horizon.

Counterfactuals are limited to one-day delayed entry, one-day early exit,75%/125% safe position size, stop-loss ±1 point and holding-days ±10. Every item records `usesFutureOutcome: true` and `purpose: 'hypothesis_generation'`.

- [ ] **Step 4: Verify and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/opportunity-cost.test.ts src/features/securities/strategy-learning/counterfactual-analysis.test.ts src/features/securities/strategy-learning/daily-review-engine.test.ts
git add app/src/features/securities/strategy-learning
git commit -m "feat: add opportunity and counterfactual review"
```

---

### Task 6: 问题聚合与候选生成

**Files:** Create `app/src/features/securities/strategy-learning/pattern-aggregator.ts`, `app/src/features/securities/strategy-learning/pattern-aggregator.test.ts`, `app/src/features/securities/strategy-learning/candidate-generator.ts`, `app/src/features/securities/strategy-learning/candidate-generator.test.ts`.

- [ ] **Step 1: Write failing eligibility tests**

```ts
const pattern = aggregateLearningPatterns([
  decision('1', '000001', 'timing.chasing'),
  decision('2', '600519', 'timing.chasing'),
  decision('3', '300750', 'timing.chasing'),
], [])[0];
expect(pattern).toMatchObject({ occurrenceCount: 3, candidateEligible: true });
expect(generateStrategyCandidates(candidateInput('risk.stop_too_slow'))[0].status)
  .toBe('draft');
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/pattern-aggregator.test.ts src/features/securities/strategy-learning/candidate-generator.test.ts
```

- [ ] **Step 3: Implement**

Eligibility requires3 occurrences,2 stocks, average confidence0.65 and absolute return or drawdown impact0.5 point. Data-quality patterns create remediation actions, not trading candidates.

Mappings: chasing raises buy score0.25 and lowers MA20 weight0.1; slow stop lowers stop loss1 point; early exit raises sell score0.25. Clamp all values to Task2 ranges. Create one single-change candidate per pattern; combined candidate only touches disjoint fields.

- [ ] **Step 4: Verify and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/pattern-aggregator.test.ts src/features/securities/strategy-learning/candidate-generator.test.ts
.\node_modules\.bin\tsc.cmd -b --pretty false
git add app/src/features/securities/strategy-learning
git commit -m "feat: generate controlled strategy candidates"
```

---

### Task 7: 成本感知滚动验证与晋级门槛

**Files:** Create `app/src/features/securities/strategy-learning/strategy-validation-engine.ts`, `app/src/features/securities/strategy-learning/strategy-validation-engine.test.ts`, `app/src/features/securities/strategy-learning/promotion-gates.ts`, `app/src/features/securities/strategy-learning/promotion-gates.test.ts`.

- [ ] **Step 1: Write failing costs and gates tests**

```ts
expect(runStrategyValidation(validationInput()).candidateMetrics.netReturnPct)
  .toBeLessThan(runStrategyValidation(validationInput()).candidateMetrics.grossReturnPct);
expect(evaluatePromotionGates(gateInput({ closedTrades: 29 })).status)
  .toBe('continue_observing');
expect(evaluatePromotionGates(gateInput({
  baselineAnnual: 10, candidateAnnual: 12.5,
  baselineDrawdown: 10, candidateDrawdown: 11,
})).status).toBe('approval_ready_with_risk');
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/strategy-validation-engine.test.ts src/features/securities/strategy-learning/promotion-gates.test.ts
```

- [ ] **Step 3: Implement validation**

Use100-share lots, T+1, commission0.03% with5元 minimum, sell stamp duty0.05% and slippage0.1%. Walk-forward windows:160 train,60 validation,20 step, minimum250 bars. Classify510300 60-day return above5% as up, below-5% as down, otherwise sideways.

Default gates: annual return lift2 points; drawdown exception at most2 points and10% relative; profit factor/payoff retention95%;20 forward days;30 trades;60% non-inferior stocks. Missing regime data stays unverified and cannot claim cross-regime stability.

- [ ] **Step 4: Verify and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/strategy-validation-engine.test.ts src/features/securities/strategy-learning/promotion-gates.test.ts
.\node_modules\.bin\oxlint.cmd src/features/securities/strategy-learning
.\node_modules\.bin\tsc.cmd -b --pretty false
git add app/src/features/securities/strategy-learning
git commit -m "feat: validate strategy candidates out of sample"
```


---

### Task 8: 前向观察、审批和回滚

**Files:** Create `app/src/features/securities/strategy-learning/strategy-approval-service.ts`, `app/src/features/securities/strategy-learning/strategy-approval-service.test.ts`, `app/src/features/securities/strategy-learning/useActiveTechnicalStrategy.ts`, `app/src/features/securities/strategy-learning/useActiveTechnicalStrategy.test.tsx`; modify `app/src/features/securities/strategy-learning/types.ts`, `app/src/features/securities/strategy-learning/strategy-learning-db.ts`, `app/src/features/securities/strategy-learning/strategy-learning-repository.ts`, `app/src/features/securities/realtime-backtest-monitor.ts` and `app/src/features/securities/useRealtimeBacktestMonitor.ts`.

- [ ] **Step 1: Write failing isolation tests**

```ts
expect(await service.getActiveStrategy('realtime-technical'))
  .toMatchObject({ version: '1' });
await expect(service.approveCandidate(riskApproval({ acceptedRiskWarning: false })))
  .rejects.toThrow('必须明确接受新增回撤风险');
await service.approveCandidate(normalApproval('candidate-2'));
expect(await service.getActiveStrategy('realtime-technical'))
  .toMatchObject({ version: '2', status: 'active' });
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/strategy-approval-service.test.ts
```

- [ ] **Step 3: Implement transactional approval**

In one Dexie transaction: verify latest validation; supersede current active version; insert a new active version copied from candidate config; update candidate; insert approval and audit. Risk candidates require explicit acceptance. Rollback creates a new active version copied from historical config and never rewrites history.

Store one forward observation per candidate/date. Reruns update the row; distinct dates and closed cycles determine eligibility.

- [ ] **Step 4: Make approved versions drive realtime signals**

`useActiveTechnicalStrategy` loads the active config, listens for `sec-strategy-version-changed`, and falls back to V1 on load failure. Pass the config into `createRealtimeBacktestMonitor`; emitted events use the active version. Add a test proving approval changes the next snapshot's strategyVersion while an unapproved candidate does not.

- [ ] **Step 5: Verify and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/strategy-approval-service.test.ts src/features/securities/strategy-learning/useActiveTechnicalStrategy.test.tsx src/features/securities/realtime-backtest-monitor.test.ts src/features/securities/useRealtimeBacktestMonitor.test.tsx
.\node_modules\.bin\tsc.cmd -b --pretty false
git add app/src/features/securities/strategy-learning app/src/features/securities/realtime-backtest-monitor.ts app/src/features/securities/realtime-backtest-monitor.test.ts app/src/features/securities/useRealtimeBacktestMonitor.ts app/src/features/securities/useRealtimeBacktestMonitor.test.tsx
git commit -m "feat: add strategy approval and rollback"
```

---

### Task 9: 收盘调度与缺失交易日补跑

**Files:**
- Create: `app/src/features/securities/strategy-learning/daily-review-scheduler.ts`, `app/src/features/securities/strategy-learning/daily-review-scheduler.test.ts`, `app/src/features/securities/strategy-learning/useStrategyLearningScheduler.ts`, `app/src/features/securities/strategy-learning/useStrategyLearningScheduler.test.tsx`.
- Modify: `app/src/features/securities/RealtimeBacktestMonitorProvider.tsx`.

- [ ] **Step 1: Write failing schedule tests**

```ts
await schedulerAt('2026-08-06T07:11:00.000Z').runDueReviews();
expect(runReview).toHaveBeenCalledWith('2026-08-06');
await catchUpScheduler({
  now: '2026-08-10T01:00:00.000Z',
  completed: ['2026-08-06'],
}).runDueReviews();
expect(runReview).toHaveBeenCalledWith('2026-08-07');
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/daily-review-scheduler.test.ts
```

- [ ] **Step 3: Implement**

Run after15:10 Shanghai time; run catch-up at provider mount, visibility regain and focus; skip weekends/closures; keep one running promise per date; retry a failed date on the next focus. Do not add minute polling. Mount only in RealtimeBacktestMonitorProvider and do not import into StockAnalysisPage.

After each completed review, call `updateDueFollowUps`. When completed-review count since the last candidate run reaches10, aggregate patterns and generate candidates. On the first trading-day catch-up of a new month, validate observing candidates, update promotion gates, and publish only material notifications.

- [ ] **Step 4: Verify and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/daily-review-scheduler.test.ts src/features/securities/useRealtimeBacktestMonitor.test.tsx
.\node_modules\.bin\tsc.cmd -b --pretty false
git add app/src/features/securities/strategy-learning app/src/features/securities/RealtimeBacktestMonitorProvider.tsx
git commit -m "feat: schedule daily strategy reviews"
```

---

### Task 10: 重要学习事件接入收件箱

**Files:**
- Create: `app/src/features/securities/strategy-learning/strategy-learning-notifications.ts` and `app/src/features/securities/strategy-learning/strategy-learning-notifications.test.ts`.
- Modify: `app/src/features/securities/backtest-signal-inbox-store.ts`, `app/src/features/securities/SignalInbox.tsx` and their tests.

- [ ] **Step 1: Write failing notification tests**

```ts
expect(publishStrategyLearningNotification(runtime(), {
  type: 'daily_review_completed', entityId: 'review-1', occurredAt,
}).alerts).toHaveLength(0);
expect(publishStrategyLearningNotification(runtime(), {
  type: 'candidate_approval_ready', entityId: 'candidate-2', occurredAt,
}).alerts[0]).toMatchObject({
  messageKind: 'strategy_learning',
  learningEventType: 'candidate_approval_ready',
});
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/strategy-learning-notifications.test.ts src/features/securities/SignalInbox.test.tsx
```

- [ ] **Step 3: Implement migration-safe optional inbox fields**

Add `learningEventType`, `learningEntityId`, `learningRoute` as optional V3 fields. Notify only review failure, degradation, candidate creation, approval readiness and rollback recommendation. Learning cards navigate to the lab and never show buy/sell execution controls.

- [ ] **Step 4: Verify and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/strategy-learning-notifications.test.ts src/features/securities/backtest-signal-inbox-store.test.ts src/features/securities/SignalInbox.test.tsx
git add app/src/features/securities/backtest-signal-inbox-store.ts app/src/features/securities/backtest-signal-inbox-store.test.ts app/src/features/securities/SignalInbox.tsx app/src/features/securities/SignalInbox.test.tsx app/src/features/securities/strategy-learning
git commit -m "feat: notify strategy learning events"
```

---

### Task 11: 实验室路由、入口和数据 Hook

**Files:**
- Create: `app/src/features/securities/StrategyLearningLabPage.tsx` and `app/src/features/securities/StrategyLearningLabPage.test.tsx`.
- Create: `app/src/features/securities/strategy-learning/useStrategyLearningLab.ts` and `app/src/features/securities/strategy-learning/useStrategyLearningLab.test.tsx`.
- Modify: `app/src/app/router.tsx`, `app/src/app/router.test.tsx`, `app/src/features/securities/SecuritiesWorkbenchPage.tsx`, `app/src/features/securities/SecuritiesWorkbenchPage.test.tsx`.

**Routes:** `/securities/strategy-learning` and `/projects/:projectId/securities/strategy-learning`.

- [ ] **Step 1: Write failing route tests**

```tsx
await user.click(screen.getByRole('button', { name: '策略学习实验室' }));
expect(mockNavigate).toHaveBeenCalledWith(
  '/projects/project-1/securities/strategy-learning',
);
expect(await screen.findByRole('heading', { name: '策略学习实验室' }))
  .toBeInTheDocument();
expect(screen.queryByRole('heading', { name: '个股分析' })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/StrategyLearningLabPage.test.tsx src/features/securities/SecuritiesWorkbenchPage.test.tsx src/app/router.test.tsx
```

- [ ] **Step 3: Implement Hook and routes**

Hook returns reviews, patterns, candidates, approvals, loading, error, runDailyReview, approveCandidate, rejectCandidate, rollbackStrategy, exportData and refresh. Callbacks stay stable and no job starts during render. The page exposes “导出学习数据”; workbench route construction follows existing recommend/screener/watchlist/portfolio buttons.

- [ ] **Step 4: Verify and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/StrategyLearningLabPage.test.tsx src/features/securities/strategy-learning/useStrategyLearningLab.test.tsx src/features/securities/SecuritiesWorkbenchPage.test.tsx src/app/router.test.tsx
.\node_modules\.bin\tsc.cmd -b --pretty false
git add app/src/features/securities/StrategyLearningLabPage* app/src/features/securities/strategy-learning/useStrategyLearningLab* app/src/features/securities/SecuritiesWorkbenchPage* app/src/app/router*
git commit -m "feat: add strategy learning workspace"
```

---

### Task 12: 每日复盘和问题模式页面

**Files:** Create `app/src/features/securities/strategy-learning/DailyReviewPanel.tsx`, `app/src/features/securities/strategy-learning/DailyReviewPanel.test.tsx`, `app/src/features/securities/strategy-learning/LearningPatternsPanel.tsx`, `app/src/features/securities/strategy-learning/LearningPatternsPanel.test.tsx`; modify `app/src/features/securities/StrategyLearningLabPage.tsx`.

- [ ] **Step 1: Write failing UI tests**

```tsx
expect(screen.getByText('做得好的地方')).toBeInTheDocument();
expect(screen.getByText('做得不好的地方')).toBeInTheDocument();
expect(screen.getByText('原因和证据')).toBeInTheDocument();
expect(screen.getByText('建议如何改进')).toBeInTheDocument();
expect(screen.getByText('置信度 80%')).toBeInTheDocument();
expect(blockingReview()).toShowText('证据不足');
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/DailyReviewPanel.test.tsx src/features/securities/strategy-learning/LearningPatternsPanel.test.tsx
```

- [ ] **Step 3: Implement**

Daily page includes date/status, portfolio metrics, good/bad/risk sections, evidence badges, expandable frozen evidence, counterfactuals, follow-up horizons, manual rerun and blocking errors.

Pattern page shows category, occurrences, distinct stocks, return/drawdown impact, evidence strength, first/last date, eligibility and linked candidate.

- [ ] **Step 4: Verify and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/DailyReviewPanel.test.tsx src/features/securities/strategy-learning/LearningPatternsPanel.test.tsx
.\node_modules\.bin\oxlint.cmd src/features/securities/strategy-learning
git add app/src/features/securities/strategy-learning app/src/features/securities/StrategyLearningLabPage.tsx
git commit -m "feat: show reviews and learning patterns"
```

---

### Task 13: 候选对比、审批和回滚页面

**Files:** Create `app/src/features/securities/strategy-learning/StrategyCandidatesPanel.tsx`, `app/src/features/securities/strategy-learning/StrategyCandidatesPanel.test.tsx`, `app/src/features/securities/strategy-learning/StrategyApprovalPanel.tsx`, `app/src/features/securities/strategy-learning/StrategyApprovalPanel.test.tsx`; modify `app/src/features/securities/StrategyLearningLabPage.tsx`.

- [ ] **Step 1: Write failing approval tests**

```tsx
await user.click(screen.getByRole('button', { name: '批准升级' }));
expect(screen.getByRole('alert')).toHaveTextContent('请填写审批理由');
expect(approveCandidate).not.toHaveBeenCalled();
await approveRiskCandidateWithoutCheckbox();
expect(screen.getByRole('alert')).toHaveTextContent('请确认接受新增回撤风险');
```

- [ ] **Step 2: Run RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/StrategyCandidatesPanel.test.tsx src/features/securities/strategy-learning/StrategyApprovalPanel.test.tsx
```

- [ ] **Step 3: Implement**

Show baseline/candidate net annual return, drawdown, win rate, payoff ratio, profit factor, Sharpe, trades, breadth, regimes and forward days. Use compact Football Field rows without new chart dependency.

Approve/reject require reason; risk approval requires checkbox; continue-observing changes no formal version; rollback shows target config and requires confirmation; successful action displays audit ID.

- [ ] **Step 4: Verify and commit**

```powershell
.\node_modules\.bin\vitest.cmd run src/features/securities/strategy-learning/StrategyCandidatesPanel.test.tsx src/features/securities/strategy-learning/StrategyApprovalPanel.test.tsx src/features/securities/StrategyLearningLabPage.test.tsx
.\node_modules\.bin\tsc.cmd -b --pretty false
git add app/src/features/securities/strategy-learning app/src/features/securities/StrategyLearningLabPage.tsx
git commit -m "feat: add strategy approval workspace"
```

---

### Task 14: 端到端闭环与发布验证

**Files:**
- Create: `app/src/integration/strategy-learning-lab-flow.test.tsx`
- Create: `app/src/features/securities/strategy-learning/strategy-learning-corruption.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing end-to-end flow**

```tsx
seedVirtualLedgerWithClosedTrades(30);
await runDailyReview();
await runTenTradingDayReviews();
expect(await screen.findByText('候选策略 v2')).toBeInTheDocument();
await seedTwentyForwardTradingDays();
expect(await screen.findByText('建议审批')).toBeInTheDocument();
await approveWithReason('样本外和前向结果通过');
expect(await screen.findByText('当前正式版本 v2')).toBeInTheDocument();
```

- [ ] **Step 2: Add corruption and isolation tests**

Invalid snapshots block promotion; failed validation never changes active version; failed audit write rolls back approval; actual stock ledger remains byte-for-byte unchanged; strategy-learning modules do not import StockAnalysisPage.

- [ ] **Step 3: Run focused regression**

```powershell
.\node_modules\.bin\vitest.cmd run src/integration/strategy-learning-lab-flow.test.tsx src/features/securities/strategy-learning src/features/securities/backtest-signal-inbox-store.test.ts src/features/securities/backtest-signal-trading-runtime.test.ts src/features/securities/virtual-trading-ledger.test.ts src/features/securities/SignalInbox.test.tsx src/features/securities/useRealtimeBacktestMonitor.test.tsx
```

- [ ] **Step 4: Run static and production validation**

```powershell
.\node_modules\.bin\oxlint.cmd src/features/securities/strategy-learning src/features/securities/StrategyLearningLabPage.tsx
.\node_modules\.bin\tsc.cmd -b --pretty false
.\node_modules\.bin\vite.cmd build
```

- [ ] **Step 5: Run full tests and document unrelated failures**

```powershell
.\node_modules\.bin\vitest.cmd run
```

Do not repair existing dashboard or stock-directory failures inside this feature. README must document15:10 review, catch-up, half-month candidates, monthly approval,20 days/30 trades, no automatic actual trading, and both lab routes.

- [ ] **Step 6: Commit**

```powershell
git add app/src/integration/strategy-learning-lab-flow.test.tsx app/src/features/securities/strategy-learning/strategy-learning-corruption.test.ts README.md
git commit -m "test: verify strategy learning lab end to end"
```

---

## Final Acceptance

Run from `C:\Users\33755\Desktop\投资尽调模型\app`:

```powershell
.\node_modules\.bin\vitest.cmd run src/integration/strategy-learning-lab-flow.test.tsx src/features/securities/strategy-learning src/features/securities/backtest-signal-inbox-store.test.ts src/features/securities/backtest-signal-trading-runtime.test.ts src/features/securities/virtual-trading-ledger.test.ts src/features/securities/SignalInbox.test.tsx src/features/securities/useRealtimeBacktestMonitor.test.tsx
.\node_modules\.bin\oxlint.cmd src/features/securities/strategy-learning src/features/securities/StrategyLearningLabPage.tsx
.\node_modules\.bin\tsc.cmd -b --pretty false
.\node_modules\.bin\vite.cmd build
```

Acceptance requires all focused tests passing, no TypeScript/lint errors, production build success, no automatic formal-strategy change, unchanged actual positions, and no code changes to StockAnalysisPage.tsx.
