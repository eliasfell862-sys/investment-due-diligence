# Risk Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, deterministic TypeScript risk engine covering nine partial-assessment categories, residual-risk scoring, six fatal-flaw redlines, dual loss-probability ranges, risk-to-clause recommendations, and a red/yellow/green matrix.

**Architecture:** Add `app/src/engines/risk/` with one public hostile-safe entry point, `evaluateRisk(input: unknown)`. Snapshot and semantic validation occur once; four internal pure calculators handle scores, fatal flaws, loss ranges, and clauses before the orchestrator assembles frozen, JSON-safe output and a stable `RiskCalculationTrace`.

**Tech Stack:** TypeScript 6, Decimal.js through shared `AnalysisDecimal` (precision 40, ROUND_HALF_EVEN), Vitest, shared `EngineResult`, shared trace contracts, pure local computation without UI, browser, persistence, network, or AI dependencies.

---

## Locked v1 decisions

- Categories are fixed and ordered: `market`, `technology`, `customer`, `financial`, `financing`, `legal_compliance`, `governance`, `data_authenticity`, `exit`.
- Categories may be assessed incrementally. A category with no risk items is `unassessed`, has `null` residual risk/light, creates a data gap, and is never treated as green or zero risk.
- Item residual risk is `probability * impact * (1 - mitigationEffectiveness)` using `AnalysisDecimal` only.
- Category risk is the maximum item residual risk. Ties select the Unicode-code-point-smallest `riskId` as the top risk.
- Default overall risk is the arithmetic mean of assessed categories. Custom weights contain all nine categories, sum exactly to `1`, and are renormalized over assessed categories while preserving original weight coverage.
- Default traffic thresholds are `greenUpper=0.33` and `redLower=0.67`. Project overrides require `0 <= greenUpper < redLower <= 1` and a nonempty change reason. Overrides affect matrix lights and clause triggers, not fixed dual-loss rule boundaries.
- All six fatal-flaw checks are required exactly once. Severity is fixed by flaw ID. Status is `clear | open | covered | resolved`.
- `covered` requires a written reason and binding conditions. `resolved` requires a resolution note. `open + reject` outranks `open + pause`, which outranks covered flaws.
- Permanent-loss and temporary-drawdown ranges use the approved fixed priority tables and never use Monte Carlo.
- Safety margin, downside cash break, downside MOIC, and exit delay are read from upstream snapshots and never recomputed.
- Yellow/red risk items generate fixed-catalog clauses. `open + reject` is not curable by clauses; `open + pause` creates mandatory conditions precedent; covered conditions become mandatory clauses.
- Output ordering uses explicit Unicode code-point comparison and never locale-dependent `localeCompare`.
- All outputs and blocked results are deeply frozen, deterministic, JSON-safe, non-mutating, and free of `NaN`/`Infinity`.

## File map

- `app/src/engines/risk/risk-types.ts`: public DTOs, result types, enums, and normalized calculator contracts.
- `app/src/engines/risk/risk-types.test.ts`: compile-time and runtime public contract locks.
- `app/src/engines/risk/risk-test-fixtures.ts`: fresh deterministic fixture builders.
- `app/src/engines/risk/compare-risk-strings.ts`: environment-independent Unicode code-point ordering.
- `app/src/engines/risk/snapshot-risk-input.ts`: bounded hostile-safe DTO snapshot.
- `app/src/engines/risk/validate-risk-input.ts`: exact-key semantic validation and normalization.
- `app/src/engines/risk/calculate-risk-scores.ts`: item/category/overall scoring and traffic lights.
- `app/src/engines/risk/evaluate-fatal-flaws.ts`: fixed fatal checklist and precedence.
- `app/src/engines/risk/estimate-loss-ranges.ts`: dual probability rule evaluation.
- `app/src/engines/risk/risk-clause-catalog.ts`: fixed category/signal/fatal clause metadata.
- `app/src/engines/risk/recommend-risk-clauses.ts`: clause trigger, dedupe, aggregation, and checklist generation.
- `app/src/engines/risk/evaluate-risk.ts`: public orchestration and trace assembly.
- `app/src/engines/risk/risk-golden-vectors.test.ts`: complete cross-component and hardening vectors.
- `app/src/domain/analysis/calculation-trace.ts`: add `RiskCalculationTrace`.
- `app/src/domain/analysis/engine-result.ts`: add risk issue codes and risk result-factory overloads.

### Task 1: Public contracts, trace support, issue codes, ordering, and fixtures

**Files:**
- Create: `app/src/engines/risk/risk-types.ts`
- Create: `app/src/engines/risk/risk-types.test.ts`
- Create: `app/src/engines/risk/risk-test-fixtures.ts`
- Create: `app/src/engines/risk/compare-risk-strings.ts`
- Modify: `app/src/domain/analysis/calculation-trace.ts`
- Modify: `app/src/domain/analysis/engine-result.ts`
- Modify: `app/src/domain/analysis/engine-result.test.ts`

- [ ] **Step 1: Write failing public-contract tests**

Lock the DTO and trace types:

```ts
expectTypeOf<RiskAssessmentInput['version']>().toEqualTypeOf<'1'>();
expectTypeOf<RiskEngineResult<RiskAssessment>['trace']>()
  .toEqualTypeOf<RiskCalculationTrace>();
```

Lock these exact public enums:

```ts
export type RiskCategory =
  | 'market'
  | 'technology'
  | 'customer'
  | 'financial'
  | 'financing'
  | 'legal_compliance'
  | 'governance'
  | 'data_authenticity'
  | 'exit';

export type RiskLight = 'green' | 'yellow' | 'red';
export type FatalFlawStatus = 'clear' | 'open' | 'covered' | 'resolved';
export type FatalOutcome = 'none' | 'conditional_cap' | 'pause' | 'reject';
```

The test must fail because the risk DTOs and risk trace do not exist.

- [ ] **Step 2: Run RED**

```powershell
npm test -- src/engines/risk/risk-types.test.ts src/domain/analysis/engine-result.test.ts
```

Expected: FAIL on missing risk contracts and trace support.

- [ ] **Step 3: Add risk trace and issue codes**

Add to `calculation-trace.ts`:

```ts
export interface RiskCalculationTrace {
  readonly engine: 'risk';
  readonly riskRef: 'risk-assessment@1';
  readonly inputs: readonly TraceInput[];
  readonly steps: readonly TraceStep[];
}
```

Extend `CalculationTrace`, `okResult`, and `blockedResult`. Add these exact issue codes:

```ts
| 'invalid_risk_item'
| 'invalid_risk_weight'
| 'invalid_risk_threshold'
| 'invalid_fatal_flaw'
| 'invalid_risk_snapshot'
| 'missing_risk_coverage'
```

- [ ] **Step 4: Implement exact public DTOs**

Define the approved input contracts, `RiskItemAssessment`, nine-row `CategoryRiskAssessment`, `OverallRiskAssessment`, fatal-flaw outputs, `LossProbabilityRange`, `ClauseRecommendation`, checklist/data-gap types, `RiskAssessment`, and:

```ts
export type RiskEngineResult<T> = EngineResult<T, RiskCalculationTrace>;
```

Fixture builders must return fresh plain/null-prototype-compatible DTOs and support nested deterministic overrides without shared mutation.

- [ ] **Step 5: Add Unicode comparator tests**

Assert code-point order, including:

```ts
expect(['ä-risk', 'z-risk'].sort(compareUnicodeCodePoints))
  .toEqual(['z-risk', 'ä-risk']);
```

- [ ] **Step 6: Verify GREEN and commit**

```powershell
npm test -- src/engines/risk/risk-types.test.ts src/domain/analysis/engine-result.test.ts
npm run typecheck
npm run lint
git add app/src/domain/analysis app/src/engines/risk/risk-types.ts app/src/engines/risk/risk-types.test.ts app/src/engines/risk/risk-test-fixtures.ts app/src/engines/risk/compare-risk-strings.ts
git commit -m "feat: define risk engine contracts"
```

### Task 2: Hostile-safe snapshot and semantic validation

**Files:**
- Create: `app/src/engines/risk/snapshot-risk-input.ts`
- Create: `app/src/engines/risk/snapshot-risk-input.test.ts`
- Create: `app/src/engines/risk/validate-risk-input.ts`
- Create: `app/src/engines/risk/validate-risk-input.test.ts`

- [ ] **Step 1: Write structural RED tests**

Cover class instances, symbols, accessors, sparse arrays, cycles, hostile proxies, non-finite numbers, excessive depth/nodes/properties/strings, null prototypes, and shared aliases. Shared aliases must be preserved and counted only on first traversal.

- [ ] **Step 2: Run structural RED**

```powershell
npm test -- src/engines/risk/snapshot-risk-input.test.ts
```

Expected: FAIL because `snapshotRiskInput` is missing.

- [ ] **Step 3: Implement bounded snapshot**

Export only:

```ts
export function snapshotRiskInput(input: unknown): unknown;
```

Use the exact approved budgets: depth 64, nodes 16,384, array length 4,096, total slots 32,768, object properties 4,096/32,768, and string length 65,536/1,048,576.

- [ ] **Step 4: Write semantic RED tests**

Cover exact keys, version/date, unique IDs, category/signal compatibility, `[0,1]` decimals, required mitigation description when effectiveness is positive, duplicate signals/evidence, 4,096-item maximum, all-nine exact weights, exact weight sum, thresholds/change reason, six fatal checks exactly once, status-specific fields, finite safety margin, nonnegative downside MOIC, exact snapshot source refs, and deterministic issue ordering.

- [ ] **Step 5: Implement validation**

Export:

```ts
export function validateRiskInput(input: unknown): RiskInputValidation;
```

Structural damage throws fresh `DomainContractError('invalid_dto')`. Semantic invalidity returns blocked validation with stable issues and trace inputs. Empty `riskItems` is valid. Custom weights with at least one assessed category but zero assessed weight return `not-meaningful`.

- [ ] **Step 6: Verify and commit**

```powershell
npm test -- src/engines/risk/snapshot-risk-input.test.ts src/engines/risk/validate-risk-input.test.ts
npm run typecheck
npm run lint
git add app/src/engines/risk/snapshot-risk-input.ts app/src/engines/risk/snapshot-risk-input.test.ts app/src/engines/risk/validate-risk-input.ts app/src/engines/risk/validate-risk-input.test.ts
git commit -m "feat: validate risk engine inputs"
```

### Task 3: Residual-risk scoring and traffic-light matrix

**Files:**
- Create: `app/src/engines/risk/calculate-risk-scores.ts`
- Create: `app/src/engines/risk/calculate-risk-scores.test.ts`

- [ ] **Step 1: Write scoring RED vectors**

Test exact item formula, 0/1 boundaries, 40-digit HALF_EVEN ties, category maximum, Unicode tie-breaking, six assessed plus three unassessed categories, all-unassessed output, default equal weights, custom-weight renormalization, category and weight coverage ratios, `overall * 20`, default thresholds, custom thresholds, and exact threshold equality.

Representative assertion:

```ts
expect(item.residualRisk).toBe(
  canonicalDecimal(
    new AnalysisDecimal(item.probability)
      .times(item.impact)
      .times(new AnalysisDecimal(1).minus(item.mitigationEffectiveness)),
  ),
);
```

- [ ] **Step 2: Run RED**

```powershell
npm test -- src/engines/risk/calculate-risk-scores.test.ts
```

- [ ] **Step 3: Implement scoring**

Export internal pure function:

```ts
export function calculateRiskScores(
  input: NormalizedRiskScoreInput,
): RiskScoreCalculation;
```

Return item assessments, fixed nine-row category matrix, overall assessment, scoring steps, and coverage gaps. Do not create clauses in this layer.

- [ ] **Step 4: Verify and commit**

```powershell
npm test -- src/engines/risk/calculate-risk-scores.test.ts
npm run typecheck
npm run lint
git add app/src/engines/risk/calculate-risk-scores.ts app/src/engines/risk/calculate-risk-scores.test.ts
git commit -m "feat: calculate residual risk matrix"
```

### Task 4: Six fatal-flaw redlines

**Files:**
- Create: `app/src/engines/risk/evaluate-fatal-flaws.ts`
- Create: `app/src/engines/risk/evaluate-fatal-flaws.test.ts`

- [ ] **Step 1: Write fatal-flaw RED vectors**

Lock the six IDs and severity table. Test all clear, one open reject, one open pause, both open severities, covered-only conditional cap, covered reason/conditions, resolved audit retention, stable order, `notCurableByClause`, and independence from empty risk categories.

- [ ] **Step 2: Run RED**

```powershell
npm test -- src/engines/risk/evaluate-fatal-flaws.test.ts
```

- [ ] **Step 3: Implement fatal evaluation**

Export:

```ts
export function evaluateFatalFlaws(
  checks: readonly NormalizedFatalFlawCheck[],
): FatalFlawCalculation;
```

Precedence is `open reject > open pause > covered > none`. Resolved checks remain in public output and trace but do not affect the outcome.

- [ ] **Step 4: Verify and commit**

```powershell
npm test -- src/engines/risk/evaluate-fatal-flaws.test.ts
npm run typecheck
npm run lint
git add app/src/engines/risk/evaluate-fatal-flaws.ts app/src/engines/risk/evaluate-fatal-flaws.test.ts
git commit -m "feat: evaluate fatal flaw redlines"
```

### Task 5: Dual loss-probability rule engine

**Files:**
- Create: `app/src/engines/risk/estimate-loss-ranges.ts`
- Create: `app/src/engines/risk/estimate-loss-ranges.test.ts`

- [ ] **Step 1: Write permanent-loss RED vectors**

Lock exact rule IDs and intervals:

```ts
permanent_open_reject                         => ['0.75', '1']
permanent_open_pause                          => ['0.5', '0.8']
permanent_cash_break_and_moic_below_one       => ['0.4', '0.7']
permanent_overall_risk_at_least_067           => ['0.3', '0.6']
permanent_overall_risk_at_least_033           => ['0.15', '0.35']
permanent_default                             => ['0.05', '0.2']
```

Assert all triggered rules are retained while the first priority rule is selected.

- [ ] **Step 2: Write temporary-drawdown RED vectors**

```ts
temporary_exit_delay_and_margin_below_015     => ['0.45', '0.75']
temporary_downside_moic_below_one              => ['0.35', '0.65']
temporary_margin_below_020                     => ['0.25', '0.5']
temporary_overall_risk_at_least_033            => ['0.15', '0.4']
temporary_default                              => ['0.05', '0.25']
```

Test exact `<` versus `>=` boundaries and confirm project traffic thresholds do not alter these fixed rules.

- [ ] **Step 3: Test missing snapshots**

Missing valuation/forecast/returns/exit snapshots must not block available fatal/overall/default rules. Assert stable `missingInputs` and `requiresInvestorConfirmation: true`.

- [ ] **Step 4: Run RED and implement**

```powershell
npm test -- src/engines/risk/estimate-loss-ranges.test.ts
```

Export:

```ts
export function estimateLossRanges(
  input: LossRangeInput,
): DualLossRangeCalculation;
```

- [ ] **Step 5: Verify and commit**

```powershell
npm test -- src/engines/risk/estimate-loss-ranges.test.ts
npm run typecheck
npm run lint
git add app/src/engines/risk/estimate-loss-ranges.ts app/src/engines/risk/estimate-loss-ranges.test.ts
git commit -m "feat: estimate dual loss probability ranges"
```

### Task 6: Risk-to-clause catalog and recommendation engine

**Files:**
- Create: `app/src/engines/risk/risk-clause-catalog.ts`
- Create: `app/src/engines/risk/risk-clause-catalog.test.ts`
- Create: `app/src/engines/risk/recommend-risk-clauses.ts`
- Create: `app/src/engines/risk/recommend-risk-clauses.test.ts`

- [ ] **Step 1: Write catalog RED tests**

Assert every one of the 38 approved `ClauseType` values appears exactly once in type/catalog coverage and every category has the exact approved default list. Assert every risk signal maps only within its category.

- [ ] **Step 2: Write recommendation RED tests**

Cover yellow=`high`, red=`must_have`, green/unassessed=no clause, signal narrowing, duplicate clause aggregation, source sorting, priority escalation, side effects, fixed disclaimer, legal review, open reject blocked status, open pause condition precedent, covered binding conditions retained separately, and resolved no new clause.

- [ ] **Step 3: Run RED**

```powershell
npm test -- src/engines/risk/risk-clause-catalog.test.ts src/engines/risk/recommend-risk-clauses.test.ts
```

- [ ] **Step 4: Implement catalog and recommendations**

Export:

```ts
export const RISK_CLAUSE_CATALOG: RiskClauseCatalog;

export function recommendRiskClauses(
  input: ClauseRecommendationInput,
): ClauseRecommendationCalculation;
```

Deduplicate by `clauseType`, except `covered_flaw_binding_condition`, which deduplicates by normalized binding-condition text. Clauses never modify residual-risk scores.

- [ ] **Step 5: Verify and commit**

```powershell
npm test -- src/engines/risk/risk-clause-catalog.test.ts src/engines/risk/recommend-risk-clauses.test.ts
npm run typecheck
npm run lint
git add app/src/engines/risk/risk-clause-catalog.ts app/src/engines/risk/risk-clause-catalog.test.ts app/src/engines/risk/recommend-risk-clauses.ts app/src/engines/risk/recommend-risk-clauses.test.ts
git commit -m "feat: link risks to clause recommendations"
```

### Task 7: Public risk orchestration, matrix assembly, and audit trace

**Files:**
- Create: `app/src/engines/risk/evaluate-risk.ts`
- Create: `app/src/engines/risk/evaluate-risk.test.ts`

- [ ] **Step 1: Write orchestration RED tests**

Use six assessed categories, three unassessed categories, custom weights, custom thresholds, one open pause, one covered flaw, one resolved flaw, complete upstream snapshots, and duplicated clause triggers. Assert the public value includes all four calculator outputs, nine rows, counts, coverage ratios, gaps, checklist, clause counts, trace ordering, warnings, frozen output, deterministic repeated calls, and unchanged input.

Lock the public entry-point type:

```ts
type RiskEntryPoint = (input: unknown) => RiskEngineResult<RiskAssessment>;

expectTypeOf(evaluateRisk).toEqualTypeOf<RiskEntryPoint>();
```

- [ ] **Step 2: Write blocked-path RED tests**

Assert invalid semantic input returns blocked risk trace with no fabricated scoring result; hostile input throws `invalid_dto`; custom weights with assessed categories but zero assessed weight return `not-meaningful`.

- [ ] **Step 3: Run RED**

```powershell
npm test -- src/engines/risk/evaluate-risk.test.ts
```

- [ ] **Step 4: Implement public entry point**

```ts
export function evaluateRisk(
  input: unknown,
): RiskEngineResult<RiskAssessment>;
```

Validate once, call calculators in the fixed order scores -> fatal flaws -> loss ranges -> clauses, then assemble category clause counts, verification checklist, data gaps, warnings, and ordered trace steps. Do not re-read hostile input after snapshot.

- [ ] **Step 5: Verify and commit**

```powershell
npm test -- src/engines/risk/evaluate-risk.test.ts
npm run typecheck
npm run lint
git add app/src/engines/risk/evaluate-risk.ts app/src/engines/risk/evaluate-risk.test.ts
git commit -m "feat: orchestrate risk assessment"
```

### Task 8: Golden vectors and boundary hardening

**Files:**
- Create: `app/src/engines/risk/risk-golden-vectors.test.ts`
- Modify risk/shared-contract files only when a failing vector proves a defect

- [ ] **Step 1: Add the complete approved golden vector**

The vector must contain at least six assessed categories, three unassessed categories, custom all-nine weights, custom thresholds with audit reason, open pause/covered/resolved fatal checks, all four upstream snapshots, multiple permanent and temporary loss-rule hits, duplicate clauses, and Unicode IDs.

Assert exact item/category/overall Decimal strings, coverage, risk penalty, matrix lights, fatal outcome, selected and triggered loss rules, missing inputs, clauses, checklist, trace IDs, frozen output, input immutability, and byte-identical repeated calls.

- [ ] **Step 2: Add hardening vectors**

Cover all-unassessed, default weights, zero/one inputs, 40-digit ties, equal category maxima, exact 0.33/0.67 light boundaries, fixed 0.15/0.20/0.33/0.67 loss boundaries, negative safety margin, 4,096 risk items, null-prototype DTO, alias-heavy input, reordered items/evidence, duplicate conditions, and maximum valid public arrays.

- [ ] **Step 3: Run focused regressions**

```powershell
npm test -- src/domain/analysis/engine-result.test.ts src/engines/equity/equity-golden-vectors.test.ts src/engines/risk/risk-golden-vectors.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 4: Commit**

```powershell
git add app/src/engines/risk app/src/domain/analysis
git commit -m "test: harden risk engine"
```

### Task 9: Complete verification and branch handoff

**Files:**
- Review all risk commits and `docs/superpowers/specs/2026-07-27-risk-engine-design.md`

- [ ] **Step 1: Run fresh complete gates**

From `app/`:

```powershell
npm test -- src/domain/analysis/engine-result.test.ts src/engines/equity/equity-golden-vectors.test.ts src/engines/risk/risk-golden-vectors.test.ts
npm run typecheck
npm test
npm run lint
npm run build
npm audit --audit-level=high
git diff --check
```

Do not run `npm audit fix --force`. Report the existing React Router audit findings separately if unchanged.

- [ ] **Step 2: Self-review against the approved design**

Confirm partial category assessment, missing-category semantics, Decimal-only arithmetic, max category risk, weight renormalization, coverage ratios, custom-threshold audit, fixed loss boundaries, fatal precedence, snapshot-only safety margin, clause dedupe, disclaimers, stable ordering, resource budgets, frozen output, and no `NaN`/`Infinity`.

- [ ] **Step 3: Fix every valid finding through a failing regression test**

Repeat focused and full gates after the final code change.

- [ ] **Step 4: Present branch completion options**

Use `superpowers:finishing-a-development-branch`. Do not merge, push, delete the branch, or remove the worktree until the user chooses.
