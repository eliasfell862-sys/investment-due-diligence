# Securities Fast Data Hydration Implementation Plan

**Goal:** Render securities, watchlist, and position rows immediately from minimal local/account data, then enrich them with cloud and realtime data.

**Architecture:** Add a 24-hour, per-account, 500 KB local snapshot utility for cloud watchlists and the position ledger. Consumers hydrate from this utility before cloud reads, while list components render placeholder rows independently of quote availability.

**Tech Stack:** React 19, TypeScript, localStorage, Supabase, Vitest.

## Constraints

- Cache never writes to Supabase.
- Do not cache quotes, K-lines, advice, reports, signals, or T-trading results.
- One snapshot per account, 24-hour TTL, 500 KB total cap.
- Clear the departing account snapshot on sign-out.
- Do not modify the stock analysis page or `stock-api.ts`.

### Task 1: Bounded account snapshot utility

- Create `app/src/features/securities/securities-account-cache.ts` and tests.
- Test account isolation, expiration, overwrite semantics, total size eviction, and account clear.
- Implement typed watchlist and ledger snapshot read/write APIs.

### Task 2: Cached cloud hydration

- Modify `useStockPositionLedgerBase.ts`, `WatchlistPage.tsx`, and `AuthProvider.tsx`.
- Hydrate current-account data from cache before cloud reads.
- Replace cache only after successful cloud reads.
- Clear the account cache during sign-out.

### Task 3: Progressive stock rows

- Modify `WatchlistPage.tsx` and `SecuritiesWorkbenchPageBase.tsx` plus tests.
- Render one row per known stock code immediately, with quote cells loading independently.
- Keep advice and T-trading calculations dependent on valid quotes and non-blocking.

### Task 4: Verification

- Run focused cache, watchlist, positions, authentication, monitor, and workbench tests.
- Run typecheck, lint, build, and localhost health check.