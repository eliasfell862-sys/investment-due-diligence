# Strategy Evaluation and Learning Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing strategy learning lab with evidence-based out-of-sample calibration metrics without changing trading logic, market-data sources, cloud schema, or Kronos integration.

**Architecture:** Add one pure aggregation module over existing `StrategyValidationRun` and `DailyStrategyReview` records. Extend the existing hook to load validation runs, then render the derived summary inside the current page. The calculator remains independent of React, Dexie, Supabase, and market-data APIs.

**Tech Stack:** React 19, TypeScript 6, Vitest, Testing Library, Dexie, oxlint.

## Global Constraints

- Do not add or modify Supabase tables, RPCs, or cloud data.
- Do not modify buy/sell signal generation, holdings, T-trading, or K-line sources.
- Do not modify or stage Kronos files.
- Keep model confidence separate from historical win rate.
- Use only `walk_forward`, `out_of_sample`, and `forward` as performance evidence.
- Require 30 closed trades for preliminary evidence and 100 for established evidence.
- Any failed leakage check produces a blocked status.

---

### Task 1: Pure calibration summary

**Files:**
- Create: `app/src/features/securities/strategy-learning/strategy-calibration-summary.ts`
- Test: `app/src/features/securities/strategy-learning/strategy-calibration-summary.test.ts`

**Interfaces:**
- Consumes: `StrategyValidationRun[]`, `DailyStrategyReview[]`.
- Produces: `buildStrategyCalibrationSummary(validationRuns, reviews): StrategyCalibrationSummary`.

- [ ] **Step 1: Write failing calculator tests**

Cover empty evidence, closed-trade-weighted results, stress exclusion, 30/100 trade thresholds, non-finite metrics, overfitting downgrade, and leakage blocking. Central expectation:

```ts
expect(buildStrategyCalibrationSummary([
  validationRun({ validationType: 'out_of_sample', closedTrades: 40, winRate: 55, netReturnPct: 8 }),
  validationRun({ validationType: 'forward', closedTrades: 60, winRate: 65, netReturnPct: 12 }),
], [dailyReview(0.7)])).toMatchObject({
  status: 'established',
  totalClosedTrades: 100,
  weightedWinRatePct: 61,
  weightedNetReturnPct: 10.4,
  modelConfidencePct: 70,
  confidenceGapPct: 9,
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- strategy-learning/strategy-calibration-summary.test.ts`

Expected: FAIL because the calculator module does not exist.

- [ ] **Step 3: Implement the pure calculator**

```ts
export type CalibrationStatus = 'insufficient' | 'preliminary' | 'established' | 'blocked';

export interface StrategyCalibrationSummary {
  status: CalibrationStatus;
  evidenceRunCount: number;
  stressRunCount: number;
  totalClosedTrades: number;
  weightedWinRatePct: number | null;
  weightedNetReturnPct: number | null;
  feeDragPct: number | null;
  maxDrawdownPct: number | null;
  modelConfidencePct: number | null;
  confidenceGapPct: number | null;
  leakageFailed: boolean;
  overfittingFailed: boolean;
  remainingTradesToPreliminary: number;
  latestDataDate: string | null;
}

export function buildStrategyCalibrationSummary(
  validationRuns: StrategyValidationRun[],
  reviews: DailyStrategyReview[],
): StrategyCalibrationSummary;
```

Use per-metric closed-trade-weighted averages, the worst valid drawdown, at most the latest 20 finite review confidences, and the latest evidence `period.end`. Ignore non-finite values rather than returning `NaN`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- strategy-learning/strategy-calibration-summary.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- app/src/features/securities/strategy-learning/strategy-calibration-summary.ts app/src/features/securities/strategy-learning/strategy-calibration-summary.test.ts
git commit -m "feat: calculate strategy calibration evidence"
```

### Task 2: Load validation evidence

**Files:**
- Modify: `app/src/features/securities/strategy-learning/useStrategyLearningLab.ts`
- Modify: `app/src/features/securities/strategy-learning/useStrategyLearningLab.test.tsx`

**Interfaces:**
- Consumes: `repository.listValidationRuns()`.
- Produces: `validationRuns` from `useStrategyLearningLab()`.

- [ ] **Step 1: Add a failing hook assertion**

Mock `listValidationRuns` to return one typed validation run, wait for loading to finish, then assert `result.current.validationRuns` has length 1.

- [ ] **Step 2: Verify RED**

Run: `npm test -- strategy-learning/useStrategyLearningLab.test.tsx`

Expected: FAIL because `validationRuns` is absent.

- [ ] **Step 3: Implement parallel loading**

Add `StrategyValidationRun[]` state, include `repository.listValidationRuns()` in the existing `Promise.all`, set it after the read, and return it from the hook. Do not change catch-up scheduling.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- strategy-learning/useStrategyLearningLab.test.tsx strategy-learning/strategy-calibration-summary.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- app/src/features/securities/strategy-learning/useStrategyLearningLab.ts app/src/features/securities/strategy-learning/useStrategyLearningLab.test.tsx
git commit -m "feat: load strategy validation evidence"
```

### Task 3: Render calibration in the existing lab

**Files:**
- Modify: `app/src/features/securities/StrategyLearningLabPage.tsx`
- Modify: `app/src/features/securities/StrategyLearningLabPage.test.tsx`

**Interfaces:**
- Consumes: `validationRuns`, `reviews`, `buildStrategyCalibrationSummary`.
- Produces: a ???????????? section in the existing route.

- [ ] **Step 1: Add failing page tests**

For established evidence assert the renamed heading, calibration heading, weighted win rate, model confidence, and ?????????????. For no validation runs assert ????????? and ?????30??????.

- [ ] **Step 2: Verify RED**

Run: `npm test -- StrategyLearningLabPage.test.tsx`

Expected: FAIL because the new section is absent.

- [ ] **Step 3: Implement the page section**

Calculate once with `buildStrategyCalibrationSummary(validationRuns, reviews)`. Render status, evidence-run count, closed trades, latest data date, nullable metrics, leakage warning, overfitting warning, and remaining trades. Display null metrics as ??????, never as zero. Use existing theme variables: red for blocked, amber for insufficient/preliminary, green for established. Keep the route unchanged.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- StrategyLearningLabPage.test.tsx strategy-learning/useStrategyLearningLab.test.tsx strategy-learning/strategy-calibration-summary.test.ts`

Expected: PASS without React warnings.

- [ ] **Step 5: Commit**

```powershell
git add -- app/src/features/securities/StrategyLearningLabPage.tsx app/src/features/securities/StrategyLearningLabPage.test.tsx
git commit -m "feat: show calibrated strategy evidence"
```

### Task 4: Complete validation

**Files:**
- Verify only; corrections are limited to the six feature files above.

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- StrategyLearningLabPage.test.tsx strategy-learning/useStrategyLearningLab.test.tsx strategy-learning/strategy-calibration-summary.test.ts`

- [ ] **Step 2: Run static and security checks**

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm audit --audit-level=high`

- [ ] **Step 3: Run full regression and build**

Run: `npm test`

Run: `npm run build`

- [ ] **Step 4: Check change boundaries**

Run: `git status --short`

Run: `git diff --check HEAD -- app/src/features/securities/StrategyLearningLabPage.tsx app/src/features/securities/StrategyLearningLabPage.test.tsx app/src/features/securities/strategy-learning/strategy-calibration-summary.ts app/src/features/securities/strategy-learning/strategy-calibration-summary.test.ts app/src/features/securities/strategy-learning/useStrategyLearningLab.ts app/src/features/securities/strategy-learning/useStrategyLearningLab.test.tsx`

Expected: no whitespace errors, and all Kronos files remain unstaged.

