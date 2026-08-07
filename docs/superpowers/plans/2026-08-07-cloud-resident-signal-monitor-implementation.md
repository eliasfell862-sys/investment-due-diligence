# Cloud Resident Signal Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Supabase-backed, Railway-hosted securities signal monitor that continues scanning after the website closes and synchronizes alerts to the website inbox and browser push notifications.

**Architecture:** Keep the React/Vite application as the user-facing client, introduce Supabase Auth and PostgreSQL as the system of record, and run a single-leader Node worker on Railway. Extract browser-independent signal decisions into a shared TypeScript module used by both the local fallback monitor and the worker so signal behavior cannot diverge.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest, Supabase Auth/PostgreSQL/Realtime, Node.js 24, Railway, Web Push/VAPID.

## Global Constraints

- Do not modify the individual stock analysis page except for regression-safe shared imports.
- Monitor every active watchlist item, actual position, and open virtual position; never truncate the universe to four items.
- Target a three-second scan cadence only during A-share trading sessions; pause during lunch, close, weekends, and configured exchange holidays.
- Buy and add recommendations default to 100 shares; sells may be partial and must never exceed T+1 available shares.
- Persist the real-time quote observed at signal creation; do not replace it with a later quote.
- Cloud database rows are isolated by `user_id` with Row Level Security.
- Cloud alerts are authoritative; Web Push is a best-effort notification channel.
- Do not automatically place broker orders.
- Preserve all existing uncommitted user and Claude changes; stage and commit only files listed by the current task.
- Use test-driven development: every production behavior starts with a failing test that is observed failing for the expected reason.

---

## File Structure

### Frontend cloud infrastructure

- `app/src/infrastructure/cloud/supabase-client.ts`: validated singleton browser client.
- `app/src/infrastructure/cloud/cloud-environment.ts`: public environment parsing without secrets.
- `app/src/features/auth/AuthProvider.tsx`: session state and authentication actions.
- `app/src/features/auth/LoginPage.tsx`: email/password registration, login, reset request, and logout entry.
- `app/src/features/auth/RequireAuth.tsx`: route guard for cloud securities functions.
- `app/src/features/securities/cloud/cloud-securities-repository.ts`: typed Supabase reads and writes.
- `app/src/features/securities/cloud/local-cloud-migration.ts`: idempotent local data migration payload builder.
- `app/src/features/securities/cloud/useCloudSignalInbox.ts`: Realtime alert subscription and inbox mutations.
- `app/src/features/securities/cloud/useCloudWorkerStatus.ts`: heartbeat and scan-status subscription.
- `app/src/features/securities/cloud/push-subscription-service.ts`: service-worker registration and push subscription lifecycle.
- `app/public/signal-push-sw.js`: background notification display and click routing.

### Shared signal core

- `app/src/engines/market-analysis/cloud-signal-core.ts`: pure snapshot evaluation facade.
- `app/src/engines/market-analysis/signal-cycle-state.ts`: edge-triggered signal-cycle state machine and stable dedupe key.
- Existing `backtest-strategy.ts`, `technical-indicators.ts`, `a-share-trading-calendar.ts`, `virtual-trading-ledger.ts`, and `backtest-signal-trading-runtime.ts` remain the underlying rules.

### Database and worker

- `app/supabase/migrations/202608070001_cloud_signal_monitor.sql`: tables, constraints, indexes, RLS, and RPC functions.
- `app/supabase/tests/cloud_signal_monitor.test.sql`: pgTAP authorization, dedupe, and transaction tests.
- `app/worker/config.ts`: secret environment validation.
- `app/worker/types.ts`: worker repository and market-data interfaces.
- `app/worker/supabase-repository.ts`: service-role database adapter.
- `app/worker/market-data-provider.ts`: Node-compatible quote/K-line provider.
- `app/worker/monitoring-universe.ts`: global code deduplication and per-user projections.
- `app/worker/worker-lease.ts`: database-backed single-leader lease.
- `app/worker/scan-runner.ts`: one complete scan with bounded concurrency.
- `app/worker/scheduler.ts`: trading-session loop without overlapping scans.
- `app/worker/push-delivery.ts`: VAPID notification delivery.
- `app/worker/index.ts`: process entry point and graceful shutdown.
- `app/railway.json`: Railway start command and restart policy.

---

### Task 1: Cloud environment and Supabase client

**Files:**
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Create: `app/src/infrastructure/cloud/cloud-environment.ts`
- Create: `app/src/infrastructure/cloud/cloud-environment.test.ts`
- Create: `app/src/infrastructure/cloud/supabase-client.ts`

**Interfaces:**
- Produces: `readCloudEnvironment(env): CloudEnvironment | null`
- Produces: `getSupabaseClient(): SupabaseClient`
- Consumes: Vite variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_VAPID_PUBLIC_KEY`.

- [ ] **Step 1: Install client and worker dependencies**

Run:

```powershell
npm install @supabase/supabase-js web-push
npm install --save-dev @types/web-push tsx supabase
```

Expected: `package.json` and `package-lock.json` include exact dependency entries and no application source changes.

- [ ] **Step 2: Write the failing cloud environment test**

```ts
import { describe, expect, it } from 'vitest';
import { readCloudEnvironment } from './cloud-environment';

describe('readCloudEnvironment', () => {
  it('returns null when cloud monitoring is not configured', () => {
    expect(readCloudEnvironment({})).toBeNull();
  });

  it('returns the three public browser values', () => {
    expect(readCloudEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
      VITE_VAPID_PUBLIC_KEY: 'public-key',
    })).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      vapidPublicKey: 'public-key',
    });
  });
});
```

- [ ] **Step 3: Run the test and observe the expected failure**

Run: `npm test -- cloud-environment.test.ts`

Expected: FAIL because `cloud-environment.ts` does not exist.

- [ ] **Step 4: Implement strict public environment parsing**

```ts
export interface CloudEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
  vapidPublicKey: string;
}

export function readCloudEnvironment(env: Record<string, string | boolean | undefined>): CloudEnvironment | null {
  const supabaseUrl = String(env.VITE_SUPABASE_URL ?? '').trim();
  const supabaseAnonKey = String(env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  const vapidPublicKey = String(env.VITE_VAPID_PUBLIC_KEY ?? '').trim();
  if (!supabaseUrl && !supabaseAnonKey && !vapidPublicKey) return null;
  if (!supabaseUrl || !supabaseAnonKey || !vapidPublicKey) {
    throw new Error('Cloud monitoring environment is incomplete');
  }
  return { supabaseUrl, supabaseAnonKey, vapidPublicKey };
}
```

Create `supabase-client.ts` with a lazily initialized `createClient` call using `readCloudEnvironment(import.meta.env)` and throw `Cloud monitoring is not configured` only when a cloud-only action is requested.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- cloud-environment.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit only Task 1 files**

```powershell
git add app/package.json app/package-lock.json app/src/infrastructure/cloud/cloud-environment.ts app/src/infrastructure/cloud/cloud-environment.test.ts app/src/infrastructure/cloud/supabase-client.ts
git commit -m "feat: add Supabase client configuration"
```

---

### Task 2: Supabase schema, RLS, dedupe, and worker lease

**Files:**
- Create: `app/supabase/config.toml`
- Create: `app/supabase/migrations/202608070001_cloud_signal_monitor.sql`
- Create: `app/supabase/tests/cloud_signal_monitor.test.sql`

**Interfaces:**
- Produces tables: `profiles`, `watchlists`, `watchlist_items`, `position_groups`, `positions`, `position_lots`, `position_transactions`, `strategy_assignments`, `signal_states`, `signal_alerts`, `virtual_positions`, `virtual_lots`, `virtual_transactions`, `virtual_cycles`, `push_subscriptions`, `notification_deliveries`, `audit_events`, `worker_leases`, `worker_heartbeats`, `scan_runs`, `market_data_failures`.
- Produces RPC: `claim_worker_lease(p_worker_name text, p_owner_id text, p_ttl_seconds integer) returns boolean`.
- Produces RPC: `commit_signal_transition(p_payload jsonb) returns uuid`.

- [ ] **Step 1: Initialize local Supabase configuration**

Run: `npx supabase init`

Expected: `supabase/config.toml` exists. Keep generated local identifiers out of Git if they contain machine-specific values.

- [ ] **Step 2: Write failing pgTAP tests**

The SQL test must create two Auth users and assert all of the following:

```sql
select plan(5);
select policies_are('public', 'watchlist_items', array['watchlist_items_owner']);
select policies_are('public', 'signal_alerts', array['signal_alerts_owner']);
select has_unique('public', 'signal_alerts', array['user_id','code','strategy_id','strategy_version','action','intent','cycle_id']);
select function_returns('public', 'claim_worker_lease', array['text','text','integer'], 'boolean');
select function_returns('public', 'commit_signal_transition', array['jsonb'], 'uuid');
select * from finish();
```

- [ ] **Step 3: Run database tests and observe failure**

Run: `npx supabase start`

Run: `npx supabase test db`

Expected: FAIL because the migration and its database objects do not exist.

- [ ] **Step 4: Implement the migration**

Use UUID primary keys, `auth.users(id)` foreign keys with `on delete cascade`, UTC `timestamptz`, nonnegative share checks, 100-share lot checks for buy transactions, and the formal alert unique constraint:

```sql
unique (user_id, code, strategy_id, strategy_version, action, intent, cycle_id)
```

Enable RLS on every user-owned table. Each owner policy must use:

```sql
using (auth.uid() = user_id)
with check (auth.uid() = user_id)
```

`commit_signal_transition` must lock the matching `signal_states` row, insert the alert and optional virtual transaction atomically, update the state, append `audit_events`, and return the existing alert ID on a duplicate cycle.

- [ ] **Step 5: Verify schema tests**

Run: `npx supabase db reset`

Run: `npx supabase test db`

Expected: all pgTAP assertions PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add app/supabase/config.toml app/supabase/migrations/202608070001_cloud_signal_monitor.sql app/supabase/tests/cloud_signal_monitor.test.sql
git commit -m "feat: add cloud signal monitoring schema"
```

---

### Task 3: Email/password authentication and route session

**Files:**
- Create: `app/src/features/auth/AuthProvider.tsx`
- Create: `app/src/features/auth/AuthProvider.test.tsx`
- Create: `app/src/features/auth/LoginPage.tsx`
- Create: `app/src/features/auth/LoginPage.test.tsx`
- Create: `app/src/features/auth/RequireAuth.tsx`
- Modify: `app/src/main.tsx`
- Modify: `app/src/app/router.tsx`
- Modify: `app/src/app/AppShell.tsx`

**Interfaces:**
- Produces: `useAuth(): { user; loading; cloudEnabled; signIn; signUp; signOut; requestPasswordReset }`
- Produces: `/login` route.
- Securities routes require authentication only when cloud configuration exists; local unconfigured installations remain usable in local-only mode.

- [ ] **Step 1: Write the failing AuthProvider session test**

```tsx
it('restores the current session and reacts to auth changes', async () => {
  auth.getSession.mockResolvedValue({ data: { session: sessionA }, error: null });
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe('user-a'));
  authListener({ event: 'SIGNED_OUT', session: null });
  await waitFor(() => expect(result.current.user).toBeNull());
});
```

- [ ] **Step 2: Run the focused test and observe failure**

Run: `npm test -- AuthProvider.test.tsx`

Expected: FAIL because `AuthProvider` and `useAuth` do not exist.

- [ ] **Step 3: Implement AuthProvider and RequireAuth**

Use `supabase.auth.getSession()`, `onAuthStateChange`, `signInWithPassword`, `signUp`, `signOut`, and `resetPasswordForEmail`. `RequireAuth` redirects unauthenticated cloud users to `/login` and preserves the intended path in router state.

- [ ] **Step 4: Write and run LoginPage tests**

Cover email validation, password minimum length of eight characters, submitting login, switching to registration, and surfacing Supabase errors.

Run: `npm test -- LoginPage.test.tsx AuthProvider.test.tsx`

Expected before implementing the page: FAIL because the form is missing.

- [ ] **Step 5: Implement LoginPage and route wiring**

Wrap `<App />` in `<AuthProvider>`, add `/login`, protect securities routes through a common route element, and add a compact account control to `AppShell`. Do not change the stock analysis component.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- AuthProvider.test.tsx LoginPage.test.tsx`

Run: `npm run typecheck`

Expected: PASS.

```powershell
git add app/src/features/auth app/src/main.tsx app/src/app/router.tsx app/src/app/AppShell.tsx
git commit -m "feat: add cloud account authentication"
```

---

### Task 4: Idempotent migration of existing browser data

**Files:**
- Create: `app/src/features/securities/cloud/local-cloud-migration.ts`
- Create: `app/src/features/securities/cloud/local-cloud-migration.test.ts`
- Create: `app/src/features/securities/cloud/CloudMigrationPanel.tsx`
- Create: `app/src/features/securities/cloud/CloudMigrationPanel.test.tsx`
- Modify: `app/src/features/securities/SecuritiesWorkbenchPage.tsx`

**Interfaces:**
- Produces: `buildLocalMigration(storage, userId): CloudMigrationPayload`.
- Produces: `migrationId = sha256(userId + canonicalized local source IDs and versions)`.
- Consumes local keys `sec_watchlists_v2`, `sec_stock_position_ledger_v1`, and `sec_bt_signal_runtime_v3`.

- [ ] **Step 1: Write the failing deterministic migration test**

```ts
it('builds the same migration id for identical local data', () => {
  const first = buildLocalMigration(storageWithFixture(), 'user-a');
  const second = buildLocalMigration(storageWithFixture(), 'user-a');
  expect(first.migrationId).toBe(second.migrationId);
  expect(first.watchlistItems.map(item => item.code)).toEqual(['000001', '600519']);
  expect(first.positions[0]?.shares).toBe(300);
});
```

- [ ] **Step 2: Run and observe failure**

Run: `npm test -- local-cloud-migration.test.ts`

Expected: FAIL because the migration builder is missing.

- [ ] **Step 3: Implement migration parsing and canonicalization**

Use existing ledger/runtime loaders with injected storage. Convert local transactions into position lots by replaying buys and FIFO sells. Reject corrupted holdings instead of silently uploading inconsistent totals.

- [ ] **Step 4: Add failing panel tests**

Assert that the panel shows exact counts, requires explicit confirmation, calls the repository once, and records completion only after server confirmation.

- [ ] **Step 5: Implement the migration panel and server call**

Call a Supabase RPC named `import_local_securities_state` with `migration_id` and the payload. The RPC must use source IDs and unique constraints so retries are no-ops.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- local-cloud-migration.test.ts CloudMigrationPanel.test.tsx`

Expected: PASS.

```powershell
git add app/src/features/securities/cloud/local-cloud-migration.ts app/src/features/securities/cloud/local-cloud-migration.test.ts app/src/features/securities/cloud/CloudMigrationPanel.tsx app/src/features/securities/cloud/CloudMigrationPanel.test.tsx app/src/features/securities/SecuritiesWorkbenchPage.tsx app/supabase/migrations/202608070001_cloud_signal_monitor.sql app/supabase/tests/cloud_signal_monitor.test.sql
git commit -m "feat: migrate local securities data to cloud"
```

---

### Task 5: Cloud securities repository and actual-trade transactions

**Files:**
- Create: `app/src/features/securities/cloud/cloud-securities-repository.ts`
- Create: `app/src/features/securities/cloud/cloud-securities-repository.test.ts`
- Modify: `app/src/features/securities/WatchlistPage.tsx`
- Modify: `app/src/features/securities/WatchlistPage.test.tsx`
- Modify: `app/src/features/securities/ActualPositionsPanel.tsx`
- Modify: `app/src/features/securities/ActualPositionsPanel.test.tsx`
- Modify: `app/src/features/securities/SignalInbox.tsx`
- Modify: `app/src/features/securities/SignalInbox.test.tsx`

**Interfaces:**
- Produces repository methods `loadUniverse`, `saveWatchlists`, `loadPositionLedger`, `executeBuy`, `executeSell`, `markAlertRead`, and `markAlertExecuted`.
- `executeBuy` and `executeSell` call database RPCs that atomically update positions, lots, transactions, signal status, and audit events.

- [ ] **Step 1: Write failing repository mapping tests**

Test exact conversion between Supabase snake_case rows and existing frontend `StockPositionLedger` and `BacktestSignalAlertV3` types. Include a 300-share position with only 200 shares available.

- [ ] **Step 2: Run and observe failure**

Run: `npm test -- cloud-securities-repository.test.ts`

Expected: FAIL because the repository is missing.

- [ ] **Step 3: Implement typed repository methods**

All methods derive `user_id` from the authenticated session, never accept it from UI components. Surface Supabase error messages as `CloudSecuritiesError` with operation and retryability fields.

- [ ] **Step 4: Add failing component integration tests**

Assert that watchlist edits and actual trades call cloud repository methods in cloud mode, retain local methods in unconfigured local mode, and refresh the cloud ledger after execution.

- [ ] **Step 5: Implement cloud/local data-source selection**

Introduce a provider that selects `CloudSecuritiesRepository` when an authenticated cloud session exists and existing local storage functions otherwise. Preserve current UI and stock-analysis routes.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- cloud-securities-repository.test.ts WatchlistPage.test.tsx ActualPositionsPanel.test.tsx SignalInbox.test.tsx`

Expected: PASS.

```powershell
git add app/src/features/securities/cloud/cloud-securities-repository.ts app/src/features/securities/cloud/cloud-securities-repository.test.ts app/src/features/securities/WatchlistPage.tsx app/src/features/securities/WatchlistPage.test.tsx app/src/features/securities/ActualPositionsPanel.tsx app/src/features/securities/ActualPositionsPanel.test.tsx app/src/features/securities/SignalInbox.tsx app/src/features/securities/SignalInbox.test.tsx
git commit -m "feat: persist securities activity in cloud"
```

---

### Task 6: Extract the shared signal cycle core

**Files:**
- Create: `app/src/engines/market-analysis/signal-cycle-state.ts`
- Create: `app/src/engines/market-analysis/signal-cycle-state.test.ts`
- Create: `app/src/engines/market-analysis/cloud-signal-core.ts`
- Create: `app/src/engines/market-analysis/cloud-signal-core.test.ts`
- Modify: `app/src/features/securities/realtime-backtest-monitor.ts`
- Modify: `app/src/features/securities/backtest-signal-trading-runtime.ts`
- Modify: corresponding existing tests.

**Interfaces:**
- Produces: `transitionSignalCycle(previous, decision): SignalCycleTransition`.
- Produces: `evaluateCloudSignalSnapshot(input): CloudSignalDecision[]`.
- Signal transitions are `opened`, `continued`, `closed`, and `reversed`.

- [ ] **Step 1: Write the failing cycle-state tests**

```ts
it('opens once, suppresses continuation, and opens a new cycle after reset', () => {
  const first = transitionSignalCycle(emptyState('000001'), buyDecision('2026-08-07T01:30:00Z'));
  expect(first.kind).toBe('opened');
  const repeated = transitionSignalCycle(first.state, buyDecision('2026-08-07T01:30:03Z'));
  expect(repeated.kind).toBe('continued');
  const reset = transitionSignalCycle(repeated.state, holdDecision('2026-08-07T01:30:06Z'));
  const next = transitionSignalCycle(reset.state, buyDecision('2026-08-07T01:31:00Z'));
  expect(next.kind).toBe('opened');
  expect(next.cycleId).not.toBe(first.cycleId);
});
```

- [ ] **Step 2: Run and observe failure**

Run: `npm test -- signal-cycle-state.test.ts`

Expected: FAIL because the state machine is missing.

- [ ] **Step 3: Implement the pure cycle state machine**

Generate deterministic cycle IDs from code, action, intent, strategy version, and the opening timestamp. Do not use `Math.random()` in dedupe identity.

- [ ] **Step 4: Write parity tests for cloud and local evaluation**

Feed the same K-lines, quote, actual position, virtual position, and strategy config through the extracted facade and existing monitor. Assert matching actions, quantities, reasons, stop loss, and T+1 outcome.

- [ ] **Step 5: Refactor local monitor to call the shared core**

Keep the existing `RealtimeBacktestMonitor` public interface. Replace duplicated decision assembly with `evaluateCloudSignalSnapshot` without changing stock-analysis behavior.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- signal-cycle-state.test.ts cloud-signal-core.test.ts realtime-backtest-monitor.test.ts backtest-signal-trading-runtime.test.ts backtest-signal-t1-pending.test.ts`

Expected: PASS.

```powershell
git add app/src/engines/market-analysis/signal-cycle-state.ts app/src/engines/market-analysis/signal-cycle-state.test.ts app/src/engines/market-analysis/cloud-signal-core.ts app/src/engines/market-analysis/cloud-signal-core.test.ts app/src/features/securities/realtime-backtest-monitor.ts app/src/features/securities/realtime-backtest-monitor.test.ts app/src/features/securities/backtest-signal-trading-runtime.ts app/src/features/securities/backtest-signal-trading-runtime.test.ts app/src/features/securities/backtest-signal-t1-pending.test.ts
git commit -m "refactor: share cloud and local signal decisions"
```

---

### Task 7: Worker configuration, repository, and monitoring universe

**Files:**
- Create: `app/worker/config.ts`
- Create: `app/worker/config.test.ts`
- Create: `app/worker/types.ts`
- Create: `app/worker/supabase-repository.ts`
- Create: `app/worker/supabase-repository.test.ts`
- Create: `app/worker/monitoring-universe.ts`
- Create: `app/worker/monitoring-universe.test.ts`

**Interfaces:**
- Produces: `readWorkerConfig(process.env): WorkerConfig`.
- Produces: `loadMonitoringAssignments(): Promise<UserMonitoringAssignment[]>`.
- Produces: `buildGlobalUniverse(assignments): { codes: string[]; byUser: Map<string, UserMonitoringAssignment> }`.

- [ ] **Step 1: Write failing secret validation tests**

Require `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and `WORKER_INSTANCE_ID`. Verify the service-role key is never read from a `VITE_` variable.

- [ ] **Step 2: Run and observe failure**

Run: `npm test -- worker/config.test.ts worker/monitoring-universe.test.ts`

Expected: FAIL because worker modules do not exist.

- [ ] **Step 3: Implement config and universe aggregation**

Normalize six-digit codes, union watchlists/actual positions/virtual positions, and return all codes sorted. Preserve per-user membership sets so the scanner evaluates only authorized assignments.

- [ ] **Step 4: Write repository contract tests**

Use a fake Supabase client and assert the repository loads strategy assignments, lots, open virtual positions, and pending T+1 sells. A partial table failure must reject the assignment load rather than return incomplete holdings.

- [ ] **Step 5: Implement the service-role repository**

Keep SQL mapping in this file; do not import React or browser storage modules.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- worker/config.test.ts worker/supabase-repository.test.ts worker/monitoring-universe.test.ts`

Expected: PASS.

```powershell
git add app/worker/config.ts app/worker/config.test.ts app/worker/types.ts app/worker/supabase-repository.ts app/worker/supabase-repository.test.ts app/worker/monitoring-universe.ts app/worker/monitoring-universe.test.ts
git commit -m "feat: add cloud monitor worker repository"
```

---

### Task 8: Node market data, lease, and non-overlapping scheduler

**Files:**
- Create: `app/worker/market-data-provider.ts`
- Create: `app/worker/market-data-provider.test.ts`
- Create: `app/worker/worker-lease.ts`
- Create: `app/worker/worker-lease.test.ts`
- Create: `app/worker/scheduler.ts`
- Create: `app/worker/scheduler.test.ts`

**Interfaces:**
- Produces: `fetchQuotes(codes): Promise<Record<string, StockQuote>>` in batches of at most 80.
- Produces: `fetchHistory(code): Promise<StockKLine[]>` with per-code trading-date cache.
- Produces: `runTradingScheduler(deps): Promise<void>` with one active scan at a time.

- [ ] **Step 1: Write failing market-data batching tests**

Test 161 unique codes produce three requests of 80, 80, and 1; duplicated codes are requested once; invalid or zero-price rows are returned as failures, not valid quotes.

- [ ] **Step 2: Write failing scheduler tests**

Use a fake clock to assert trading scans target three seconds, lunch schedules the next afternoon window, weekend schedules Monday, and a five-second scan does not overlap a second scan.

- [ ] **Step 3: Run and observe failures**

Run: `npm test -- worker/market-data-provider.test.ts worker/worker-lease.test.ts worker/scheduler.test.ts`

Expected: FAIL because the provider, lease, and scheduler are missing.

- [ ] **Step 4: Implement Node-compatible HTTP providers**

Use `fetch` with `AbortSignal.timeout`, parse Tencent quotes and Tencent/Sina K-lines with the existing pure parsers, cap concurrent history loads at four, and expose per-code failures.

- [ ] **Step 5: Implement lease and scheduler**

Acquire and renew `cloud-signal-monitor` through `claim_worker_lease`. If renewal fails, stop scanning until the lease can be reacquired. Use a recursive `setTimeout` scheduled after each completed scan rather than `setInterval`.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- worker/market-data-provider.test.ts worker/worker-lease.test.ts worker/scheduler.test.ts`

Expected: PASS.

```powershell
git add app/worker/market-data-provider.ts app/worker/market-data-provider.test.ts app/worker/worker-lease.ts app/worker/worker-lease.test.ts app/worker/scheduler.ts app/worker/scheduler.test.ts
git commit -m "feat: schedule resilient cloud market scans"
```

---

### Task 9: Complete scan runner and atomic signal persistence

**Files:**
- Create: `app/worker/scan-runner.ts`
- Create: `app/worker/scan-runner.test.ts`
- Modify: `app/worker/supabase-repository.ts`
- Modify: `app/worker/supabase-repository.test.ts`
- Modify: `app/supabase/migrations/202608070001_cloud_signal_monitor.sql`
- Modify: `app/supabase/tests/cloud_signal_monitor.test.sql`

**Interfaces:**
- Produces: `runScan(deps, now): Promise<ScanSummary>`.
- `ScanSummary` contains `uniqueCodes`, `assignmentCount`, `successCount`, `failureCount`, `openedSignals`, `durationMs`, and `quoteAt`.

- [ ] **Step 1: Write the failing full-scan tests**

Cover 36 watchlist codes plus actual and virtual positions, one code failure, a new buy edge, a continued buy, an actual partial sell, a T+1 pending virtual sell, and a stop-loss sell. Assert every created alert stores the quote passed into that scan.

- [ ] **Step 2: Run and observe failure**

Run: `npm test -- worker/scan-runner.test.ts`

Expected: FAIL because `runScan` is missing.

- [ ] **Step 3: Implement one complete scan**

Load assignments once, build the global universe, fetch each quote once, load/cache histories, call `evaluateCloudSignalSnapshot`, transition each user's persistent state, and commit only `opened`, `closed`, or T+1 status transitions. A single code failure increments `failureCount` and processing continues.

- [ ] **Step 4: Add concurrency and restart database tests**

Use pgTAP to call `commit_signal_transition` twice with the same cycle and assert one alert ID. Persist a `buy` state, simulate a worker restart, call again, and assert no second alert.

- [ ] **Step 5: Verify all scan and SQL tests**

Run: `npm test -- worker/scan-runner.test.ts worker/supabase-repository.test.ts cloud-signal-core.test.ts`

Run: `npx supabase test db`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add app/worker/scan-runner.ts app/worker/scan-runner.test.ts app/worker/supabase-repository.ts app/worker/supabase-repository.test.ts app/supabase/migrations/202608070001_cloud_signal_monitor.sql app/supabase/tests/cloud_signal_monitor.test.sql
git commit -m "feat: persist cloud signal transitions"
```

---

### Task 10: Web Push delivery and device management

**Files:**
- Create: `app/worker/push-delivery.ts`
- Create: `app/worker/push-delivery.test.ts`
- Create: `app/src/features/securities/cloud/push-subscription-service.ts`
- Create: `app/src/features/securities/cloud/push-subscription-service.test.ts`
- Create: `app/public/signal-push-sw.js`
- Create: `app/src/features/securities/cloud/PushNotificationSettings.tsx`
- Create: `app/src/features/securities/cloud/PushNotificationSettings.test.tsx`

**Interfaces:**
- Produces worker `deliverSignalPush(alert, subscriptions): PushDeliveryResult[]`.
- Produces browser `enableSignalPush(userId): Promise<PushSubscriptionRecord>`.

- [ ] **Step 1: Write failing worker push tests**

Assert payload fields are code, name, action, intent, suggested shares, signal price, reasons, and alert URL. An HTTP 404 or 410 marks the subscription expired; another failure records an error but keeps the alert.

- [ ] **Step 2: Write failing browser subscription tests**

Assert permission is requested only after user action, the service worker is registered at `/signal-push-sw.js`, the VAPID key is used, and disabling removes both browser and database subscriptions.

- [ ] **Step 3: Run and observe failures**

Run: `npm test -- worker/push-delivery.test.ts push-subscription-service.test.ts PushNotificationSettings.test.tsx`

Expected: FAIL because push modules do not exist.

- [ ] **Step 4: Implement worker and browser push services**

Configure `webpush.setVapidDetails(subject, publicKey, privateKey)` only in the worker. Store browser endpoints and keys in `push_subscriptions`; never store the VAPID private key in Supabase or Vite client code.

- [ ] **Step 5: Implement the service worker**

```js
self.addEventListener('push', event => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(payload.title || '证券信号提醒', {
    body: payload.body || '新的交易信号已写入收件箱',
    data: { url: payload.url || '/securities' },
    tag: payload.alertId || 'cloud-signal',
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

- [ ] **Step 6: Verify and commit**

Run: `npm test -- worker/push-delivery.test.ts push-subscription-service.test.ts PushNotificationSettings.test.tsx`

Expected: PASS.

```powershell
git add app/worker/push-delivery.ts app/worker/push-delivery.test.ts app/src/features/securities/cloud/push-subscription-service.ts app/src/features/securities/cloud/push-subscription-service.test.ts app/src/features/securities/cloud/PushNotificationSettings.tsx app/src/features/securities/cloud/PushNotificationSettings.test.tsx app/public/signal-push-sw.js
git commit -m "feat: send browser signal notifications"
```

---

### Task 11: Cloud inbox subscription, health status, and local fallback

**Files:**
- Create: `app/src/features/securities/cloud/useCloudSignalInbox.ts`
- Create: `app/src/features/securities/cloud/useCloudSignalInbox.test.tsx`
- Create: `app/src/features/securities/cloud/useCloudWorkerStatus.ts`
- Create: `app/src/features/securities/cloud/useCloudWorkerStatus.test.tsx`
- Modify: `app/src/features/securities/RealtimeBacktestMonitorProvider.tsx`
- Modify: `app/src/features/securities/SignalInbox.tsx`
- Modify: `app/src/features/securities/SignalInbox.test.tsx`

**Interfaces:**
- Produces cloud inbox state compatible with current `SignalInbox` rendering.
- Produces worker status `online | delayed | degraded | offline` from heartbeat and latest scan.
- Local formal signal generation is disabled while cloud status is `online` or `delayed`.

- [ ] **Step 1: Write failing Realtime subscription tests**

Test initial alert loading, INSERT delivery, UPDATE delivery, reconnect catch-up, mark-read, and no duplicate alert IDs.

- [ ] **Step 2: Write failing status tests**

Given a three-second target cadence, classify a heartbeat under 15 seconds as online, 15-60 seconds as delayed, over 60 seconds as offline, and a recent scan with failures as degraded.

- [ ] **Step 3: Run and observe failures**

Run: `npm test -- useCloudSignalInbox.test.tsx useCloudWorkerStatus.test.tsx SignalInbox.test.tsx`

Expected: FAIL because cloud hooks and status copy do not exist.

- [ ] **Step 4: Implement cloud hooks and provider selection**

Subscribe to `signal_alerts`, `worker_heartbeats`, and `scan_runs`. When cloud is healthy, the current local monitor may still provide live prices but must not commit formal alerts or virtual trades. When cloud is offline, show a user-controlled “本地临时扫描” action rather than silently switching.

- [ ] **Step 5: Update inbox status presentation**

Display cloud state, last heartbeat, last scan, quote time, all monitored counts, successes, failures, and opened signals. When there are no alerts, show `最近一轮已扫描 N 只，未触发新的买入/补仓/卖出条件`.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- useCloudSignalInbox.test.tsx useCloudWorkerStatus.test.tsx SignalInbox.test.tsx RealtimeBacktestMonitorProvider.test.tsx useRealtimeBacktestMonitor.test.tsx`

Expected: PASS.

```powershell
git add app/src/features/securities/cloud/useCloudSignalInbox.ts app/src/features/securities/cloud/useCloudSignalInbox.test.tsx app/src/features/securities/cloud/useCloudWorkerStatus.ts app/src/features/securities/cloud/useCloudWorkerStatus.test.tsx app/src/features/securities/RealtimeBacktestMonitorProvider.tsx app/src/features/securities/SignalInbox.tsx app/src/features/securities/SignalInbox.test.tsx
git commit -m "feat: synchronize cloud signal inbox"
```

---

### Task 12: Worker entry point, Railway deployment, and end-to-end verification

**Files:**
- Create: `app/worker/index.ts`
- Create: `app/worker/index.test.ts`
- Create: `app/railway.json`
- Create: `app/.env.example`
- Modify: `app/package.json`
- Modify: `app/README.md`
- Modify: `app/vercel.json`

**Interfaces:**
- Produces commands `npm run worker:start`, `npm run worker:test`, and `npm run check:cloud`.
- Railway runs exactly one worker process; database lease remains the duplicate-execution safeguard.

- [ ] **Step 1: Write failing process lifecycle test**

Assert the entry point validates secrets, acquires the lease, starts the scheduler, writes heartbeats, and on SIGTERM stops scheduling, waits for the current scan, releases the lease, and exits cleanly.

- [ ] **Step 2: Run and observe failure**

Run: `npm test -- worker/index.test.ts`

Expected: FAIL because the worker entry point does not exist.

- [ ] **Step 3: Implement worker entry and scripts**

Add:

```json
{
  "worker:start": "tsx worker/index.ts",
  "worker:test": "vitest run worker",
  "check:cloud": "npm run typecheck && npm test -- worker src/features/auth src/features/securities/cloud && npm run lint"
}
```

`railway.json` must start `npm run worker:start` from the `app` directory and restart on failure with a bounded retry policy.

- [ ] **Step 4: Document environment and deployment sequence**

`.env.example` lists public variable names and server secret names with empty values. `README.md` documents Supabase migration, Auth redirect URLs, VAPID generation, Vercel public variables, Railway secrets, health verification, and rollback. Never include real keys.

- [ ] **Step 5: Run full automated verification**

Run: `npm run typecheck`

Run: `npm test`

Run: `npm run lint`

Run: `npx supabase test db`

Run: `npm run build`

Expected: all commands PASS with no new warnings.

- [ ] **Step 6: Perform local cloud integration verification**

Start local Supabase, run the Worker against local keys, create a test user, import a fixture watchlist, inject a deterministic test quote/K-line provider, close the browser tab, and verify:

1. Worker creates one alert while the page is closed.
2. Repeating the same signal creates no duplicate.
3. Reopening the page displays the unread alert.
4. Push delivery is attempted for the subscribed test device.
5. A 300-share same-day position displays total 300 and available 0.

- [ ] **Step 7: Run stock-page regression set**

Run:

```powershell
npm test -- StockAnalysisPage.test.tsx StockAnalysisRealtimeTargets.test.tsx SignalInbox.test.tsx WatchlistPage.test.tsx ActualPositionsPanel.test.tsx useRealtimeBacktestMonitor.test.tsx realtime-backtest-monitor.test.ts backtest-signal-trading-runtime.test.ts backtest-signal-t1-pending.test.ts
```

Expected: PASS; individual stock overview, K-line data, target prices, and navigation remain intact.

- [ ] **Step 8: Commit deployment files**

```powershell
git add app/worker/index.ts app/worker/index.test.ts app/railway.json app/.env.example app/package.json app/package-lock.json app/README.md app/vercel.json
git commit -m "feat: deploy cloud resident signal monitor"
```

---

## Final Acceptance Checklist

- [ ] A cloud test signal is generated after the website has been closed for at least 30 minutes.
- [ ] Reopening the website synchronizes the unread alert from Supabase.
- [ ] An authorized browser receives the Web Push notification.
- [ ] The alert stores the trigger quote, quantity, reasons, strategy ID, strategy version, and timestamp.
- [ ] A continued signal does not repeat every three seconds; reset and re-entry produce a new cycle.
- [ ] All watchlists, actual positions, and open virtual positions are scanned without fixed truncation.
- [ ] Buy/add defaults to 100 shares; partial sells and T+1 availability remain correct.
- [ ] Worker restart and duplicate worker instances do not duplicate alerts or virtual trades.
- [ ] RLS prevents cross-user reads and writes.
- [ ] Push failure never deletes or rolls back the cloud inbox alert.
- [ ] Existing stock analysis, K-line, overview, watchlist, position, inbox, and strategy-learning regressions pass.
- [ ] No Supabase service key, VAPID private key, password, or real credential exists in Git history.
