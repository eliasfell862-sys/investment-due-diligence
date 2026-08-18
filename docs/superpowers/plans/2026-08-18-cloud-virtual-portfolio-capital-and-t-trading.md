# Cloud Virtual Portfolio Capital and T-Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce one shared CNY 200,000 cash account across every cloud virtual position, safely rebuild over-cap historical records, and run fee-aware T-trading for every open virtual position.

**Architecture:** Add a versioned pure TypeScript cash ledger for deterministic local behavior, then enforce the same rule atomically in Supabase with a per-user locked cash-account row. Extend the resident worker's existing T-trading path to evaluate actual and virtual positions through one market-data pipeline while keeping their execution and message kinds separate. Historical cleanup uses immutable preview snapshots followed by an authenticated, transactional apply RPC.

**Tech Stack:** React 19, TypeScript 6, Vitest 4, decimal.js, Supabase/PostgreSQL PL/pgSQL, Node/Railway worker, existing A-share fee and T-trading engines.

## Global Constraints

- The shared initial capital is exactly CNY 200,000 per user.
- Capital is constrained by cash flow, not mark-to-market value.
- Buy, add, and T-buyback cash outflow includes modeled transaction fees.
- Sell cash inflow is net of commission, transfer fee, stamp duty, and modeled slippage where applicable.
- No virtual mutation may leave `cashBalance < 0`.
- Every open cloud virtual position remains in the T-trading universe even after removal from watchlists.
- Virtual T sells still obey A-share T+1 availability and 100-share board lots.
- Do not change actual-position execution, live-trading shadow validation, Eastmoney OCR, or other users' data.
- Do not deploy migrations or clean production data until all local TypeScript, SQL, worker, typecheck, lint, and build checks pass and the user approves the cleanup preview.
- Historical cleanup must be previewed first and applied only against the exact unchanged snapshot.
- Execute this plan inline in the current session; do not use subagents.

---

## File Map

### New files

- `app/src/features/securities/virtual-cash-account.ts` — pure shared-cash calculations, typed failures, summaries, and V1-to-V2 migration.
- `app/src/features/securities/virtual-cash-account.test.ts` — shared-capital and cash-flow unit tests.
- `app/src/features/securities/virtual-history-replay.ts` — deterministic historical replay and cleanup preview builder.
- `app/src/features/securities/virtual-history-replay.test.ts` — dependency-aware replay tests.
- `app/src/features/securities/VirtualCapitalCleanupDialog.tsx` — preview/review/confirm UI.
- `app/src/features/securities/VirtualCapitalCleanupDialog.test.tsx` — cleanup safety UI tests.
- `app/supabase/migrations/202608180001_virtual_portfolio_capital_and_t_trading.sql` — cash table, transaction snapshots, generalized T-cycle ownership, atomic signal execution, and cleanup RPCs.
- `app/supabase/tests/virtual_portfolio_capital.test.sql` — pgTAP coverage for cash, concurrency-safe execution semantics, and cleanup isolation.

### Modified files

- `app/src/features/securities/virtual-trading-ledger.ts` — ledger V2 cash account and fee-aware mutations.
- `app/src/features/securities/virtual-trading-ledger.test.ts` — mutation and migration behavior.
- `app/src/features/securities/backtest-signal-inbox-store.ts` — new cash-blocked and virtual-T message/status types.
- `app/src/features/securities/backtest-signal-inbox-store.test.ts` — V1/V3 runtime migration and message parsing.
- `app/src/features/securities/backtest-signal-trading-runtime.ts` — block unaffordable virtual buys without creating trades.
- `app/src/features/securities/backtest-signal-trading-runtime.test.ts` — signal-to-cash integration.
- `app/src/features/securities/realtime-backtest-monitor.ts` — pass liquidity information needed by fee estimation.
- `app/src/features/securities/useRealtimeBacktestMonitor.ts` — include fee profile and display cloud rejection state.
- `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx` — cloud payload and blocked-state tests.
- `app/src/features/securities/cloud/cloud-securities-repository-base.ts` — load cash and fee snapshots with virtual runtime.
- `app/src/features/securities/cloud/cloud-securities-repository.ts` — cleanup preview/apply RPC methods.
- `app/src/features/securities/cloud/cloud-securities-repository.test.ts` — row mapping and RPC tests.
- `app/src/features/securities/ForwardSimulationPanel.tsx` — capital summary and cleanup entry point.
- `app/src/features/securities/ForwardSimulationPanel.test.tsx` — capital summary and blocked-message UI.
- `app/worker/supabase-repository.ts` — load virtual T candidates and generalized cycles.
- `app/worker/supabase-repository.test.ts` — per-user actual/virtual assignment mapping.
- `app/worker/t-trading-runner.ts` — scan both scopes without duplicate quote calls.
- `app/worker/t-trading-runner.test.ts` — full virtual-position coverage.
- `app/worker/t-trading-evaluator.ts` — scope-specific virtual T message payloads.
- `app/worker/t-trading-evaluator.test.ts` — virtual sell/buyback/cash-blocked decisions.
- `app/worker/runtime-repository.ts` — pass virtual T transitions to the atomic RPC.
- `app/worker/runtime-repository.test.ts` — RPC contract tests.
- `app/supabase/cloud-securities-migration.sql` — append the same production migration for clean installs.
- `docs/live-trading/eastmoney-shadow-runbook.md` — virtual capital and cleanup operational steps; OCR behavior remains unchanged.

---

### Task 1: Add the shared virtual cash domain

**Files:**
- Create: `app/src/features/securities/virtual-cash-account.ts`
- Create: `app/src/features/securities/virtual-cash-account.test.ts`

**Interfaces:**
- Produces: `VIRTUAL_INITIAL_CAPITAL`, `VirtualCashAccount`, `VirtualCashSummary`, `VirtualCashError`, `createVirtualCashAccount()`, `applyVirtualCashFlow()`, and `summarizeVirtualCash()`.
- Consumes: `TradeFeeBreakdown` and `TradingFeeProfile` from `t-trading/trading-fee-engine.ts`.

- [ ] **Step 1: Write failing tests for one shared CNY 200,000 account**

```ts
import { describe, expect, it } from 'vitest';
import {
  applyVirtualCashFlow,
  createVirtualCashAccount,
  VirtualCashError,
  VIRTUAL_INITIAL_CAPITAL,
} from './virtual-cash-account';

describe('virtual cash account', () => {
  it('starts every user with one shared CNY 200000 account', () => {
    expect(createVirtualCashAccount('2026-08-18T01:00:00.000Z')).toEqual({
      initialCapital: VIRTUAL_INITIAL_CAPITAL,
      cashBalance: 200000,
      reservedCash: 0,
      version: 0,
      updatedAt: '2026-08-18T01:00:00.000Z',
    });
  });

  it('rejects a second stock when combined gross amount and fees exceed shared cash', () => {
    const first = applyVirtualCashFlow(createVirtualCashAccount('2026-08-18T01:00:00.000Z'), {
      side: 'buy', grossAmount: 150000, feeAmount: 10, occurredAt: '2026-08-18T01:01:00.000Z',
    });
    expect(() => applyVirtualCashFlow(first.account, {
      side: 'buy', grossAmount: 50000, feeAmount: 0.01, occurredAt: '2026-08-18T01:02:00.000Z',
    })).toThrowError(VirtualCashError);
  });

  it('reuses only net sell proceeds', () => {
    const bought = applyVirtualCashFlow(createVirtualCashAccount('2026-08-18T01:00:00.000Z'), {
      side: 'buy', grossAmount: 100000, feeAmount: 8, occurredAt: '2026-08-18T01:01:00.000Z',
    });
    const sold = applyVirtualCashFlow(bought.account, {
      side: 'sell', grossAmount: 20000, feeAmount: 25, occurredAt: '2026-08-19T01:01:00.000Z',
    });
    expect(sold.cashDelta).toBe(19975);
    expect(sold.account.cashBalance).toBe(119967);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run from `app`:

```powershell
npx vitest run src/features/securities/virtual-cash-account.test.ts
```

Expected: FAIL because `virtual-cash-account.ts` does not exist.

- [ ] **Step 3: Implement the minimal cash domain with decimal-safe rounding**

```ts
import Decimal from 'decimal.js';

export const VIRTUAL_INITIAL_CAPITAL = 200_000;

export interface VirtualCashAccount {
  initialCapital: number;
  cashBalance: number;
  reservedCash: number;
  version: number;
  updatedAt: string;
}

export class VirtualCashError extends Error {
  constructor(
    readonly code: 'virtual_cash_insufficient' | 'virtual_cash_invalid',
    readonly requiredCash: number,
    readonly availableCash: number,
  ) {
    super(code);
  }
}

export function createVirtualCashAccount(updatedAt: string): VirtualCashAccount {
  return { initialCapital: 200000, cashBalance: 200000, reservedCash: 0, version: 0, updatedAt };
}

export function applyVirtualCashFlow(account: VirtualCashAccount, input: {
  side: 'buy' | 'sell'; grossAmount: number; feeAmount: number; occurredAt: string;
}) {
  const gross = new Decimal(input.grossAmount);
  const fees = new Decimal(input.feeAmount);
  const delta = input.side === 'buy' ? gross.plus(fees).negated() : gross.minus(fees);
  const next = new Decimal(account.cashBalance).plus(delta);
  if (next.isNegative()) {
    throw new VirtualCashError('virtual_cash_insufficient', gross.plus(fees).toNumber(), account.cashBalance);
  }
  return {
    cashDelta: delta.toDecimalPlaces(2).toNumber(),
    account: { ...account, cashBalance: next.toDecimalPlaces(2).toNumber(), version: account.version + 1, updatedAt: input.occurredAt },
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run src/features/securities/virtual-cash-account.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the cash domain**

```powershell
git add app/src/features/securities/virtual-cash-account.ts app/src/features/securities/virtual-cash-account.test.ts
git commit -m "feat: add shared virtual cash account"
```

---

### Task 2: Upgrade the pure virtual ledger to fee-aware V2

**Files:**
- Modify: `app/src/features/securities/virtual-trading-ledger.ts`
- Modify: `app/src/features/securities/virtual-trading-ledger.test.ts`
- Modify: `app/src/features/securities/backtest-signal-inbox-store.ts`
- Modify: `app/src/features/securities/backtest-signal-inbox-store.test.ts`

**Interfaces:**
- Consumes: `applyVirtualCashFlow()` from Task 1 and `estimateTradeFees()` from `t-trading/trading-fee-engine.ts`.
- Produces: `VirtualTradingLedger` version 2 with `cashAccount`; fee/cash fields on `VirtualTransaction`; `migrateVirtualTradingLedger()`.

- [ ] **Step 1: Add failing ledger tests for cross-stock limits, fees, sells, and V1 migration**

```ts
it('shares cash across different stock positions', () => {
  const first = buyVirtualPosition(createEmptyVirtualTradingLedger(AT), buy({ code: '000001', price: 1500, shares: 100 }), options).ledger;
  expect(() => buyVirtualPosition(first, buy({ code: '000002', price: 500, shares: 100 }), options))
    .toThrowError(/virtual_cash_insufficient/);
});

it('stores fee and post-trade cash snapshots', () => {
  const result = buyVirtualPosition(createEmptyVirtualTradingLedger(AT), buy({ price: 10, shares: 100 }), options);
  expect(result.transaction).toMatchObject({ grossAmount: 1000, feeAmount: 5, cashDelta: -1005 });
  expect(result.transaction.cashBalanceAfter).toBe(198995);
});

it('migrates V1 without silently deleting over-cap history', () => {
  const migrated = migrateVirtualTradingLedger(v1Ledger);
  expect(migrated.version).toBe(2);
  expect(migrated.cashAccount.initialCapital).toBe(200000);
  expect(migrated.requiresCapitalCleanup).toBe(true);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx vitest run src/features/securities/virtual-trading-ledger.test.ts src/features/securities/backtest-signal-inbox-store.test.ts
```

Expected: FAIL because the ledger is V1 and transaction cash fields are absent.

- [ ] **Step 3: Implement ledger V2 and stable migration**

Update the public shapes to:

```ts
export interface VirtualTradingLedger {
  version: 2;
  cashAccount: VirtualCashAccount;
  positions: VirtualPosition[];
  transactions: VirtualTransaction[];
  cycles: VirtualTradeCycle[];
  requiresCapitalCleanup: boolean;
}

export interface VirtualTransaction {
  // existing fields remain
  grossAmount: number;
  feeAmount: number;
  cashDelta: number;
  cashBalanceAfter: number;
  feeProfileSnapshot: TradingFeeProfile;
  feeEstimated: boolean;
}
```

Make `BuyVirtualPositionInput` and `SellVirtualPositionInput` require `feeProfile` and `averageDailyAmount`. Use `estimateTradeFees()` for virtual transactions. Apply cash before cloning positions so an insufficient buy throws without changing the input ledger. For a sell, validate shares and T+1 first, then credit only `grossAmount - feeAmount`.

The V1 migration must reconstruct cash from ordered transactions using the current fee profile, mark migrated transactions `feeEstimated: true`, and set `requiresCapitalCleanup: true` if any buy cannot be replayed. It must not delete data during load.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run src/features/securities/virtual-trading-ledger.test.ts src/features/securities/backtest-signal-inbox-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit ledger V2**

```powershell
git add app/src/features/securities/virtual-trading-ledger.ts app/src/features/securities/virtual-trading-ledger.test.ts app/src/features/securities/backtest-signal-inbox-store.ts app/src/features/securities/backtest-signal-inbox-store.test.ts
git commit -m "feat: enforce shared cash in virtual ledger"
```

---

### Task 3: Block unaffordable signal executions without corrupting state

**Files:**
- Modify: `app/src/features/securities/realtime-backtest-monitor.ts`
- Modify: `app/src/features/securities/backtest-signal-trading-runtime.ts`
- Modify: `app/src/features/securities/backtest-signal-trading-runtime.test.ts`
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.ts`
- Modify: `app/src/features/securities/useRealtimeBacktestMonitor.test.tsx`

**Interfaces:**
- Consumes: ledger V2 and `VirtualCashError` from Tasks 1–2.
- Produces: `virtual_cash_insufficient` alerts with no virtual transaction and a cloud payload carrying the fee profile/liquidity inputs.

- [ ] **Step 1: Write failing runtime tests**

```ts
it('creates a blocked alert but no trade when shared cash cannot cover a buy', () => {
  const result = applySignalDecisionEvent(stateWithCash(500), buyEvent({ price: 10 }), fixedIds);
  expect(result.createdTransactions).toEqual([]);
  expect(result.createdAlerts[0]).toMatchObject({
    messageKind: 'virtual_blocked',
    virtualTrackingStatus: 'blocked_cash',
  });
  expect(result.createdAlerts[0]?.reasons).toContain('virtual_cash_insufficient');
  expect(result.state.virtualLedger.cashAccount.cashBalance).toBe(500);
});

it('sends fee and liquidity inputs to the authenticated cloud transition', async () => {
  await refreshCloudMonitor();
  expect(commitCloudSignalTransition).toHaveBeenCalledWith(expect.objectContaining({
    fee_profile: expect.any(Object),
    average_daily_amount: expect.any(Number),
  }));
});
```

- [ ] **Step 2: Run runtime tests and verify RED**

Run:

```powershell
npx vitest run src/features/securities/backtest-signal-trading-runtime.test.ts src/features/securities/useRealtimeBacktestMonitor.test.tsx
```

Expected: FAIL because insufficient cash currently throws and cloud payload lacks fee inputs.

- [ ] **Step 3: Implement typed blocking and liquidity propagation**

Add `averageDailyAmount` to `BacktestDecisionEvent`. In `applySignalDecisionEvent`, catch only `VirtualCashError` with code `virtual_cash_insufficient`; create a `virtual_blocked` alert and leave the ledger unchanged. Do not catch validation, T+1, or corruption errors as cash failures.

Extend `VirtualTrackingStatus` with `blocked_cash`. In cloud mode send `fee_profile`, `average_daily_amount`, and `virtual_execution_requested: true`; the database remains authoritative.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run src/features/securities/backtest-signal-trading-runtime.test.ts src/features/securities/useRealtimeBacktestMonitor.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit signal integration**

```powershell
git add app/src/features/securities/realtime-backtest-monitor.ts app/src/features/securities/backtest-signal-trading-runtime.ts app/src/features/securities/backtest-signal-trading-runtime.test.ts app/src/features/securities/useRealtimeBacktestMonitor.ts app/src/features/securities/useRealtimeBacktestMonitor.test.tsx
git commit -m "feat: block unaffordable virtual signals"
```

---

### Task 4: Build deterministic historical replay and cleanup previews

**Files:**
- Create: `app/src/features/securities/virtual-history-replay.ts`
- Create: `app/src/features/securities/virtual-history-replay.test.ts`

**Interfaces:**
- Consumes: ledger V2, fee engine, virtual cycles/lots/transactions.
- Produces: `previewVirtualCapitalCleanup(input): VirtualCapitalCleanupPreview` and a canonical SHA-256 `snapshotHash`.

- [ ] **Step 1: Write failing replay tests**

```ts
it('keeps ordered trades until cash is insufficient and removes dependent records', () => {
  const preview = previewVirtualCapitalCleanup(history({
    buys: [buyTx('a', '000001', 120000), buyTx('b', '000002', 90000)],
    sells: [sellTx('c', 'b', '000002', 10000)],
  }));
  expect(preview.retainedTransactionIds).toEqual(['a']);
  expect(preview.removedTransactionIds).toEqual(['b', 'c']);
  expect(preview.endingCash).toBeGreaterThanOrEqual(0);
});

it('allows a later buy after an earlier retained sell releases net cash', () => {
  const preview = previewVirtualCapitalCleanup(historyWithBuySellBuy());
  expect(preview.removedTransactionIds).toEqual([]);
});

it('uses stable tradedAt then id ordering and produces the same snapshot hash', () => {
  expect(previewVirtualCapitalCleanup(input).snapshotHash)
    .toBe(previewVirtualCapitalCleanup(reverseInput(input)).snapshotHash);
});
```

- [ ] **Step 2: Run replay tests and verify RED**

Run: `npx vitest run src/features/securities/virtual-history-replay.test.ts`

Expected: FAIL because the replay module does not exist.

- [ ] **Step 3: Implement dependency-aware replay**

Define:

```ts
export interface VirtualCapitalCleanupPreview {
  snapshotHash: string;
  snapshotAt: string;
  originalTransactionCount: number;
  retainedTransactionIds: string[];
  removedTransactionIds: string[];
  removedCycleIds: string[];
  removedCodes: string[];
  rebuiltPositionCount: number;
  endingCash: number;
  investedCost: number;
  cumulativeFees: number;
  containsEstimatedFees: boolean;
  rebuiltLedger: VirtualTradingLedger;
}
```

Sort by `tradedAt`, then `id`. Associate sells to retained FIFO lots. When a buy is unaffordable, reject its lot; reject sells that consume rejected lots; regenerate positions and cycles only from retained transactions. Hash canonical source IDs, timestamps, prices, shares, and fee snapshots—not the generated summary.

- [ ] **Step 4: Run replay tests and verify GREEN**

Run: `npx vitest run src/features/securities/virtual-history-replay.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit replay service**

```powershell
git add app/src/features/securities/virtual-history-replay.ts app/src/features/securities/virtual-history-replay.test.ts
git commit -m "feat: preview virtual capital cleanup"
```

---

### Task 5: Add Supabase cash storage and atomic capital enforcement

**Files:**
- Create: `app/supabase/migrations/202608180001_virtual_portfolio_capital_and_t_trading.sql`
- Create: `app/supabase/tests/virtual_portfolio_capital.test.sql`
- Modify: `app/supabase/tests/cloud_signal_behavior.test.sql`
- Modify: `app/supabase/cloud-securities-migration.sql`

**Interfaces:**
- Produces: `virtual_cash_accounts`, fee/cash snapshot columns, updated `commit_signal_transition(jsonb)`, `preview_virtual_capital_cleanup()`, and `apply_virtual_capital_cleanup(uuid,text)`.
- Consumes: authenticated wrapper `commit_authenticated_signal_transition(jsonb)` and existing RLS conventions.

- [ ] **Step 1: Write failing pgTAP tests**

```sql
select lives_ok(
  $$ select public.commit_signal_transition(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000001',
    'code', '000001', 'name', 'A', 'action', 'buy', 'intent', 'open',
    'price', 1500, 'suggested_shares', 100, 'signal_at', '2026-08-18T01:00:00Z',
    'strategy_id', 'realtime-technical', 'strategy_version', '1',
    'cycle_id', 'buy-a', 'virtual_execution_requested', true,
    'fee_profile', jsonb_build_object('commissionRate', 0.0003, 'minimumCommission', 5,
      'sellStampDutyRate', 0.0005, 'transferFeeRate', 0.00001,
      'slippageMode', 'fixed', 'fixedSlippageRate', 0),
    'average_daily_amount', 100000000
  )) $$,
  'first stock uses shared cash'
);

select throws_ok(
  $$ select public.commit_signal_transition(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000001',
    'code', '000002', 'name', 'B', 'action', 'buy', 'intent', 'open',
    'price', 501, 'suggested_shares', 100, 'signal_at', '2026-08-18T01:01:00Z',
    'strategy_id', 'realtime-technical', 'strategy_version', '1',
    'cycle_id', 'buy-b', 'virtual_execution_requested', true,
    'fee_profile', jsonb_build_object('commissionRate', 0.0003, 'minimumCommission', 5,
      'sellStampDutyRate', 0.0005, 'transferFeeRate', 0.00001,
      'slippageMode', 'fixed', 'fixedSlippageRate', 0),
    'average_daily_amount', 100000000
  )) $$,
  'P0001', 'virtual_cash_insufficient',
  'second stock cannot receive a separate 200000 allowance'
);

select is(
  (select cash_balance >= 0 from public.virtual_cash_accounts where user_id = '00000000-0000-0000-0000-000000000001'),
  true,
  'cash never becomes negative'
);
```

Also add tests that two savepoints attempting competing buys leave only one affordable trade, sells credit net cash, other users remain untouched, stale preview hashes are rejected, and failed RPCs do not leave an alert marked executed.

- [ ] **Step 2: Run local SQL tests and verify RED**

Run from `app` with Docker Desktop running:

```powershell
npx supabase start
npx supabase db reset
npx supabase test db supabase/tests/virtual_portfolio_capital.test.sql
```

Expected: FAIL because `virtual_cash_accounts` and cleanup RPCs do not exist.

- [ ] **Step 3: Implement the migration**

Create `virtual_cash_accounts` with `user_id` primary key, exact 200000 default, non-negative checks, RLS select policy, and service-role/authenticated RPC access only. Add transaction snapshot columns with non-negative constraints.

Inside `commit_signal_transition`:

```sql
insert into public.virtual_cash_accounts (user_id, initial_capital, cash_balance)
values (v_user_id, 200000, 200000)
on conflict (user_id) do nothing;

select * into v_cash_account
from public.virtual_cash_accounts
where user_id = v_user_id
for update;

if v_action = 'buy' and v_cash_account.cash_balance < v_gross_amount + v_fee_amount then
  update public.signal_alerts
  set message_kind = 'virtual_blocked', virtual_tracking_status = 'blocked_cash'
  where id = v_alert_id;
  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id, 'virtual_cash_insufficient', 'signal_alert', v_alert_id::text,
    jsonb_build_object(
      'required_cash', v_gross_amount + v_fee_amount,
      'available_cash', v_cash_account.cash_balance,
      'code', v_code
    )
  );
  return v_alert_id;
end if;
```

For successful buys subtract gross plus fees. For sells add gross minus fees. Update cash, positions, lots, transactions, cycles, alerts, and audit events in the same function call. Avoid dynamic SQL and never trust a client-provided balance or fee total; calculate fees from the validated profile fields inside PostgreSQL.

Append the migration verbatim to `cloud-securities-migration.sql` for new environments.

- [ ] **Step 4: Run SQL tests and verify GREEN**

Run:

```powershell
npx supabase db reset
npx supabase test db supabase/tests/virtual_portfolio_capital.test.sql
npx supabase test db supabase/tests/cloud_signal_behavior.test.sql
```

Expected: PASS.

- [ ] **Step 5: Commit the database enforcement**

```powershell
git add app/supabase/migrations/202608180001_virtual_portfolio_capital_and_t_trading.sql app/supabase/tests/virtual_portfolio_capital.test.sql app/supabase/tests/cloud_signal_behavior.test.sql app/supabase/cloud-securities-migration.sql
git commit -m "feat: enforce cloud virtual capital atomically"
```

---

### Task 6: Add authenticated cleanup preview and apply APIs

**Files:**
- Modify: `app/src/features/securities/cloud/cloud-securities-repository.ts`
- Modify: `app/src/features/securities/cloud/cloud-securities-repository-base.ts`
- Modify: `app/src/features/securities/cloud/cloud-securities-repository.test.ts`
- Modify: `app/supabase/migrations/202608180001_virtual_portfolio_capital_and_t_trading.sql`
- Modify: `app/supabase/tests/virtual_portfolio_capital.test.sql`

**Interfaces:**
- Produces: `loadVirtualCapitalSummary()`, `previewVirtualCapitalCleanup()`, `applyVirtualCapitalCleanup(previewId, snapshotHash)`.
- Consumes: Task 5 RPCs and maps database rows to ledger V2.

- [ ] **Step 1: Write failing repository tests**

```ts
it('loads one shared virtual cash account with the signal runtime', async () => {
  const runtime = await repository.loadSignalRuntime();
  expect(runtime.virtualLedger.cashAccount).toMatchObject({ initialCapital: 200000, cashBalance: 73120.55 });
});

it('requires preview id and snapshot hash to apply cleanup', async () => {
  await repository.applyVirtualCapitalCleanup('preview-1', 'sha256-value');
  expect(rpc).toHaveBeenCalledWith('apply_virtual_capital_cleanup', {
    p_preview_id: 'preview-1', p_snapshot_hash: 'sha256-value',
  });
});
```

- [ ] **Step 2: Run repository tests and verify RED**

Run: `npx vitest run src/features/securities/cloud/cloud-securities-repository.test.ts`

Expected: FAIL because cash mapping and cleanup methods do not exist.

- [ ] **Step 3: Implement repository mapping and authenticated wrappers**

Load `virtual_cash_accounts` with the runtime. Map `gross_amount`, `fee_amount`, `cash_delta`, `cash_balance_after`, `fee_profile_snapshot`, and `fee_estimated`. If a cloud account row is missing, report `virtual_cash_account_missing`; do not invent a second frontend-only balance after migrations are active.

The preview RPC returns only the current user summary and opaque IDs. The apply RPC accepts only the preview ID and hash; it derives `auth.uid()` server-side.

- [ ] **Step 4: Run repository and SQL tests**

Run:

```powershell
npx vitest run src/features/securities/cloud/cloud-securities-repository.test.ts
npx supabase test db supabase/tests/virtual_portfolio_capital.test.sql
```

Expected: PASS.

- [ ] **Step 5: Commit cloud repository APIs**

```powershell
git add app/src/features/securities/cloud/cloud-securities-repository.ts app/src/features/securities/cloud/cloud-securities-repository-base.ts app/src/features/securities/cloud/cloud-securities-repository.test.ts app/supabase/migrations/202608180001_virtual_portfolio_capital_and_t_trading.sql app/supabase/tests/virtual_portfolio_capital.test.sql
git commit -m "feat: expose virtual capital cleanup APIs"
```

---

### Task 7: Generalize cloud T-trading ownership to virtual positions

**Files:**
- Modify: `app/supabase/migrations/202608180001_virtual_portfolio_capital_and_t_trading.sql`
- Modify: `app/supabase/tests/actual_position_t_trading.test.sql`
- Modify: `app/supabase/tests/virtual_portfolio_capital.test.sql`
- Modify: `app/src/features/securities/backtest-signal-inbox-store.ts`
- Modify: `app/src/features/securities/backtest-signal-inbox-store.test.ts`

**Interfaces:**
- Produces: generalized T-cycle ownership with exactly one actual or virtual position; message kinds `virtual_t_sell`, `virtual_t_buyback`, `virtual_t_cash_blocked`, and `virtual_t_expiry_risk`.
- Preserves: every existing `actual_t_*` contract.

- [ ] **Step 1: Write failing SQL and parser tests**

```sql
select lives_ok(
  $$ select public.commit_t_trade_signal(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000001',
    'position_scope', 'virtual', 'virtual_position_id', :'virtual_position_id',
    'code', '000001', 'signal_kind', 'virtual_t_sell',
    'suggested_shares', 100, 'price', 12, 'signal_at', '2026-08-19T02:00:00Z'
  )) $$,
  'virtual position can open a T sell signal'
);
```

```ts
expect(parseTTradeAlertPayload('virtual_t_cash_blocked', metadata, cycleId)).toMatchObject({
  kind: 'virtual_t_cash_blocked', cycleId,
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run src/features/securities/backtest-signal-inbox-store.test.ts
npx supabase test db supabase/tests/actual_position_t_trading.test.sql
npx supabase test db supabase/tests/virtual_portfolio_capital.test.sql
```

Expected: FAIL because T cycles only accept actual positions and message unions reject virtual kinds.

- [ ] **Step 3: Implement generalized ownership without breaking actual positions**

Add `position_scope text not null default 'actual'`, nullable `position_id`, and nullable `virtual_position_id` with a check that exactly one matches the scope. Backfill existing rows as `actual`. Update indexes and idempotency keys to include scope.

Update T signal parsing and labels, but keep virtual T messages non-executable by the actual-position confirmation dialog; virtual execution is handled by the atomic cloud RPC.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same Vitest and pgTAP commands from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit generalized T ownership**

```powershell
git add app/supabase/migrations/202608180001_virtual_portfolio_capital_and_t_trading.sql app/supabase/tests/actual_position_t_trading.test.sql app/supabase/tests/virtual_portfolio_capital.test.sql app/src/features/securities/backtest-signal-inbox-store.ts app/src/features/securities/backtest-signal-inbox-store.test.ts
git commit -m "feat: support virtual position T cycles"
```

---

### Task 8: Scan every virtual holding and execute fee-aware virtual T cycles

**Files:**
- Modify: `app/worker/supabase-repository.ts`
- Modify: `app/worker/supabase-repository.test.ts`
- Modify: `app/worker/t-trading-runner.ts`
- Modify: `app/worker/t-trading-runner.test.ts`
- Modify: `app/worker/t-trading-evaluator.ts`
- Modify: `app/worker/t-trading-evaluator.test.ts`
- Modify: `app/worker/runtime-repository.ts`
- Modify: `app/worker/runtime-repository.test.ts`
- Modify: `app/supabase/migrations/202608180001_virtual_portfolio_capital_and_t_trading.sql`
- Modify: `app/supabase/tests/virtual_portfolio_capital.test.sql`

**Interfaces:**
- Consumes: generalized T ownership, existing market structure, calibration, fee engine, and locked cloud cash account.
- Produces: one scan over all actual and virtual positions; automatic virtual T sell/buyback transitions.

- [ ] **Step 1: Write failing worker tests for complete virtual coverage**

```ts
it('scans every open virtual position even when it is absent from watchlists', async () => {
  repository.loadMonitoringAssignments.mockResolvedValue([
    assignment({ watchlistCodes: [], actualPositions: [], virtualPositions: [virtual('000001'), virtual('000002')] }),
  ]);
  await runTTradingScan(deps);
  expect(evaluate).toHaveBeenCalledTimes(2);
  expect(marketData.fetchQuotes).toHaveBeenCalledWith(['000001', '000002']);
});

it('uses one quote request for duplicate actual and virtual codes', async () => {
  repository.loadMonitoringAssignments.mockResolvedValue([
    assignment({ actualPositions: [actual('000001')], virtualPositions: [virtual('000001')] }),
  ]);
  await runTTradingScan(deps);
  expect(marketData.fetchQuotes).toHaveBeenCalledWith(['000001']);
  expect(evaluate).toHaveBeenCalledTimes(2);
});

it('returns virtual_t_cash_blocked when a buyback exceeds shared cash', async () => {
  const result = await evaluator(input({ scope: 'virtual', cashBalance: 300, remainingBuybackShares: 100, quotePrice: 10 }));
  expect(result?.signalKind).toBe('virtual_t_cash_blocked');
});
```

- [ ] **Step 2: Run worker tests and verify RED**

Run:

```powershell
npx vitest run worker/supabase-repository.test.ts worker/t-trading-runner.test.ts worker/t-trading-evaluator.test.ts worker/runtime-repository.test.ts
```

Expected: FAIL because the runner only iterates `actualPositions`.

- [ ] **Step 3: Implement scoped candidates and atomic virtual T execution**

Introduce:

```ts
export interface WorkerTTradePositionSnapshot {
  scope: 'actual' | 'virtual';
  id: string;
  userId: string;
  code: string;
  name: string;
  shares: number;
  availableShares: number;
  averageCost: number;
  openedAt: string;
}
```

Build candidates from both arrays. Deduplicate only quote codes, not position evaluations. For virtual positions, use the same `evaluateTTradeSell()` and `evaluateTTradeBuyback()` calculations, but emit `virtual_t_*` kinds and include `position_scope`, `virtual_position_id`, fee profile, average daily amount, and cash requirement.

The database transition must:

- sell only matured virtual lots;
- credit net sell proceeds to shared cash;
- open a virtual T cycle bound to the virtual position;
- buy back only if gross amount plus fees fits locked shared cash;
- keep the cycle open and emit `virtual_t_cash_blocked` when cash is insufficient;
- calculate realized T profit only on matched shares after both-side fees.

- [ ] **Step 4: Run worker and SQL tests and verify GREEN**

Run:

```powershell
npx vitest run worker/supabase-repository.test.ts worker/t-trading-runner.test.ts worker/t-trading-evaluator.test.ts worker/runtime-repository.test.ts
npx supabase test db supabase/tests/virtual_portfolio_capital.test.sql
```

Expected: PASS.

- [ ] **Step 5: Commit virtual T scanning**

```powershell
git add app/worker app/supabase/migrations/202608180001_virtual_portfolio_capital_and_t_trading.sql app/supabase/tests/virtual_portfolio_capital.test.sql
git commit -m "feat: run T trading for all virtual holdings"
```

---

### Task 9: Add capital summary and cleanup confirmation UI

**Files:**
- Create: `app/src/features/securities/VirtualCapitalCleanupDialog.tsx`
- Create: `app/src/features/securities/VirtualCapitalCleanupDialog.test.tsx`
- Modify: `app/src/features/securities/ForwardSimulationPanel.tsx`
- Modify: `app/src/features/securities/ForwardSimulationPanel.test.tsx`
- Modify: `app/src/features/securities/cloud/CloudSignalInbox.tsx`
- Modify: `app/src/features/securities/cloud/CloudSignalInbox.test.tsx`

**Interfaces:**
- Consumes: cash summary and cleanup APIs from Task 6.
- Produces: visible capital cards, cleanup preview, explicit typed confirmation, and virtual T blocked messages.

- [ ] **Step 1: Write failing UI tests**

```tsx
it('shows shared capital separately from market value', () => {
  render(<ForwardSimulationPanel ledger={ledger({ cashBalance: 73120 })} prices={{ '000001': 30 }} {...handlers} />);
  expect(screen.getByText('初始本金')).toBeInTheDocument();
  expect(screen.getByText('¥200,000.00')).toBeInTheDocument();
  expect(screen.getByText('可用现金')).toBeInTheDocument();
  expect(screen.getByText('¥73,120.00')).toBeInTheDocument();
  expect(screen.getByText('当前市值')).toBeInTheDocument();
});

it('does not apply cleanup until the user confirms the exact preview', async () => {
  render(<VirtualCapitalCleanupDialog preview={preview} onApply={onApply} onCancel={onCancel} />);
  await user.click(screen.getByRole('button', { name: '执行账本清理' }));
  expect(onApply).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('确认文字'), '确认清理超额虚拟交易');
  await user.click(screen.getByRole('button', { name: '执行账本清理' }));
  expect(onApply).toHaveBeenCalledWith(preview.previewId, preview.snapshotHash);
});
```

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```powershell
npx vitest run src/features/securities/ForwardSimulationPanel.test.tsx src/features/securities/VirtualCapitalCleanupDialog.test.tsx src/features/securities/cloud/CloudSignalInbox.test.tsx
```

Expected: FAIL because the capital cards and cleanup dialog do not exist.

- [ ] **Step 3: Implement the UI with no automatic cleanup**

Display seven values: initial capital, available cash, invested cost, current market value, unrealized P/L, capital utilization, and open T-cycle count. Add “预演20万本金账本清理”; the first action calls preview only. Require the exact Chinese confirmation phrase before apply. Disable apply if the preview is stale, contains a fee-profile blocker, or the RPC is pending.

Render `virtual_cash_insufficient` and `virtual_t_cash_blocked` as explanatory messages with required cash, available cash, and gap. Do not route virtual T messages into the actual-position execution dialog.

- [ ] **Step 4: Run UI tests and verify GREEN**

Run the same Vitest command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit the capital UI**

```powershell
git add app/src/features/securities/VirtualCapitalCleanupDialog.tsx app/src/features/securities/VirtualCapitalCleanupDialog.test.tsx app/src/features/securities/ForwardSimulationPanel.tsx app/src/features/securities/ForwardSimulationPanel.test.tsx app/src/features/securities/cloud/CloudSignalInbox.tsx app/src/features/securities/cloud/CloudSignalInbox.test.tsx
git commit -m "feat: add virtual capital controls"
```

---

### Task 10: Integrate strategy review and operational diagnostics

**Files:**
- Modify: `app/src/features/securities/strategy-learning/daily-snapshot-builder.ts`
- Modify: `app/src/features/securities/strategy-learning/daily-snapshot-builder.test.ts`
- Modify: `app/src/features/securities/strategy-learning/daily-review-orchestrator.ts`
- Modify: `app/src/features/securities/strategy-learning/daily-review-orchestrator.test.ts`
- Modify: `docs/live-trading/eastmoney-shadow-runbook.md`

**Interfaces:**
- Consumes: ledger V2 cash/fee snapshots and virtual T cycles.
- Produces: daily review fields for rejected buys, cash utilization, T net profit, blocked buybacks, and cleanup audit guidance.

- [ ] **Step 1: Write failing review tests**

```ts
it('records cash-blocked signals and fee-adjusted virtual T outcomes', () => {
  const snapshot = buildDailySnapshot(input({
    cashBalance: 1500,
    alerts: [cashBlockedAlert('000001')],
    virtualTCycles: [closedVirtualTCycle({ netProfit: 82.5, totalFees: 17.5 })],
  }));
  expect(snapshot.virtualPortfolio).toMatchObject({
    initialCapital: 200000,
    cashBalance: 1500,
    cashBlockedSignalCount: 1,
    virtualTNetProfit: 82.5,
  });
});
```

- [ ] **Step 2: Run review tests and verify RED**

Run:

```powershell
npx vitest run src/features/securities/strategy-learning/daily-snapshot-builder.test.ts src/features/securities/strategy-learning/daily-review-orchestrator.test.ts
```

Expected: FAIL because cash and virtual T metrics are not in the snapshot.

- [ ] **Step 3: Add review metrics without changing strategy parameters automatically**

Record capital utilization, rejected trade count, rejected cash amount, realized virtual T net profit, T fees, and blocked buybacks. These metrics may inform review text but must not automatically increase capital, bypass cash checks, or alter live strategy parameters.

Document local Supabase reset/test commands, preview verification, production backup, apply confirmation, rollback-by-backup procedure, and post-apply invariants. State explicitly that OCR and live execution are out of scope.

- [ ] **Step 4: Run review tests and verify GREEN**

Run the same Vitest command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit review integration and runbook**

```powershell
git add app/src/features/securities/strategy-learning/daily-snapshot-builder.ts app/src/features/securities/strategy-learning/daily-snapshot-builder.test.ts app/src/features/securities/strategy-learning/daily-review-orchestrator.ts app/src/features/securities/strategy-learning/daily-review-orchestrator.test.ts docs/live-trading/eastmoney-shadow-runbook.md
git commit -m "feat: review virtual capital and T outcomes"
```

---

### Task 11: Full local verification and production-change gate

**Files:**
- Verify only; modify files only if a failing test exposes a defect covered by this plan.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a local verification report and a production cleanup preview request; no deployment.

- [ ] **Step 1: Run the complete focused securities and worker suite**

```powershell
npx vitest run src/features/securities/virtual-cash-account.test.ts src/features/securities/virtual-trading-ledger.test.ts src/features/securities/virtual-history-replay.test.ts src/features/securities/backtest-signal-trading-runtime.test.ts src/features/securities/useRealtimeBacktestMonitor.test.tsx src/features/securities/cloud/cloud-securities-repository.test.ts src/features/securities/ForwardSimulationPanel.test.tsx src/features/securities/VirtualCapitalCleanupDialog.test.tsx src/features/securities/cloud/CloudSignalInbox.test.tsx src/features/securities/strategy-learning/daily-snapshot-builder.test.ts src/features/securities/strategy-learning/daily-review-orchestrator.test.ts worker/supabase-repository.test.ts worker/t-trading-runner.test.ts worker/t-trading-evaluator.test.ts worker/runtime-repository.test.ts
```

Expected: PASS with no unhandled rejection or console error.

- [ ] **Step 2: Run all local database tests from a clean reset**

```powershell
npx supabase db reset
npx supabase test db
```

Expected: every pgTAP suite passes, including existing actual-position T-trading behavior.

- [ ] **Step 3: Run full application quality gates**

```powershell
npm run typecheck
npm run test
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Perform local manual regression without production cloud changes**

Start local Supabase, worker, and Electron development mode. Verify:

1. Two virtual stocks consume the same CNY 200,000 cash pool.
2. A buy crossing the remaining cash becomes a blocked inbox item and creates no position.
3. A matured virtual holding can emit a virtual T sell; same-day bought shares cannot.
4. Net sell proceeds increase shared cash.
5. A virtual T buyback is blocked when another stock has consumed the cash, and its cycle remains open.
6. Removing a virtual holding from watchlists does not remove it from T scans.
7. Cleanup preview shows retained/removed counts without deleting anything.
8. Actual positions, actual T execution, stock analysis, watchlists, OCR account reads, and shadow validation behave as before.

- [ ] **Step 5: Commit any verification-only test fixture changes**

```powershell
git status --short
git add app/src/features/securities app/worker app/supabase docs/live-trading/eastmoney-shadow-runbook.md
git commit -m "test: verify virtual portfolio capital controls"
```

Skip the commit when the worktree is clean.

- [ ] **Step 6: Stop before production deployment or cleanup**

Report:

- migration commit hash;
- TypeScript, SQL, lint, typecheck, and build results;
- local cleanup preview totals;
- whether any fees are estimated;
- exact production commands that would be run after approval.

Do not push, deploy, apply the Supabase migration, restart the production Railway worker, or delete production virtual history without a new explicit user approval.

