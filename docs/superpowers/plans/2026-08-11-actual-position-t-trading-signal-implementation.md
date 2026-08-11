# Actual Position Dynamic T-Trading Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build fee-aware, volatility-calibrated intraday T-trading sell and buyback signals for actual A-share positions, with user-confirmed execution, T+1 enforcement, cloud persistence, inbox delivery, and complete-cycle profit accounting.

**Architecture:** Add a pure TypeScript domain under `app/src/features/securities/t-trading/` for fees, market structure, quantity selection, calibration, and cycle transitions. Persist fee profiles, cycles, and immutable executions through transactional Supabase RPCs; extend the resident worker to evaluate actual positions and open T cycles, then render typed alerts through the existing inbox boundaries without changing stock-analysis or K-line routes.

**Tech Stack:** TypeScript 6, React 19, Vitest, Decimal.js, Supabase/PostgreSQL with pgTAP, existing A-share market-data adapters, existing Node resident worker.

## Global Constraints

- Monitor actual positions only; do not scan all A-shares for this feature.
- Support `profit_t` and `cost_reduction_t`.
- Shares are positive multiples of 100 and never exceed `floor(availableShares * 0.35 / 100) * 100`.
- Use broker/user-confirmed position cost; trade 11.05 with broker cost 11.10 uses 11.10.
- Defaults: commission 0.03%, minimum CNY 5; sell stamp duty 0.05%; transfer fee 0.001% both directions.
- Estimated calculations include modeled slippage. Actual calculations using confirmed execution prices do not deduct modeled slippage again.
- Cycles are intraday. After Shanghai close, stop automatic buyback signals until explicit user resolution.
- A support break with worsening risk pauses mechanical buyback.
- Signals never place broker orders. Only confirmed executions change positions or cycles.
- Same-day buybacks use existing T+1 lot freezing.
- Cloud mutations are transactional, idempotent, and isolated by `user_id` RLS.
- Do not modify the individual stock-analysis page, route, or K-line loading chain.
- Runtime must not launch the downloaded Python project; port deterministic ideas into TypeScript and document attribution.
- Execute inline unless the user explicitly changes the existing no-subagent preference.
- Run npm/npx commands from `app/`; run git commands from the repository root.

---

## File Map

New domain files:
- `app/src/features/securities/t-trading/t-trading-types.ts`
- `app/src/features/securities/t-trading/trading-fee-engine.ts` and `.test.ts`
- `app/src/features/securities/t-trading/t-trading-market-structure.ts` and `.test.ts`
- `app/src/features/securities/t-trading/t-trading-signal-engine.ts` and `.test.ts`
- `app/src/features/securities/t-trading/t-trading-calibration.ts` and `.test.ts`
- `app/src/features/securities/t-trading/t-trading-cycle.ts` and `.test.ts`
- `app/src/features/securities/t-trading/local-t-trading-store.ts` and `.test.ts`
- `app/src/features/securities/t-trading/useTTradingState.ts` and `.test.tsx`
- `app/src/features/securities/t-trading/TradingFeeProfileDialog.tsx` and `.test.tsx`
- `app/src/features/securities/t-trading/TTradeExecutionDialog.tsx` and `.test.tsx`
- `app/src/features/securities/t-trading/TTradeSignalCard.tsx` and `.test.tsx`
- `app/src/features/securities/t-trading/TTradePositionSummary.tsx` and `.test.tsx`

New cloud/worker files:
- `app/supabase/migrations/202608110004_actual_position_t_trading.sql`
- `app/supabase/tests/actual_position_t_trading.test.sql`
- `app/worker/t-trading-evaluator.ts` and `.test.ts`
- `app/worker/t-trading-runner.ts` and `.test.ts`
- `app/docs/algorithm-sources/actual-position-t-trading.md`

Existing integration files:
- `app/src/features/securities/backtest-signal-inbox-store.ts`
- `app/src/features/securities/cloud/cloud-securities-repository-base.ts`
- `app/src/features/securities/cloud/cloud-securities-repository.ts`
- `app/src/features/securities/cloud/CloudSignalInbox.tsx`
- `app/src/features/securities/SignalInboxBase.tsx`
- `app/src/features/securities/useRealtimeBacktestMonitor.ts`
- `app/src/features/securities/ActualPositionsPanel.tsx`
- `app/worker/supabase-repository.ts`
- `app/worker/runtime-repository.ts`
- `app/worker/stateful-scan-runner.ts`
- `app/worker/index.ts`

### Task 1: Canonical Types and Fee Engine

**Files:**
- Create: `app/src/features/securities/t-trading/t-trading-types.ts`
- Create: `app/src/features/securities/t-trading/trading-fee-engine.ts`
- Test: `app/src/features/securities/t-trading/trading-fee-engine.test.ts`

**Interfaces:**
- Produces `DEFAULT_TRADING_FEE_PROFILE`.
- Produces `estimateTradeFees(input): TradeFeeBreakdown`.
- Produces `calculateActualTradeFees(input): TradeFeeBreakdown`.
- Produces `estimateRoundTripFees(input): RoundTripFeeBreakdown`.

- [ ] **Step 1: Define types and exact defaults**

```ts
export interface TradingFeeProfile {
  commissionRate: number;
  minimumCommission: number;
  sellStampDutyRate: number;
  transferFeeRate: number;
  slippageMode: 'dynamic' | 'fixed';
  fixedSlippageRate: number;
  updatedAt: string | null;
}
export const DEFAULT_TRADING_FEE_PROFILE = {
  commissionRate: 0.0003, minimumCommission: 5,
  sellStampDutyRate: 0.0005, transferFeeRate: 0.00001,
  slippageMode: 'dynamic', fixedSlippageRate: 0.0005, updatedAt: null,
} satisfies TradingFeeProfile;
```

- [ ] **Step 2: Write failing minimum-commission and tax tests**

```ts
it('charges minimum commission and sell-only stamp duty', () => {
  const fee = estimateTradeFees({
    side: 'sell', price: 11.05, shares: 100,
    profile: DEFAULT_TRADING_FEE_PROFILE,
    liquidity: { averageDailyAmount: 10_000_000, orderAmount: 1_105 },
  });
  expect(fee.commission).toBe(5);
  expect(fee.stampDuty).toBe(0.55);
  expect(fee.transferFee).toBe(0.01);
});
```

- [ ] **Step 3: Verify RED**

Run: `npm test -- src/features/securities/t-trading/trading-fee-engine.test.ts`

Expected: FAIL because the fee functions do not exist.

- [ ] **Step 4: Implement with Decimal.js**

Use:
```text
commission = max(minimumCommission, amount * commissionRate)
stampDuty = side == sell ? amount * sellStampDutyRate : 0
transferFee = amount * transferFeeRate
estimatedTotal = commission + stampDuty + transferFee + modeledSlippage
actualTotal = brokerActualTotalFee ?? commission + stampDuty + transferFee
```
Confirmed execution price always returns `modeledSlippage: 0`.

- [ ] **Step 5: Test two-leg fees and proportional commission**

Assert both legs pay commission/transfer fee, only sell pays stamp duty, and CNY 1,000,000 uses proportional commission.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- src/features/securities/t-trading/trading-fee-engine.test.ts`

```bash
git add app/src/features/securities/t-trading
git commit -m "feat: add T-trading fee engine"
```

### Task 2: Market Structure Adapter

**Files:**
- Create: `app/src/features/securities/t-trading/t-trading-market-structure.ts`
- Test: `app/src/features/securities/t-trading/t-trading-market-structure.test.ts`
- Create: `app/docs/algorithm-sources/actual-position-t-trading.md`

**Interfaces:**
- Consumes `StockKLine`, `StockQuote`, `calcATR`, `calcMA`, `calcOBV`.
- Produces `buildTTradeMarketStructure(input): TTradeMarketStructure`.

- [ ] **Step 1: Write failing ATRP/volatility tests**

Assert `atrp20 === atr20 / currentPrice`, 20-day annualized log-return volatility is finite, and 80 bars report `sampleDays: 80`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/features/securities/t-trading/t-trading-market-structure.test.ts`

- [ ] **Step 3: Implement deterministic extraction**

Clone/sort bars; run `calcMA(copy,[5,10,20])`, `calcOBV(copy)`, `calcATR(copy,20)`. Compute:

```text
atrp20 = atr20 / currentPrice
volatility20 = sampleStdDev(last20LogReturns) * sqrt(252)
volumeRatio20 = latestVolume / mean(previous20Volumes)
obvSlope5 = (latestObv - obvFiveBarsAgo) / 5
```

Choose nearest valid support below price from MA5/10/20 and 20-day low. Choose nearest resistance above price from swing highs and 20-day high.

- [ ] **Step 4: Test flow and data quality**

Rising price + high volume + positive OBV slope => `inflow`; inverse => `outflow`; fewer than 20 bars => `insufficient`; quote older than 15 seconds during trading => `stale`.

- [ ] **Step 5: Record source attribution**

Document:
- `daily_stock_analysis/src/stock_analyzer.py::_analyze_support_resistance`
- `daily_stock_analysis/src/analyzer.py` capital-flow stability rules
- `daily_stock_analysis/src/utils/sniper_points.py` take-profit contract

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- src/features/securities/t-trading/t-trading-market-structure.test.ts`

```bash
git add app/src/features/securities/t-trading/t-trading-market-structure.ts app/src/features/securities/t-trading/t-trading-market-structure.test.ts app/docs/algorithm-sources/actual-position-t-trading.md
git commit -m "feat: add T-trading market structure"
```

### Task 3: Sell Candidate and Quantity Optimizer

**Files:**
- Create: `app/src/features/securities/t-trading/t-trading-signal-engine.ts`
- Test: `app/src/features/securities/t-trading/t-trading-signal-engine.test.ts`

**Interfaces:**
- Produces `evaluateTTradeSell(input): TTradeSellDecision`.
- Produces `optimizeTTradeShares(input): TTradeQuantityDecision`.

- [ ] **Step 1: Write failing 35% tests**

For 1,000 available shares, recommendation is at most 300. For 100 available shares, no signal because the ceiling is zero.

- [ ] **Step 2: Write low-price round-trip rejection**

For CNY 11.05, reject a target spread that cannot cover both minimum commissions, taxes, transfer fees, slippage, and risk buffer.

- [ ] **Step 3: Verify RED**

Run: `npm test -- src/features/securities/t-trading/t-trading-signal-engine.test.ts`

- [ ] **Step 4: Implement sell ranges and confirmations**

```text
maxShares = floor(availableShares * 0.35 / 100) * 100
sellLow = max(currentPrice, resistance - atr20 * 0.25)
sellHigh = max(sellLow, resistance + atr20 * 0.15)
buybackTarget = max(support, currentPrice - atr20 * calibratedBuybackAtr)
riskBuffer = max(roundTripFees * 0.25, sellAmount * 0.001)
```

Require fresh data, 100 executable shares, net profit above buffer, and resistance proximity, intraday rejection, or weakening flow. `cost_reduction_t` requires two confirmations among resistance, rejection, outflow, and `volumeRatio20 >= 1.2`.

- [ ] **Step 5: Implement board-lot scoring**

For each 100-share candidate:
```text
score = expectedNetProfit - modeledImpactCost - sellAmount * atrp20 * 0.15
```
Choose highest score; ties choose fewer shares.

- [ ] **Step 6: Test classification and explanations**

Assert profit/cost-reduction classification and presence of ATR, resistance, flow, fees, net profit, validity, and strategy version.

- [ ] **Step 7: Verify GREEN and commit**

Run: `npm test -- src/features/securities/t-trading/t-trading-signal-engine.test.ts`

```bash
git add app/src/features/securities/t-trading
git commit -m "feat: add T-trading sell decisions"
```

### Task 4: Buyback, Risk Pause, and Expiry

**Files:**
- Modify: `app/src/features/securities/t-trading/t-trading-signal-engine.ts`
- Test: `app/src/features/securities/t-trading/t-trading-signal-engine.test.ts`

**Interfaces:**
- Produces `evaluateTTradeBuyback(input): TTradeBuybackDecision`.
- Produces `evaluateTTradeExpiry(input): TTradeExpiryDecision`.

- [ ] **Step 1: Write failing buyback tests**

A buyback requires one price condition (support, MA, or calibrated ATR retracement) and one stability condition (weaker downside momentum, flow stabilization, non-deteriorating volume/price, or support confirmation).

- [ ] **Step 2: Write support-break and expiry tests**

Expect `buyback_paused_risk_review` when `currentPrice < support * 0.985` with outflow. At 14:50 Asia/Shanghai send one expiry-risk reminder; after 15:00 return `expire_cycle`; do not repeat when `expiryRiskSentAt` exists.

- [ ] **Step 3: Verify RED**

Run: `npm test -- src/features/securities/t-trading/t-trading-signal-engine.test.ts`

- [ ] **Step 4: Implement typed decisions**

```ts
type TTradeBuybackDecision =
  | { kind: 'monitoring'; reasons: string[] }
  | { kind: 'buyback'; shares: number; targetRange: [number, number]; reasons: string[] }
  | { kind: 'risk_review'; nextStatus: 'buyback_paused_risk_review'; reasons: string[] };
```

Use remaining unmatched shares only. Expired cycles never produce next-day automatic buyback.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- src/features/securities/t-trading/t-trading-signal-engine.test.ts`

```bash
git add app/src/features/securities/t-trading/t-trading-signal-engine.ts app/src/features/securities/t-trading/t-trading-signal-engine.test.ts
git commit -m "feat: add T-trading buyback controls"
```

### Task 5: Walk-Forward Calibration

**Files:**
- Create: `app/src/features/securities/t-trading/t-trading-calibration.ts`
- Test: `app/src/features/securities/t-trading/t-trading-calibration.test.ts`

**Interfaces:**
- Produces `calibrateTTradeParameters(input): TTradeCalibrationResult`.
- Result status is `calibrated` or `sample_insufficient`.

- [ ] **Step 1: Write insufficient-sample test**

With 59 bars, return:
```ts
{
  status: 'sample_insufficient',
  parameters: {
    sellAtrMultiple: 0.8,
    buybackAtrMultiple: 0.6,
    resistanceTolerance: 0.02,
    maxPositionRatio: 0.15,
  },
}
```

- [ ] **Step 2: Write no-future-data test**

Calibrate through index 119. Append a large shock after index 119 and recalibrate with the same `asOfIndex`; expect identical output.

- [ ] **Step 3: Verify RED**

Run: `npm test -- src/features/securities/t-trading/t-trading-calibration.test.ts`

- [ ] **Step 4: Implement bounded grid**

```text
sellAtrMultiple: 0.6, 0.8, 1.0
buybackAtrMultiple: 0.4, 0.6, 0.8
resistanceTolerance: 0.01, 0.02, 0.03
maxPositionRatio: 0.15, 0.25, 0.35
```

At each evaluation day, indicators use bars ending that day. Later bars score fills only. Score after-fee win rate, average net profit, consecutive losses, unfilled probability, missed upside, and excessive frequency. Tie-break by lower unfilled probability, lower position ratio, lower frequency, then lexicographic key.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- src/features/securities/t-trading/t-trading-calibration.test.ts`

```bash
git add app/src/features/securities/t-trading/t-trading-calibration.ts app/src/features/securities/t-trading/t-trading-calibration.test.ts
git commit -m "feat: calibrate T-trading without lookahead"
```

### Task 6: Cycle State Machine and Local Persistence

**Files:**
- Create: `app/src/features/securities/t-trading/t-trading-cycle.ts`
- Test: `app/src/features/securities/t-trading/t-trading-cycle.test.ts`
- Create: `app/src/features/securities/t-trading/local-t-trading-store.ts`
- Test: `app/src/features/securities/t-trading/local-t-trading-store.test.ts`

**Interfaces:**
- Produces `openTTradeCycle`, `applyTTradeBuyback`, `pauseTTradeBuyback`, `expireTTradeCycle`, `keepTTradeAsReduction`.
- Produces `loadLocalTTradingState` and `saveLocalTTradingState` using `sec_actual_t_runtime_v1`.

- [ ] **Step 1: Write partial-buyback test**

Sell 300 at CNY 12 with CNY 6 fees; buy back 100 at CNY 11 with CNY 5 fees. Expect remaining 200, status `partially_bought_back`, and realized T profit CNY 93 because allocated sell fees are CNY 2.

- [ ] **Step 2: Write completion/cost tests**

After buying the remaining 200:
```text
costReductionPerShare = cycleNetProfit / restoredTotalShares
adjustedAverageCost = preCycleAverageCost - costReductionPerShare
```
All execution records remain immutable.

- [ ] **Step 3: Write expiry/reduction/idempotency tests**

`expired_unfilled` stops monitoring. `kept_as_reduction` preserves real sell facts but excludes unmatched shares from T profit. Duplicate `idempotencyKey` is rejected. Corrupt local JSON throws `LocalTTradingStateCorruptionError`.

- [ ] **Step 4: Verify RED**

Run: `npm test -- src/features/securities/t-trading/t-trading-cycle.test.ts src/features/securities/t-trading/local-t-trading-store.test.ts`

- [ ] **Step 5: Implement immutable transitions**

Reject invalid status transitions, non-board-lot shares, and buybacks above remaining shares. Persist version 1 state and dispatch `sec-actual-t-runtime-changed`.

- [ ] **Step 6: Verify GREEN and commit**

Run the Step 4 command.

```bash
git add app/src/features/securities/t-trading
git commit -m "feat: add T-trading cycle state"
```

### Task 7: Supabase Schema, RLS, and Signal Metadata

**Files:**
- Create: `app/supabase/migrations/202608110004_actual_position_t_trading.sql`
- Test: `app/supabase/tests/actual_position_t_trading.test.sql`

**Interfaces:**
- Produces tables `trading_fee_profiles`, `t_trade_cycles`, `t_trade_executions`.
- Adds `signal_alerts.signal_metadata jsonb not null default '{}'::jsonb`.
- Adds nullable `signal_alerts.t_trade_cycle_id uuid`.
- Produces `upsert_trading_fee_profile(p_payload jsonb)`.
- Produces service-only `commit_t_trade_signal(p_payload jsonb)`.

- [ ] **Step 1: Write failing pgTAP RLS/default tests**

Create two auth users. Assert each sees only its profile, cycles, and executions; cross-user insert/update fails; missing profile resolves to documented defaults.

- [ ] **Step 2: Verify RED**

Run: `npx supabase test db --file supabase/tests/actual_position_t_trading.test.sql`

- [ ] **Step 3: Create schema and checks**

Use:
```sql
check (commission_rate >= 0);
check (minimum_commission >= 0);
check (shares > 0 and shares % 100 = 0);
check (status in (
  'sell_executed','buyback_monitoring','buyback_signal_pending',
  'partially_bought_back','completed','buyback_paused_risk_review',
  'expired_unfilled','kept_as_reduction','cancelled_by_user'
));
```

Add unique `(user_id,idempotency_key)` on executions and indexes for `(user_id,status)`, `(user_id,code,trading_date)`, `(user_id,cycle_id,executed_at)`.

- [ ] **Step 4: Add RLS and grants**

Authenticated policies use `auth.uid() = user_id`. Revoke public/anon RPC access. Give service role only worker-required privileges.

- [ ] **Step 5: Implement profile and signal RPCs**

`upsert_trading_fee_profile` validates fields, uses `auth.uid()`, and writes `audit_events`.

`commit_t_trade_signal` uses deterministic key:
```text
user_id + position_id + trading_date + strategy_version + signal_kind
```
Persistent conditions update one pending alert snapshot; a new edge creates one alert and one audit event.

- [ ] **Step 6: Verify GREEN and commit**

Run the Step 2 command.

```bash
git add app/supabase/migrations/202608110004_actual_position_t_trading.sql app/supabase/tests/actual_position_t_trading.test.sql
git commit -m "feat: add cloud T-trading schema"
```

### Task 8: Transactional Sell, Buyback, and Resolution RPCs

**Files:**
- Modify: `app/supabase/migrations/202608110004_actual_position_t_trading.sql`
- Test: `app/supabase/tests/actual_position_t_trading.test.sql`

**Interfaces:**
- Produces authenticated `execute_t_trade_sell(p_payload jsonb)`.
- Produces authenticated `execute_t_trade_buyback(p_payload jsonb)`.
- Produces authenticated `resolve_t_trade_cycle(p_payload jsonb)`.
- Produces service-only `expire_t_trade_cycles(p_as_of timestamptz)`.

- [ ] **Step 1: Write boundary tests**

Fixture A: 600 available shares => 200 succeeds, 300 fails. Fixture B: 1,000 available shares => 300 succeeds, 400 fails. Use fresh positions per assertion.

- [ ] **Step 2: Write T+1, idempotency, and rollback tests**

Assert FIFO previous-day lots are sold; buyback creates a same-day frozen lot; duplicate alert execution creates no second transaction; forced T-execution failure rolls back the position mutation.

- [ ] **Step 3: Write partial-buyback tests**

Sell 300, buy back 100 then 200 through separate alerts. Assert immutable executions, allocated fees, remaining 200 after first buyback, and `completed` after second.

- [ ] **Step 4: Verify RED**

Run: `npx supabase test db --file supabase/tests/actual_position_t_trading.test.sql`

- [ ] **Step 5: Implement sell RPC atomically**

Lock alert/position; recalculate T+1 and 35%; snapshot profile and basis; call existing manual sell with operation `t-sell:<alert_id>`; insert execution and cycle; mark alert sold; audit; return ids.

- [ ] **Step 6: Implement buyback and resolution**

Buyback locks cycle, validates remaining shares, calls existing manual buy with `t-buyback:<alert_id>`, inserts execution, recomputes aggregates from execution facts, updates status, and marks alert bought.

`resolve_t_trade_cycle` accepts only:
```text
record_buyback: price, shares, traded_at, optional broker_actual_total_fee
keep_as_reduction: resolved_at
```
`expire_t_trade_cycles` expires unresolved same-day cycles after 15:00 Asia/Shanghai without next-day automatic buyback.

- [ ] **Step 7: Verify GREEN and commit**

Run the Step 4 command.

```bash
git add app/supabase/migrations/202608110004_actual_position_t_trading.sql app/supabase/tests/actual_position_t_trading.test.sql
git commit -m "feat: execute T cycles transactionally"
```

### Task 9: Cloud Repository and Login-Aware Hook

**Files:**
- Modify: `app/src/features/securities/cloud/cloud-securities-repository-base.ts`
- Modify: `app/src/features/securities/cloud/cloud-securities-repository.ts`
- Test: `app/src/features/securities/cloud/cloud-securities-repository.test.ts`
- Create: `app/src/features/securities/t-trading/useTTradingState.ts`
- Test: `app/src/features/securities/t-trading/useTTradingState.test.tsx`

**Interfaces:**
```ts
loadTTradingState(): Promise<TTradingState>
saveTradingFeeProfile(profile: TradingFeeProfile): Promise<void>
executeTTradeSell(input: ExecuteTTradeSellInput): Promise<TTradeMutationResult>
executeTTradeBuyback(input: ExecuteTTradeBuybackInput): Promise<TTradeMutationResult>
resolveTTradeCycle(input: ResolveTTradeCycleInput): Promise<TTradeMutationResult>
```

- [ ] **Step 1: Write failing mapping tests**

Map numeric strings, multiple executions, `signal_metadata`, stable sorting, fee snapshots, and typed statuses.

- [ ] **Step 2: Write hook mode tests**

Cloud user calls cloud repository. No auth provider calls local store. Cloud failure sets error and never silently substitutes local data.

- [ ] **Step 3: Verify RED**

Run: `npm test -- src/features/securities/cloud/cloud-securities-repository.test.ts src/features/securities/t-trading/useTTradingState.test.tsx`

- [ ] **Step 4: Implement mappings and RPC payloads**

Send user inputs only; server derives `auth.uid()`, fees, availability, and authoritative limits.

- [ ] **Step 5: Implement realtime refresh**

Cloud mode subscribes to profile/cycle/execution tables for current user. Local mode listens to `sec-actual-t-runtime-changed`, storage, and focus.

- [ ] **Step 6: Verify GREEN and commit**

Run the Step 3 command.

```bash
git add app/src/features/securities/cloud/cloud-securities-repository-base.ts app/src/features/securities/cloud/cloud-securities-repository.ts app/src/features/securities/cloud/cloud-securities-repository.test.ts app/src/features/securities/t-trading/useTTradingState.ts app/src/features/securities/t-trading/useTTradingState.test.tsx
git commit -m "feat: expose T-trading cloud state"
```

### Task 10: Resident Worker Integration

**Files:**
- Create: `app/worker/t-trading-evaluator.ts`
- Test: `app/worker/t-trading-evaluator.test.ts`
- Create: `app/worker/t-trading-runner.ts`
- Test: `app/worker/t-trading-runner.test.ts`
- Modify: `app/worker/supabase-repository.ts`
- Test: `app/worker/supabase-repository.test.ts`
- Modify: `app/worker/runtime-repository.ts`
- Test: `app/worker/runtime-repository.test.ts`
- Modify: `app/worker/stateful-scan-runner.ts`
- Test: `app/worker/stateful-scan-runner.test.ts`
- Modify: `app/worker/index.ts`
- Test: `app/worker/index.test.ts`

**Interfaces:**
- Extend `CompleteMonitoringAssignment` with `feeProfile` and `openTTradeCycles`.
- Produce `createWorkerTTradingEvaluator(options)`.
- Produce `runTTradingScan(input)`.
- Add repository methods `commitTTradeSignal(payload)` and `expireTTradeCycles(asOf)`.

- [ ] **Step 1: Write assignment isolation tests**

Two users receive only their profiles, actual positions, lots, and open cycles. Watchlist-only stocks are not T candidates.

- [ ] **Step 2: Write evaluator tests**

Assert 250-bar history request; conservative fallback under 60 bars; sell for qualifying actual position; buyback/risk-review for open cycle; one expiry reminder near close.

- [ ] **Step 3: Write runner dedup/failure tests**

Two identical scans update one alert. One-stock failure does not block another user. Generic backtest signal state cannot suppress T signals.

- [ ] **Step 4: Verify RED**

Run:
`npm test -- worker/t-trading-evaluator.test.ts worker/t-trading-runner.test.ts worker/supabase-repository.test.ts worker/runtime-repository.test.ts worker/stateful-scan-runner.test.ts worker/index.test.ts`

- [ ] **Step 5: Implement worker wiring**

Load default/profile, active cycles, and T+1 availability. Cache history per code for one scan. Commit T signals independently from generic cycles. After 15:00 call `expireTTradeCycles(quoteAt)`.

- [ ] **Step 6: Verify regular worker regression**

Run: `npm test -- worker`

Expected: existing virtual trades, ordinary actual-risk alerts, heartbeat, lease, and scan tests remain green.

- [ ] **Step 7: Commit**

```bash
git add app/worker
git commit -m "feat: monitor T signals in cloud worker"
```

### Task 11: Typed Alerts and Inbox Execution

**Files:**
- Modify: `app/src/features/securities/backtest-signal-inbox-store.ts`
- Test: `app/src/features/securities/backtest-signal-inbox-store.test.ts`
- Create: `app/src/features/securities/t-trading/TTradeSignalCard.tsx`
- Test: `app/src/features/securities/t-trading/TTradeSignalCard.test.tsx`
- Create: `app/src/features/securities/t-trading/TTradeExecutionDialog.tsx`
- Test: `app/src/features/securities/t-trading/TTradeExecutionDialog.test.tsx`
- Modify: `app/src/features/securities/cloud/CloudSignalInbox.tsx`
- Test: `app/src/features/securities/cloud/CloudSignalInbox.test.tsx`
- Modify: `app/src/features/securities/SignalInboxBase.tsx`
- Test: `app/src/features/securities/SignalInbox.test.tsx`
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.ts`
- Test: `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`

**Interfaces:**
- Message kinds: `actual_t_sell`, `actual_t_buyback`, `actual_t_expiry_risk`, `actual_t_risk_review`.
- Extend `BacktestSignalAlertV3` with `tTrade: TTradeAlertPayload | null`.
- Dialog result: `{ price; shares; brokerActualTotalFee: number | null; resolution }`.

- [ ] **Step 1: Write failing parsing tests**

A T row maps all metadata. A legacy row maps `tTrade: null` and preserves old fields.

- [ ] **Step 2: Write card and dialog tests**

Sell card shows type, trigger/ranges, shares, ATRP, resistance, volume/flow, two-leg fees, net profit, cost reduction, expiry. Risk-review has no mechanical buyback button. Dialog enforces positive price, 100-share multiples, ceiling, and non-negative optional broker fee.

- [ ] **Step 3: Verify RED**

Run:
`npm test -- src/features/securities/backtest-signal-inbox-store.test.ts src/features/securities/t-trading/TTradeSignalCard.test.tsx src/features/securities/t-trading/TTradeExecutionDialog.test.tsx src/features/securities/cloud/CloudSignalInbox.test.tsx src/features/securities/SignalInbox.test.tsx`

- [ ] **Step 4: Implement cloud execution**

Branch on `alert.tTrade`. Sell calls `executeTTradeSell`; buyback calls `executeTTradeBuyback`; expiry resolution calls `resolveTTradeCycle`. Reload ledger, T state, and inbox together before closing.

- [ ] **Step 5: Implement local foreground execution**

Merge local T alerts without changing ordinary backtest alerts. Use existing stock ledger plus local cycle store and idempotency key. If cycle persistence fails after ledger write, restore prior serialized ledger and show an error instead of `已执行`.

- [ ] **Step 6: Verify GREEN and commit**

Run the Step 3 command.

```bash
git add app/src/features/securities/backtest-signal-inbox-store.ts app/src/features/securities/backtest-signal-inbox-store.test.ts app/src/features/securities/t-trading/TTradeSignalCard.tsx app/src/features/securities/t-trading/TTradeSignalCard.test.tsx app/src/features/securities/t-trading/TTradeExecutionDialog.tsx app/src/features/securities/t-trading/TTradeExecutionDialog.test.tsx app/src/features/securities/cloud/CloudSignalInbox.tsx app/src/features/securities/cloud/CloudSignalInbox.test.tsx app/src/features/securities/SignalInboxBase.tsx app/src/features/securities/SignalInbox.test.tsx app/src/features/securities/useRealtimeBacktestMonitor.ts app/src/features/securities/useRealtimeBacktestMonitor.test.tsx
git commit -m "feat: execute T signals from inbox"
```

### Task 12: Actual Position UI and Fee Settings

**Files:**
- Create: `app/src/features/securities/t-trading/TradingFeeProfileDialog.tsx`
- Test: `app/src/features/securities/t-trading/TradingFeeProfileDialog.test.tsx`
- Create: `app/src/features/securities/t-trading/TTradePositionSummary.tsx`
- Test: `app/src/features/securities/t-trading/TTradePositionSummary.test.tsx`
- Modify: `app/src/features/securities/ActualPositionsPanel.tsx`
- Test: `app/src/features/securities/ActualPositionsPanel.test.tsx`

**Interfaces:**
- Consumes `useTTradingState`, current quotes, availability, pending alerts, and active cycles.
- Produces no route change.

- [ ] **Step 1: Write fee-dialog tests**

Reject negative rates/minimum commission. `恢复默认` saves exact defaults. Successful save displays whether default or user fee settings are active.

- [ ] **Step 2: Write per-position display tests**

Each row shows one state:
- sell/buyback ranges, suggested shares, and basis;
- active cycle with sold and remaining shares;
- paused risk review;
- `样本不足，使用保守参数`;
- `行情或 K 线过期，未生成做 T 信号`.

- [ ] **Step 3: Verify RED**

Run:
`npm test -- src/features/securities/t-trading/TradingFeeProfileDialog.test.tsx src/features/securities/t-trading/TTradePositionSummary.test.tsx src/features/securities/ActualPositionsPanel.test.tsx`

- [ ] **Step 4: Implement fee entry and T-plan column**

Add `交易费率` beside `我的实际持仓`. Add `做 T 计划` column without altering code/name/group/shares/cost/realtime/P&L/actions. Keep navigation exactly:
```text
/projects/:projectId/securities/stock/:code
```

- [ ] **Step 5: Verify GREEN and commit**

Run the Step 3 command.

```bash
git add app/src/features/securities/t-trading/TradingFeeProfileDialog.tsx app/src/features/securities/t-trading/TradingFeeProfileDialog.test.tsx app/src/features/securities/t-trading/TTradePositionSummary.tsx app/src/features/securities/t-trading/TTradePositionSummary.test.tsx app/src/features/securities/ActualPositionsPanel.tsx app/src/features/securities/ActualPositionsPanel.test.tsx
git commit -m "feat: show T plans on actual positions"
```

### Task 13: Full Verification and Regression Guard

**Files:**
- Create: `app/src/features/securities/t-trading/t-trading-integration.test.ts`
- Test: existing stock-analysis and K-line test files discovered by the exact `rg` command below.
- Do not modify stock-analysis or K-line production files.

- [ ] **Step 1: Write the complete-cycle integration test**

```ts
it('creates a fee-positive sell, records execution, and completes a matched buyback', () => {
  const sell = evaluateTTradeSell(profitableFixture());
  expect(sell.kind).toBe('sell');
  if (sell.kind !== 'sell') throw new Error('expected sell recommendation');
  const opened = openTTradeCycle(executedSellFixture(sell.recommendation));
  const completed = applyTTradeBuyback(opened, executedBuybackFixture(opened.remainingBuybackShares));
  expect(completed.status).toBe('completed');
  expect(completed.remainingBuybackShares).toBe(0);
  expect(completed.realizedTProfit).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run T-domain tests**

Run: `npm test -- src/features/securities/t-trading`

Expected: PASS.

- [ ] **Step 3: Run securities integration tests**

Run:
`npm test -- src/features/securities/cloud src/features/securities/stock-position-ledger.test.ts src/features/securities/stock-position-availability.test.ts src/features/securities/ActualPositionsPanel.test.tsx src/features/securities/SignalInbox.test.tsx src/features/securities/useRealtimeBacktestMonitor.test.tsx`

Expected: PASS.

- [ ] **Step 4: Run worker and database tests**

Run:
```bash
npm test -- worker
npx supabase test db
```

Expected: all existing and new worker/pgTAP tests pass.

- [ ] **Step 5: Run stock-analysis and K-line regressions**

Find exact tests:
```bash
rg --files src | rg "Stock.*test\.(ts|tsx)$|KLine.*test\.(ts|tsx)$"
```
Run every returned test path. If no K-line component test exists, run the existing stock-analysis page test returned by the command and use the production build as the route-level guard.

- [ ] **Step 6: Run full quality gate**

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Expected: all exit 0.

- [ ] **Step 7: Inspect diff and commit the integration test**

```bash
git status --short
git diff --check
git diff --stat
git diff --cached --name-only
```

Confirm no individual stock-analysis/K-line production files and no unrelated directories are staged.

```bash
git add app/src/features/securities/t-trading/t-trading-integration.test.ts
git commit -m "test: verify actual-position T trading"
```

## Plan Self-Review Checklist

- Every approved spec section maps to Tasks 1-13: fees, 35%, T+1, sell, buyback, partial executions, expiry, risk pause, calibration, cloud/RLS, worker, inbox, UI, and regression.
- Estimated versus actual slippage is separated in Task 1.
- Partial buyback profit uses matched shares and allocated sell fees in Task 6.
- Multi-step cloud writes are transactional and idempotent in Task 8.
- Generic backtest and T-trading states are isolated in Task 10.
- Individual stock analysis and K-line production files are explicitly excluded.
- No implementation step relies on a Python runtime.
