# Research and Securities Workbenches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the existing project area to the research-project workbench and add a separate securities-project workbench at `/securities`.

**Architecture:** Keep the existing investment due-diligence `Project` model, Dexie repository, and `/projects/*` routes unchanged. Add one sibling navigation entry and a standalone presentational securities page; export the route configuration so a memory-router test can prove the new route renders without coupling it to research-project data.

**Tech Stack:** React 19, TypeScript 6, React Router 7, Vitest 4, Testing Library.

## Global Constraints

- The sidebar order is exactly `01 投研项目`, then `02 证券项目`.
- `投研项目` links to `/`; `证券项目` links to `/securities`.
- Existing `/projects/*`, `Project`, `ProjectRepository`, and Dexie `projects` storage remain unchanged.
- The securities page must not read or modify research-project data.
- Do not add a non-functional “新建证券项目” button or invent securities persistence fields.
- Preserve all unrelated uncommitted inference, risk, valuation, equity, and smart-assessment changes.

---

## File Map

- `app/src/app/AppShell.tsx`: owns the shared sidebar navigation.
- `app/src/app/AppShell.test.tsx`: locks link labels, destinations, order, and active state.
- `app/src/features/projects/ProjectListPage.tsx`: owns research-project workbench copy and existing project list behavior.
- `app/src/features/projects/ProjectListPage.test.tsx`: locks renamed research-project copy while preserving list behavior.
- `app/src/features/securities/SecuritiesWorkbenchPage.tsx`: standalone securities workbench shell with no data dependency.
- `app/src/features/securities/SecuritiesWorkbenchPage.test.tsx`: locks page content and separation from research projects.
- `app/src/app/router.tsx`: registers `/securities` and exports route objects for route-level testing.
- `app/src/app/router.test.tsx`: proves `/securities` renders through the real application route configuration.

### Task 1: Add the two-entry sidebar navigation

**Files:**
- Create: `app/src/app/AppShell.test.tsx`
- Modify: `app/src/app/AppShell.tsx:1-24`

**Interfaces:**
- Consumes: React Router `NavLink` and `Outlet`.
- Produces: links named `投研项目` and `证券项目` with destinations `/` and `/securities`.

- [ ] **Step 1: Write the failing navigation test**

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('shows independent research and securities workbench links in order', () => {
    render(
      <MemoryRouter initialEntries={['/securities']}>
        <AppShell />
      </MemoryRouter>,
    );

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '01 投研项目',
      '02 证券项目',
    ]);
    expect(screen.getByRole('link', { name: /投研项目/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /证券项目/ })).toHaveAttribute('href', '/securities');
    expect(screen.getByRole('link', { name: /证券项目/ })).toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run from `app/`:

```powershell
npm test -- src/app/AppShell.test.tsx
```

Expected: FAIL because the sidebar still contains only `01 项目` and has no securities link.

- [ ] **Step 3: Implement the minimal navigation change**

Replace the current `<nav>` contents with:

```tsx
<nav className="primary-nav" aria-label="主导航">
  <NavLink to="/" end>
    <span aria-hidden="true">01</span>
    投研项目
  </NavLink>
  <NavLink to="/securities">
    <span aria-hidden="true">02</span>
    证券项目
  </NavLink>
</nav>
```

- [ ] **Step 4: Run the test to verify GREEN**

```powershell
npm test -- src/app/AppShell.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit only navigation files**

```powershell
git add app/src/app/AppShell.tsx app/src/app/AppShell.test.tsx
git commit -m "feat: add research and securities navigation"
```

### Task 2: Rename the existing workbench copy to research projects

**Files:**
- Modify: `app/src/features/projects/ProjectListPage.tsx:26-67`
- Modify: `app/src/features/projects/ProjectListPage.test.tsx`

**Interfaces:**
- Consumes: existing `ProjectRepository` list/delete interface.
- Produces: unchanged project behavior with research-project-specific visible copy.

- [ ] **Step 1: Add a failing copy test and update affected existing assertions**

Add inside `describe('ProjectListPage', ...)`:

```tsx
it('labels the existing area as the research project workbench', async () => {
  renderPage({ list: async () => [], delete: async () => undefined });

  expect(await screen.findByRole('heading', { name: '投研项目工作台' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '新建投研项目' })).toHaveAttribute(
    'href',
    '/projects/new',
  );
  expect(screen.getByText('创建投研项目并选择行业模板，搭建本次尽调的分析框架。')).toBeInTheDocument();
});
```

Update existing expected copy:

```tsx
expect(screen.getByText('正在读取投研项目…')).toBeInTheDocument();
expect(await screen.findByRole('alert')).toHaveTextContent('无法读取本地投研项目，请重试。');
await userEvent.click(screen.getByRole('button', { name: '重新读取投研项目' }));
```

- [ ] **Step 2: Run the test to verify RED**

```powershell
npm test -- src/features/projects/ProjectListPage.test.tsx
```

Expected: FAIL on the old `项目工作台`, `新建项目`, loading/error/retry, and empty-state copy.

- [ ] **Step 3: Implement exact copy replacements**

In `ProjectListPage.tsx`, use these strings:

```tsx
if (!confirm(`确定删除投研项目「${name}」吗？\n投研项目数据将被永久清除，无法恢复。`)) return;
<p className="eyebrow">Deal Review / 投研项目管理</p>
<h1>投研项目工作台</h1>
新建投研项目
<p role="status">正在读取投研项目…</p>
<p role="alert">无法读取本地投研项目，请重试。</p>
重新读取投研项目
<p className="empty-state-index">01 — RESEARCH PROJECTS</p>
<p>创建投研项目并选择行业模板，搭建本次尽调的分析框架。</p>
<section aria-label="投研项目列表">
```

Do not rename TypeScript types, repository methods, route paths, or database tables.

- [ ] **Step 4: Run the test to verify GREEN**

```powershell
npm test -- src/features/projects/ProjectListPage.test.tsx
```

Expected: PASS with existing persistence, retry, and live-update tests unchanged except copy assertions.

- [ ] **Step 5: Commit only project workbench files**

```powershell
git add app/src/features/projects/ProjectListPage.tsx app/src/features/projects/ProjectListPage.test.tsx
git commit -m "feat: rename project workbench to research projects"
```

### Task 3: Add the independent securities workbench and real route

**Files:**
- Create: `app/src/features/securities/SecuritiesWorkbenchPage.tsx`
- Create: `app/src/features/securities/SecuritiesWorkbenchPage.test.tsx`
- Create: `app/src/app/router.test.tsx`
- Modify: `app/src/app/router.tsx:1-58`

**Interfaces:**
- Consumes: shared page CSS classes only.
- Produces: `SecuritiesWorkbenchPage(): JSX.Element`, exported `appRoutes: RouteObject[]`, and `/securities` route.

- [ ] **Step 1: Write the failing standalone-page test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SecuritiesWorkbenchPage } from './SecuritiesWorkbenchPage';

describe('SecuritiesWorkbenchPage', () => {
  it('renders an independent securities workbench shell', () => {
    render(<SecuritiesWorkbenchPage />);

    expect(screen.getByRole('heading', { name: '证券项目工作台' })).toBeInTheDocument();
    expect(screen.getByText('从证券研究命题出发，逐步建立股票池、估值跟踪与投资判断。')).toBeInTheDocument();
    expect(screen.getByText('证券研究能力将在这里独立展开')).toBeInTheDocument();
    expect(screen.queryByText('新建投研项目')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '投研项目列表' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the failing real-route test**

```tsx
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { appRoutes } from './router';

describe('application routes', () => {
  it('renders the securities workbench at /securities', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/securities'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: '证券项目工作台' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /证券项目/ })).toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 3: Run both tests to verify RED**

```powershell
npm test -- src/features/securities/SecuritiesWorkbenchPage.test.tsx src/app/router.test.tsx
```

Expected: FAIL because the page, exported `appRoutes`, and route do not exist.

- [ ] **Step 4: Implement the standalone page**

Create `SecuritiesWorkbenchPage.tsx`:

```tsx
export function SecuritiesWorkbenchPage() {
  return (
    <section className="page securities-workbench-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Securities Research / 证券研究</p>
          <h1>证券项目工作台</h1>
          <p className="page-intro">
            从证券研究命题出发，逐步建立股票池、估值跟踪与投资判断。
          </p>
        </div>
      </header>
      <div className="empty-state">
        <p className="empty-state-index">02 — SECURITIES</p>
        <div>
          <h2>证券研究能力将在这里独立展开</h2>
          <p>后续可在此建立股票池、证券研究档案、估值跟踪和持续监控。</p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Register an exportable route configuration**

In `router.tsx`:

```tsx
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { SecuritiesWorkbenchPage } from '../features/securities/SecuritiesWorkbenchPage';
```

Replace direct router construction with:

```tsx
export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <ProjectListPage repository={projectRepository} /> },
      { path: 'securities', element: <SecuritiesWorkbenchPage /> },
      // keep every existing project route unchanged
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
```

- [ ] **Step 6: Run focused tests to verify GREEN**

```powershell
npm test -- src/features/securities/SecuritiesWorkbenchPage.test.tsx src/app/router.test.tsx src/app/AppShell.test.tsx src/features/projects/ProjectListPage.test.tsx
```

Expected: all PASS.

- [ ] **Step 7: Run complete validation**

```powershell
npm run typecheck
npm test
npm run lint
npm run build
git diff --check
```

Expected: all commands exit successfully; pre-existing lint warnings may be reported but no new errors are allowed.

- [ ] **Step 8: Commit only securities route files**

```powershell
git add app/src/features/securities/SecuritiesWorkbenchPage.tsx app/src/features/securities/SecuritiesWorkbenchPage.test.tsx app/src/app/router.tsx app/src/app/router.test.tsx
git commit -m "feat: add independent securities workbench"
```

## Final Review Checklist

- [ ] Verify sidebar order and active states at `/` and `/securities`.
- [ ] Verify `/projects/new` and a saved `/projects/:projectId` still work.
- [ ] Verify no securities file imports `Project`, `ProjectRepository`, `appDb`, or project storage hooks.
- [ ] Verify the final staged/committed files do not include unrelated working-tree changes.