import { fireEvent, render, screen } from '@testing-library/react';
import { File as NativeFile } from 'node:buffer';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveEvidenceConflict } from '../domain/evidence/resolve-conflict';
import { findTargetFieldDefinition } from '../domain/evidence/target-fields';
import type { Project } from '../domain/project/project';
import { ProjectDashboardRoute } from '../features/dashboard/ProjectDashboardRoute';
import { ProjectDataRoomRoute } from '../features/data-room/ProjectDataRoomRoute';
import { AppDb } from '../infrastructure/db/app-db';
import { EvidenceRepository } from '../infrastructure/db/evidence-repository';
import { ProjectRepository } from '../infrastructure/db/project-repository';
import { FileVault } from '../infrastructure/files/file-vault';
import {
  inspectWorkbookInWorker,
  type InspectedWorkbook,
} from '../infrastructure/import/excel-importer';

const workbook: InspectedWorkbook = {
  sheetNames: ['Operating'],
  sheets: {
    Operating: {
      name: 'Operating',
      headers: ['Company', 'Description', 'Period', 'Revenue', 'Margin', 'ARR'],
      rows: [
        {
          Company: 'ACME',
          Description: 'Subscription software',
          Period: '2025',
          Revenue: 120,
          Margin: 0.45,
          ARR: 90,
        },
        {
          Company: 'ACME',
          Description: 'Subscription software',
          Period: '2025',
          Revenue: 100,
          Margin: 0.4,
          ARR: 80,
        },
      ],
      cells: [
        {
          Company: { value: 'ACME' },
          Description: { value: 'Subscription software' },
          Period: { value: '2025' },
          Revenue: { value: 120 },
          Margin: { value: 0.45 },
          ARR: { value: 90 },
        },
        {
          Company: { value: 'ACME' },
          Description: { value: 'Subscription software' },
          Period: { value: '2025' },
          Revenue: { value: 100 },
          Margin: { value: 0.4 },
          ARR: { value: 80 },
        },
      ],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    },
  },
};

const project: Project = {
  id: 'project-1',
  name: '复合模板项目',
  status: 'draft',
  currency: 'CNY',
  amountUnit: 'ten_thousand',
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  dealProfile: {
    strategy: 'growth',
    investmentAmount: '0',
    targetOwnershipPct: '10',
    targetIrrPct: '25',
    targetMoic: '3',
    holdingPeriodYears: 5,
    industryTemplateIds: ['saas', 'hardtech_manufacturing'],
  },
};

class RespondingWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly postMessage = vi.fn(() => {
    queueMicrotask(() => {
      this.onmessage?.({ data: { ok: true, workbook } } as MessageEvent);
    });
  });
  readonly terminate = vi.fn();
}

function renderDataRoom(
  projectRepository: ProjectRepository,
  evidenceRepository: EvidenceRepository,
  vault: FileVault,
  workerFactory: () => never,
) {
  return render(
    <MemoryRouter initialEntries={['/projects/project-1/data-room']}>
      <Routes>
        <Route
          path="/projects/:projectId/data-room"
          element={
            <ProjectDataRoomRoute
              projectRepository={projectRepository}
              evidenceRepository={evidenceRepository}
              vault={vault}
              inspector={(data) => inspectWorkbookInWorker(data, { workerFactory })}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function importWorkbook() {
  await screen.findByText('financials.xlsx');
  fireEvent.click(screen.getByRole('button', { name: '解析 financials.xlsx' }));
  await screen.findByRole('heading', { name: 'Operating' });

  const mapping = {
    Company: 'company_name',
    Description: 'business_description',
    Period: 'period_end',
    Revenue: 'revenue',
    Margin: 'gross_margin',
    ARR: 'arr',
  } as const;
  for (const [source, target] of Object.entries(mapping)) {
    fireEvent.change(screen.getByLabelText(`${source} 映射字段`), {
      target: { value: target },
    });
  }
  fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
  expect(await screen.findByRole('button', { name: '导入完成' })).toBeDisabled();
}

describe('offline investment due diligence flow', () => {
  const dbName = `investment-flow-${crypto.randomUUID()}`;
  let db: AppDb | undefined;

  afterEach(async () => {
    db?.close();
    await new AppDb(dbName).delete();
  });

  it('persists a multi-template project and conflict-aware Excel evidence across reloads', async () => {
    db = new AppDb(dbName);
    const initialProjects = new ProjectRepository(db);
    const initialVault = new FileVault(db, {
      createId: () => 'document-1',
      now: () => new Date('2026-07-22T01:00:00.000Z'),
    });
    await initialProjects.save(project);
    await initialVault.store(
      project.id,
      new NativeFile([new Uint8Array([1])], 'financials.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }) as unknown as File,
    );

    db.close();
    db = new AppDb(dbName);
    let projects = new ProjectRepository(db);
    let evidence = new EvidenceRepository(db);
    let vault = new FileVault(db);
    const workers: RespondingWorker[] = [];
    const workerFactory = vi.fn(() => {
      const worker = new RespondingWorker();
      workers.push(worker);
      return worker as never;
    });

    expect((await projects.get(project.id))?.dealProfile.industryTemplateIds).toEqual([
      'saas',
      'hardtech_manufacturing',
    ]);
    expect(await vault.list(project.id)).toHaveLength(1);

    const firstView = renderDataRoom(projects, evidence, vault, workerFactory);
    await importWorkbook();
    const firstImport = await evidence.listByProject(project.id);
    expect(firstImport).toHaveLength(12);
    expect(new Set(firstImport.map((item) => item.id)).size).toBe(12);
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(workers[0]?.postMessage).toHaveBeenCalledOnce();
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    firstView.unmount();

    const firstIds = firstImport.map((item) => item.id);
    db.close();
    db = new AppDb(dbName);
    projects = new ProjectRepository(db);
    evidence = new EvidenceRepository(db);
    vault = new FileVault(db);

    expect(await projects.list()).toEqual([project]);
    expect(await vault.list(project.id)).toHaveLength(1);
    expect((await evidence.listByProject(project.id)).map((item) => item.id)).toEqual(firstIds);

    const replayView = renderDataRoom(projects, evidence, vault, workerFactory);
    await importWorkbook();
    expect((await evidence.listByProject(project.id)).map((item) => item.id)).toEqual(firstIds);
    replayView.unmount();

    const storedEvidence = await evidence.listByProject(project.id);
    const revenueEvidence = storedEvidence.filter((item) => item.fieldId === 'revenue');
    expect(revenueEvidence).toHaveLength(2);
    expect(revenueEvidence.every((item) => item.conflictStatus === 'unresolved')).toBe(true);
    const revenueDefinition = findTargetFieldDefinition('revenue');
    if (!revenueDefinition) throw new Error('Expected revenue target definition');
    expect(resolveEvidenceConflict(revenueEvidence, revenueDefinition.direction)).toMatchObject({
      status: 'provisional',
      analysisValue: '100',
    });

    render(
      <MemoryRouter initialEntries={['/projects/project-1']}>
        <Routes>
          <Route
            path="/projects/:projectId"
            element={
              <ProjectDashboardRoute
                projectRepository={projects}
                evidenceRepository={evidence}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('复合模板项目')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('3 组')).toBeInTheDocument();
    expect(screen.getByText('尚未就绪')).toBeInTheDocument();
  });
});
