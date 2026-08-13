# Securities Route Lazy Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split securities pages out of the initial application bundle without changing routes, authentication, cloud providers, or page behavior.

**Architecture:** Replace only the nine securities page static imports in `router-base.tsx` with `React.lazy` imports. Wrap route elements with one shared `Suspense` helper so root and project-scoped routes reuse identical lazy components and loading UI.

**Tech Stack:** React 19, React Router 7, TypeScript, Vite 8, Vitest.

## Global Constraints

- Do not modify stock analysis internals or `stock-api.ts`.
- Do not change route paths, `RequireAuth`, or `SecuritiesRouteBoundary` placement.
- Do not use subagents.
- Do not push until explicitly requested.

---

### Task 1: Add a tested lazy route boundary

**Files:**
- Create: `app/src/app/LazyRouteElement.tsx`
- Create: `app/src/app/LazyRouteElement.test.tsx`

**Interfaces:**
- Consumes: a `React.LazyExoticComponent<ComponentType>`.
- Produces: `lazyRouteElement(Component)` returning a React route element with a `Suspense` fallback.

- [ ] Write a test using a deferred dynamic import and assert that `正在加载页面…` appears before the module resolves.
- [ ] Run `npm test -- LazyRouteElement.test.tsx` and verify it fails because the helper does not exist.
- [ ] Implement `lazyRouteElement` with `Suspense` and a lightweight `role="status"` fallback.
- [ ] Resolve the deferred module and assert the page renders.
- [ ] Run the focused test and verify it passes.

### Task 2: Convert securities routes to per-page dynamic imports

**Files:**
- Modify: `app/src/app/router-base.tsx`
- Modify: `app/src/app/router.test.tsx`

**Interfaces:**
- Consumes: `lazyRouteElement` from Task 1 and the existing named page exports.
- Produces: unchanged `appRoutes` paths whose securities elements load on demand.

- [ ] Add a route test asserting the securities route elements still render through `SecuritiesRouteBoundary` after asynchronous loading.
- [ ] Run `npm test -- router.test.tsx` and verify the new expectation fails before conversion.
- [ ] Replace nine static securities imports with `lazy(() => import(...).then(...))` declarations.
- [ ] Replace both root and project-scoped securities route elements with cached `lazyRouteElement` constants.
- [ ] Run `npm test -- router.test.tsx router-auth.test.tsx router-local-first.test.tsx` and verify all pass.

### Task 3: Validate performance and regressions

**Files:**
- No production files beyond Tasks 1–2.

**Interfaces:**
- Consumes: the new lazy route graph.
- Produces: verified split chunks and preserved behavior.

- [ ] Run `npm test -- LazyRouteElement.test.tsx router.test.tsx router-auth.test.tsx router-local-first.test.tsx`.
- [ ] Run `npm run typecheck` and `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Record the main entry size and verify individual securities chunks exist in `dist/assets`.
- [ ] Confirm `http://localhost:5173` returns status 200.