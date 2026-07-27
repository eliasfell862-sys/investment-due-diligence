# Three-Scenario Forecast Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, auditable downside/base/upside forecast engine that produces 36/48/60 monthly forecasts, complete model-year summaries, FCFF, cash lows, and minimum financing needs.

**Architecture:** Keep strict DTO parsing, semantic validation, monthly series generation, revenue unit algebra, single-scenario calculation, aggregation, and three-scenario orchestration in separate files. Reuse the registered `free_cash_flow@1` AST for monthly FCF, extend shared analysis contracts for forecast traces, and return only frozen JSON-safe `EngineResult` snapshots.

**Tech Stack:** TypeScript 6, decimal.js through `AnalysisDecimal`, Vitest, existing analysis domain contracts, existing formula registry/AST evaluator, oxlint.

---

## Execution rules

- Work in one isolated linked worktree on branch `feature/three-scenario-forecast-engine`.
- Use a fresh implementation subagent for each task, followed by an independent specification reviewer and an independent code-quality reviewer.
- Do not run two implementation subagents concurrently.
- Every production change must be preceded by a focused failing test and an observed expected RED result.
- Before every task commit, run its focused tests, `npm run typecheck`, `npm run lint`, and the full `npm test` suite from `app/`.
- Fix and re-review every Critical or Important review finding before moving to the next task.
- Do not change UI, routes, Dexie schema, ingestion, report, valuation, equity, risk, or decision files.

## File map

| File | Responsibility |
| --- | --- |
| `app/src/domain/analysis/analysis-scalar.ts` | Shared valueRef/source/conflict contract |
| `app/src/domain/analysis/calculation-trace.ts` | Formula and forecast trace union |
| `app/src/domain/analysis/engine-result.ts` | Forecast issue codes |
| `app/src/engines/formulas/formula-types.ts` | Reuse shared scalar/conflict types without behavior change |
| `app/src/engines/forecast/forecast-types.ts` | Public and normalized forecast DTOs |
| `app/src/engines/forecast/snapshot-forecast-input.ts` | Hostile-safe bounded JSON snapshot |
| `app/src/engines/forecast/validate-forecast-input.ts` | Structural union parsing and semantic validation |
| `app/src/engines/forecast/generate-monthly-series.ts` | Direct seasonality and model-year rates |
| `app/src/engines/forecast/calculate-revenue.ts` | Fixed/custom revenue drivers and unit reduction |
| `app/src/engines/forecast/calculate-scenario.ts` | Monthly financial chain and FCF AST reuse |
| `app/src/engines/forecast/aggregate-model-years.ts` | 12-month model-year and cash summaries |
| `app/src/engines/forecast/forecast-three-scenarios.ts` | Public orchestration, trace, ordering, freezing |
| `app/src/engines/forecast/forecast-test-fixtures.ts` | Small auditable input builders |
| `app/src/engines/forecast/forecast-golden-vectors.test.ts` | Complete three-scenario golden vector |

### Task 1: Shared scalar, issue, and trace contracts

**Files:**
- Create: `app/src/domain/analysis/analysis-scalar.ts`
- Create: `app/src/domain/analysis/analysis-scalar.test.ts`
- Modify: `app/src/domain/analysis/calculation-trace.ts`
- Modify: `app/src/domain/analysis/engine-result.ts`
- Modify: `app/src/domain/analysis/engine-result.test.ts`
- Modify: `app/src/engines/formulas/formula-types.ts`
- Modify: `app/src/engines/formulas/formula-registry.test.ts`

- [ ] **Step 1: Write failing shared-contract tests**

Add `analysis-scalar.test.ts`:

```ts
import { expectTypeOf } from 'vitest';
import type { AnalysisScalar, ConflictStatus } from './analysis-scalar';

it('defines one shared auditable scalar contract', () => {
  expectTypeOf<ConflictStatus>().toEqualTypeOf<
    'none' | 'resolved' | 'conservative-selected' | 'blocking'
  >();
  expectTypeOf<AnalysisScalar>().toMatchTypeOf<{
    readonly valueRef: string;
    readonly metricId: string;
    readonly sourceRefs: readonly string[];
  }>();
});
```

Extend `engine-result.test.ts` with a forecast trace passed through both `okResult` and `blockedResult`, asserting nested scenarios and steps are deep-frozen and JSON-safe. Extend `formula-registry.test.ts` to assert `FormulaObservation` still exposes the same `conflict` shape after the type move.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm test -- src/domain/analysis/analysis-scalar.test.ts src/domain/analysis/engine-result.test.ts src/engines/formulas/formula-registry.test.ts
```

Expected: FAIL because `analysis-scalar.ts` and the forecast trace variant do not exist.

- [ ] **Step 3: Add the shared types**

Create `analysis-scalar.ts`:

```ts
import type { MetricValue } from './value';

export type ConflictStatus =
  | 'none'
  | 'resolved'
  | 'conservative-selected'
  | 'blocking';

export interface AnalysisConflict {
  readonly status: ConflictStatus;
  readonly selectionReason?: string;
}

export interface AnalysisScalar {
  readonly valueRef: string;
  readonly metricId: string;
  readonly value: MetricValue;
  readonly sourceRefs: readonly string[];
  readonly conflict: AnalysisConflict;
}
```

Change `FormulaObservation` to extend `AnalysisScalar`, retaining only `period` and optional `label` locally. Export `ConflictStatus` from `formula-types.ts` as an alias import/export so existing consumers remain source-compatible.

Refactor `calculation-trace.ts` to:

```ts
export interface FormulaCalculationTrace {
  readonly engine: 'formula';
  readonly formulaRef: string;
  readonly inputs: readonly TraceInput[];
  readonly steps: readonly TraceStep[];
  readonly output?: MetricValue;
}

export interface ForecastMonthTrace {
  readonly periodId: string;
  readonly steps: readonly TraceStep[];
}

export interface ForecastScenarioTrace {
  readonly scenarioId: 'downside' | 'base' | 'upside';
  readonly months: readonly ForecastMonthTrace[];
  readonly aggregationSteps: readonly TraceStep[];
}

export interface ForecastCalculationTrace {
  readonly engine: 'forecast';
  readonly forecastRef: 'three-scenario@1';
  readonly inputs: readonly TraceInput[];
  readonly scenarios: readonly ForecastScenarioTrace[];
}

export type CalculationTrace = FormulaCalculationTrace | ForecastCalculationTrace;
```

Extend `EngineIssueCode` with:

```ts
| 'invalid_scenario_set'
| 'unsupported_engine_version'
| 'invalid_forecast_horizon'
| 'invalid_seasonality'
| 'invalid_revenue_driver'
```

- [ ] **Step 4: Verify GREEN and regressions**

Run focused tests, then:

```powershell
npm run typecheck
npm run lint
npm test
```

Expected: focused tests PASS; all existing formula and domain tests remain green.

- [ ] **Step 5: Commit**

```powershell
git add app/src/domain/analysis/analysis-scalar.ts app/src/domain/analysis/analysis-scalar.test.ts app/src/domain/analysis/calculation-trace.ts app/src/domain/analysis/engine-result.ts app/src/domain/analysis/engine-result.test.ts app/src/engines/formulas/formula-types.ts app/src/engines/formulas/formula-registry.test.ts
git commit -m "feat: add shared forecast analysis contracts"
```

### Task 2: Forecast DTOs and fixtures

**Files:**
- Create: `app/src/engines/forecast/forecast-types.ts`
- Create: `app/src/engines/forecast/forecast-types.test.ts`
- Create: `app/src/engines/forecast/forecast-test-fixtures.ts`

- [ ] **Step 1: Write the failing public-type test**

Create `forecast-types.test.ts` importing `ThreeScenarioForecastInput`, `ScenarioForecastSet`, `MonthlyForecast`, and `ForecastHorizonMonths`. Use `expectTypeOf` to lock `36 | 48 | 60`, the five revenue union tags, scenario output order-compatible IDs, and all monthly financial fields. Instantiate a minimal typed request through `forecast-test-fixtures.ts` so the desired API is exercised before implementation.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/engines/forecast/forecast-types.test.ts
```

Expected: FAIL because the forecast module does not exist.

- [ ] **Step 3: Define the exact public types**

Implement the specification types, including:

```ts
export type ForecastHorizonMonths = 36 | 48 | 60;
export type ForecastEngineVersion = '1';

export interface ThreeScenarioForecastInput {
  readonly version: ForecastEngineVersion;
  readonly baseline: ForecastBaseline;
  readonly scenarios: readonly ScenarioDefinition<ForecastScenarioAssumptions>[];
}

export interface SeasonalityPattern {
  readonly valueRef: string;
  readonly sourceRefs: readonly string[];
  readonly multipliers: readonly [
    DecimalString, DecimalString, DecimalString, DecimalString,
    DecimalString, DecimalString, DecimalString, DecimalString,
    DecimalString, DecimalString, DecimalString, DecimalString,
  ];
}

export interface GeneratedValueRule {
  readonly startingValue: AnalysisScalar;
  readonly monthlyGrowthRate: AnalysisScalar;
  readonly seasonality?: SeasonalityPattern;
}
```

Add all approved revenue, cost, scenario, monthly output, model-year output, cash summary, normalized input, and internal generated-series types. Amount output fields are canonical decimal strings under the single `ScenarioForecastSet.currency`.

Create fixture helpers that produce plain fresh DTOs, never shared frozen aliases:

```ts
export function scalar(
  valueRef: string,
  metricId: string,
  value: string,
  unit: AnalysisUnit,
): AnalysisScalar;

export function forecastInput(
  overrides?: DeepPartial<ThreeScenarioForecastInput>,
): ThreeScenarioForecastInput;
```

The default fixture uses CNY, start month `2026-04`, 36 months, no seasonality, zero growth, customer-count revenue, and distinct assumptions for all three scenarios.

- [ ] **Step 4: Verify and commit**

Run focused test, `npm run typecheck`, `npm run lint`, and `npm test`, then:

```powershell
git add app/src/engines/forecast/forecast-types.ts app/src/engines/forecast/forecast-types.test.ts app/src/engines/forecast/forecast-test-fixtures.ts
git commit -m "feat: define forecast engine contracts"
```

### Task 3: Bounded hostile-safe snapshot and semantic validation

**Files:**
- Create: `app/src/engines/forecast/snapshot-forecast-input.ts`
- Create: `app/src/engines/forecast/snapshot-forecast-input.test.ts`
- Create: `app/src/engines/forecast/validate-forecast-input.ts`
- Create: `app/src/engines/forecast/validate-forecast-input.test.ts`

- [ ] **Step 1: Write structural RED tests**

Test that snapshotting rejects with a fresh `DomainContractError('invalid_dto')` for sparse arrays, class instances, accessors, symbols, cycles, non-finite numbers, hostile proxies, strings over 65,536 characters, arrays over 4,096 entries, depth over 64, and more than 16,384 unique DTO nodes. Assert overlong public arrays are rejected from their length descriptor before `ownKeys` is invoked.

- [ ] **Step 2: Verify structural RED**

```powershell
npm test -- src/engines/forecast/snapshot-forecast-input.test.ts
```

Expected: FAIL because the snapshotter is missing.

- [ ] **Step 3: Implement the bounded snapshot**

Use the proven formula-engine pattern with these constants:

```ts
const MAX_DTO_NODES = 16384;
const MAX_DTO_DEPTH = 64;
const MAX_ARRAY_LENGTH = 4096;
const MAX_OBJECT_PROPERTIES = 4096;
const MAX_STRING_LENGTH = 65536;
const MAX_TOTAL_STRING_CHARACTERS = 1048576;
```

Export only:

```ts
export function snapshotForecastInput(input: unknown): unknown;
```

It must return a detached plain JSON snapshot and map every native exception to `invalid_dto`.

- [ ] **Step 4: Write semantic RED tests**

Cover exact top-level keys, version `1`, valid `YYYY-MM`, horizons 36/48/60, ISO currency, exact three scenarios, exact probability sum, exact annual-rate array length, canonical decimals, scalar units, unique non-empty valueRefs, sourceRefs maximum 32, conflict shape, positive season multipliers with exact sum 12, 2–5 custom factors, and blocking versus conservative conflict behavior.

The test should expect a result shaped as:

```ts
type ForecastValidation =
  | {
      readonly status: 'valid';
      readonly input: NormalizedForecastInput;
      readonly warnings: readonly EngineIssue[];
      readonly traceInputs: readonly TraceInput[];
    }
  | {
      readonly status: 'blocked';
      readonly reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful';
      readonly issues: readonly EngineIssue[];
      readonly traceInputs: readonly TraceInput[];
    };
```

- [ ] **Step 5: Verify semantic RED and implement validation**

Run the semantic test and confirm expected failures, then implement:

```ts
export function validateForecastInput(input: unknown): ForecastValidation {
  const snapshot = snapshotForecastInput(input);
  // Parse exact union shapes, normalize canonical values, validate in the
  // specification's fixed priority, and stable-sort issues and trace inputs.
}
```

Use `validateScenarioSet`, existing decimal parsers, and `validateAnalysisPeriodValue` where applicable. Do not read a field before its structural shape and public length budget have been checked. `conservative-selected` adds a warning; `blocking` returns blocked. Any duplicate `valueRef` returns `invalid-input` with `value_out_of_range` at the duplicate path.

- [ ] **Step 6: Verify and commit**

Run both focused tests, typecheck, lint, and full tests, then:

```powershell
git add app/src/engines/forecast/snapshot-forecast-input.ts app/src/engines/forecast/snapshot-forecast-input.test.ts app/src/engines/forecast/validate-forecast-input.ts app/src/engines/forecast/validate-forecast-input.test.ts
git commit -m "feat: validate forecast inputs defensively"
```

### Task 4: Monthly periods, direct seasonality, and annual rates

**Files:**
- Create: `app/src/engines/forecast/generate-monthly-series.ts`
- Create: `app/src/engines/forecast/generate-monthly-series.test.ts`

- [ ] **Step 1: Write RED tests for the approved math**

Use a forecast start of April and season factors `[0.8, 0.9, 1, 1.1, 1.2, 1.1, 1, 0.9, 0.8, 0.9, 1.1, 1.2]`, whose sum is 12. Assert:

```ts
expect(series[0]).toBe(startingValue);
expect(series[1]).toBe(canonicalDecimal(
  new AnalysisDecimal(startingValue)
    .dividedBy('1.1')
    .times(new AnalysisDecimal(1).plus(growth))
    .times('1.2'),
));
```

Also cover December→January, 60 months without drift, no-seasonality identity, growth `-1`, rejection of generated negative non-negative series, real month ends including leap-year February, and model-year rates switching exactly at months 13, 25, 37, and 49.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/engines/forecast/generate-monthly-series.test.ts
```

- [ ] **Step 3: Implement period and series helpers**

Export:

```ts
export function createForecastPeriods(
  startMonth: string,
  horizon: ForecastHorizonMonths,
): readonly FlowPeriod[];

export function generateMonthlyValues(
  rule: NormalizedGeneratedValueRule,
  periods: readonly FlowPeriod[],
  options: { readonly nonNegative: boolean },
): SeriesGeneration;

export function expandModelYearRates(
  rates: readonly DecimalString[],
  horizon: ForecastHorizonMonths,
): readonly DecimalString[];
```

Calculate each month directly:

```ts
const trendBase = start.dividedBy(startSeason);
const value = trendBase
  .times(AnalysisDecimal.pow(one.plus(growth), monthIndex))
  .times(calendarSeason);
```

Never derive a month from the previously generated month.

- [ ] **Step 4: Verify and commit**

Run focused/full verification and commit:

```powershell
git add app/src/engines/forecast/generate-monthly-series.ts app/src/engines/forecast/generate-monthly-series.test.ts
git commit -m "feat: generate deterministic forecast series"
```

### Task 5: Revenue drivers and unit algebra

**Files:**
- Create: `app/src/engines/forecast/calculate-revenue.ts`
- Create: `app/src/engines/forecast/calculate-revenue.test.ts`

- [ ] **Step 1: Write RED vectors for all five drivers**

Test customer count×monthly customer revenue, user count×ARPU, GMV×Take Rate, unit sales×unit price, and custom product. Assert canonical revenue and driver output for at least months 1, 12, and 13. Add blocked vectors for currency mismatch, customer/user count mismatch, count×count, two currency factors, no currency-producing factor, 1 or 6 custom factors, and a negative generated driver.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/engines/forecast/calculate-revenue.test.ts
```

- [ ] **Step 3: Implement explicit unit reduction**

Export:

```ts
export function calculateRevenueSeries(
  revenue: NormalizedRevenueModel,
  periods: readonly FlowPeriod[],
  currency: CurrencyCode,
): RevenueCalculation;
```

The reducer must:

1. Ignore ratio dimensions after validating their ratio kind;
2. Allow one monthly currency factor plus ratios; or one count plus one matching currency-per-count plus ratios;
3. Require the resulting currency to equal the baseline currency;
4. Multiply all factor values with `AnalysisDecimal` in stable factor order;
5. Return canonical driver values and stable trace steps.

- [ ] **Step 4: Verify and commit**

Run focused/full verification and commit:

```powershell
git add app/src/engines/forecast/calculate-revenue.ts app/src/engines/forecast/calculate-revenue.test.ts
git commit -m "feat: calculate forecast revenue drivers"
```

### Task 6: Single-scenario financial chain and FCF reuse

**Files:**
- Create: `app/src/engines/forecast/calculate-scenario.ts`
- Create: `app/src/engines/forecast/calculate-scenario.test.ts`

- [ ] **Step 1: Write RED financial-chain tests**

Use a one-scenario normalized fixture with hand-calculable values. Assert every line for month 1, a profitable month, a loss month, zero pre-tax income, negative working-capital increase, first-month financing, and no financing. Assert tax is `max(preTaxIncome, 0) * taxRate` and FCFF is based on EBIT rather than net income.

Add an invariant test that obtains `free_cash_flow@1` through `getFormulaDefinition`, evaluates its AST with the same operating cash flow and CapEx operands, and expects the monthly forecast FCF to match exactly.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/engines/forecast/calculate-scenario.test.ts
```

- [ ] **Step 3: Implement the monthly chain**

Export:

```ts
export function calculateScenario(
  scenario: NormalizedScenario,
  baseline: NormalizedForecastBaseline,
  periods: readonly FlowPeriod[],
): ScenarioCalculation;
```

For FCF, resolve the registered definition and evaluate its AST:

```ts
const definition = getFormulaDefinition('free_cash_flow', '1');
const fcf = evaluateAst(
  definition.ast,
  new Map([
    ['operating_cash_flow', operatingCashFlow],
    ['capital_expenditure', capitalExpenditure],
  ]),
  new Map(),
);
```

Treat a non-OK AST result as an internal contract failure, because validation has already guaranteed valid operands. Prefix reused AST step IDs with scenario and period IDs before merging them into the forecast trace.

- [ ] **Step 4: Verify and commit**

Run focused/full verification and commit:

```powershell
git add app/src/engines/forecast/calculate-scenario.ts app/src/engines/forecast/calculate-scenario.test.ts
git commit -m "feat: calculate monthly scenario forecasts"
```

### Task 7: Model-year aggregation and public orchestration

**Files:**
- Create: `app/src/engines/forecast/aggregate-model-years.ts`
- Create: `app/src/engines/forecast/aggregate-model-years.test.ts`
- Create: `app/src/engines/forecast/forecast-three-scenarios.ts`
- Create: `app/src/engines/forecast/forecast-three-scenarios.test.ts`

- [ ] **Step 1: Write aggregation RED tests**

Assert 36/48/60 months produce 3/4/5 model years; flows sum; beginning cash uses the first month; pre-financing and ending cash use the last month; financing inflows sum; lowest pre-financing cash uses the earliest month on an exact tie; and the trigger month is omitted when financing is never positive.

- [ ] **Step 2: Write orchestration RED tests**

Assert the public function:

- accepts `unknown` safely through validation;
- returns scenarios in downside/base/upside order regardless of input order;
- blocks the whole set if one scenario is invalid;
- preserves conservative warnings in stable path order;
- returns a forecast trace with unique sorted inputs and stable month steps;
- does not mutate input;
- returns deeply frozen, JSON-safe output;
- produces byte-identical JSON for repeated equivalent calls.

- [ ] **Step 3: Verify RED**

```powershell
npm test -- src/engines/forecast/aggregate-model-years.test.ts src/engines/forecast/forecast-three-scenarios.test.ts
```

- [ ] **Step 4: Implement aggregation and public API**

Export:

```ts
export function aggregateModelYears(
  months: readonly MonthlyForecast[],
): {
  readonly modelYears: readonly ModelYearForecast[];
  readonly cashSummary: ForecastCashSummary;
  readonly steps: readonly TraceStep[];
};

export function forecastThreeScenarios(
  input: unknown,
): EngineResult<ScenarioForecastSet>;
```

The public function validates once, creates periods once, evaluates scenarios sequentially in canonical ID order, aggregates warnings and trace inputs, and finishes with `okResult` or `blockedResult`. Do not catch `DomainContractError`; structural DTO damage remains an exception. Catch only impossible internal failures if they can be mapped without hiding a programming error.

- [ ] **Step 5: Verify and commit**

Run focused/full verification and commit:

```powershell
git add app/src/engines/forecast/aggregate-model-years.ts app/src/engines/forecast/aggregate-model-years.test.ts app/src/engines/forecast/forecast-three-scenarios.ts app/src/engines/forecast/forecast-three-scenarios.test.ts
git commit -m "feat: forecast three financial scenarios"
```

### Task 8: Golden vectors, boundary hardening, and complete verification

**Files:**
- Create: `app/src/engines/forecast/forecast-golden-vectors.test.ts`
- Modify only forecast/shared-contract files when a failing hardening test proves a defect

- [ ] **Step 1: Add the 36-month golden vector before fixes**

Build one complete three-scenario fixture with:

- forecast start `2026-04`;
- explicit 12-month seasonality;
- different revenue drivers across the three scenarios;
- annual ratio costs with three rates;
- amount-growth depreciation, interest, CapEx, and working capital;
- one scenario with no financing, one with delayed financing, and one with first-year financing.

Hand-calculate and assert selected months 1, 12, 13, 24, 25, and 36; all three model-year totals; cash lows; trigger months; and cumulative financing requirements. Add focused 48/60-month vectors for the fourth and fifth annual-rate transitions.

- [ ] **Step 2: Run the golden vector and observe any precise failures**

```powershell
npm test -- src/engines/forecast/forecast-golden-vectors.test.ts
```

Expected: any failure must identify a real contract gap or calculation defect. Add production fixes only after the failing assertion is observed.

- [ ] **Step 3: Add hostile and invariant hardening vectors**

Cover alias-heavy inputs, repeated references, maximum valid custom factors, maximum source refs, extreme canonical decimals, 40-digit HALF_EVEN ties, input reordering, equivalent null-prototype DTOs, and generated output serialization. Confirm formula tests still see no contract change beyond shared type extraction.

- [ ] **Step 4: Run fresh complete gates**

From `app/` run, in order:

```powershell
npm test -- src/domain/analysis/analysis-scalar.test.ts src/domain/analysis/engine-result.test.ts src/domain/analysis/scenario.test.ts src/engines/formulas/formula-golden-vectors.test.ts src/engines/formulas/formula-invariants.test.ts src/engines/forecast/forecast-golden-vectors.test.ts
npm run typecheck
npm test
npm run lint
npm run build
npm audit --audit-level=high
git diff --check
```

Expected: all commands exit 0. Existing Vite chunk-size warnings may be reported but must not become build errors. If `npm audit` needs network and the sandbox blocks it, request the required permission rather than silently skipping it.

- [ ] **Step 5: Commit final hardening**

```powershell
git add app/src/engines/forecast app/src/domain/analysis app/src/engines/formulas/formula-types.ts app/src/engines/formulas/formula-registry.test.ts
git commit -m "test: harden three-scenario forecasts"
```

### Task 9: Whole-feature review and branch completion

**Files:**
- Review all commits from `b648a30` to feature HEAD

- [ ] **Step 1: Dispatch an independent whole-feature reviewer**

Provide the reviewer the approved design, this plan, base SHA `b648a30`, feature HEAD, and explicit instructions to report Critical/Important findings on contract compliance, Decimal precision, seasonality math, unit algebra, cash/FCFF semantics, hostile DTO handling, trace determinism, and regression risk.

- [ ] **Step 2: Fix review findings through TDD**

For every valid Critical or Important finding, write and observe a failing regression test, have the responsible implementation agent fix it, re-run focused/full validation, and send the exact diff back to the same reviewer for re-review.

- [ ] **Step 3: Run final fresh verification**

Repeat Task 8 Step 4 after the last code change. Confirm `git status --short` is clean after the final review/fix commit.

- [ ] **Step 4: Use finishing-a-development-branch**

Detect the linked-worktree state and base branch, then present the standard four options: local merge, push/PR, keep branch, or discard. Do not merge, push, delete, or remove the worktree until the user selects an option.
