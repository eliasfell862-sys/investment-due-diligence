# Equity and Dilution Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user explicitly requested inline execution without subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure TypeScript equity engine that models fully diluted cap tables through priced rounds and ESOP expansion, calculates preference-aware liquidation waterfalls, and produces scenario investor IRR/MOIC, expected MOIC, and permanent-loss probability.

**Architecture:** Add `app/src/engines/equity/` with three public pure functions: `modelCapTable`, `calculateLiquidationWaterfall`, and `calculateInvestorReturns`. Public inputs are hostile-safe `unknown` DTOs, all calculations use the shared 40-digit HALF_EVEN Decimal boundary, and every result is frozen, JSON-safe, deterministic, and traceable. Cap-table modeling, liquidation allocation, and return calculations remain separate layers; the returns layer consumes the cap-table and reuses the liquidation engine per scenario.

**Tech Stack:** TypeScript 6, Decimal.js through `AnalysisDecimal`, Vitest, shared `EngineResult` and trace contracts, pure functions without UI, Dexie, browser, or network dependencies.

---

## Locked v1 decisions

- Fully diluted shares are the source of truth. Ownership is always derived as `holderShares / totalFullyDilutedShares`.
- Each `securityId` identifies one aggregate holder/security position and is unique. Multiple positions may share a `holderId`.
- Initial positions carry acquisition date and invested capital so investor cash flows remain auditable.
- v1 supports common, preferred, and ESOP positions; it excludes SAFEs, convertibles, anti-dilution repricing, and option vesting schedules.
- A priced round may include one ESOP pool expansion with timing `pre-money` or `post-money`.
- Pre-money pool expansion is solved to the declared post-round target pool percentage before share pricing, so dilution is borne by pre-round holders.
- Post-money pool expansion occurs after investor issuance, so all then-existing holders are diluted.
- Priced-round formulas are:
  - `pricePerShare = preMoneyEquityValue / preRoundFullyDilutedShares`
  - `newShares = investmentAmount / pricePerShare`
  - optional `postMoneyEquityValue` must equal `preMoneyEquityValue + investmentAmount`.
- Events are processed in supplied order and must have unique IDs with nondecreasing valid dates.
- Preferred securities declare participation, liquidation multiple, seniority rank, and optional participating cap multiple.
- Smaller `seniorityRank` is paid first. Same-rank preference claims share constrained proceeds pro rata.
- Participating preferred receives preference first and then participates in residual by as-converted shares. A cap multiple limits total proceeds, and capped excess is iteratively redistributed.
- Non-participating preferred conversion is solved jointly. Up to 12 such security classes are sorted by security ID, all conversion vectors are enumerated, and only self-consistent vectors are eligible.
- A conversion vector is self-consistent when every security's payout under its current choice is at least its payout after flipping only that security while holding all other choices fixed.
- If multiple self-consistent vectors exist, choose the lexicographically smallest false/true vector by sorted security ID. No equilibrium or more than 12 classes returns blocked/invalid-input.
- Every waterfall allocation is conserved: total holder proceeds exactly equals the distributable exit value and remaining value never becomes negative.
- XIRR uses Actual/365, accepts exactly one sign change, brackets from `[-0.999999999999, 1]` while doubling the upper bound through `1000`, and uses at most 512 bisections.
- XIRR converges when normalized NPV is at most `1e-20` or bracket width is at most `1e-24`; otherwise it returns `root_not_found`.
- Scenario MOIC is investor proceeds divided by total invested capital. Scenario XIRR may be `null` with an explicit `root_not_found` issue.
- Expected MOIC is `?(probability ? investor proceeds) / total invested capital`; scenario IRRs are never averaged.
- Permanent-loss probability is the exact probability sum of scenarios where investor proceeds are strictly below total invested capital.

### Task 1: Shared equity contracts, result types, fixtures, and trace support

**Files:**
- Create: `app/src/engines/equity/equity-types.ts`
- Create: `app/src/engines/equity/equity-types.test.ts`
- Create: `app/src/engines/equity/equity-test-fixtures.ts`
- Modify: `app/src/domain/analysis/calculation-trace.ts`
- Modify: `app/src/domain/analysis/engine-result.ts`
- Modify: `app/src/domain/analysis/engine-result.test.ts`

- [ ] **Step 1: Write failing contract tests**

Lock these public APIs:

```ts
export function modelCapTable(input: unknown): EquityEngineResult<CapTableModel>;
export function calculateLiquidationWaterfall(
  input: unknown,
): EquityEngineResult<LiquidationWaterfall>;
export function calculateInvestorReturns(
  input: unknown,
): EquityEngineResult<InvestorReturnSet>;
```

Lock the core position and result contracts:

```ts
export interface SecurityPosition {
  readonly securityId: string;
  readonly holderId: string;
  readonly securityType: 'common' | 'preferred' | 'esop';
  readonly shares: DecimalString;
  readonly investedCapital: DecimalString;
  readonly acquisitionDate: string;
  readonly liquidationPreference?: LiquidationPreference;
}

export interface CapTableSnapshot {
  readonly eventId: string;
  readonly asOfDate: string;
  readonly totalFullyDilutedShares: DecimalString;
  readonly positions: readonly CapTablePosition[];
}

export interface InvestorReturnSet {
  readonly totalInvestedCapital: DecimalString;
  readonly scenarios: readonly InvestorScenarioReturn[];
  readonly expectedExitProceeds: DecimalString;
  readonly expectedMoic: DecimalString;
  readonly permanentLossProbability: ProbabilityString;
}
```

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/engines/equity/equity-types.test.ts src/domain/analysis/engine-result.test.ts
```

Expected: FAIL because equity contracts and trace variants do not exist.

- [ ] **Step 3: Add equity trace and result-factory overloads**

Add:

```ts
export interface EquityCalculationTrace {
  readonly engine: 'equity';
  readonly equityRef:
    | 'cap-table@1'
    | 'liquidation-waterfall@1'
    | 'investor-returns@1';
  readonly inputs: readonly TraceInput[];
  readonly steps: readonly TraceStep[];
}
```

Extend `CalculationTrace`, `okResult`, and `blockedResult`. Add stable issue codes:

```ts
| 'invalid_cap_table'
| 'invalid_equity_event'
| 'invalid_liquidation_preference'
| 'invalid_conversion_equilibrium'
| 'allocation_mismatch'
```

- [ ] **Step 4: Implement exact DTO and result types**

Define:
- initial cap-table positions;
- priced-round events and embedded ESOP expansion;
- cap-table snapshots and investment ledger entries;
- liquidation waterfall inputs, conversion decisions, and allocations;
- return scenarios and XIRR cash flows;
- normalized internal types and internal blocked-calculation unions.

Fixture builders must return fresh plain DTOs and accept deterministic nested overrides.

- [ ] **Step 5: Verify GREEN**

```powershell
npm test -- src/engines/equity/equity-types.test.ts src/domain/analysis/engine-result.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 6: Commit**

```powershell
git add app/src/domain/analysis app/src/engines/equity/equity-types.ts app/src/engines/equity/equity-types.test.ts app/src/engines/equity/equity-test-fixtures.ts docs/superpowers/plans/2026-07-27-equity-dilution-engine.md
git commit -m "feat: define equity engine contracts"
```

### Task 2: Hostile-safe snapshot and semantic validation

**Files:**
- Create: `app/src/engines/equity/snapshot-equity-input.ts`
- Create: `app/src/engines/equity/snapshot-equity-input.test.ts`
- Create: `app/src/engines/equity/validate-equity-input.ts`
- Create: `app/src/engines/equity/validate-equity-input.test.ts`

- [ ] **Step 1: Write structural RED tests**

Cover sparse arrays, class instances, accessors, symbols, cycles, hostile proxies, non-finite numbers, oversized arrays/properties/strings, excessive depth/nodes, and shared aliases. Native failures must map to fresh `DomainContractError('invalid_dto')`.

- [ ] **Step 2: Verify structural RED**

```powershell
npm test -- src/engines/equity/snapshot-equity-input.test.ts
```

- [ ] **Step 3: Implement bounded snapshot**

Export only:

```ts
export function snapshotEquityInput(input: unknown): unknown;
```

Use the same budgets as forecast and valuation inputs.

- [ ] **Step 4: Write semantic RED tests**

Cover exact keys, version `1`, ISO currency/date, canonical decimals, unique nonempty IDs, nonnegative shares/invested capital, strictly positive starting fully diluted shares, preferred-only preference fields, positive preference multiples, integer nonnegative seniority ranks, valid cap multiples, priced-round valuation/investment positivity, optional post-money consistency, ESOP target ownership in `(0,1)`, event date ordering, scenario probability sum, unique scenario IDs, exit date ordering, and valid investor holder references.

- [ ] **Step 5: Implement validators**

Export:

```ts
export function validateCapTableInput(input: unknown): CapTableValidation;
export function validateWaterfallInput(input: unknown): WaterfallValidation;
export function validateInvestorReturnInput(input: unknown): InvestorReturnValidation;
```

Structural damage throws. Semantic invalidity returns stable blocked results and trace inputs.

- [ ] **Step 6: Verify and commit**

```powershell
npm test -- src/engines/equity/snapshot-equity-input.test.ts src/engines/equity/validate-equity-input.test.ts
npm run typecheck
npm run lint
git add app/src/engines/equity/snapshot-equity-input.ts app/src/engines/equity/snapshot-equity-input.test.ts app/src/engines/equity/validate-equity-input.ts app/src/engines/equity/validate-equity-input.test.ts
git commit -m "feat: validate equity engine inputs"
```

### Task 3: Priced rounds, ESOP expansion, and multi-round cap tables

**Files:**
- Create: `app/src/engines/equity/model-cap-table.ts`
- Create: `app/src/engines/equity/model-cap-table.test.ts`

- [ ] **Step 1: Write cap-table RED vectors**

Test:
- a simple pre-money priced round;
- optional post-money consistency;
- pre-money ESOP expansion borne by old holders;
- post-money ESOP expansion borne by all holders;
- existing ESOP pool top-up rather than duplicate pool creation;
- multiple subsequent rounds;
- the same investor participating in later rounds;
- exact ownership sum of `1`;
- exact share-conservation checks after every event;
- deterministic position order and frozen output.

Use the equations:

```ts
pricePerShare = preMoney / prePricingFullyDilutedShares;
newInvestorShares = investment / pricePerShare;

preMoneyPoolIncrease =
  (targetPool * (1 + investment / preMoney) * preRoundShares - existingPoolShares) /
  (1 - targetPool * (1 + investment / preMoney));

postMoneyPoolIncrease =
  (targetPool * sharesAfterInvestorIssue - existingPoolShares) /
  (1 - targetPool);
```

Pool increase is floored at zero; invalid denominators block instead of returning negative or infinite shares.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/engines/equity/model-cap-table.test.ts
```

- [ ] **Step 3: Implement cap-table modeling**

Export:

```ts
export function modelCapTable(input: unknown): EquityEngineResult<CapTableModel>;
```

Process events sequentially, create one snapshot per event plus the initial snapshot, append investment ledger entries for initial and round investments, and stable-sort positions by security ID in public output.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- src/engines/equity/model-cap-table.test.ts
npm run typecheck
npm run lint
git add app/src/engines/equity/model-cap-table.ts app/src/engines/equity/model-cap-table.test.ts
git commit -m "feat: model cap table dilution"
```

### Task 4: Preference waterfall and conversion equilibrium

**Files:**
- Create: `app/src/engines/equity/calculate-liquidation-waterfall.ts`
- Create: `app/src/engines/equity/calculate-liquidation-waterfall.test.ts`

- [ ] **Step 1: Write preference RED vectors**

Cover:
- common-only pro rata allocation;
- one non-participating preferred taking preference;
- one non-participating preferred converting;
- participating preferred taking preference plus residual;
- capped participating preferred with excess redistribution;
- multiple seniority ranks;
- same-rank pro-rata shortage;
- insufficient exit value;
- conservation and nonnegative remaining value.

- [ ] **Step 2: Write conversion-equilibrium RED vectors**

Create two- and three-class examples where independent per-security maxima select the wrong combination. Assert full vector enumeration, self-consistency checks, stable security-ID ordering, lexicographically smallest equilibrium, the 12-class maximum, and a 13-class invalid-input block.

- [ ] **Step 3: Verify RED**

```powershell
npm test -- src/engines/equity/calculate-liquidation-waterfall.test.ts
```

- [ ] **Step 4: Implement the waterfall**

Export:

```ts
export function calculateLiquidationWaterfall(
  input: unknown,
): EquityEngineResult<LiquidationWaterfall>;
```

For each conversion vector:
1. allocate preference by seniority and same-rank claim proportions;
2. allocate residual across common, participating preferred, and converted non-participating shares;
3. iteratively enforce participating caps and redistribute excess;
4. calculate each security's preference, participation, and total proceeds;
5. reject any allocation that violates conservation.

Evaluate self-consistency against every single-security flip and select the lexicographically smallest equilibrium.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
npm test -- src/engines/equity/calculate-liquidation-waterfall.test.ts
npm run typecheck
npm run lint
git add app/src/engines/equity/calculate-liquidation-waterfall.ts app/src/engines/equity/calculate-liquidation-waterfall.test.ts
git commit -m "feat: calculate liquidation waterfall"
```

### Task 5: Actual/365 XIRR solver

**Files:**
- Create: `app/src/engines/equity/calculate-xirr.ts`
- Create: `app/src/engines/equity/calculate-xirr.test.ts`

- [ ] **Step 1: Write XIRR RED vectors**

Cover exact one-year doubling, leap-year Actual/365 timing, multiple negative investments before one positive exit, IRR above 100%, a valid negative IRR, no sign change, more than one sign change, no root bracket, and deterministic convergence.

The solver must implement:

```ts
npv = sum(amount / (1 + rate) ** (actualDaysFromFirstDate / 365));
scale = max(sum(abs(amount)), 1);
converged = abs(npv) / scale <= 1e-20 || upper - lower <= 1e-24;
```

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/engines/equity/calculate-xirr.test.ts
```

- [ ] **Step 3: Implement XIRR**

Export the internal pure function:

```ts
export function calculateXirr(
  cashFlows: readonly DatedCashFlow[],
): XirrCalculation;
```

Validate chronological ordering and one sign change. Bracket and bisect exactly as specified; never use `Number` financial arithmetic.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- src/engines/equity/calculate-xirr.test.ts
npm run typecheck
npm run lint
git add app/src/engines/equity/calculate-xirr.ts app/src/engines/equity/calculate-xirr.test.ts
git commit -m "feat: solve investor xirr"
```

### Task 6: Scenario investor returns and permanent-loss probability

**Files:**
- Create: `app/src/engines/equity/calculate-investor-returns.ts`
- Create: `app/src/engines/equity/calculate-investor-returns.test.ts`

- [ ] **Step 1: Write investor-return RED vectors**

Use a modeled cap table with downside/base/upside exits. Assert:
- investor proceeds come from the full liquidation waterfall, not ownership multiplication when preferences bind;
- scenario MOIC equals proceeds divided by total invested capital;
- scenario XIRR uses all dated investor investments and scenario exit proceeds;
- zero/invalid XIRR is `null` with `root_not_found`;
- expected proceeds is the probability-weighted proceeds sum;
- expected MOIC uses weighted proceeds divided by invested capital;
- expected MOIC is not the arithmetic mean of scenario MOIC unless probabilities happen to make it so;
- scenario IRRs are never averaged;
- permanent-loss probability sums only scenarios with proceeds below invested capital;
- exact break-even proceeds do not count as permanent loss.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/engines/equity/calculate-investor-returns.test.ts
```

- [ ] **Step 3: Implement returns**

Export:

```ts
export function calculateInvestorReturns(
  input: unknown,
): EquityEngineResult<InvestorReturnSet>;
```

For each scenario, call the validated internal waterfall evaluator, sum allocations for the target holder, append the exit cash flow to the holder's negative investment ledger, calculate MOIC and XIRR, then aggregate weighted proceeds and permanent-loss probability using `AnalysisDecimal`.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- src/engines/equity/calculate-investor-returns.test.ts
npm run typecheck
npm run lint
git add app/src/engines/equity/calculate-investor-returns.ts app/src/engines/equity/calculate-investor-returns.test.ts
git commit -m "feat: calculate probability weighted investor returns"
```

### Task 7: Golden vectors and boundary hardening

**Files:**
- Create: `app/src/engines/equity/equity-golden-vectors.test.ts`
- Modify only equity/shared-contract files when a failing vector proves a defect

- [ ] **Step 1: Add a complete golden vector**

Build:
- founders, common investors, ESOP, Series A participating preferred, and Series B non-participating preferred;
- a current round with pre-money pool top-up;
- one later round with post-money pool top-up;
- downside/base/upside exits with probabilities summing to `1`.

Assert every event's price/share issuance, final ownership, preference allocation, conversion decisions, investor scenario proceeds, MOIC/XIRR, expected proceeds/MOIC, permanent-loss probability, trace references, frozen output, and byte-identical repeated calls.

- [ ] **Step 2: Add hardening vectors**

Cover null-prototype DTOs, alias-heavy inputs, 40-digit HALF_EVEN ties, extreme finite decimals, zero-share positions, same-rank shortages, exact cap hits, exact break-even loss boundary, reordered input positions, 12 conversion classes, and maximum valid public arrays.

- [ ] **Step 3: Run focused regressions**

```powershell
npm test -- src/domain/analysis/engine-result.test.ts src/engines/valuation/valuation-golden-vectors.test.ts src/engines/equity/equity-golden-vectors.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 4: Commit**

```powershell
git add app/src/engines/equity app/src/domain/analysis
git commit -m "test: harden equity and dilution engine"
```

### Task 8: Complete verification and branch handoff

**Files:**
- Review all equity commits and this plan

- [ ] **Step 1: Run fresh complete gates**

From `app/`:

```powershell
npm test -- src/domain/analysis/engine-result.test.ts src/engines/valuation/valuation-golden-vectors.test.ts src/engines/equity/equity-golden-vectors.test.ts
npm run typecheck
npm test
npm run lint
npm run build
npm audit --audit-level=high
git diff --check
```

Do not run `npm audit fix --force`; report the known React Router vulnerabilities separately.

- [ ] **Step 2: Self-review against the approved phase-two specification**

Confirm share conservation, exact ownership sum, pool timing, multi-round dilution, preference seniority, same-rank allocation, participation caps, conversion equilibrium, waterfall conservation, XIRR tolerances, weighted expected proceeds, expected MOIC, permanent-loss probability, deterministic trace, and no `NaN`/`Infinity`.

- [ ] **Step 3: Fix every valid finding through a failing regression test**

Repeat the full gates after the final code change.

- [ ] **Step 4: Present branch completion options**

Use `superpowers:finishing-a-development-branch`. Do not merge, push, delete the branch, or remove the worktree until the user chooses.
