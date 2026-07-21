# Investment Due Diligence Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working vertical slice of the local investment due diligence app: project creation, composable industry templates, IndexedDB persistence, local document storage, Excel field mapping, evidence provenance, conservative conflict resolution, and a readiness dashboard.

**Architecture:** A React/TypeScript/Vite frontend lives in `app/`. Domain rules remain framework-independent under `src/domain`; IndexedDB and file parsers live under `src/infrastructure`; user workflows live under `src/features`. Tests use Vitest, Testing Library, and fake-indexeddb, with domain tests preceding implementation.

**Tech Stack:** React, TypeScript, Vite, React Router, Dexie, Zod, decimal.js, SheetJS, React Hook Form, Vitest, Testing Library, fake-indexeddb.

---

## Phase 1 File Map

```text
app/
  package.json
  vite.config.ts
  vitest.config.ts
  src/
    app/AppShell.tsx
    app/router.tsx
    App.tsx
    domain/project/project.ts
    domain/project/project.schema.ts
    domain/templates/industry-template.ts
    domain/templates/template-registry.ts
    domain/metrics/metric-definition.ts
    domain/evidence/evidence.ts
    domain/evidence/resolve-conflict.ts
    domain/readiness/calculate-readiness.ts
    infrastructure/db/app-db.ts
    infrastructure/db/evidence-repository.ts
    infrastructure/db/project-repository.ts
    infrastructure/files/file-vault.ts
    infrastructure/import/excel-importer.ts
    features/projects/ProjectListPage.tsx
    features/projects/NewProjectPage.tsx
    features/data-room/DataRoomPage.tsx
    features/data-room/ExcelMappingPanel.tsx
    features/dashboard/ProjectDashboardPage.tsx
    shared/ui/StatusBadge.tsx
    index.css
    test/setup.ts
```

Each domain file owns one concept. UI components call repositories and domain functions through explicit interfaces; they do not contain investment formulas or IndexedDB queries inline.

### Task 1: Scaffold the React application and test harness

**Files:**
- Create: `app/` using Vite
- Modify: `app/package.json`
- Create: `app/vitest.config.ts`
- Create: `app/src/test/setup.ts`
- Create: `app/src/smoke.test.ts`

- [ ] **Step 1: Scaffold the app and install runtime dependencies**

Run from the repository root:

```powershell
npm create vite@latest app -- --template react-ts
Set-Location app
npm install
npm install react-router-dom dexie dexie-react-hooks zod decimal.js xlsx react-hook-form
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event fake-indexeddb
```

Expected: `app/package.json` exists and dependency installation exits with code 0.

- [ ] **Step 2: Add test scripts**

Run:

```powershell
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
npm pkg set scripts.typecheck="tsc -b"
npm pkg set scripts.check="npm run typecheck && npm run test && npm run lint"
```

Expected: `package.json` contains `test`, `test:watch`, `typecheck`, and `check` scripts.

- [ ] **Step 3: Create the Vitest configuration**

Create `app/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    clearMocks: true,
  },
});
```

Create `app/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
```

Create `app/src/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('test harness', () => {
  it('runs in jsdom', () => {
    expect(window.document).toBeDefined();
  });
});
```

- [ ] **Step 4: Run the baseline checks**

Run:

```powershell
npm run test
npm run typecheck
```

Expected: one passing test and no TypeScript errors.

- [ ] **Step 5: Commit the scaffold**

```powershell
git add app
git commit -m "chore: scaffold due diligence frontend"
```

### Task 2: Define project and deal-profile domain models

**Files:**
- Create: `app/src/domain/project/project.ts`
- Create: `app/src/domain/project/project.schema.ts`
- Test: `app/src/domain/project/project.schema.test.ts`

- [ ] **Step 1: Write the failing schema tests**

Create `app/src/domain/project/project.schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { projectSchema } from './project.schema';

describe('projectSchema', () => {
  it('accepts a valid local due diligence project', () => {
    const result = projectSchema.parse({
      id: 'project-1',
      name: '示例科技',
      status: 'draft',
      currency: 'CNY',
      amountUnit: 'ten_thousand',
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
      dealProfile: {
        strategy: 'growth',
        investmentAmount: '5000',
        targetOwnershipPct: '10',
        targetIrrPct: '25',
        targetMoic: '3',
        holdingPeriodYears: 5,
        industryTemplateIds: ['saas'],
      },
    });

    expect(result.dealProfile.strategy).toBe('growth');
  });

  it('rejects an empty project name and invalid holding period', () => {
    const result = projectSchema.safeParse({
      id: 'project-2',
      name: '',
      status: 'draft',
      currency: 'CNY',
      amountUnit: 'yuan',
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
      dealProfile: {
        strategy: 'vc_early',
        investmentAmount: '1000',
        targetOwnershipPct: '8',
        targetIrrPct: '35',
        targetMoic: '5',
        holdingPeriodYears: 0,
        industryTemplateIds: [],
      },
    });

    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run test -- src/domain/project/project.schema.test.ts`

Expected: FAIL because `project.schema.ts` does not exist.

- [ ] **Step 3: Implement the domain types and schema**

Create `app/src/domain/project/project.ts`:

```ts
export type InvestmentStrategy = 'vc_early' | 'growth' | 'pe_buyout';
export type ProjectStatus = 'draft' | 'in_diligence' | 'decision_ready' | 'archived';
export type CurrencyCode = 'CNY' | 'USD' | 'HKD' | 'EUR';
export type AmountUnit = 'yuan' | 'ten_thousand' | 'million';

export interface DealProfile {
  strategy: InvestmentStrategy;
  investmentAmount: string;
  targetOwnershipPct: string;
  targetIrrPct: string;
  targetMoic: string;
  holdingPeriodYears: number;
  industryTemplateIds: string[];
}

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  currency: CurrencyCode;
  amountUnit: AmountUnit;
  createdAt: string;
  updatedAt: string;
  dealProfile: DealProfile;
}
```

Create `app/src/domain/project/project.schema.ts`:

```ts
import { z } from 'zod';

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, '必须是非负数字');

export const dealProfileSchema = z.object({
  strategy: z.enum(['vc_early', 'growth', 'pe_buyout']),
  investmentAmount: decimalString,
  targetOwnershipPct: decimalString,
  targetIrrPct: decimalString,
  targetMoic: decimalString,
  holdingPeriodYears: z.number().int().min(1).max(15),
  industryTemplateIds: z.array(z.string().min(1)).min(1),
});

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, '项目名称不能为空'),
  status: z.enum(['draft', 'in_diligence', 'decision_ready', 'archived']),
  currency: z.enum(['CNY', 'USD', 'HKD', 'EUR']),
  amountUnit: z.enum(['yuan', 'ten_thousand', 'million']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dealProfile: dealProfileSchema,
});
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/domain/project/project.schema.test.ts`

Expected: two passing tests.

- [ ] **Step 5: Commit**

```powershell
git add app/src/domain/project
git commit -m "feat: define project and deal profile models"
```

### Task 3: Add composable industry templates and metric definitions

**Files:**
- Create: `app/src/domain/metrics/metric-definition.ts`
- Create: `app/src/domain/templates/industry-template.ts`
- Create: `app/src/domain/templates/template-registry.ts`
- Test: `app/src/domain/templates/template-registry.test.ts`

- [ ] **Step 1: Write failing template composition tests**

Create `app/src/domain/templates/template-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { composeIndustryTemplates } from './template-registry';

describe('composeIndustryTemplates', () => {
  it('combines SaaS and manufacturing metrics without duplicates', () => {
    const result = composeIndustryTemplates(['saas', 'hardtech_manufacturing']);
    const ids = result.metrics.map((metric) => metric.id);

    expect(ids).toContain('nrr');
    expect(ids).toContain('technology_readiness_level');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps project-specific custom metrics', () => {
    const result = composeIndustryTemplates(['saas'], [{
      id: 'hardware_attach_rate',
      label: '硬件绑定率',
      unit: 'percent',
      direction: 'higher_is_better',
      inputKind: 'manual',
      description: '使用硬件的付费 SaaS 客户比例',
    }]);

    expect(result.metrics.some((metric) => metric.id === 'hardware_attach_rate')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run test -- src/domain/templates/template-registry.test.ts`

Expected: FAIL because the registry is missing.

- [ ] **Step 3: Implement metric and template types**

Create `app/src/domain/metrics/metric-definition.ts`:

```ts
export type MetricUnit = 'currency' | 'percent' | 'multiple' | 'months' | 'days' | 'count' | 'level';
export type MetricDirection = 'higher_is_better' | 'lower_is_better' | 'neutral';
export type MetricInputKind = 'manual' | 'formula' | 'imported';

export interface MetricDefinition {
  id: string;
  label: string;
  unit: MetricUnit;
  direction: MetricDirection;
  inputKind: MetricInputKind;
  description: string;
  formula?: string;
}
```

Create `app/src/domain/templates/industry-template.ts`:

```ts
import type { MetricDefinition } from '../metrics/metric-definition';

export interface IndustryTemplate {
  id: string;
  name: string;
  metrics: MetricDefinition[];
}

export interface ComposedIndustryTemplate {
  selectedTemplateIds: string[];
  metrics: MetricDefinition[];
}
```

Create `app/src/domain/templates/template-registry.ts`:

```ts
import type { MetricDefinition } from '../metrics/metric-definition';
import type { ComposedIndustryTemplate, IndustryTemplate } from './industry-template';

const saas: IndustryTemplate = {
  id: 'saas',
  name: 'SaaS / 软件',
  metrics: [
    { id: 'arr', label: 'ARR', unit: 'currency', direction: 'higher_is_better', inputKind: 'imported', description: '年度经常性收入' },
    { id: 'nrr', label: 'NRR', unit: 'percent', direction: 'higher_is_better', inputKind: 'formula', description: '净收入留存率' },
    { id: 'revenue_churn', label: 'Revenue Churn', unit: 'percent', direction: 'lower_is_better', inputKind: 'formula', description: '收入流失率' },
    { id: 'cac_payback_months', label: 'CAC 毛利回收月数', unit: 'months', direction: 'lower_is_better', inputKind: 'formula', description: 'CAC ÷ 单客月度新增毛利' },
    { id: 'burn_multiple', label: 'Burn Multiple', unit: 'multiple', direction: 'lower_is_better', inputKind: 'formula', description: '净现金消耗 ÷ 净新增 ARR' },
  ],
};

const consumer: IndustryTemplate = {
  id: 'consumer',
  name: '消费品',
  metrics: [
    { id: 'repeat_purchase_rate', label: '复购率', unit: 'percent', direction: 'higher_is_better', inputKind: 'imported', description: '指定周期内重复购买客户比例' },
    { id: 'sku_concentration', label: 'SKU 集中度', unit: 'percent', direction: 'lower_is_better', inputKind: 'formula', description: '头部 SKU 收入占比' },
    { id: 'channel_concentration', label: '渠道依赖度', unit: 'percent', direction: 'lower_is_better', inputKind: 'formula', description: '最大渠道收入占比' },
    { id: 'inventory_turnover_days', label: '库存周转天数', unit: 'days', direction: 'lower_is_better', inputKind: 'formula', description: '平均库存对应销售成本天数' },
  ],
};

const hardtech: IndustryTemplate = {
  id: 'hardtech_manufacturing',
  name: '硬科技 / 制造',
  metrics: [
    { id: 'technology_readiness_level', label: '技术就绪度 TRL', unit: 'level', direction: 'higher_is_better', inputKind: 'manual', description: 'TRL 1-9' },
    { id: 'yield_rate', label: '良率', unit: 'percent', direction: 'higher_is_better', inputKind: 'imported', description: '合格产出占总产出比例' },
    { id: 'capacity_utilization', label: '产能利用率', unit: 'percent', direction: 'higher_is_better', inputKind: 'formula', description: '实际产量 ÷ 设计产能' },
    { id: 'order_backlog', label: '在手订单', unit: 'currency', direction: 'higher_is_better', inputKind: 'imported', description: '已签署但尚未确认收入的订单金额' },
  ],
};

export const industryTemplates: Record<string, IndustryTemplate> = {
  [saas.id]: saas,
  [consumer.id]: consumer,
  [hardtech.id]: hardtech,
};

export function composeIndustryTemplates(
  templateIds: string[],
  customMetrics: MetricDefinition[] = [],
): ComposedIndustryTemplate {
  const metrics = [...templateIds.flatMap((id) => industryTemplates[id]?.metrics ?? []), ...customMetrics];
  const unique = new Map(metrics.map((metric) => [metric.id, metric]));
  return { selectedTemplateIds: templateIds, metrics: [...unique.values()] };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/domain/templates/template-registry.test.ts`

Expected: two passing tests.

- [ ] **Step 5: Commit**

```powershell
git add app/src/domain/metrics app/src/domain/templates
git commit -m "feat: add composable industry templates"
```

### Task 4: Create the IndexedDB schema and project repository

**Files:**
- Create: `app/src/infrastructure/db/app-db.ts`
- Create: `app/src/infrastructure/db/project-repository.ts`
- Test: `app/src/infrastructure/db/project-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `app/src/infrastructure/db/project-repository.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { AppDb } from './app-db';
import { ProjectRepository } from './project-repository';

describe('ProjectRepository', () => {
  const db = new AppDb(`test-${crypto.randomUUID()}`);
  const repository = new ProjectRepository(db);

  afterEach(async () => {
    await db.projects.clear();
  });

  it('saves and retrieves a project', async () => {
    await repository.save({
      id: 'p1', name: '示例科技', status: 'draft', currency: 'CNY', amountUnit: 'ten_thousand',
      createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z',
      dealProfile: { strategy: 'growth', investmentAmount: '5000', targetOwnershipPct: '10', targetIrrPct: '25', targetMoic: '3', holdingPeriodYears: 5, industryTemplateIds: ['saas'] },
    });

    expect((await repository.get('p1'))?.name).toBe('示例科技');
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run test -- src/infrastructure/db/project-repository.test.ts`

Expected: FAIL because database files are missing.

- [ ] **Step 3: Implement the database and repository**

Create `app/src/infrastructure/db/app-db.ts`:

```ts
import Dexie, { type EntityTable } from 'dexie';
import type { Project } from '../../domain/project/project';
import type { EvidenceItem } from '../../domain/evidence/evidence';

export interface StoredDocument {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  parseStatus: 'stored' | 'parsed' | 'failed';
  blob: Blob;
}

export class AppDb extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  evidence!: EntityTable<EvidenceItem, 'id'>;
  documents!: EntityTable<StoredDocument, 'id'>;

  constructor(name = 'investment-due-diligence') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt, status, name',
      evidence: 'id, projectId, fieldId, conflictStatus, updatedAt',
      documents: 'id, projectId, uploadedAt, mimeType',
    });
  }
}

export const appDb = new AppDb();
```

Create `app/src/infrastructure/db/project-repository.ts`:

```ts
import type { Project } from '../../domain/project/project';
import { projectSchema } from '../../domain/project/project.schema';
import type { AppDb } from './app-db';

export class ProjectRepository {
  constructor(private readonly db: AppDb) {}

  async save(project: Project): Promise<void> {
    await this.db.projects.put(projectSchema.parse(project));
  }

  async get(id: string): Promise<Project | undefined> {
    return this.db.projects.get(id);
  }

  async list(): Promise<Project[]> {
    return this.db.projects.orderBy('updatedAt').reverse().toArray();
  }
}
```

Temporarily create `app/src/domain/evidence/evidence.ts` with the interface used by the schema; Task 5 expands its behavior:

```ts
export interface EvidenceItem {
  id: string;
  projectId: string;
  fieldId: string;
  sourceDocumentId?: string;
  sourceLocator?: string;
  rawValue: string;
  normalizedValue: string;
  confidence: number;
  conflictStatus: 'none' | 'unresolved' | 'resolved';
  updatedAt: string;
}
```

- [ ] **Step 4: Run the repository test**

Run: `npm run test -- src/infrastructure/db/project-repository.test.ts`

Expected: one passing test.

- [ ] **Step 5: Commit**

```powershell
git add app/src/infrastructure/db app/src/domain/evidence/evidence.ts
git commit -m "feat: persist projects in indexeddb"
```

### Task 5: Implement evidence conflict resolution

**Files:**
- Modify: `app/src/domain/evidence/evidence.ts`
- Create: `app/src/domain/evidence/resolve-conflict.ts`
- Test: `app/src/domain/evidence/resolve-conflict.test.ts`

- [ ] **Step 1: Write failing conflict tests**

Create `app/src/domain/evidence/resolve-conflict.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveEvidenceConflict } from './resolve-conflict';

const item = (id: string, value: string) => ({
  id, projectId: 'p1', fieldId: 'monthly_active_users', rawValue: value,
  normalizedValue: value, confidence: 0.8, conflictStatus: 'unresolved' as const,
  updatedAt: '2026-07-21T00:00:00.000Z',
});

describe('resolveEvidenceConflict', () => {
  it('uses the lower value for positive metrics', () => {
    const result = resolveEvidenceConflict([item('bp', '5000000'), item('backend', '2000000')], 'higher_is_better');
    expect(result.analysisValue).toBe('2000000');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('uses the higher value for risk or cost metrics', () => {
    const result = resolveEvidenceConflict([item('bp', '8'), item('crm', '15')], 'lower_is_better');
    expect(result.analysisValue).toBe('15');
  });

  it('blocks non-orderable conflicts', () => {
    const result = resolveEvidenceConflict([item('a', 'licensed'), item('b', 'unlicensed')], 'neutral');
    expect(result.analysisValue).toBeNull();
    expect(result.blocksConclusion).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run test -- src/domain/evidence/resolve-conflict.test.ts`

Expected: FAIL because the resolver is missing.

- [ ] **Step 3: Implement conservative resolution with decimal precision**

Extend `app/src/domain/evidence/evidence.ts`:

```ts
export interface EvidenceItem {
  id: string;
  projectId: string;
  fieldId: string;
  sourceDocumentId?: string;
  sourceLocator?: string;
  rawValue: string;
  normalizedValue: string;
  confidence: number;
  conflictStatus: 'none' | 'unresolved' | 'resolved';
  updatedAt: string;
}

export interface ConflictResolution {
  analysisValue: string | null;
  selectedEvidenceId: string | null;
  requiresConfirmation: boolean;
  blocksConclusion: boolean;
}
```

Create `app/src/domain/evidence/resolve-conflict.ts`:

```ts
import Decimal from 'decimal.js';
import type { MetricDirection } from '../metrics/metric-definition';
import type { ConflictResolution, EvidenceItem } from './evidence';

export function resolveEvidenceConflict(
  items: EvidenceItem[],
  direction: MetricDirection,
): ConflictResolution {
  if (items.length === 0) {
    return { analysisValue: null, selectedEvidenceId: null, requiresConfirmation: false, blocksConclusion: true };
  }

  if (items.length === 1) {
    return { analysisValue: items[0].normalizedValue, selectedEvidenceId: items[0].id, requiresConfirmation: false, blocksConclusion: false };
  }

  if (direction === 'neutral') {
    return { analysisValue: null, selectedEvidenceId: null, requiresConfirmation: true, blocksConclusion: true };
  }

  const ordered = [...items].sort((left, right) => new Decimal(left.normalizedValue).comparedTo(right.normalizedValue));
  const selected = direction === 'higher_is_better' ? ordered[0] : ordered[ordered.length - 1];

  return {
    analysisValue: selected.normalizedValue,
    selectedEvidenceId: selected.id,
    requiresConfirmation: true,
    blocksConclusion: false,
  };
}
```

- [ ] **Step 4: Run the conflict tests**

Run: `npm run test -- src/domain/evidence/resolve-conflict.test.ts`

Expected: three passing tests.

- [ ] **Step 5: Commit**

```powershell
git add app/src/domain/evidence
git commit -m "feat: resolve evidence conflicts conservatively"
```

### Task 6: Build project creation and navigation shell

**Files:**
- Create: `app/src/app/AppShell.tsx`
- Create: `app/src/app/router.tsx`
- Modify: `app/src/App.tsx`
- Create: `app/src/features/projects/ProjectListPage.tsx`
- Create: `app/src/features/projects/NewProjectPage.tsx`
- Modify: `app/src/main.tsx`
- Modify: `app/src/index.css`
- Test: `app/src/features/projects/NewProjectPage.test.tsx`

- [ ] **Step 1: Write a failing project-creation UI test**

Create `app/src/features/projects/NewProjectPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NewProjectPage } from './NewProjectPage';

describe('NewProjectPage', () => {
  it('creates a project with combined templates', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><NewProjectPage onCreate={onCreate} /></MemoryRouter>);

    await userEvent.type(screen.getByLabelText('项目名称'), '硬件 SaaS 示例');
    await userEvent.selectOptions(screen.getByLabelText('投资阶段'), 'vc_early');
    await userEvent.click(screen.getByLabelText('SaaS / 软件'));
    await userEvent.click(screen.getByLabelText('硬科技 / 制造'));
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: '硬件 SaaS 示例',
      dealProfile: expect.objectContaining({ strategy: 'vc_early', industryTemplateIds: ['saas', 'hardtech_manufacturing'] }),
    }));
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run test -- src/features/projects/NewProjectPage.test.tsx`

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement the page and shell**

Create `app/src/features/projects/NewProjectPage.tsx`:

```tsx
import { useForm } from 'react-hook-form';
import type { InvestmentStrategy, Project } from '../../domain/project/project';

interface FormValues { name: string; strategy: InvestmentStrategy; templates: string[] }
interface Props { onCreate: (project: Project) => Promise<void> }

export function NewProjectPage({ onCreate }: Props) {
  const { register, handleSubmit } = useForm<FormValues>({ defaultValues: { name: '', strategy: 'growth', templates: [] } });

  return (
    <main className="page">
      <h1>建立尽调项目</h1>
      <form onSubmit={handleSubmit(async (values) => {
        const now = new Date().toISOString();
        await onCreate({
          id: crypto.randomUUID(), name: values.name, status: 'draft', currency: 'CNY', amountUnit: 'ten_thousand',
          createdAt: now, updatedAt: now,
          dealProfile: { strategy: values.strategy, investmentAmount: '0', targetOwnershipPct: '10', targetIrrPct: '25', targetMoic: '3', holdingPeriodYears: 5, industryTemplateIds: values.templates },
        });
      })}>
        <label>项目名称<input aria-label="项目名称" {...register('name', { required: true })} /></label>
        <label>投资阶段<select aria-label="投资阶段" {...register('strategy')}><option value="vc_early">早期 VC</option><option value="growth">成长期</option><option value="pe_buyout">PE / 并购</option></select></label>
        <fieldset><legend>行业模板（可组合）</legend>
          <label><input type="checkbox" value="saas" {...register('templates', { required: true })} />SaaS / 软件</label>
          <label><input type="checkbox" value="consumer" {...register('templates', { required: true })} />消费品</label>
          <label><input type="checkbox" value="hardtech_manufacturing" {...register('templates', { required: true })} />硬科技 / 制造</label>
        </fieldset>
        <button type="submit">创建项目</button>
      </form>
    </main>
  );
}
```

Create `app/src/app/AppShell.tsx`:

```tsx
import { NavLink, Outlet } from 'react-router-dom';

export function AppShell() {
  return <div className="app-shell"><aside><h2>投资尽调</h2><NavLink to="/">项目</NavLink></aside><Outlet /></div>;
}
```

Create `app/src/features/projects/ProjectListPage.tsx`:

```tsx
import { Link } from 'react-router-dom';

export function ProjectListPage() {
  return <main className="page"><h1>项目工作台</h1><Link className="primary-link" to="/projects/new">新建项目</Link></main>;
}
```

Create `app/src/app/router.tsx`:

```tsx
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { appDb } from '../infrastructure/db/app-db';
import { ProjectRepository } from '../infrastructure/db/project-repository';
import { ProjectListPage } from '../features/projects/ProjectListPage';
import { NewProjectPage } from '../features/projects/NewProjectPage';

const repository = new ProjectRepository(appDb);

export const router = createBrowserRouter([{ path: '/', element: <AppShell />, children: [
  { index: true, element: <ProjectListPage /> },
  { path: 'projects/new', element: <NewProjectPage onCreate={(project) => repository.save(project)} /> },
] }]);
```

Replace `app/src/App.tsx`:

```tsx
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';

export default function App() { return <RouterProvider router={router} />; }
```

Use `app/src/main.tsx` to render `<App />` and import `./index.css`. Replace `app/src/index.css` with:

```css
:root { font-family: "Microsoft YaHei", "Segoe UI", sans-serif; color: #17232b; background: #f4f6f7; }
* { box-sizing: border-box; }
body { margin: 0; }
.app-shell { min-height: 100vh; display: grid; grid-template-columns: 220px 1fr; }
aside { background: #123a52; color: white; padding: 24px; }
aside a { color: #d8e8ec; display: block; padding: 10px 0; text-decoration: none; }
.page { padding: 36px; max-width: 1120px; }
form { display: grid; gap: 20px; max-width: 680px; background: white; padding: 24px; border-radius: 14px; }
label { display: grid; gap: 8px; }
input, select { padding: 10px 12px; border: 1px solid #c9d2d8; border-radius: 8px; }
button, .primary-link { background: #176b70; color: white; border: 0; border-radius: 8px; padding: 11px 16px; text-decoration: none; width: fit-content; }
```

- [ ] **Step 4: Run UI tests and typecheck**

Run:

```powershell
npm run test -- src/features/projects/NewProjectPage.test.tsx
npm run typecheck
```

Expected: test passes and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```powershell
git add app/src
git commit -m "feat: add project creation workflow"
```

### Task 7: Add the local file vault and data room

**Files:**
- Create: `app/src/infrastructure/files/file-vault.ts`
- Create: `app/src/features/data-room/DataRoomPage.tsx`
- Test: `app/src/infrastructure/files/file-vault.test.ts`

- [ ] **Step 1: Write failing file-vault tests**

Create `app/src/infrastructure/files/file-vault.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AppDb } from '../db/app-db';
import { FileVault } from './file-vault';

describe('FileVault', () => {
  it('stores the original document in IndexedDB', async () => {
    const db = new AppDb(`files-${crypto.randomUUID()}`);
    const vault = new FileVault(db);
    const file = new File(['sample'], 'bp.pdf', { type: 'application/pdf' });
    const stored = await vault.store('p1', file);

    expect(stored.name).toBe('bp.pdf');
    expect((await vault.list('p1'))).toHaveLength(1);
    await db.delete();
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run test -- src/infrastructure/files/file-vault.test.ts`

Expected: FAIL because `FileVault` is missing.

- [ ] **Step 3: Implement storage and upload UI**

Create `app/src/infrastructure/files/file-vault.ts`:

```ts
import type { AppDb, StoredDocument } from '../db/app-db';

export class FileVault {
  constructor(private readonly db: AppDb) {}

  async store(projectId: string, file: File): Promise<StoredDocument> {
    const document: StoredDocument = {
      id: crypto.randomUUID(), projectId, name: file.name, mimeType: file.type || 'application/octet-stream',
      size: file.size, uploadedAt: new Date().toISOString(), parseStatus: 'stored', blob: file,
    };
    await this.db.documents.put(document);
    return document;
  }

  async list(projectId: string): Promise<StoredDocument[]> {
    return this.db.documents.where('projectId').equals(projectId).sortBy('uploadedAt');
  }
}
```

Create `app/src/features/data-room/DataRoomPage.tsx`:

```tsx
import { useState } from 'react';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import type { FileVault } from '../../infrastructure/files/file-vault';

export function DataRoomPage({ projectId, vault }: { projectId: string; vault: FileVault }) {
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  return <main className="page"><h1>资料中心</h1>
    <input aria-label="上传资料" type="file" multiple accept=".xlsx,.xls,.pdf,.doc,.docx,.ppt,.pptx" onChange={async (event) => {
      for (const file of Array.from(event.target.files ?? [])) await vault.store(projectId, file);
      setDocuments(await vault.list(projectId));
    }} />
    <ul>{documents.map((document) => <li key={document.id}>{document.name} · {(document.size / 1024).toFixed(1)} KB</li>)}</ul>
  </main>;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/infrastructure/files/file-vault.test.ts`

Expected: one passing test.

- [ ] **Step 5: Commit**

```powershell
git add app/src/infrastructure/files app/src/features/data-room
git commit -m "feat: store diligence documents locally"
```

### Task 8: Parse Excel workbooks and map fields to evidence

**Files:**
- Create: `app/src/infrastructure/import/excel-importer.ts`
- Create: `app/src/features/data-room/ExcelMappingPanel.tsx`
- Test: `app/src/infrastructure/import/excel-importer.test.ts`
- Test: `app/src/features/data-room/ExcelMappingPanel.test.tsx`

- [ ] **Step 1: Write failing Excel import tests**

Create `app/src/infrastructure/import/excel-importer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { inspectWorkbook, mapRowsToEvidence } from './excel-importer';

describe('excel importer', () => {
  it('lists sheets and maps selected columns to evidence', () => {
    const sheet = XLSX.utils.json_to_sheet([{ 年份: '2025', 营业收入: 1200 }]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '利润表');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const inspected = inspectWorkbook(bytes);

    expect(inspected.sheetNames).toEqual(['利润表']);
    const evidence = mapRowsToEvidence('p1', 'doc1', inspected.sheets['利润表'], { 营业收入: 'revenue' });
    expect(evidence[0]).toMatchObject({ fieldId: 'revenue', normalizedValue: '1200', sourceLocator: '利润表!B2' });
  });
});
```

Create `app/src/features/data-room/ExcelMappingPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ExcelMappingPanel } from './ExcelMappingPanel';

it('submits an explicit source-to-target field mapping', async () => {
  const onMap = vi.fn();
  render(<ExcelMappingPanel sheet={{ name: '利润表', headers: ['营业收入'], rows: [{ 营业收入: 1200 }] }} onMap={onMap} />);
  await userEvent.selectOptions(screen.getByLabelText('营业收入 映射字段'), 'revenue');
  await userEvent.click(screen.getByRole('button', { name: '确认导入' }));
  expect(onMap).toHaveBeenCalledWith({ 营业收入: 'revenue' });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run test -- src/infrastructure/import/excel-importer.test.ts src/features/data-room/ExcelMappingPanel.test.tsx`

Expected: FAIL because the importer is missing.

- [ ] **Step 3: Implement deterministic workbook inspection and mapping**

Create `app/src/infrastructure/import/excel-importer.ts`:

```ts
import * as XLSX from 'xlsx';
import type { EvidenceItem } from '../../domain/evidence/evidence';

export interface InspectedSheet { name: string; headers: string[]; rows: Record<string, unknown>[] }
export interface InspectedWorkbook { sheetNames: string[]; sheets: Record<string, InspectedSheet> }

export function inspectWorkbook(data: ArrayBuffer | Uint8Array): InspectedWorkbook {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const sheets = Object.fromEntries(workbook.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], { defval: null });
    return [name, { name, headers: rows.length ? Object.keys(rows[0]) : [], rows } satisfies InspectedSheet];
  }));
  return { sheetNames: workbook.SheetNames, sheets };
}

export function mapRowsToEvidence(
  projectId: string,
  sourceDocumentId: string,
  sheet: InspectedSheet,
  mapping: Record<string, string>,
): EvidenceItem[] {
  return sheet.rows.flatMap((row, rowIndex) => Object.entries(mapping).flatMap(([column, fieldId]) => {
    const value = row[column];
    if (value === null || value === undefined || value === '') return [];
    const normalizedValue = value instanceof Date ? value.toISOString() : String(value).replace(/,/g, '');
    return [{
      id: crypto.randomUUID(), projectId, fieldId, sourceDocumentId,
      sourceLocator: `${sheet.name}!${XLSX.utils.encode_col(sheet.headers.indexOf(column))}${rowIndex + 2}`,
      rawValue: String(value), normalizedValue, confidence: 0.8,
      conflictStatus: 'none' as const, updatedAt: new Date().toISOString(),
    }];
  }));
}
```

Create `app/src/features/data-room/ExcelMappingPanel.tsx`:

```tsx
import { useState } from 'react';
import type { InspectedSheet } from '../../infrastructure/import/excel-importer';

const targetFields = [
  { id: '', label: '不导入' },
  { id: 'company_name', label: '公司名称' },
  { id: 'revenue', label: '营业收入' },
  { id: 'gross_margin', label: '毛利率' },
  { id: 'net_profit', label: '净利润' },
  { id: 'operating_cash_flow', label: '经营现金流' },
  { id: 'arr', label: 'ARR' },
];

export function ExcelMappingPanel({ sheet, onMap }: { sheet: InspectedSheet; onMap: (mapping: Record<string, string>) => void | Promise<void> }) {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  return <section><h2>Excel 字段映射</h2>
    <p>工作表：{sheet.name}，共 {sheet.rows.length} 行</p>
    {sheet.headers.map((header) => <label key={header}>{header}
      <select aria-label={`${header} 映射字段`} value={mapping[header] ?? ''} onChange={(event) =>
        setMapping((current) => ({ ...current, [header]: event.target.value }))}>
        {targetFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
      </select>
    </label>)}
    <button onClick={() => onMap(Object.fromEntries(Object.entries(mapping).filter(([, fieldId]) => fieldId))}>确认导入</button>
    <table><thead><tr>{sheet.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
      <tbody>{sheet.rows.slice(0, 5).map((row, index) => <tr key={index}>{sheet.headers.map((header) => <td key={header}>{String(row[header] ?? '')}</td>)}</tr>)}</tbody>
    </table>
  </section>;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/infrastructure/import/excel-importer.test.ts src/features/data-room/ExcelMappingPanel.test.tsx`

Expected: two passing tests.

- [ ] **Step 5: Commit**

```powershell
git add app/src/infrastructure/import app/src/features/data-room/ExcelMappingPanel.tsx
git commit -m "feat: import excel fields as evidence"
```

### Task 9: Calculate project readiness and show unresolved conflicts

**Files:**
- Create: `app/src/domain/readiness/calculate-readiness.ts`
- Create: `app/src/shared/ui/StatusBadge.tsx`
- Create: `app/src/features/dashboard/ProjectDashboardPage.tsx`
- Test: `app/src/domain/readiness/calculate-readiness.test.ts`

- [ ] **Step 1: Write failing readiness tests**

Create `app/src/domain/readiness/calculate-readiness.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calculateReadiness } from './calculate-readiness';

describe('calculateReadiness', () => {
  it('reports completeness and unresolved conflicts separately', () => {
    const result = calculateReadiness(['company_name', 'revenue', 'gross_margin'], [
      { fieldId: 'company_name', conflictStatus: 'none' },
      { fieldId: 'revenue', conflictStatus: 'unresolved' },
    ]);
    expect(result.completenessPct).toBe(67);
    expect(result.unresolvedConflictCount).toBe(1);
    expect(result.canExport).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run test -- src/domain/readiness/calculate-readiness.test.ts`

Expected: FAIL because the readiness function is missing.

- [ ] **Step 3: Implement readiness and dashboard components**

Create `app/src/domain/readiness/calculate-readiness.ts`:

```ts
interface EvidenceSummary { fieldId: string; conflictStatus: 'none' | 'unresolved' | 'resolved' }
export interface Readiness { completenessPct: number; missingFieldIds: string[]; unresolvedConflictCount: number; canExport: boolean }

export function calculateReadiness(requiredFieldIds: string[], evidence: EvidenceSummary[]): Readiness {
  const present = new Set(evidence.map((item) => item.fieldId));
  const missingFieldIds = requiredFieldIds.filter((fieldId) => !present.has(fieldId));
  const unresolvedConflictCount = evidence.filter((item) => item.conflictStatus === 'unresolved').length;
  const completenessPct = requiredFieldIds.length === 0 ? 100 : Math.round(((requiredFieldIds.length - missingFieldIds.length) / requiredFieldIds.length) * 100);
  return { completenessPct, missingFieldIds, unresolvedConflictCount, canExport: missingFieldIds.length === 0 && unresolvedConflictCount === 0 };
}
```

Create `app/src/shared/ui/StatusBadge.tsx`:

```tsx
export function StatusBadge({ tone, children }: { tone: 'good' | 'warning' | 'danger'; children: React.ReactNode }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}
```

Create `app/src/features/dashboard/ProjectDashboardPage.tsx`:

```tsx
import type { Readiness } from '../../domain/readiness/calculate-readiness';
import { StatusBadge } from '../../shared/ui/StatusBadge';

export function ProjectDashboardPage({ readiness }: { readiness: Readiness }) {
  return <main className="page"><h1>项目总览</h1>
    <div className="metric-card"><strong>{readiness.completenessPct}%</strong><span>数据完整度</span></div>
    <StatusBadge tone={readiness.unresolvedConflictCount ? 'danger' : 'good'}>
      未解决冲突 {readiness.unresolvedConflictCount}
    </StatusBadge>
    {readiness.missingFieldIds.length > 0 && <section><h2>待补字段</h2><ul>{readiness.missingFieldIds.map((id) => <li key={id}>{id}</li>)}</ul></section>}
  </main>;
}
```

Append to `app/src/index.css`:

```css
.status-badge { display: inline-flex; padding: 6px 10px; border-radius: 999px; font-size: 13px; }
.status-good { background: #dff3e6; color: #176239; }
.status-warning { background: #fff0c2; color: #7a5600; }
.status-danger { background: #ffe0df; color: #8c2825; }
.metric-card { background: white; border-radius: 12px; padding: 20px; display: grid; gap: 4px; width: 200px; margin-bottom: 16px; }
.metric-card strong { color: #123a52; font-size: 30px; }
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/domain/readiness/calculate-readiness.test.ts`

Expected: one passing test.

- [ ] **Step 5: Commit**

```powershell
git add app/src/domain/readiness app/src/features/dashboard app/src/shared/ui app/src/index.css
git commit -m "feat: show project readiness and conflicts"
```

### Task 10: Wire the vertical slice and verify the phase

**Files:**
- Modify: `app/src/app/router.tsx`
- Create: `app/src/infrastructure/db/evidence-repository.ts`
- Modify: `app/src/features/projects/ProjectListPage.tsx`
- Modify: `app/src/features/dashboard/ProjectDashboardPage.tsx`
- Modify: `app/src/features/data-room/DataRoomPage.tsx`
- Create: `app/src/app/phase-one.integration.test.tsx`
- Create: `app/README.md`

- [ ] **Step 1: Write a failing integration test**

Create `app/src/app/phase-one.integration.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NewProjectPage } from '../features/projects/NewProjectPage';
import { AppDb } from '../infrastructure/db/app-db';
import { EvidenceRepository } from '../infrastructure/db/evidence-repository';

describe('phase one vertical slice', () => {
  it('captures a local project with two industry templates', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><NewProjectPage onCreate={save} /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('项目名称'), '组合模式项目');
    await userEvent.click(screen.getByLabelText('SaaS / 软件'));
    await userEvent.click(screen.getByLabelText('硬科技 / 制造'));
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('marks conflicting imported values as unresolved', async () => {
    const db = new AppDb(`integration-${crypto.randomUUID()}`);
    const repository = new EvidenceRepository(db);
    const base = {
      projectId: 'p1', fieldId: 'monthly_active_users', sourceDocumentId: 'doc1',
      confidence: 0.8, updatedAt: '2026-07-21T00:00:00.000Z',
      conflictStatus: 'none' as const,
    };
    await repository.saveMany([{ ...base, id: 'e1', rawValue: '5000000', normalizedValue: '5000000' }]);
    await repository.saveMany([{ ...base, id: 'e2', rawValue: '2000000', normalizedValue: '2000000' }]);

    expect((await repository.listByProject('p1')).every((item) => item.conflictStatus === 'unresolved')).toBe(true);
    await db.delete();
  });
});
```

- [ ] **Step 2: Add project routes, evidence persistence, and a wired data room**

Create `app/src/infrastructure/db/evidence-repository.ts`:

```ts
import type { EvidenceItem } from '../../domain/evidence/evidence';
import type { AppDb } from './app-db';

export class EvidenceRepository {
  constructor(private readonly db: AppDb) {}

  async saveMany(items: EvidenceItem[]): Promise<void> {
    const projectIds = [...new Set(items.map((item) => item.projectId))];
    for (const projectId of projectIds) {
      const incoming = items.filter((item) => item.projectId === projectId);
      const existing = await this.listByProject(projectId);
      const all = [...existing, ...incoming];
      const conflictingFields = new Set(all.flatMap((candidate) => {
        const values = new Set(all.filter((item) => item.fieldId === candidate.fieldId).map((item) => item.normalizedValue));
        return values.size > 1 ? [candidate.fieldId] : [];
      }));
      await this.db.evidence.bulkPut(all.map((item) => conflictingFields.has(item.fieldId)
        ? { ...item, conflictStatus: 'unresolved' as const }
        : item));
    }
  }

  async listByProject(projectId: string): Promise<EvidenceItem[]> {
    return this.db.evidence.where('projectId').equals(projectId).toArray();
  }
}
```

Replace `app/src/features/projects/ProjectListPage.tsx`:

```tsx
import { Link } from 'react-router-dom';
import type { Project } from '../../domain/project/project';

export function ProjectListPage({ projects }: { projects: Project[] }) {
  return <main className="page"><h1>项目工作台</h1>
    <Link className="primary-link" to="/projects/new">新建项目</Link>
    <section><h2>本地项目</h2><ul>{projects.map((project) =>
      <li key={project.id}><Link to={`/projects/${project.id}`}>{project.name}</Link></li>)}</ul></section>
  </main>;
}
```

Replace `app/src/features/dashboard/ProjectDashboardPage.tsx`:

```tsx
import { Link } from 'react-router-dom';
import type { Readiness } from '../../domain/readiness/calculate-readiness';
import { StatusBadge } from '../../shared/ui/StatusBadge';

export function ProjectDashboardPage({ projectId, readiness }: { projectId: string; readiness: Readiness }) {
  return <main className="page"><h1>项目总览</h1>
    <Link className="primary-link" to={`/projects/${projectId}/data-room`}>进入资料中心</Link>
    <div className="metric-card"><strong>{readiness.completenessPct}%</strong><span>数据完整度</span></div>
    <StatusBadge tone={readiness.unresolvedConflictCount ? 'danger' : 'good'}>
      未解决冲突 {readiness.unresolvedConflictCount}
    </StatusBadge>
    {readiness.missingFieldIds.length > 0 && <section><h2>待补字段</h2><ul>{readiness.missingFieldIds.map((id) => <li key={id}>{id}</li>)}</ul></section>}
  </main>;
}
```

Replace `app/src/features/data-room/DataRoomPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import type { EvidenceRepository } from '../../infrastructure/db/evidence-repository';
import type { FileVault } from '../../infrastructure/files/file-vault';
import { inspectWorkbook, mapRowsToEvidence, type InspectedWorkbook } from '../../infrastructure/import/excel-importer';
import { ExcelMappingPanel } from './ExcelMappingPanel';

interface ExcelState {
  documentId: string;
  workbook: InspectedWorkbook;
}

export function DataRoomPage({ projectId, vault, evidenceRepository }: {
  projectId: string;
  vault: FileVault;
  evidenceRepository: EvidenceRepository;
}) {
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [excel, setExcel] = useState<ExcelState | null>(null);
  const [selectedSheetName, setSelectedSheetName] = useState('');

  useEffect(() => { void vault.list(projectId).then(setDocuments); }, [projectId, vault]);

  return <main className="page"><h1>资料中心</h1>
    <input aria-label="上传资料" type="file" multiple accept=".xlsx,.xls,.pdf,.doc,.docx,.ppt,.pptx" onChange={async (event) => {
      for (const file of Array.from(event.target.files ?? [])) {
        const stored = await vault.store(projectId, file);
        if (/\.(xlsx|xls)$/i.test(file.name)) {
          const workbook = inspectWorkbook(await file.arrayBuffer());
          setExcel({ documentId: stored.id, workbook });
          setSelectedSheetName(workbook.sheetNames[0] ?? '');
        }
      }
      setDocuments(await vault.list(projectId));
    }} />
    <ul>{documents.map((document) => <li key={document.id}>{document.name} · {(document.size / 1024).toFixed(1)} KB</li>)}</ul>
    {excel && selectedSheetName && <>
      <label>工作表<select aria-label="工作表" value={selectedSheetName} onChange={(event) => setSelectedSheetName(event.target.value)}>
        {excel.workbook.sheetNames.map((name) => <option key={name}>{name}</option>)}
      </select></label>
      <ExcelMappingPanel sheet={excel.workbook.sheets[selectedSheetName]} onMap={async (mapping) => {
        const evidence = mapRowsToEvidence(projectId, excel.documentId, excel.workbook.sheets[selectedSheetName], mapping);
        await evidenceRepository.saveMany(evidence);
      }} />
    </>}
  </main>;
}
```

Replace `app/src/app/router.tsx`:

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { createBrowserRouter, useNavigate, useParams } from 'react-router-dom';
import { calculateReadiness } from '../domain/readiness/calculate-readiness';
import { DataRoomPage } from '../features/data-room/DataRoomPage';
import { ProjectDashboardPage } from '../features/dashboard/ProjectDashboardPage';
import { NewProjectPage } from '../features/projects/NewProjectPage';
import { ProjectListPage } from '../features/projects/ProjectListPage';
import { appDb } from '../infrastructure/db/app-db';
import { EvidenceRepository } from '../infrastructure/db/evidence-repository';
import { ProjectRepository } from '../infrastructure/db/project-repository';
import { FileVault } from '../infrastructure/files/file-vault';
import { AppShell } from './AppShell';

const projectRepository = new ProjectRepository(appDb);
const evidenceRepository = new EvidenceRepository(appDb);
const fileVault = new FileVault(appDb);
const requiredFieldIds = ['company_name', 'business_description', 'revenue', 'gross_margin'];

function ProjectListRoute() {
  const projects = useLiveQuery(() => projectRepository.list(), [], []);
  return <ProjectListPage projects={projects} />;
}

function NewProjectRoute() {
  const navigate = useNavigate();
  return <NewProjectPage onCreate={async (project) => {
    await projectRepository.save(project);
    navigate(`/projects/${project.id}`);
  }} />;
}

function ProjectDashboardRoute() {
  const { projectId = '' } = useParams();
  const evidence = useLiveQuery(() => evidenceRepository.listByProject(projectId), [projectId], []);
  const readiness = calculateReadiness(requiredFieldIds, evidence);
  return <ProjectDashboardPage projectId={projectId} readiness={readiness} />;
}

function DataRoomRoute() {
  const { projectId = '' } = useParams();
  return <DataRoomPage projectId={projectId} vault={fileVault} evidenceRepository={evidenceRepository} />;
}

export const router = createBrowserRouter([{
  path: '/', element: <AppShell />, children: [
    { index: true, element: <ProjectListRoute /> },
    { path: 'projects/new', element: <NewProjectRoute /> },
    { path: 'projects/:projectId', element: <ProjectDashboardRoute /> },
    { path: 'projects/:projectId/data-room', element: <DataRoomRoute /> },
  ],
}]);
```

- [ ] **Step 3: Document local operation**

Create `app/README.md`:

```md
# 一级市场投资尽调模型

## 本地启动

1. 安装 Node.js 20 或更高版本。
2. 在本目录运行 `npm install`。
3. 运行 `npm run dev`。
4. 在浏览器打开 Vite 输出的本地地址。

项目资料保存在当前浏览器的 IndexedDB 中。阶段 1 支持创建项目、组合行业模板、保存文件、Excel 字段映射、证据冲突保守处理和数据完整度提示。

## 验证

运行 `npm run check` 执行类型检查、单元测试和 lint。
```

- [ ] **Step 4: Run the complete validation suite**

Run:

```powershell
npm run check
npm run build
```

Expected: all tests pass, lint and typecheck exit with code 0, and Vite writes a production build to `app/dist/`.

- [ ] **Step 5: Perform a manual browser smoke test**

Run: `npm run dev`

Verify:

1. Project list opens without console errors.
2. A project can be created with SaaS and hard-tech templates selected together.
3. The created project persists after refresh.
4. A PDF can be stored and listed without upload to a server.
5. An Excel workbook can be inspected and mapped.
6. Conflicting positive metrics use the lower value and remain visibly unresolved.
7. Readiness shows missing fields and blocks export readiness when conflicts remain.

- [ ] **Step 6: Commit the completed phase**

```powershell
git add app docs/superpowers/plans
git commit -m "feat: complete local diligence data foundation"
```

## Phase 1 Completion Criteria

- The app starts locally without a backend.
- Project and document data survive browser refresh through IndexedDB.
- Industry templates are composable and custom metrics are preserved by the domain API.
- Excel values become traceable evidence items with source locators.
- Evidence conflicts use direction-aware conservative values and cannot be silently hidden.
- The dashboard shows completeness and unresolved conflicts.
- `npm run check` and `npm run build` pass.
- No report, valuation, risk score, or AI output is mocked in Phase 1; those belong to later plans.
