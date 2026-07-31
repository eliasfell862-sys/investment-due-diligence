# Securities Workbench Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve contrast, hierarchy, and long-session readability across the stock, fund, bond, and ETF workbench without changing market-data or analysis behavior.

**Architecture:** Add one stylesheet scoped to `.securities-workbench-page`, expose semantic theme tokens there, and replace repeated hard-coded colors in the existing React page with those tokens. Add only small semantic class names and accessibility attributes to the existing component tree; do not split or redesign the business components.

**Tech Stack:** React 19, TypeScript 6, CSS, Vitest, Testing Library, Vite

## Global Constraints

- Preserve the deep professional financial-terminal direction.
- Do not change market-data APIs, analysis engines, state transitions, calculations, or displayed values.
- Scope all new theme rules to the securities workbench so the investment-research workbench is unaffected.
- Keep the A-share convention of red for gains and green for losses, with explicit numeric signs retained.
- Preserve horizontal scrolling for wide data tables and support narrow-screen wrapping.
- Do not add runtime dependencies.
- Execute inline in the current session; do not use subagents.

---

### Task 1: Add Semantic Workbench Hooks and Regression Tests

**Files:**
- Modify: `app/src/features/securities/SecuritiesWorkbenchPage.test.tsx`
- Modify: `app/src/features/securities/SecuritiesWorkbenchPage.tsx`

**Interfaces:**
- Consumes: Existing `SecuritiesWorkbenchPage` component.
- Produces: Root class `securities-workbench-page`, navigation label `证券资产类别`, `aria-current="page"` on the active asset tab, and stable classes `securities-tabs`, `securities-toolbar`, `securities-table-shell`.

- [ ] **Step 1: Write the failing semantic-shell test**

Add assertions that the workbench root contains `securities-workbench-page`, the tab navigation is discoverable by the accessible name `证券资产类别`, the 股票 button has `aria-current="page"`, and a `.securities-table-shell` exists.

```tsx
const heading = screen.getByRole('heading', { name: '证券项目工作台' });
expect(heading.closest('.securities-workbench-page')).not.toBeNull();
expect(screen.getByRole('navigation', { name: '证券资产类别' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: /股票/ })).toHaveAttribute('aria-current', 'page');
expect(document.querySelector('.securities-table-shell')).not.toBeNull();
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- SecuritiesWorkbenchPage.test.tsx`

Expected: FAIL because the navigation label, current-page attribute, and stable visual classes are not present.

- [ ] **Step 3: Add the minimum semantic hooks**

In `SecuritiesWorkbenchPage.tsx`:

- Import `./SecuritiesWorkbenchPage.css`.
- Add `aria-label="证券资产类别"` and `className="securities-tabs"` to the tab navigation.
- Add `aria-current={activeTab === tab.id ? 'page' : undefined}` to each asset-tab button.
- Add `className="securities-toolbar"` to the stock search/action row.
- Add `className="securities-table-shell"` to the stock quote table wrapper.

- [ ] **Step 4: Run the focused test and verify pass**

Run: `npm test -- SecuritiesWorkbenchPage.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the semantic hooks**

```bash
git add app/src/features/securities/SecuritiesWorkbenchPage.tsx app/src/features/securities/SecuritiesWorkbenchPage.test.tsx
git commit -m "test: define securities workbench visual hooks"
```

### Task 2: Implement the Scoped High-Contrast Theme

**Files:**
- Create: `app/src/features/securities/SecuritiesWorkbenchPage.css`
- Modify: `app/src/features/securities/SecuritiesWorkbenchPage.tsx`

**Interfaces:**
- Consumes: Root and component classes created in Task 1.
- Produces: CSS custom properties `--sec-bg`, `--sec-surface-1`, `--sec-surface-2`, `--sec-surface-3`, `--sec-border`, `--sec-border-strong`, `--sec-text`, `--sec-text-secondary`, `--sec-text-muted`, `--sec-accent`, `--sec-gain`, `--sec-loss`, `--sec-warning`, and `--sec-danger`.

- [ ] **Step 1: Add a source-level theme regression test**

Extend `SecuritiesWorkbenchPage.test.tsx` to read no CSS directly; instead verify representative rendered elements resolve to semantic token strings in their inline styles after the component is rendered:

```tsx
const stockButton = screen.getByRole('button', { name: /股票/ });
expect(stockButton.getAttribute('style')).toContain('var(--sec-accent)');
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- SecuritiesWorkbenchPage.test.tsx`

Expected: FAIL because the active tab still uses hard-coded hexadecimal colors.

- [ ] **Step 3: Create the scoped theme stylesheet**

Create `SecuritiesWorkbenchPage.css` with:

- A deep blue-black page canvas and four distinct surface levels.
- High-contrast primary, secondary, and muted text tokens.
- Consistent 42px controls, visible borders, `:hover`, and `:focus-visible` states.
- Compact page header, elevated tab rail, clear active tab, and horizontally scrollable tabs.
- Table header contrast, zebra rows, hover/selected rows, tabular numerals, and a sensible table minimum width.
- Unified card/panel borders and surface colors for existing `.card`, inline panels, charts, and debate sections inside the scoped root.
- Responsive rules at 760px for toolbar wrapping, reduced padding, single-column card grids where applicable, and persistent table scrolling.
- A `prefers-reduced-motion` rule that disables nonessential transitions.

- [ ] **Step 4: Replace the repeated hard-coded palette with semantic variables**

In `SecuritiesWorkbenchPage.tsx`, replace repeated palette literals with the corresponding CSS variables while preserving dynamic gain/loss logic:

```ts
const color = (v: number) =>
  v > 0 ? 'var(--sec-gain)' : v < 0 ? 'var(--sec-loss)' : 'var(--sec-text-muted)';
```

Use `var(--sec-text)`, `var(--sec-text-secondary)`, `var(--sec-text-muted)`, `var(--sec-surface-1)`, `var(--sec-surface-2)`, `var(--sec-border)`, and `var(--sec-accent)` for the existing high-frequency values. Keep special warning and error states mapped to `--sec-warning` and `--sec-danger`.

- [ ] **Step 5: Run tests and type checking**

Run: `npm test -- SecuritiesWorkbenchPage.test.tsx`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit the visual theme**

```bash
git add app/src/features/securities/SecuritiesWorkbenchPage.tsx app/src/features/securities/SecuritiesWorkbenchPage.css app/src/features/securities/SecuritiesWorkbenchPage.test.tsx
git commit -m "style: improve securities workbench contrast"
```

### Task 3: Validate All Asset Tabs and Production Build

**Files:**
- Modify if required by discovered visual regressions: `app/src/features/securities/SecuritiesWorkbenchPage.css`
- Modify if required by discovered markup regressions: `app/src/features/securities/SecuritiesWorkbenchPage.tsx`

**Interfaces:**
- Consumes: Completed scoped theme and unchanged asset modules.
- Produces: A buildable, tested workbench with consistent visual treatment across stock, fund, bond, and ETF tabs.

- [ ] **Step 1: Extend interaction coverage to all four tabs**

Add a test that clicks 基金, 债券, ETF, and 股票 in sequence and asserts that each button receives `aria-current="page"` when active.

```tsx
const user = userEvent.setup();
for (const label of ['基金', '债券', 'ETF', '股票']) {
  const button = screen.getByRole('button', { name: new RegExp(label) });
  await user.click(button);
  expect(button).toHaveAttribute('aria-current', 'page');
}
```

- [ ] **Step 2: Run the full securities test**

Run: `npm test -- SecuritiesWorkbenchPage.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run the full project quality checks**

Run: `npm run check`

Expected: Type checking, all tests, and lint pass.

Run: `npm run build`

Expected: Production build completes successfully.

- [ ] **Step 4: Perform visual verification**

Open the local workbench and inspect stock, fund, bond, and ETF tabs at a desktop width and a narrow width. Verify readable primary/secondary text, distinct panels, visible form focus, table horizontal scrolling, red/green numbers with signs, and no clipped controls. If Windows browser inspection remains unavailable, report that limitation and rely on code/test/build verification rather than claiming visual confirmation.

- [ ] **Step 5: Commit any verification fixes**

If Task 3 required code changes:

```bash
git add app/src/features/securities/SecuritiesWorkbenchPage.tsx app/src/features/securities/SecuritiesWorkbenchPage.css app/src/features/securities/SecuritiesWorkbenchPage.test.tsx
git commit -m "fix: polish securities workbench responsive states"
```

If no code changes were required, do not create an empty commit.
