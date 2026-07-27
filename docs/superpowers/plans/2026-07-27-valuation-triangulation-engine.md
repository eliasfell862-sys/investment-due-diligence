# Valuation Triangulation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user explicitly requested inline execution without subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure TypeScript valuation engine that consumes model-year forecast outputs and produces auditable DCF, comparable-company, and VC-method valuation ranges, Football Field rows, and deterministic sensitivity matrices.

**Architecture:** Add a new `app/src/engines/valuation/` domain package with four public pure functions: `calculateDcf`, `calculateComparableValuation`, `calculateVcMethod`, and `triangulateValuations`. Every public function accepts `unknown`, snapshots hostile DTOs before semantic parsing, uses the shared 40-digit HALF_EVEN Decimal boundary, returns a valuation-specific `EngineResult`, and emits a stable calculation trace. All ranges use the same valuation date, currency, and `pre-money-equity` basis; unavailable methods remain explicit rather than being replaced with fabricated zeroes.

**Tech Stack:** TypeScript 6, Decimal.js through `AnalysisDecimal`, Vitest, existing domain `EngineResult`/trace contracts, pure functions with frozen JSON-safe DTOs.

---

## Locked v1 decisions

- Every public amount is a canonical decimal string in one explicit ISO currency.
- The valuation date is the day before the first model year begins. DCF only accepts consecutive, complete 12-month model years.
- DCF supports year-end and mid-year discounting. Mid-year affects annual FCFF only; terminal values are always discounted at year `N`.
- DCF produces two 5x5 matrices: WACC × perpetuity growth and WACC × exit multiple. Every center cell equals its corresponding base terminal-method equity value.
- DCF overall midpoint is the explicitly weighted combination of the two base terminal-method values. The low/high bounds are the minimum/maximum values across both full sensitivity grids.
- Comparable-company valuation calculates peer multiples from raw peer values. Negative EBITDA is excluded from EV/EBITDA and negative net income is excluded from P/E. Each multiple needs at least three valid peers.
- Comparable quantiles use Hyndman-Fan Type 7. Growth, profitability, size, and liquidity adjustments are each clamped to `[-0.50, 0.50]`; their sum is clamped again to the same range.
- VC valuation receives a low/base/high exit-equity range, target ownership, expected dilution, holding years, and target IRR and/or MOIC. `maximumInvestment = exitEquityValue × targetOwnership × (1 - expectedDilution) / targetMoic`; `maximumPreMoney = maximumInvestment × (1 - targetOwnership) / targetOwnership`. This exposes the user-requested ownership-based bridge without confusing stake value with company value.
- VC produces a 5x5 exit-equity × target-IRR sensitivity matrix whose center equals the base-case maximum pre-money valuation.
- Triangulation accepts two or three available method snapshots, requires explicit weights summing exactly to `1`, and calculates the combined low/mid/high as pointwise weighted sums. It emits one Football Field row per method plus a combined row.
- Formal downstream investment decisions may require at least two available methods; therefore `triangulateValuations` blocks a one-method input instead of inventing coverage.

### Task 1: Shared valuation contracts and trace support

**Files:**
- Create: `app/src/engines/valuation/valuation-types.ts`
- Create: `app/src/engines/valuation/valuation-types.test.ts`
- Create: `app/src/engines/valuation/valuation-test-fixtures.ts`
- Modify: `app/src/domain/analysis/calculation-trace.ts`
- Modify: `app/src/domain/analysis/engine-result.ts`
- Modify: `app/src/domain/analysis/engine-result.test.ts`

- [ ] **Step 1: Write the failing public-contract tests**

Lock these public APIs and output contracts with `expectTypeOf`:

```ts
export function calculateDcf(input: unknown): ValuationEngineResult<DcfResult>;
export function calculateComparableValuation(
  input: unknown,
): ValuationEngineResult<ComparableValuationResult>;
export function calculateVcMethod(input: unknown): ValuationEngineResult<VcMethodResult>;
export function triangulateValuations(
  input: unknown,
): ValuationEngineResult<ValuationTriangulationResult>;
```

Define the shared result shapes:

```ts
export type ValuationMethodId =
  | 'dcf'
  | 'comparable-ev-revenue'
  | 'comparable-ev-ebitda'
  | 'comparable-pe'
  | 'vc-method';

export interface ValuationRange {
  readonly low: DecimalString;
  readonly midpoint: DecimalString;
  readonly high: DecimalString;
  readonly currency: CurrencyCode;
  readonly valuationDate: string;
  readonly basis: 'pre-money-equity';
}

export interface FootballFieldRow {
  readonly methodId: ValuationMethodId | 'triangulated';
  readonly label: string;
  readonly low: DecimalString;
  readonly midpoint: DecimalString;
  readonly high: DecimalString;
}

export interface SensitivityMatrix {
  readonly matrixRef:
    | 'dcf-wacc-perpetuity-growth@1'
    | 'dcf-wacc-exit-multiple@1'
    | 'vc-exit-equity-target-irr@1';
  readonly rowAxis: SensitivityAxis;
  readonly columnAxis: SensitivityAxis;
  readonly values: readonly [
    readonly [DecimalString, DecimalString, DecimalString, DecimalString, DecimalString],
    readonly [DecimalString, DecimalString, DecimalString, DecimalString, DecimalString],
    readonly [DecimalString, DecimalString, DecimalString, DecimalString, DecimalString],
    readonly [DecimalString, DecimalString, DecimalString, DecimalString, DecimalString],
    readonly [DecimalString, DecimalString, DecimalString, DecimalString, DecimalString],
  ];
}
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm test -- src/engines/valuation/valuation-types.test.ts src/domain/analysis/engine-result.test.ts
```

Expected: FAIL because valuation contracts and trace variants do not exist.

- [ ] **Step 3: Add valuation trace and engine-result support**

Add:

```ts
export interface ValuationCalculationTrace {
  readonly engine: 'valuation';
  readonly valuationRef:
    | 'dcf@1'
    | 'comparable-valuation@1'
    | 'vc-method@1'
    | 'valuation-triangulation@1';
  readonly inputs: readonly TraceInput[];
  readonly steps: readonly TraceStep[];
}
```

Extend `CalculationTrace`, add `okResult`/`blockedResult` overloads, and add these stable issue codes:

```ts
| 'invalid_valuation_basis'
| 'invalid_valuation_range'
| 'invalid_sensitivity_matrix'
| 'inconsistent_target_return'
```

- [ ] **Step 4: Implement exact public DTO/result types and fresh fixture builders**

The fixture module must return newly allocated plain DTOs. It must expose helpers for canonical model years, DCF inputs, peers, comparable inputs, VC inputs, and triangulation inputs. Do not export shared mutable aliases.

- [ ] **Step 5: Verify GREEN and regressions**

Run:

```powershell
npm test -- src/engines/valuation/valuation-types.test.ts src/domain/analysis/engine-result.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 6: Commit**

```powershell
git add app/src/domain/analysis app/src/engines/valuation/valuation-types.ts app/src/engines/valuation/valuation-types.test.ts app/src/engines/valuation/valuation-test-fixtures.ts
git commit -m "feat: define valuation engine contracts"
```

### Task 2: Hostile-safe snapshot and exact semantic validation

**Files:**
- Create: `app/src/engines/valuation/snapshot-valuation-input.ts`
- Create: `app/src/engines/valuation/snapshot-valuation-input.test.ts`
- Create: `app/src/engines/valuation/validate-valuation-input.ts`
- Create: `app/src/engines/valuation/validate-valuation-input.test.ts`

- [ ] **Step 1: Write structural RED tests**

Apply the proven forecast limits and test sparse arrays, class instances, accessors, symbols, cycles, hostile proxies, non-finite numbers, excessive depth, excessive nodes, excessive array slots, excessive properties, and oversized strings. Every native failure must map to a fresh `DomainContractError('invalid_dto')`.

- [ ] **Step 2: Verify structural RED**

```powershell
npm test -- src/engines/valuation/snapshot-valuation-input.test.ts
```

- [ ] **Step 3: Implement the bounded snapshot**

Export only:

```ts
export function snapshotValuationInput(input: unknown): unknown;
```

Use the same budgets as `snapshotForecastInput`; preserve aliasing, reject cycles, and never invoke accessors.

- [ ] **Step 4: Write semantic RED tests**

Cover exact keys, version `1`, canonical decimals, ISO currencies and dates, complete 12-month model years, continuous periods, valuation-date alignment, unique peer IDs, all range ordering invariants, WACC in `(0, 1]`, `WACC > g`, positive exit multiples, five-value ascending sensitivity axes with the base value at index 2, conflict warnings, blocking conflicts, exact triangulation weights, same date/currency/basis, and VC target-return consistency within `1e-12`.

- [ ] **Step 5: Implement validators**

Export internal validators:

```ts
export function validateDcfInput(input: unknown): DcfValidation;
export function validateComparableInput(input: unknown): ComparableValidation;
export function validateVcInput(input: unknown): VcValidation;
export function validateTriangulationInput(input: unknown): TriangulationValidation;
```

Validation must snapshot first, parse exact union shapes, produce normalized Decimal strings, stable-sort issues and trace inputs, and return warnings for `conservative-selected` conflicts. Structural damage throws; semantic invalidity returns blocked.

- [ ] **Step 6: Verify GREEN and commit**

```powershell
npm test -- src/engines/valuation/snapshot-valuation-input.test.ts src/engines/valuation/validate-valuation-input.test.ts
npm run typecheck
npm run lint
git add app/src/engines/valuation/snapshot-valuation-input.ts app/src/engines/valuation/snapshot-valuation-input.test.ts app/src/engines/valuation/validate-valuation-input.ts app/src/engines/valuation/validate-valuation-input.test.ts
git commit -m "feat: validate valuation inputs defensively"
```

### Task 3: DCF dual-terminal valuation and sensitivity grids

**Files:**
- Create: `app/src/engines/valuation/calculate-dcf.ts`
- Create: `app/src/engines/valuation/calculate-dcf.test.ts`

- [ ] **Step 1: Write DCF RED vectors**

Test hand-calculable year-end and mid-year cases. Assert:

```ts
discountExponent = convention === 'mid-year' ? yearIndex - 0.5 : yearIndex;
pvFcff = fcff / (1 + wacc) ** discountExponent;
perpetuityTv = finalFcff * (1 + g) / (wacc - g);
exitTv = terminalMetric * exitMultiple;
pvTerminal = terminalValue / (1 + wacc) ** modelYearCount;
equityValue = enterpriseValue - (interestBearingDebt - cashAndCashEquivalents);
```

Add RED tests for negative FCFF, net cash, `WACC <= g`, invalid terminal metric, terminal-value shares, explicit terminal-method weights, center-cell identities, full 25-cell recalculation, monotonicity, deterministic JSON, deep freeze, and no input mutation.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/engines/valuation/calculate-dcf.test.ts
```

- [ ] **Step 3: Implement DCF**

Export:

```ts
export function calculateDcf(input: unknown): ValuationEngineResult<DcfResult>;
```

Calculate each sensitivity cell from scratch with the row/column assumptions. The overall midpoint must be:

```ts
weightedMidpoint =
  perpetuityBaseEquity * perpetuityWeight +
  exitMultipleBaseEquity * exitMultipleWeight;
```

The range low/high must scan every cell in both matrices. Do not round for display.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- src/engines/valuation/calculate-dcf.test.ts
npm run typecheck
npm run lint
git add app/src/engines/valuation/calculate-dcf.ts app/src/engines/valuation/calculate-dcf.test.ts
git commit -m "feat: calculate dual-terminal dcf valuations"
```

### Task 4: Comparable-company valuation

**Files:**
- Create: `app/src/engines/valuation/calculate-comparable-valuation.ts`
- Create: `app/src/engines/valuation/calculate-comparable-valuation.test.ts`

- [ ] **Step 1: Write comparable RED vectors**

Cover EV/Revenue, EV/EBITDA, and P/E with hand-calculable peers. Verify Type 7 quantiles using:

```ts
h = (n - 1) * p + 1;
j = Math.floor(h);
gamma = h - j;
quantile = x[j - 1] + gamma * (x[j] - x[j - 1]);
```

Test deduplication by normalized company ID, stable sorting, exclusion of non-positive denominators, minimum three valid samples per multiple, subject negative EBITDA/net income, net-debt bridge, net cash, four individual adjustment clamps, total clamp, negative adjustment, valid partial coverage, and fully unavailable coverage.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/engines/valuation/calculate-comparable-valuation.test.ts
```

- [ ] **Step 3: Implement comparable valuation**

Export:

```ts
export function calculateComparableValuation(
  input: unknown,
): ValuationEngineResult<ComparableValuationResult>;
```

Each valid multiple returns its raw sample count, raw P25/median/P75, total adjustment, adjusted multiple range, and pre-money equity range. Never average ranges across different multiple families.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- src/engines/valuation/calculate-comparable-valuation.test.ts
npm run typecheck
npm run lint
git add app/src/engines/valuation/calculate-comparable-valuation.ts app/src/engines/valuation/calculate-comparable-valuation.test.ts
git commit -m "feat: calculate comparable valuation ranges"
```

### Task 5: VC method and ownership-based maximum pre-money valuation

**Files:**
- Create: `app/src/engines/valuation/calculate-vc-method.ts`
- Create: `app/src/engines/valuation/calculate-vc-method.test.ts`

- [ ] **Step 1: Write VC RED vectors**

Assert target MOIC derivation and the ownership bridge:

```ts
targetMoic = (1 + targetIrr) ** holdingYears;
targetExitProceeds = exitEquityValue * targetOwnership * (1 - expectedDilution);
maximumInvestment = targetExitProceeds / targetMoic;
maximumPreMoney = maximumInvestment * (1 - targetOwnership) / targetOwnership;
```

Cover IRR-only, MOIC-only, consistent dual inputs, inconsistent dual inputs, IRR above 100%, zero dilution, full dilution, ownership `1`, non-positive holding years, low/base/high monotonicity, center-cell identity, and all 25 sensitivity cells.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/engines/valuation/calculate-vc-method.test.ts
```

- [ ] **Step 3: Implement VC valuation**

Export:

```ts
export function calculateVcMethod(
  input: unknown,
): ValuationEngineResult<VcMethodResult>;
```

Return the target MOIC, target exit proceeds range, maximum investment range, maximum pre-money range, and the versioned sensitivity matrix. If any resulting base pre-money value is non-positive, return `blocked/not-meaningful` rather than zero.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- src/engines/valuation/calculate-vc-method.test.ts
npm run typecheck
npm run lint
git add app/src/engines/valuation/calculate-vc-method.ts app/src/engines/valuation/calculate-vc-method.test.ts
git commit -m "feat: calculate vc method valuation limits"
```

### Task 6: Explicit-weight triangulation and Football Field output

**Files:**
- Create: `app/src/engines/valuation/triangulate-valuations.ts`
- Create: `app/src/engines/valuation/triangulate-valuations.test.ts`

- [ ] **Step 1: Write triangulation RED vectors**

Test three methods, degraded two-method coverage, one-method blocking, exact Decimal weight sum, duplicate method IDs, mixed dates, mixed currencies, mixed basis, invalid ranges, stable canonical ordering, pointwise weighted low/mid/high, Football Field rows, combined row, warnings, frozen JSON, deterministic repeated calls, and no mutation.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/engines/valuation/triangulate-valuations.test.ts
```

- [ ] **Step 3: Implement triangulation**

Export:

```ts
export function triangulateValuations(
  input: unknown,
): ValuationEngineResult<ValuationTriangulationResult>;
```

Canonical row order is DCF, EV/Revenue, EV/EBITDA, P/E, VC, triangulated. Preserve every available method range; do not collapse comparable rows into an unstated average.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- src/engines/valuation/triangulate-valuations.test.ts
npm run typecheck
npm run lint
git add app/src/engines/valuation/triangulate-valuations.ts app/src/engines/valuation/triangulate-valuations.test.ts
git commit -m "feat: triangulate valuation ranges"
```

### Task 7: Golden vectors and cross-engine forecast compatibility

**Files:**
- Create: `app/src/engines/valuation/valuation-golden-vectors.test.ts`
- Modify only valuation/shared-contract files when a failing vector proves a defect

- [ ] **Step 1: Add a complete RED golden vector**

Run the existing `forecastThreeScenarios` fixture, take the base scenario model years, and feed those exact `ModelYearForecast` DTOs into DCF and comparable subject metrics. Build a VC exit range from declared terminal equity assumptions, then triangulate DCF, three available comparable rows, and VC with explicit weights.

Assert selected PVs, both terminal values, net-debt bridge, comparable quantiles, VC maximum investment/pre-money values, the final combined range, all Football Field rows, all matrix center cells, trace references, and byte-identical JSON.

- [ ] **Step 2: Verify RED, then fix only proven gaps**

```powershell
npm test -- src/engines/valuation/valuation-golden-vectors.test.ts
```

- [ ] **Step 3: Add hardening vectors**

Cover 36/48/60-month forecast outputs, alias-heavy DTOs, null-prototype DTOs, 40-digit HALF_EVEN ties, extreme finite decimals, reordered peers/methods, insufficient peer subsets, `WACC` and growth boundary proximity, and all output serialization invariants.

- [ ] **Step 4: Run focused regressions and commit**

```powershell
npm test -- src/domain/analysis/engine-result.test.ts src/engines/forecast/forecast-golden-vectors.test.ts src/engines/valuation/valuation-golden-vectors.test.ts
npm run typecheck
npm run lint
git add app/src/engines/valuation app/src/domain/analysis
git commit -m "test: harden valuation triangulation"
```

### Task 8: Complete verification and branch handoff

**Files:**
- Review all valuation commits and `docs/superpowers/plans/2026-07-27-valuation-triangulation-engine.md`

- [ ] **Step 1: Run fresh complete gates**

From `app/` run:

```powershell
npm test -- src/domain/analysis/engine-result.test.ts src/engines/forecast/forecast-golden-vectors.test.ts src/engines/valuation/valuation-golden-vectors.test.ts
npm run typecheck
npm test
npm run lint
npm run build
npm audit --audit-level=high
git diff --check
```

Existing Vite large-chunk warnings may remain warnings. Do not run `npm audit fix --force`; report the known React Router vulnerabilities separately if the audit remains non-zero.

- [ ] **Step 2: Self-review against the approved phase-two specification**

Confirm dual terminal values, terminal discount timing, pre-money basis, Type 7 quantiles, invalid-sample exclusions, adjustment clamps, ownership-based VC bridge, explicit triangulation weights, at least two methods, frozen output, deterministic trace, no `NaN`/`Infinity`, and no display rounding.

- [ ] **Step 3: Fix every valid finding through a failing regression test**

Run the focused test after each fix, then repeat all complete gates after the last code change.

- [ ] **Step 4: Present branch completion options**

Use `superpowers:finishing-a-development-branch`. Do not merge, push, delete the branch, or remove the worktree until the user chooses.
