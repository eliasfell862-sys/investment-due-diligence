# Portfolio Group Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents for this plan.

**Goal:** Add versioned portfolio groups to the securities portfolio-allocation page so calculated allocations can be saved, reviewed, versioned, and deleted independently of watchlists.

**Architecture:** Create a focused localStorage repository beside the securities feature that owns validation, IDs, version appends, lookup, and deletion. `PortfolioAllocationPage` converts its current candidate results into immutable snapshots and renders two UI surfaces: save-to-group controls and a portfolio-group manager with read-only historical versions.

**Tech Stack:** React 19, TypeScript 6, React Router, Vitest, Testing Library, browser localStorage.

## Global Constraints

- Use the storage key `sec_portfolio_groups_v1`.
- Do not modify `sec_watchlists_v2` or `sec_active_watchlist`.
- Saving to an existing group always appends a new immutable version.
- AI review content is optional and must never block saving.
- Historical versions load in read-only mode and cannot be overwritten.
- No cloud synchronization, brokerage integration, permissions, or version-diff visualization.
- Do not use subagents.

---

## File Structure

- Create `app/src/features/securities/portfolio-group-storage.ts`: types, validation, localStorage reads/writes, version creation, lookup, and deletion.
- Create `app/src/features/securities/portfolio-group-storage.test.ts`: repository behavior and corrupted-storage regression coverage.
- Modify `app/src/features/securities/PortfolioAllocationPage.tsx`: save controls, snapshot conversion, group manager, read-only version display, and user feedback.
- Create `app/src/features/securities/PortfolioAllocationPage.test.tsx`: page-level save, append-version, optional-AI, historical-view, and delete behavior.

---

### Task 1: Versioned Portfolio Group Repository

**Files:**
- Create: `app/src/features/securities/portfolio-group-storage.ts`
- Test: `app/src/features/securities/portfolio-group-storage.test.ts`

**Interfaces:**
- Produces:

```ts
export const PORTFOLIO_GROUPS_KEY = 'sec_portfolio_groups_v1';

export type PortfolioRiskLevel = 'conservative' | 'balanced' | 'aggressive';

export interface PortfolioPositionSnapshot {
  code: string;
  name: string;
  groupName: string;
  groupColor: string;
  score: number;
  allocation: number;
  amount: number;
  shares: number;
  price: number;
  rationale: string;
}

export interface PortfolioVersion {
  id: string;
  createdAt: string;
  capital: number;
  riskLevel: PortfolioRiskLevel;
  sourceWatchlistId?: string;
  sourceWatchlistName?: string;
  aiSummary?: string;
  positions: PortfolioPositionSnapshot[];
}

export interface PortfolioGroup {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentVersionId: string;
  versions: PortfolioVersion[];
}

export interface PortfolioVersionDraft extends Omit<PortfolioVersion, 'id' | 'createdAt'> {}

export interface PortfolioStorageOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => string;
  createId?: (prefix: 'pg' | 'pv') => string;
}

export function loadPortfolioGroups(storage?: Pick<Storage, 'getItem'>): PortfolioGroup[];
export function savePortfolioVersion(
  target: { groupId: string } | { newGroupName: string },
  draft: PortfolioVersionDraft,
  options?: PortfolioStorageOptions,
): { groups: PortfolioGroup[]; group: PortfolioGroup; version: PortfolioVersion };
export function deletePortfolioGroup(
  groupId: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): PortfolioGroup[];
export function findPortfolioVersion(
  groups: PortfolioGroup[],
  groupId: string,
  versionId: string,
): PortfolioVersion | null;
```

- [ ] **Step 1: Write failing repository tests**

Create `portfolio-group-storage.test.ts` with an in-memory Storage double and these concrete cases:

```ts
import { describe, expect, it } from 'vitest';
import {
  deletePortfolioGroup,
  findPortfolioVersion,
  loadPortfolioGroups,
  PORTFOLIO_GROUPS_KEY,
  savePortfolioVersion,
  type PortfolioVersionDraft,
} from './portfolio-group-storage';

function memoryStorage(seed?: string) {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(PORTFOLIO_GROUPS_KEY, seed);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

const draft: PortfolioVersionDraft = {
  capital: 100000,
  riskLevel: 'balanced',
  sourceWatchlistId: 'wl-1',
  sourceWatchlistName: '核心池',
  aiSummary: '',
  positions: [{
    code: '000001', name: '平安银行', groupName: '银行', groupColor: '#70b8b0',
    score: 72, allocation: 100, amount: 100000, shares: 8600,
    price: 11.62, rationale: '低PE',
  }],
};

it('creates a group with its first immutable version', () => {
  const storage = memoryStorage();
  const result = savePortfolioVersion({ newGroupName: '稳健组合' }, draft, {
    storage,
    now: () => '2026-08-03T10:00:00.000Z',
    createId: prefix => prefix + '-1',
  });
  expect(result.group).toMatchObject({ name: '稳健组合', currentVersionId: 'pv-1' });
  expect(result.group.versions).toHaveLength(1);
  expect(loadPortfolioGroups(storage)).toHaveLength(1);
});

it('appends a version without replacing the previous version', () => {
  const storage = memoryStorage();
  const first = savePortfolioVersion({ newGroupName: '稳健组合' }, draft, {
    storage, now: () => '2026-08-03T10:00:00.000Z', createId: p => p + '-1',
  });
  const second = savePortfolioVersion({ groupId: first.group.id }, { ...draft, capital: 200000 }, {
    storage, now: () => '2026-08-03T11:00:00.000Z', createId: p => p + '-2',
  });
  expect(second.group.versions.map(v => v.capital)).toEqual([100000, 200000]);
  expect(second.group.currentVersionId).toBe('pv-2');
});

it('rejects duplicate group names and empty positions', () => {
  const storage = memoryStorage();
  savePortfolioVersion({ newGroupName: '稳健组合' }, draft, { storage });
  expect(() => savePortfolioVersion({ newGroupName: ' 稳健组合 ' }, draft, { storage }))
    .toThrow('持仓组名称已存在');
  expect(() => savePortfolioVersion({ newGroupName: '空组合' }, { ...draft, positions: [] }, { storage }))
    .toThrow('当前没有可保存的持仓');
});

it('loads corrupted JSON as an empty collection', () => {
  expect(loadPortfolioGroups(memoryStorage('{broken'))).toEqual([]);
});

it('finds versions and deletes only the requested group', () => {
  const storage = memoryStorage();
  const one = savePortfolioVersion({ newGroupName: '组合一' }, draft, { storage });
  savePortfolioVersion({ newGroupName: '组合二' }, draft, { storage });
  expect(findPortfolioVersion(loadPortfolioGroups(storage), one.group.id, one.version.id)).not.toBeNull();
  expect(deletePortfolioGroup(one.group.id, storage).map(group => group.name)).toEqual(['组合二']);
});
```

- [ ] **Step 2: Run repository tests and verify RED**

Run:

```powershell
npx vitest run src/features/securities/portfolio-group-storage.test.ts
```

Expected: FAIL because `portfolio-group-storage.ts` and its exported functions do not exist.

- [ ] **Step 3: Implement repository validation and version append behavior**

Implement the interfaces above. Use these rules in `savePortfolioVersion`:

```ts
const name = 'newGroupName' in target ? target.newGroupName.trim() : '';
if (draft.positions.length === 0) throw new Error('当前没有可保存的持仓');
if (!Number.isFinite(draft.capital) || draft.capital <= 0) throw new Error('可用资金必须大于0');
if ('newGroupName' in target && !name) throw new Error('请输入持仓组名称');
if ('newGroupName' in target && groups.some(group => group.name === name)) {
  throw new Error('持仓组名称已存在');
}
```

Clone `positions` when constructing a version so later page mutations cannot alter saved history. Generate IDs with `crypto.randomUUID()` when available and a timestamp/random fallback otherwise.

- [ ] **Step 4: Run repository tests and verify GREEN**

Run:

```powershell
npx vitest run src/features/securities/portfolio-group-storage.test.ts
```

Expected: all repository tests PASS.

- [ ] **Step 5: Commit repository task**

```powershell
git add app/src/features/securities/portfolio-group-storage.ts app/src/features/securities/portfolio-group-storage.test.ts
git commit -m "feat: add versioned portfolio group storage"
```

---

### Task 2: Save Current Allocation to a Portfolio Group

**Files:**
- Modify: `app/src/features/securities/PortfolioAllocationPage.tsx`
- Create: `app/src/features/securities/PortfolioAllocationPage.test.tsx`

**Interfaces:**
- Consumes: `loadPortfolioGroups`, `savePortfolioVersion`, `PortfolioGroup`, and `PortfolioVersionDraft` from Task 1.
- Produces: page controls named `新建持仓组`, `保存当前方案`, and `保存到持仓组` for Testing Library and users.

- [ ] **Step 1: Write failing page tests for visibility and new-group saving**

Mock `stock-api`, technical indicators, pattern scanning, and strategy scanning. Seed the active watchlist and return one quote:

```ts
vi.mock('../../infrastructure/market-data/stock-api', () => ({
  fetchSinaQuotes: vi.fn().mockResolvedValue([{
    code: '000001', name: '平安银行', price: 10, change: 0, changePct: 0,
    open: 10, high: 10, low: 10, preClose: 10, volume: 1000, amount: 10000,
    turnover: 1, pe: 8, pb: 1, totalCap: 2000,
  }]),
  fetchEastmoneyKLine: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../engines/market-analysis/technical-indicators', () => ({ calcAllIndicators: vi.fn() }));
vi.mock('../../engines/market-analysis/kline-patterns', () => ({ scanPatterns: vi.fn().mockReturnValue([]) }));
vi.mock('../../engines/market-analysis/trading-strategies', () => ({ scanStrategies: vi.fn().mockReturnValue([]) }));
```

Test flow:

```ts
it('hides save controls until an allocation exists and then saves a new group without AI text', async () => {
  localStorage.setItem('sec_watchlists_v2', JSON.stringify([{
    id: 'wl-1', name: '核心池', codes: ['000001'], createdAt: '2026-08-03',
    groups: [], codeGroups: {},
  }]));
  localStorage.setItem('sec_active_watchlist', 'wl-1');
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/projects/default/securities/portfolio']}><PortfolioAllocationPage /></MemoryRouter>);

  expect(screen.queryByRole('heading', { name: '保存到持仓组' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /开始分析/ }));
  expect(await screen.findByRole('heading', { name: '保存到持仓组' })).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('目标持仓组'), '__new__');
  await user.type(screen.getByLabelText('新持仓组名称'), '稳健组合');
  await user.click(screen.getByRole('button', { name: '保存当前方案' }));

  expect(await screen.findByText(/已保存到“稳健组合”/)).toBeInTheDocument();
  const saved = JSON.parse(localStorage.getItem('sec_portfolio_groups_v1') || '[]');
  expect(saved[0].versions[0]).toMatchObject({ capital: 100000, aiSummary: '' });
});
```

- [ ] **Step 2: Run page test and verify RED**

Run:

```powershell
npx vitest run src/features/securities/PortfolioAllocationPage.test.tsx
```

Expected: FAIL because the save section and accessible controls are absent.

- [ ] **Step 3: Implement save controls and snapshot conversion**

Add page state:

```ts
const [portfolioGroups, setPortfolioGroups] = useState<PortfolioGroup[]>(() => loadPortfolioGroups());
const [saveTarget, setSaveTarget] = useState('__new__');
const [newGroupName, setNewGroupName] = useState('');
const [saveMessage, setSaveMessage] = useState('');
const [saveError, setSaveError] = useState('');
```

Build a `PortfolioVersionDraft` from current candidates:

```ts
const draft: PortfolioVersionDraft = {
  capital,
  riskLevel,
  sourceWatchlistId: wl?.id,
  sourceWatchlistName: wl?.name,
  aiSummary,
  positions: candidates.map(candidate => ({
    code: candidate.stock.code,
    name: candidate.stock.name,
    groupName: candidate.groupName,
    groupColor: candidate.groupColor,
    score: candidate.score,
    allocation: candidate.allocation,
    amount: candidate.amount,
    shares: candidate.shares,
    price: candidate.stock.price,
    rationale: candidate.rationale,
  })),
};
```

Render an accessible `<select aria-label="目标持仓组">`, `<input aria-label="新持仓组名称">`, and save button. Call `savePortfolioVersion`, refresh `portfolioGroups`, select the saved group, clear the new-group input, and show `已保存到“组名”，当前共 N 个版本`.

- [ ] **Step 4: Run page and repository tests**

Run:

```powershell
npx vitest run src/features/securities/PortfolioAllocationPage.test.tsx src/features/securities/portfolio-group-storage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit save workflow**

```powershell
git add app/src/features/securities/PortfolioAllocationPage.tsx app/src/features/securities/PortfolioAllocationPage.test.tsx
git commit -m "feat: save allocation results to portfolio groups"
```

---

### Task 3: Append Versions and Manage Historical Portfolio Groups

**Files:**
- Modify: `app/src/features/securities/PortfolioAllocationPage.tsx`
- Modify: `app/src/features/securities/PortfolioAllocationPage.test.tsx`

**Interfaces:**
- Consumes: `deletePortfolioGroup` and `findPortfolioVersion` from Task 1.
- Produces: headings `持仓组管理` and `历史方案详情`, group/version selection controls, and `删除持仓组`.

- [ ] **Step 1: Add failing tests for appending, viewing, and deleting**

Add one test that pre-seeds a group, runs analysis, selects the existing group, saves, and verifies two versions remain:

```ts
expect(saved[0].versions).toHaveLength(2);
expect(saved[0].currentVersionId).toBe(saved[0].versions[1].id);
```

Add one test that pre-seeds two versions, renders the manager, selects the older version, and asserts the read-only detail shows its capital, risk preference, stock name, allocation, and stored AI summary.

Add one deletion test:

```ts
vi.spyOn(window, 'confirm').mockReturnValue(true);
await user.click(screen.getByRole('button', { name: '删除持仓组' }));
expect(JSON.parse(localStorage.getItem('sec_portfolio_groups_v1') || '[]')).toEqual([]);
expect(screen.getByText('暂无已保存的持仓组')).toBeInTheDocument();
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run src/features/securities/PortfolioAllocationPage.test.tsx
```

Expected: FAIL because version-management controls do not exist.

- [ ] **Step 3: Implement portfolio-group manager**

Add state:

```ts
const [managedGroupId, setManagedGroupId] = useState('');
const [managedVersionId, setManagedVersionId] = useState('');
```

Derive:

```ts
const managedGroup = portfolioGroups.find(group => group.id === managedGroupId) ?? portfolioGroups[0];
const managedVersion = managedGroup
  ? findPortfolioVersion(portfolioGroups, managedGroup.id, managedVersionId || managedGroup.currentVersionId)
  : null;
```

Render:

- Group selector with group name, version count, and latest update time.
- Version selector sorted newest first with formatted timestamp, capital, risk label, position count, and `含AI审查` marker.
- Read-only table using `managedVersion.positions`.
- AI summary card only when `managedVersion.aiSummary` is non-empty.
- Delete button guarded by `window.confirm('确定删除持仓组“名称”及其全部历史版本吗？')`.

After delete, refresh `portfolioGroups`, clear selected group/version IDs when necessary, and show `暂无已保存的持仓组` when the collection becomes empty.

- [ ] **Step 4: Run page tests and verify GREEN**

Run:

```powershell
npx vitest run src/features/securities/PortfolioAllocationPage.test.tsx
```

Expected: all page tests PASS.

- [ ] **Step 5: Commit management UI**

```powershell
git add app/src/features/securities/PortfolioAllocationPage.tsx app/src/features/securities/PortfolioAllocationPage.test.tsx
git commit -m "feat: manage portfolio group history"
```

---

### Task 4: Regression Verification and Delivery

**Files:**
- Verify only; no unrelated production edits.

**Interfaces:**
- Consumes all deliverables from Tasks 1-3.
- Produces a verified feature ready for browser use and later database migration.

- [ ] **Step 1: Run targeted tests**

```powershell
npx vitest run src/features/securities/portfolio-group-storage.test.ts src/features/securities/PortfolioAllocationPage.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run securities regressions**

```powershell
npx vitest run src/features/securities src/infrastructure/market-data
```

Expected: PASS. If an unrelated existing stock-directory test fails, document it and do not modify unrelated stock-directory behavior as part of this feature.

- [ ] **Step 3: Run static and production checks**

```powershell
npm run typecheck
npm run build
git diff --check
```

Expected: all commands succeed; existing chunk-size warnings are informational.

- [ ] **Step 4: Browser verification**

At `http://localhost:5173/projects/default/securities/portfolio`:

1. Run a one-stock allocation.
2. Save it to a new group without running AI review.
3. Change capital and save to the same group.
4. Confirm the group shows two versions.
5. Load the first version and verify its original capital and allocation remain unchanged.
6. Delete the group and verify the empty state.

- [ ] **Step 5: Final commit if verification required minor test-only corrections**

```powershell
git add app/src/features/securities/portfolio-group-storage.ts app/src/features/securities/portfolio-group-storage.test.ts app/src/features/securities/PortfolioAllocationPage.tsx app/src/features/securities/PortfolioAllocationPage.test.tsx
git commit -m "test: verify portfolio group workflow"
```

Skip this commit when there are no remaining changes after Tasks 1-3.
