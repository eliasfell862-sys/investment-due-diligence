# Live Trading Gateway Phase 1 Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only, zero-real-order shadow trading foundation that reuses the current watchlist, short/medium advice, formal price targets, fee engine, T+1 ledger, and T-trading rules, while proving whether the Eastern Fortune Windows client can be read reliably.

**Architecture:** Keep all strategy and risk calculations in focused TypeScript domain modules. Run a separate Python loopback bridge for Windows UI capability probing and shadow order execution; Electron owns the bridge process and exposes a narrow IPC surface to React. Phase 1 never clicks an Eastern Fortune buy/sell control, never writes Supabase trading tables, and never deploys to Netlify.

**Tech Stack:** React 19, TypeScript 6, Vitest, Decimal.js, Electron 43, Python 3.12, FastAPI, Pydantic, pytest, pywinauto, Windows Credential Manager/keyring.

## Global Constraints

- Do not deploy to Netlify, Railway, or Supabase during this plan.
- Do not create or apply cloud migrations during this plan.
- Do not stage or modify the existing uncommitted Kronos files.
- Do not change the individual stock analysis page or its K-line source.
- The bridge binds only to `127.0.0.1` and rejects requests without the per-process bridge token.
- Phase 1 supports only `shadow` and `read_only_probe`; Eastern Fortune live order submission must return `live_execution_disabled`.
- Trading pool is exactly CNY 7,000; maximum invested capital CNY 5,600; reserved cash CNY 1,400.
- Maximum concurrent positions is 2; per-stock capital cap is CNY 3,500.
- Maximum planned loss per order is CNY 140 including estimated entry and exit fees.
- Daily realized loss plus fees circuit breaker is CNY 210.
- Buy quantities and ordinary partial sells use 100-share board lots; full liquidation may sell an odd-lot remainder.
- T-trading sell and buyback always require mobile/user confirmation; one T sell is at most 35% of broker-available shares.
- A weakened short/medium rating alone does not sell a losing position; hard stop and fatal risk remain higher priority.
- At least 20 valid shadow orders must pass before a later plan can expose a real-trading enable switch.
- Commits must use explicit file lists; never run `git add .`.

## Phase Boundaries

This is the first of three independently reviewed plans:

1. **Phase 1 — local rules, shadow ledger, Electron bridge, Eastern Fortune read-only capability probe**: this document.
2. **Phase 2 — paired device, signed cloud trade intents, mobile approvals, audit/RLS**: write only after Phase 1 proves the bridge contract and probe result.
3. **Phase 3 — restricted Eastern Fortune execution, reconciliation, five one-lot pilot trades**: write only after 20 shadow orders pass and the user explicitly authorizes real trading.

---

## File Map

### TypeScript trading domain

- Create `app/src/features/securities/live-trading/live-trading-types.ts`: immutable profiles, candidate, risk, order, fill, bridge, and qualification contracts.
- Create `app/src/features/securities/live-trading/live-trading-profile.ts`: fixed Phase 1 profile and validation.
- Create `app/src/features/securities/live-trading/live-trading-risk-engine.ts`: quantity, fees, loss, cash reserve, position count, and circuit breaker.
- Create `app/src/features/securities/live-trading/live-trading-signal-policy.ts`: observation/core buy, take-profit, weakened-rating, fatal-risk, stop, and T-trading priority rules.
- Create `app/src/features/securities/live-trading/live-trading-candidate-scanner.ts`: one-pass watchlist analysis using existing market data and analysis engines.
- Create `app/src/features/securities/live-trading/shadow-order-machine.ts`: legal state transitions and idempotency.
- Create `app/src/features/securities/live-trading/shadow-trading-store.ts`: account-scoped local shadow orders, fills, reserved T-buyback cash, and qualification results.

### React UI

- Create `app/src/features/securities/live-trading/useLiveTradingShadow.ts`: scanner/store/bridge orchestration.
- Create `app/src/features/securities/live-trading/LiveTradingShadowPage.tsx`: local device, risk profile, candidates, shadow orders, and 20-order progress.
- Create `app/src/features/securities/live-trading/LiveTradingShadowPage.css`: existing securities theme-compatible layout.
- Modify `app/src/app/router-base.tsx`: add `/securities/live-trading` and project-scoped equivalent without touching `router.tsx`.
- Modify `app/src/features/securities/SecuritiesWorkbenchPageBase.tsx`: add a visible “实盘交易（影子）” entry only.

### Windows bridge

- Create `trading-bridge/pyproject.toml`: pinned Python dependencies and pytest configuration.
- Create `trading-bridge/src/trading_bridge/models.py`: bridge request/response models.
- Create `trading-bridge/src/trading_bridge/auth.py`: loopback-token authentication.
- Create `trading-bridge/src/trading_bridge/adapters/base.py`: broker adapter protocol.
- Create `trading-bridge/src/trading_bridge/adapters/shadow.py`: deterministic shadow adapter.
- Create `trading-bridge/src/trading_bridge/adapters/eastmoney_probe.py`: read-only process/window/control capability probe.
- Create `trading-bridge/src/trading_bridge/app.py`: FastAPI endpoints.
- Create `trading-bridge/tests/`: unit and API tests.
- Create `app/electron/trading-bridge-manager.cjs`: spawn, authenticate, health-check, and stop the sidecar.
- Modify `app/electron/main.cjs`: register trading bridge IPC handlers.
- Modify `app/electron/preload.cjs`: expose only the typed bridge methods required by the UI.
- Create `app/src/types/electron-trading-bridge.d.ts`: renderer declaration.

### Documentation

- Create `docs/live-trading/eastmoney-shadow-runbook.md`: install, probe, shadow run, failure handling, and evidence collection.

---

### Task 1: Define the Phase 1 Profile and Domain Contracts

**Files:**
- Create: `app/src/features/securities/live-trading/live-trading-types.ts`
- Create: `app/src/features/securities/live-trading/live-trading-profile.ts`
- Test: `app/src/features/securities/live-trading/live-trading-profile.test.ts`

**Interfaces:**
- Produces: `LiveTradingProfile`, `LiveTradingCandidate`, `LiveTradeIntent`, `ShadowOrder`, `BrokerAccountSnapshot`, `BrokerPositionSnapshot`, `BridgeCapabilityReport`, `SHADOW_LIVE_TRADING_PROFILE`, `validateLiveTradingProfile(profile)`.
- Consumes: `TradingFeeProfile` from `../t-trading/t-trading-types`.

- [ ] **Step 1: Write the failing profile tests**

```ts
import { describe, expect, it } from 'vitest';
import { SHADOW_LIVE_TRADING_PROFILE, validateLiveTradingProfile } from './live-trading-profile';

describe('live trading profile', () => {
  it('freezes the approved capital and risk limits', () => {
    expect(SHADOW_LIVE_TRADING_PROFILE).toMatchObject({
      mode: 'shadow', capitalPool: 7_000, maximumInvested: 5_600,
      reservedCash: 1_400, maximumPositions: 2, maximumPerStock: 3_500,
      maximumPlannedLoss: 140, dailyCircuitBreaker: 210,
      boardLot: 100, maximumTTradeAvailableRatio: 0.35,
    });
  });

  it('rejects a profile whose invested plus reserved cash exceeds the pool', () => {
    expect(() => validateLiveTradingProfile({
      ...SHADOW_LIVE_TRADING_PROFILE, maximumInvested: 6_000,
    })).toThrow('最大投入与预留现金不能超过资金池');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npm test -- src/features/securities/live-trading/live-trading-profile.test.ts`

Expected: FAIL because the live-trading profile modules do not exist.

- [ ] **Step 3: Implement the contracts and validated constant**

Define exact discriminated unions:

```ts
export type LiveTradingMode = 'shadow' | 'read_only_probe';
export type LiveTradeSide = 'buy' | 'sell';
export type LiveTradeIntentKind =
  | 'core_buy' | 'take_profit_1' | 'take_profit_2'
  | 'hard_stop' | 'fatal_exit' | 't_sell' | 't_buyback';
export type ShadowOrderStatus =
  | 'eligible' | 'preauthorized' | 'awaiting_user_confirmation'
  | 'submitting' | 'submitted' | 'partially_filled' | 'filled'
  | 'cancelled' | 'rejected' | 'expired' | 'blocked_by_risk';

export interface LiveTradingProfile {
  mode: LiveTradingMode;
  capitalPool: number;
  maximumInvested: number;
  reservedCash: number;
  maximumPositions: number;
  maximumPerStock: number;
  maximumPlannedLoss: number;
  dailyCircuitBreaker: number;
  boardLot: 100;
  maximumTTradeAvailableRatio: 0.35;
  orderTtlSeconds: 30;
}
```

Implement `validateLiveTradingProfile` with finite-positive checks, exact board-lot/T-ratio checks, and `maximumInvested + reservedCash <= capitalPool`.

- [ ] **Step 4: Run the focused test**

Run: `cd app && npm test -- src/features/securities/live-trading/live-trading-profile.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- app/src/features/securities/live-trading/live-trading-types.ts app/src/features/securities/live-trading/live-trading-profile.ts app/src/features/securities/live-trading/live-trading-profile.test.ts
git commit -m "feat: define shadow trading profile"
```

---

### Task 2: Implement Position Sizing and Hard Risk Gates

**Files:**
- Create: `app/src/features/securities/live-trading/live-trading-risk-engine.ts`
- Test: `app/src/features/securities/live-trading/live-trading-risk-engine.test.ts`
- Reuse: `app/src/features/securities/t-trading/trading-fee-engine.ts`

**Interfaces:**
- Consumes: `LiveTradingProfile`, broker account/position snapshots, `TradingFeeProfile`, `estimateTradeFees()`.
- Produces: `planLiveBuy(input): LiveBuyRiskDecision`, `evaluateDailyCircuitBreaker(input): CircuitBreakerDecision`, `maximumTTradeShares(availableShares, profile): number`.

- [ ] **Step 1: Write failing risk tests**

```ts
it('keeps CNY 1,400 reserved and sizes to one board lot', () => {
  const result = planLiveBuy(input({ limitPrice: 20, stopPrice: 19, availableCash: 7_000 }));
  expect(result.allowed).toBe(true);
  expect(result.shares).toBe(100);
  expect(result.projectedInvested).toBeLessThanOrEqual(5_600);
});

it('rejects when one board lot exceeds the CNY 140 planned-loss limit after fees', () => {
  const result = planLiveBuy(input({ limitPrice: 30, stopPrice: 28.5 }));
  expect(result).toMatchObject({ allowed: false, reason: 'planned_loss_limit' });
});

it('blocks new buys at CNY 210 daily realized loss plus fees', () => {
  expect(evaluateDailyCircuitBreaker({ realizedProfit: -190, paidFees: 20, limit: 210 }))
    .toEqual({ tripped: true, lossWithFees: 210 });
});

it('caps T shares at 35 percent and rounds down to a board lot', () => {
  expect(maximumTTradeShares(1_000, SHADOW_LIVE_TRADING_PROFILE)).toBe(300);
  expect(maximumTTradeShares(200, SHADOW_LIVE_TRADING_PROFILE)).toBe(0);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npm test -- src/features/securities/live-trading/live-trading-risk-engine.test.ts`

Expected: FAIL because the engine is missing.

- [ ] **Step 3: Implement minimum-constraint sizing**

Calculate candidate shares from all constraints and choose the minimum board-lot value:

```ts
const byCash = floorLot(Math.min(input.availableCash - profile.reservedCash, profile.maximumInvested - input.currentInvested) / input.limitPrice);
const byStockCap = floorLot((profile.maximumPerStock - input.currentStockMarketValue) / input.limitPrice);
const roundTripPerShareRisk = input.limitPrice - input.stopPrice;
const byLoss = largestLotWhosePlannedLossDoesNotExceed140();
const shares = Math.min(byCash, byStockCap, byLoss, input.requestedShares ?? Infinity);
```

For each candidate lot, call `estimateTradeFees` for entry and modeled exit; reject when positions are already 2, the stock is already at cap, circuit breaker is tripped, the stop is not below the entry, or fewer than 100 shares remain.

- [ ] **Step 4: Run focused and existing fee tests**

Run: `cd app && npm test -- src/features/securities/live-trading/live-trading-risk-engine.test.ts src/features/securities/t-trading/trading-fee-engine.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- app/src/features/securities/live-trading/live-trading-risk-engine.ts app/src/features/securities/live-trading/live-trading-risk-engine.test.ts
git commit -m "feat: enforce live trading risk limits"
```

---

### Task 3: Implement Signal Priority, Take-Profit, Loss-Wait, and T Rules

**Files:**
- Create: `app/src/features/securities/live-trading/live-trading-signal-policy.ts`
- Test: `app/src/features/securities/live-trading/live-trading-signal-policy.test.ts`

**Interfaces:**
- Consumes: `ShortTermTradingAdvice`, `MediumTermBuyAdvice`, `RealtimePriceTargets`, position P&L, fatal-risk flag, hard-stop flag, T plan.
- Produces: `evaluateLiveTradingSignal(input): LiveTradingSignalDecision` and `LIVE_SIGNAL_PRIORITY`.

- [ ] **Step 1: Write failing policy tests**

```ts
it('observes inside the short entry range but preauthorizes only at the formal buy price', () => {
  expect(evaluateLiveTradingSignal(signal({ price: 10.4, shortRange: [10.3, 10.5], formalBuy: 10 })).kind)
    .toBe('observe_buy');
  expect(evaluateLiveTradingSignal(signal({ price: 10, shortRange: [10.3, 10.5], formalBuy: 10 })).kind)
    .toBe('core_buy');
});

it('waits when ratings weaken while the position is losing', () => {
  expect(evaluateLiveTradingSignal(positionSignal({ unrealizedProfit: -80, short: 'reduce_sell', medium: 'risk_avoidance' })))
    .toMatchObject({ kind: 'loss_wait', requiresSell: false });
});

it('uses first take profit for a profitable single-rating downgrade', () => {
  expect(evaluateLiveTradingSignal(positionSignal({ shares: 300, unrealizedProfit: 100, short: 'reduce_sell', medium: 'watch' })))
    .toMatchObject({ kind: 'take_profit_1', suggestedShares: 100, requiresUserConfirmation: true });
});

it('hard stop overrides fatal exit, take profit, and T sell', () => {
  expect(evaluateLiveTradingSignal(positionSignal({ hardStopTriggered: true, fatalRisk: true, tSellEligible: true })).kind)
    .toBe('hard_stop');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd app && npm test -- src/features/securities/live-trading/live-trading-signal-policy.test.ts`

Expected: FAIL because the policy does not exist.

- [ ] **Step 3: Implement the exact priority table**

```ts
export const LIVE_SIGNAL_PRIORITY = [
  'hard_stop', 'fatal_exit', 'take_profit_2',
  'take_profit_1', 't_sell', 'hold',
] as const;
```

Rules:

- `core_buy`: short is `strong_buy` or `buy_on_dip`; medium is `accumulate`, `cautious_buy`, or `watch`; price is at/below formal buy; data is fresh.
- `observe_buy`: same rating gate and price is inside the short entry range but above formal buy.
- `loss_wait`: ratings weaken while unrealized P&L is negative and no hard stop/fatal risk exists.
- `take_profit_1`: profitable, one horizon weakens or first target/formal sell is reached; 50% rounded down, or all 100 shares.
- `take_profit_2`: profitable and both horizons weaken, or second target is reached; sell all available shares.
- `fatal_exit`: fatal risk regardless of P&L, user confirmation required unless hard stop also triggered.
- `hard_stop`: preauthorized automatic sell of broker-available shares.
- `t_sell`/`t_buyback`: always user confirmation; suppress if any higher-priority sell exists.

- [ ] **Step 4: Run focused policy and existing short-advice tests**

Run: `cd app && npm test -- src/features/securities/live-trading/live-trading-signal-policy.test.ts src/engines/market-analysis/short-term-trading-advice.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- app/src/features/securities/live-trading/live-trading-signal-policy.ts app/src/features/securities/live-trading/live-trading-signal-policy.test.ts
git commit -m "feat: define live trade signal policy"
```

---

### Task 4: Build a One-Pass Watchlist Candidate Scanner

**Files:**
- Create: `app/src/features/securities/live-trading/live-trading-candidate-scanner.ts`
- Test: `app/src/features/securities/live-trading/live-trading-candidate-scanner.test.ts`
- Reuse without modifying: `app/src/features/securities/realtime-price-targets.ts`
- Reuse without modifying: `app/src/engines/market-analysis/short-term-trading-advice.ts`
- Reuse without modifying: `app/src/engines/market-analysis/medium-term-buy-advice.ts`

**Interfaces:**
- Consumes: watchlist codes, live quotes, `fetchEastmoneyKLine`, `fetchEastmoneyBasic`, indicator/strategy/pattern/fundamental builders.
- Produces: `scanLiveTradingCandidates(input, dependencies): Promise<LiveTradingCandidate[]>`.

- [ ] **Step 1: Write a failing single-fetch scanner test**

```ts
it('builds short, medium, formal targets, and combined score from one K-line fetch', async () => {
  const fetchKLine = vi.fn().mockResolvedValue(validKlines(120));
  const result = await scanLiveTradingCandidates({ codes: ['000333'], quotes: quoteMap() }, deps({ fetchKLine }));
  expect(fetchKLine).toHaveBeenCalledTimes(1);
  expect(result[0]).toMatchObject({ code: '000333', name: '美的集团' });
  expect(result[0].shortAdvice.entryRange).not.toBeNull();
  expect(result[0].mediumAdvice.action).not.toBe('insufficient_data');
  expect(result[0].formalTargets.buyPrice).toBeGreaterThan(0);
  expect(result[0].combinedScore).toBeCloseTo(result[0].mediumAdvice.score * 0.6 + result[0].shortAdvice.score * 0.4);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd app && npm test -- src/features/securities/live-trading/live-trading-candidate-scanner.test.ts`

Expected: FAIL because the scanner is missing.

- [ ] **Step 3: Implement one-pass analysis with bounded concurrency**

Fetch one 120-day K-line series and one basic-data record per code, clone/calculate indicators once, then build strategies, patterns, fundamentals, medium advice, short advice, and `computeRealtimePriceTargets`. Use maximum concurrency 2 and a five-minute account-scoped memory cache. Return explicit `dataFresh`, `dataAsOf`, and failure reasons; never emit a tradable candidate when targets or either advice are insufficient.

- [ ] **Step 4: Run scanner and market-analysis regression tests**

Run: `cd app && npm test -- src/features/securities/live-trading/live-trading-candidate-scanner.test.ts src/features/securities/realtime-price-targets.test.ts src/features/securities/watchlist-score-sort.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- app/src/features/securities/live-trading/live-trading-candidate-scanner.ts app/src/features/securities/live-trading/live-trading-candidate-scanner.test.ts
git commit -m "feat: scan watchlist shadow candidates"
```

---

### Task 5: Implement the Shadow Order State Machine and Local Ledger

**Files:**
- Create: `app/src/features/securities/live-trading/shadow-order-machine.ts`
- Create: `app/src/features/securities/live-trading/shadow-trading-store.ts`
- Test: `app/src/features/securities/live-trading/shadow-order-machine.test.ts`
- Test: `app/src/features/securities/live-trading/shadow-trading-store.test.ts`

**Interfaces:**
- Produces: `transitionShadowOrder(order, event)`, `createShadowTradingStore(storage, accountId)`, `calculateShadowQualification(orders)`.
- Consumes: `ShadowOrder`, `LiveTradeIntent`, risk decisions from Tasks 1–3.

- [ ] **Step 1: Write failing state and idempotency tests**

```ts
it('does not submit the same idempotency key twice', () => {
  const store = createShadowTradingStore(memoryStorage(), 'user-a');
  store.append(order({ id: 'o1', idempotencyKey: '000333:core-buy:20260817T093000' }));
  expect(() => store.append(order({ id: 'o2', idempotencyKey: '000333:core-buy:20260817T093000' })))
    .toThrow('duplicate_shadow_order');
});

it('expires an unfilled order after 30 seconds', () => {
  expect(transitionShadowOrder(submittedOrder(), { type: 'clock', at: '2026-08-17T01:30:31Z' }).status)
    .toBe('expired');
});

it('reserves T-sale proceeds until buyback or reduction resolution', () => {
  const store = createShadowTradingStore(memoryStorage(), 'user-a');
  store.recordTSellFill(tSellFill({ amount: 1_200, expectedBuybackFees: 5.2 }));
  expect(store.snapshot().reservedTBuybackCash).toBe(1_205.2);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd app && npm test -- src/features/securities/live-trading/shadow-order-machine.test.ts src/features/securities/live-trading/shadow-trading-store.test.ts`

Expected: FAIL because the state machine/store are absent.

- [ ] **Step 3: Implement legal transitions and account-scoped persistence**

Use a versioned key `sec_live_shadow_v1:<accountId>`. Store only shadow orders, fills, risk snapshots, qualification outcomes, and bridge probe summaries; do not store credentials, raw K-lines, or AI reports. Reject illegal transitions, duplicate idempotency keys, and cross-account loads. A T-buyback reserve cannot be consumed by `core_buy` available-cash calculations.

- [ ] **Step 4: Run focused tests**

Run: `cd app && npm test -- src/features/securities/live-trading/shadow-order-machine.test.ts src/features/securities/live-trading/shadow-trading-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```powershell
git add -- app/src/features/securities/live-trading/shadow-order-machine.ts app/src/features/securities/live-trading/shadow-order-machine.test.ts app/src/features/securities/live-trading/shadow-trading-store.ts app/src/features/securities/live-trading/shadow-trading-store.test.ts
git commit -m "feat: persist idempotent shadow orders"
```

---

### Task 6: Create the Authenticated Loopback Trading Bridge

**Files:**
- Create: `trading-bridge/pyproject.toml`
- Create: `trading-bridge/src/trading_bridge/__init__.py`
- Create: `trading-bridge/src/trading_bridge/models.py`
- Create: `trading-bridge/src/trading_bridge/auth.py`
- Create: `trading-bridge/src/trading_bridge/adapters/base.py`
- Create: `trading-bridge/src/trading_bridge/adapters/shadow.py`
- Create: `trading-bridge/src/trading_bridge/app.py`
- Test: `trading-bridge/tests/test_auth.py`
- Test: `trading-bridge/tests/test_shadow_adapter.py`
- Test: `trading-bridge/tests/test_app.py`

**Interfaces:**
- Produces HTTP: `GET /health`, `GET /v1/capabilities`, `GET /v1/account`, `POST /v1/orders/shadow`, `POST /v1/orders/{id}/cancel`.
- Requires: `X-Bridge-Token` equal to `TRADING_BRIDGE_TOKEN`; bind address must be `127.0.0.1`.
- Phase 1 adapter modes: `shadow`, `eastmoney_read_only`.

- [ ] **Step 1: Write failing Python API tests**

```py
def test_rejects_missing_token(client):
    assert client.get('/health').status_code == 401

def test_shadow_order_never_claims_broker_submission(client, headers):
    response = client.post('/v1/orders/shadow', headers=headers, json={
        'order_id': 'o1', 'code': '000333', 'side': 'buy',
        'limit_price': 50.0, 'shares': 100, 'expires_at': '2026-08-17T02:00:00Z'
    })
    assert response.status_code == 200
    assert response.json()['execution_mode'] == 'shadow'
    assert response.json()['broker_order_id'] is None
```

- [ ] **Step 2: Create a virtual environment and verify tests fail**

Run:

```powershell
cd trading-bridge
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
.\.venv\Scripts\python.exe -m pytest -q
```

Expected: FAIL until the modules/endpoints exist.

- [ ] **Step 3: Implement the narrow bridge contract**

Use Pydantic models with `extra='forbid'`. Compare tokens with `secrets.compare_digest`. `create_app()` must reject a non-loopback configured host. Add `main()` that calls `uvicorn.run(app, host='127.0.0.1', port=configured_port)` so the documented module command is executable. `ShadowBrokerAdapter.submit_order()` returns a deterministic shadow acknowledgement and never imports pywinauto or invokes a Windows control.

- [ ] **Step 4: Run bridge tests**

Run: `cd trading-bridge && .\.venv\Scripts\python.exe -m pytest -q`

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```powershell
git add -- trading-bridge/pyproject.toml trading-bridge/src/trading_bridge/__init__.py trading-bridge/src/trading_bridge/models.py trading-bridge/src/trading_bridge/auth.py trading-bridge/src/trading_bridge/adapters/base.py trading-bridge/src/trading_bridge/adapters/shadow.py trading-bridge/src/trading_bridge/app.py trading-bridge/tests/test_auth.py trading-bridge/tests/test_shadow_adapter.py trading-bridge/tests/test_app.py
git commit -m "feat: add local shadow trading bridge"
```

---

### Task 7: Add the Eastern Fortune Read-Only Capability Probe

**Files:**
- Create: `trading-bridge/src/trading_bridge/adapters/eastmoney_probe.py`
- Test: `trading-bridge/tests/test_eastmoney_probe.py`
- Modify: `trading-bridge/src/trading_bridge/app.py`
- Modify: `trading-bridge/src/trading_bridge/models.py`

**Interfaces:**
- Produces: `EastmoneyCapabilityProbe.probe() -> CapabilityReport` and `POST /v1/eastmoney/probe`.
- Capability fields: process detected, executable path hash, product version, window detected, login state readable, funds view readable, positions view readable, orders view readable, cancel control readable, unknown dialogs, redacted evidence.
- Explicitly does not produce buy/sell/click methods.

- [ ] **Step 1: Write failing fake-UIA probe tests**

```py
def test_probe_reports_missing_client_without_clicking(fake_uia):
    report = EastmoneyCapabilityProbe(fake_uia).probe()
    assert report.process_detected is False
    assert report.safe_for_shadow is False
    assert fake_uia.click_calls == []

def test_probe_redacts_account_numbers(fake_uia_with_account):
    report = EastmoneyCapabilityProbe(fake_uia_with_account).probe()
    assert '3375523495' not in str(report.model_dump())
    assert report.funds_view_readable is True
```

- [ ] **Step 2: Run and verify failure**

Run: `cd trading-bridge && .\.venv\Scripts\python.exe -m pytest tests/test_eastmoney_probe.py -q`

Expected: FAIL because the probe is missing.

- [ ] **Step 3: Implement a read-only pywinauto probe**

Use dependency injection around pywinauto so tests use a fake UIA backend. The real backend may enumerate processes, top-level windows, automation IDs, control types, visible text, and product version. It must never call `click_input`, `type_keys`, `set_edit_text`, or invoke a control pattern. Redact sequences of six or more digits and hash the executable path before returning evidence.

Set `safe_for_shadow` only when the process/window can be identified and the probe completes without unknown modal dialogs. Set `safe_for_live=false` unconditionally in Phase 1.

- [ ] **Step 4: Run all bridge tests**

Run: `cd trading-bridge && .\.venv\Scripts\python.exe -m pytest -q`

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```powershell
git add -- trading-bridge/src/trading_bridge/adapters/eastmoney_probe.py trading-bridge/src/trading_bridge/app.py trading-bridge/src/trading_bridge/models.py trading-bridge/tests/test_eastmoney_probe.py
git commit -m "feat: probe eastmoney desktop capabilities"
```

---

### Task 8: Connect Electron to the Local Bridge Without Exposing Secrets

**Files:**
- Create: `app/electron/trading-bridge-manager.cjs`
- Test: `app/electron/trading-bridge-manager.test.ts`
- Modify: `app/electron/main.cjs`
- Modify: `app/electron/preload.cjs`
- Create: `app/src/types/electron-trading-bridge.d.ts`

**Interfaces:**
- Preload produces: `window.electronTrading.getStatus()`, `runEastmoneyProbe()`, `submitShadowOrder(order)`, `cancelShadowOrder(orderId)`.
- Renderer never receives the bridge token, child-process environment, executable path, or credentials.

- [ ] **Step 1: Write failing manager tests**

```ts
it('starts the bridge hidden with a random token and loopback host', async () => {
  const manager = createTradingBridgeManager({ spawn: spawnMock, fetch: fetchMock, randomBytes });
  await manager.start();
  expect(spawnMock).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({
    windowsHide: true,
    env: expect.objectContaining({ TRADING_BRIDGE_HOST: '127.0.0.1' }),
  }));
  expect(manager.publicStatus()).not.toHaveProperty('token');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd app && npm test -- electron/trading-bridge-manager.test.ts`

Expected: FAIL because the manager is missing.

- [ ] **Step 3: Implement process lifecycle and narrow IPC**

Generate 32 random bytes per process, pass them only through the child environment, wait on `/health` with bounded condition polling, and terminate the child during `before-quit`. Register IPC handlers with zod/schema validation before forwarding requests. Preload exposes named methods rather than a generic `invoke(channel, payload)` escape hatch.

- [ ] **Step 4: Run Electron manager tests and typecheck**

Run: `cd app && npm test -- electron/trading-bridge-manager.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 8**

```powershell
git add -- app/electron/trading-bridge-manager.cjs app/electron/trading-bridge-manager.test.ts app/electron/main.cjs app/electron/preload.cjs app/src/types/electron-trading-bridge.d.ts
git commit -m "feat: connect electron to trading bridge"
```

---

### Task 9: Add the Shadow Trading Page and Local Route

**Files:**
- Create: `app/src/features/securities/live-trading/useLiveTradingShadow.ts`
- Create: `app/src/features/securities/live-trading/LiveTradingShadowPage.tsx`
- Create: `app/src/features/securities/live-trading/LiveTradingShadowPage.css`
- Test: `app/src/features/securities/live-trading/LiveTradingShadowPage.test.tsx`
- Modify: `app/src/app/router-base.tsx`
- Test: `app/src/app/router.test.tsx`
- Modify: `app/src/features/securities/SecuritiesWorkbenchPageBase.tsx`
- Test: `app/src/features/securities/SecuritiesWorkbenchPage.test.tsx`

**Interfaces:**
- Consumes: `useOptionalSecuritiesState()` watchlists/positions, `useRealtimeStockQuotes`, candidate scanner, signal policy, risk engine, shadow store, and `window.electronTrading`.
- Produces route: `/projects/:projectId/securities/live-trading` plus `/securities/live-trading`.

- [ ] **Step 1: Write failing UI tests**

```tsx
it('shows fixed limits and never offers live execution in Phase 1', async () => {
  renderPage({ bridgeOnline: true, mode: 'shadow' });
  expect(screen.getByText('资金池 ¥7,000')).toBeInTheDocument();
  expect(screen.getByText('最大投入 ¥5,600')).toBeInTheDocument();
  expect(screen.getByText('影子订单 0 / 20')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '开启实盘' })).not.toBeInTheDocument();
});

it('blocks shadow submission when the bridge is offline', async () => {
  renderPage({ bridgeOnline: false, candidate: eligibleCandidate() });
  expect(screen.getByRole('button', { name: '生成影子订单 美的集团' })).toBeDisabled();
  expect(screen.getByText('本地交易桥离线')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd app && npm test -- src/features/securities/live-trading/LiveTradingShadowPage.test.tsx src/app/router.test.tsx src/features/securities/SecuritiesWorkbenchPage.test.tsx`

Expected: FAIL because the page/route/entry are missing.

- [ ] **Step 3: Implement the Phase 1 UI**

Sections:

- bridge/Eastern Fortune read-only capability status;
- immutable 7,000/5,600/1,400/2 positions/3,500/140/210 profile card;
- watchlist candidates with short/medium ratings, combined score, short range, formal buy/sell, stop and freshness;
- observation vs core-buy decision;
- shadow orders and state timeline;
- T-buyback reserved cash;
- qualification progress with blocking failures.

The page must state “影子模式不会向券商提交订单”. Add only a shadow entry to the securities workbench. Modify `router-base.tsx`, not dirty `router.tsx`; the existing protection wrapper will protect the new securities route automatically.

- [ ] **Step 4: Run UI, router, and securities regression tests**

Run: `cd app && npm test -- src/features/securities/live-trading/LiveTradingShadowPage.test.tsx src/app/router.test.tsx src/features/securities/SecuritiesWorkbenchPage.test.tsx src/features/securities/WatchlistPage.test.tsx src/features/securities/StockAnalysisRealtimeTargets.test.tsx`

Expected: PASS and the stock-analysis regression remains unchanged.

- [ ] **Step 5: Commit Task 9**

```powershell
git add -- app/src/features/securities/live-trading/useLiveTradingShadow.ts app/src/features/securities/live-trading/LiveTradingShadowPage.tsx app/src/features/securities/live-trading/LiveTradingShadowPage.css app/src/features/securities/live-trading/LiveTradingShadowPage.test.tsx app/src/app/router-base.tsx app/src/app/router.test.tsx app/src/features/securities/SecuritiesWorkbenchPageBase.tsx app/src/features/securities/SecuritiesWorkbenchPage.test.tsx
git commit -m "feat: add local shadow trading workbench"
```

---

### Task 10: Enforce the 20-Order Qualification Gate and Produce the Runbook

**Files:**
- Create: `app/src/features/securities/live-trading/shadow-qualification.ts`
- Test: `app/src/features/securities/live-trading/shadow-qualification.test.ts`
- Modify: `app/src/features/securities/live-trading/LiveTradingShadowPage.tsx`
- Modify: `app/src/features/securities/live-trading/LiveTradingShadowPage.test.tsx`
- Create: `docs/live-trading/eastmoney-shadow-runbook.md`

**Interfaces:**
- Produces: `evaluateShadowQualification(orders, probe): ShadowQualificationReport`.
- A report passes only with 20 valid completed/expired/cancelled shadow scenarios, zero blocking failures, and a current successful read-only capability probe.

- [ ] **Step 1: Write failing qualification tests**

```ts
it('does not pass with nineteen valid orders', () => {
  expect(evaluateShadowQualification(validOrders(19), successfulProbe()).passed).toBe(false);
});

it('fails permanently for the run when any wrong-code or duplicate-execution incident exists', () => {
  const report = evaluateShadowQualification([
    ...validOrders(20), failedOrder({ failureKind: 'wrong_code' }),
  ], successfulProbe());
  expect(report).toMatchObject({ passed: false, blockingFailures: 1 });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd app && npm test -- src/features/securities/live-trading/shadow-qualification.test.ts`

Expected: FAIL because the evaluator is missing.

- [ ] **Step 3: Implement exact qualification evidence**

Count only orders with a frozen candidate/risk/fee snapshot and terminal state. Require scenario coverage for buy, expiry/cancel, ordinary sell, hard stop, T+1 block, T sell, T buyback, partial fill simulation, duplicate rejection, and bridge restart recovery. The report contains counts and reasons only; it cannot enable live trading in Phase 1.

Write the runbook with exact commands:

```powershell
cd C:\Users\33755\Desktop\投资尽调模型\trading-bridge
.\.venv\Scripts\python.exe -m trading_bridge.app

cd C:\Users\33755\Desktop\投资尽调模型\app
npm run electron:dev
```

Document how to install/open Eastern Fortune desktop, run the read-only probe, verify no controls were clicked, generate 20 shadow orders, export the redacted report, stop the bridge, and recover from a failed probe.

- [ ] **Step 4: Run the complete local verification suite**

Run:

```powershell
cd app
npm run typecheck
npm test -- src/features/securities/live-trading src/features/securities/t-trading src/features/securities/WatchlistPage.test.tsx src/features/securities/StockAnalysisRealtimeTargets.test.tsx src/app/router.test.tsx
npm run lint
npm run build

cd ..\trading-bridge
.\.venv\Scripts\python.exe -m pytest -q
```

Expected: all commands PASS. Do not run Netlify deploy, Railway deploy, Supabase migration, or Git push.

- [ ] **Step 5: Commit Task 10**

```powershell
git add -- app/src/features/securities/live-trading/shadow-qualification.ts app/src/features/securities/live-trading/shadow-qualification.test.ts app/src/features/securities/live-trading/LiveTradingShadowPage.tsx app/src/features/securities/live-trading/LiveTradingShadowPage.test.tsx docs/live-trading/eastmoney-shadow-runbook.md
git commit -m "test: gate live trading behind shadow evidence"
```

---

## Phase 1 Completion Gate

Phase 1 is complete only when all conditions hold:

- The production website and Supabase schema were not changed.
- No Eastern Fortune buy, sell, cancel, or text-entry control was invoked by the probe.
- Browser and Electron renderer never receive a bridge token or broker credential.
- Risk tests prove 7,000/5,600/1,400/2/3,500/140/210/35%/100-share rules.
- Losing positions wait on rating weakness but still obey hard stop/fatal risk.
- Profitable rating weakness follows approved first/second take-profit rules.
- T sell/buyback require user confirmation and reserve buyback cash.
- Twenty shadow orders pass with zero blocking failures.
- Stock analysis and existing K-line tests remain green.
- The user reviews the redacted Eastern Fortune capability report before any Phase 2 plan is written.
