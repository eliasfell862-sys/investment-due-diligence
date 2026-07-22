# Investment Due Diligence Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect persistent projects, local Excel evidence, conflict-aware readiness, and navigable project pages into one offline vertical slice without starting Word, valuation, or AI features.

**Architecture:** Keep domain validation and conflict policy separate from IndexedDB orchestration. Persist through small repositories, keep the hardened Data Room upload state machine intact while injecting Worker inspection and evidence writes, and use route-level live queries to feed the existing Task 9 dashboard UI.

**Tech Stack:** React 19, React Router 7, Dexie/Dexie React Hooks, Zod, Decimal.js, Vitest, Testing Library, Vite.

---

## Scope

- **In:** Evidence repository and target directions; Excel parse/map/import flow; persistent project list/detail routes; readiness wiring; offline integration tests; Chinese README; local browser smoke.
- **Out:** Word export implementation, valuation models, AI analysis, network services, new template metrics not present in the target-field registry.

## Phase A — Evidence repository and canonical conflict state

**Files:**
- Create: `app/src/domain/evidence/evidence.schema.ts`
- Create: `app/src/infrastructure/db/evidence-repository.ts`
- Create: `app/src/infrastructure/db/evidence-repository.test.ts`
- Modify: `app/src/domain/evidence/target-fields.ts`
- Create: `app/src/domain/evidence/target-fields.test.ts`

- [ ] Add `direction: MetricDirection` to every canonical target definition: text, dimension, and period fields use `neutral`; revenue, gross margin, net profit, operating cash flow, ARR, and NRR use `higher_is_better`.
- [ ] Write RED tests for runtime rejection, stable replay, overwrite/moved identity recomputation, concurrent writes, cross-group isolation, conservative numeric resolution, and deterministic project ordering.
- [ ] Implement `EvidenceRepository.saveMany()` as one Dexie `rw` transaction: validate all inputs before writes, read overwritten identities, `bulkPut` stable IDs, recompute every affected `projectId + fieldId + periodIdentity + dimensionIdentity` group with `resolveEvidenceConflict`, then persist `none` for agreed groups and `unresolved` for disagreements.
- [ ] Implement `listByProject()` with stable ascending identity order ending in evidence ID, run focused tests, then commit `feat: persist conflict-aware evidence`.

## Phase B — Hardened Data Room Excel workflow

**Files:**
- Modify: `app/src/features/data-room/DataRoomPage.tsx`
- Modify: `app/src/features/data-room/DataRoomPage.test.tsx`
- Modify: `app/src/features/data-room/ExcelMappingPanel.tsx` only if controlled props require integration-safe adjustments
- Test: `app/src/features/data-room/ExcelMappingPanel.test.tsx`

- [ ] Extend Data Room dependencies with an injectable inspector whose default is `inspectWorkbookInWorker`, an `EvidenceRepository`, controlled `completedImportKeys`, and `onImportCompleted`.
- [ ] Write RED tests for opening a stored Excel blob, parse loading/error/retry, stale project/document results, sheet selection, completed-key replay protection, and `mapRowsToEvidence → EvidenceRepository.saveMany`; retain every existing upload/list regression test.
- [ ] Add an explicit “解析/重新打开” action for stored Excel documents, keep PDF/Word/PowerPoint rows unchanged, and render one selected `ExcelMappingPanel` only after Worker inspection succeeds.
- [ ] Run Data Room, mapping, Worker, vault, and repository tests, then commit `feat: import Excel evidence from data room`.

## Phase C — Persistent routes, live project pages, and readiness

**Files:**
- Modify: `app/src/app/router.tsx`
- Modify: `app/src/features/projects/ProjectListPage.tsx`
- Create: `app/src/features/projects/ProjectListPage.test.tsx`
- Modify: `app/src/features/projects/NewProjectPage.tsx`
- Modify: `app/src/features/projects/NewProjectPage.test.tsx`
- Create: `app/src/features/dashboard/ProjectDashboardRoute.tsx`
- Create: `app/src/features/dashboard/ProjectDashboardRoute.test.tsx`
- Modify: `app/src/features/dashboard/ProjectDashboardPage.tsx`
- Modify: `app/src/features/dashboard/ProjectDashboardPage.test.tsx`

- [ ] Use `useLiveQuery` for the persisted project list and route-level project/evidence reads; expose loading, database error, and not-found states without flashing stale project data.
- [ ] Navigate to `/projects/:projectId` only after a successful create, add `/projects/:projectId/data-room`, and link dashboard ↔ Data Room while preserving the Task 9 dashboard cards.
- [ ] Calculate readiness with fixed core fields `company_name`, `business_description`, `revenue`, and `gross_margin`; add `arr` only when the selected SaaS template and canonical registry/import chain support it, and never require unknown template-only metrics.
- [ ] Run route/page tests and commit `feat: wire persistent project readiness routes`.

## Phase D — Offline vertical-slice integration

**Files:**
- Create: `app/src/integration/investment-due-diligence-flow.test.tsx`
- Modify supporting test helpers only where reusable fixtures are required.

- [ ] Write an integration test that creates and reloads projects across multiple templates, inspects Excel through the Worker boundary, maps evidence, replays stable IDs without duplicates, produces an unresolved conflict, verifies `higher_is_better` selects the lower conservative value, and confirms readiness/export remain blocked.
- [ ] Verify the same flow preserves project/document/evidence rows after recreating repositories and components against the same IndexedDB database; commit `test: cover offline due diligence flow`.

## Phase E — Documentation and delivery verification

**Files:**
- Replace: `app/README.md`

- [ ] Document correct local commands, IndexedDB persistence, 100 MiB per-file and 50-file/250 MiB batch limits, Worker-only Excel parsing, browser-local privacy, supported formats, and verification commands in professional Chinese.
- [ ] Run `npm run check`, `npm run build`, `npm audit --offline --audit-level=high`, and `git diff --check`; commit `docs: explain local due diligence workflow`.
- [ ] Start the local Vite server and run an offline browser smoke: create a project, refresh and confirm persistence, upload/reopen Excel, select a sheet and mapping, confirm the file list remains, then verify dashboard completeness/conflict/export state. Stop the server and record the result without changing production scope.

## Validation gates

- Each phase begins with focused RED and ends with focused GREEN plus type/lint checks.
- Full Data Room regressions run before and after Phase B.
- The final suite must pass without network access; the known Vite chunk-size warning is acceptable, new warnings are not.
