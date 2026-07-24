import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { File as NativeFile } from 'node:buffer';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import type { Project } from '../../domain/project/project';
import { AppDb } from '../../infrastructure/db/app-db';
import { DocumentEvidenceRepository } from '../../infrastructure/db/document-evidence-repository';
import { EvidenceRepository } from '../../infrastructure/db/evidence-repository';
import { ProjectRepository } from '../../infrastructure/db/project-repository';
import { FileVault } from '../../infrastructure/files/file-vault';
import { ProjectDashboardRoute } from './ProjectDashboardRoute';

function project(
  templateIds: Project['dealProfile']['industryTemplateIds'],
  id = 'project-1',
  name = '\u793a\u4f8b\u9879\u76ee',
): Project {
  return {
    id,
    name,
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
      industryTemplateIds: templateIds,
    },
  };
}

function evidence(fieldId: string, normalizedValue: string): EvidenceItem {
  return {
    id: fieldId,
    projectId: 'project-1',
    fieldId,
    periodIdentity: 'source-document:document-1:undated',
    dimensionIdentity: 'project:project-1:default',
    normalizedValue,
    importBatchId: 'batch',
    sourceDocumentId: 'document-1',
    sourceType: 'document_fact',
    sourceSheet: 'Document',
    sourceRow: 1,
    rawValue: normalizedValue,
    confidence: 0.8,
    conflictStatus: 'none',
    updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function SwitchProjectButton({ projectId }: { readonly projectId: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/projects/' + projectId)}>
      {'\u5207\u6362\u9879\u76ee'}
    </button>
  );
}

function renderRoute(
  projectRepository: Pick<ProjectRepository, 'get'>,
  evidenceRepository: Pick<EvidenceRepository, 'listByProject'>,
  fileVault: Pick<FileVault, 'countByProject'> = { countByProject: async () => 1 },
  documentRepository: Pick<DocumentEvidenceRepository, 'countPendingByProject'> = {
    countPendingByProject: async () => 0,
  },
) {
  return render(
    <MemoryRouter initialEntries={['/projects/project-1']}>
      <Routes>
        <Route
          path="/projects/:projectId"
          element={
            <ProjectDashboardRoute
              projectRepository={projectRepository}
              evidenceRepository={evidenceRepository}
              fileVault={fileVault}
              documentEvidenceRepository={documentRepository}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderSwitchableRoute(
  projectRepository: Pick<ProjectRepository, 'get'>,
  evidenceRepository: Pick<EvidenceRepository, 'listByProject'>,
) {
  return render(
    <MemoryRouter initialEntries={['/projects/project-a']}>
      <SwitchProjectButton projectId="project-b" />
      <Routes>
        <Route
          path="/projects/:projectId"
          element={
            <ProjectDashboardRoute
              projectRepository={projectRepository}
              evidenceRepository={evidenceRepository}
              fileVault={{ countByProject: async () => 0 }}
              documentEvidenceRepository={{ countPendingByProject: async () => 0 }}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProjectDashboardRoute', () => {
  it('shows loading, database error, and not-found states', async () => {
    const loading = renderRoute(
      { get: () => new Promise<Project | undefined>(() => undefined) },
      { listByProject: async () => [] },
    );
    expect(screen.getByText('\u6b63\u5728\u8bfb\u53d6\u9879\u76ee\u5c31\u7eea\u5ea6\u2026')).toBeInTheDocument();
    loading.unmount();

    const failed = renderRoute(
      { get: async () => { throw new Error('database failed'); } },
      { listByProject: async () => [] },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '\u65e0\u6cd5\u8bfb\u53d6\u9879\u76ee\u6570\u636e\uff0c\u8bf7\u91cd\u8bd5\u3002',
    );
    failed.unmount();

    renderRoute(
      { get: async () => undefined },
      { listByProject: async () => [] },
    );
    expect(await screen.findByRole('heading', {
      name: '\u672a\u627e\u5230\u9879\u76ee',
    })).toBeInTheDocument();
  });

  it('retries a failed dashboard query and recovers', async () => {
    const projectRepository = {
      get: vi.fn()
        .mockRejectedValueOnce(new Error('database failed'))
        .mockResolvedValueOnce(project(['consumer'])),
    };
    const evidenceRepository = {
      listByProject: vi.fn().mockResolvedValue([]),
    };
    renderRoute(
      projectRepository,
      evidenceRepository,
      { countByProject: async () => 0 },
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '\u65e0\u6cd5\u8bfb\u53d6\u9879\u76ee\u6570\u636e\uff0c\u8bf7\u91cd\u8bd5\u3002',
    );
    await userEvent.click(screen.getByRole('button', {
      name: '\u91cd\u65b0\u8bfb\u53d6\u9879\u76ee\u6570\u636e',
    }));

    expect(await screen.findByText('\u793a\u4f8b\u9879\u76ee')).toBeInTheDocument();
    expect(projectRepository.get).toHaveBeenCalledTimes(2);
    expect(evidenceRepository.listByProject).toHaveBeenCalledOnce();
  });

  it('queries local document and pending-candidate counts for both report gates', async () => {
    const fileVault = { countByProject: vi.fn().mockResolvedValue(1) };
    const documentRepository = {
      countPendingByProject: vi.fn().mockResolvedValue(2),
    };
    renderRoute(
      { get: async () => project(['consumer']) },
      {
        listByProject: async () => [
          evidence('company_name', 'ACME'),
          evidence('business_description', 'Subscription software'),
          evidence('team_summary', 'Experienced team'),
        ],
      },
      fileVault,
      documentRepository,
    );

    expect(await screen.findByText('\u793a\u4f8b\u9879\u76ee')).toBeInTheDocument();
    expect(screen.getByRole('link', {
      name: '\u8fdb\u5165\u8d44\u6599\u4e2d\u5fc3',
    })).toHaveAttribute('href', '/projects/project-1/data-room');
    expect(screen.getByText('2 \u9879\u5f85\u5ba1\u6838')).toBeInTheDocument();
    expect(screen.getByText(
      '\u8d44\u6599\u4e0d\u8db3\uff0c\u6682\u7f13\u51b3\u7b56',
    )).toBeInTheDocument();
    const quickLookGate = screen.getByRole('article', {
      name: '\u9879\u76ee\u901f\u89c8\u62a5\u544a',
    });
    expect(within(quickLookGate).getAllByText(
      '\u5df2\u6ee1\u8db3\u6761\u4ef6',
    )).not.toHaveLength(0);
    const formalGate = screen.getByRole('article', {
      name: '\u6b63\u5f0f\u6295\u8d44\u5907\u5fd8\u5f55',
    });
    expect(within(formalGate).getByText('\u8425\u4e1a\u6536\u5165')).toBeInTheDocument();
    expect(within(formalGate).getByText('\u6bdb\u5229\u7387')).toBeInTheDocument();
    expect(fileVault.countByProject).toHaveBeenCalledWith('project-1');
    expect(documentRepository.countPendingByProject).toHaveBeenCalledWith('project-1');
  });

  it('requires ARR only for a SaaS project', async () => {
    renderRoute(
      { get: async () => project(['saas', 'hardtech_manufacturing']) },
      {
        listByProject: async () => [
          evidence('company_name', 'ACME'),
          evidence('business_description', '\u8ba2\u9605\u8f6f\u4ef6'),
          evidence('revenue', '1200'),
          evidence('gross_margin', '0.4'),
        ],
      },
    );

    expect(await screen.findByText('\u793a\u4f8b\u9879\u76ee')).toBeInTheDocument();
    const formalGate = screen.getByRole('article', {
      name: '\u6b63\u5f0f\u6295\u8d44\u5907\u5fd8\u5f55',
    });
    expect(within(formalGate).getByText('ARR')).toBeInTheDocument();
  });

  it('clears the ready project immediately when the route parameter changes', async () => {
    const projectB = deferred<Project | undefined>();
    const repository = {
      get: vi.fn((projectId: string) =>
        projectId === 'project-a'
          ? Promise.resolve(project(['consumer'], 'project-a', '\u9879\u76ee A'))
          : projectB.promise,
      ),
    };
    renderSwitchableRoute(repository, { listByProject: async () => [] });

    expect(await screen.findByText('\u9879\u76ee A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {
      name: '\u5207\u6362\u9879\u76ee',
    }));

    expect(screen.getByText(
      '\u6b63\u5728\u8bfb\u53d6\u9879\u76ee\u5c31\u7eea\u5ea6\u2026',
    )).toBeInTheDocument();
    expect(screen.queryByText('\u9879\u76ee A')).not.toBeInTheDocument();

    await act(async () => {
      projectB.resolve(project(['consumer'], 'project-b', '\u9879\u76ee B'));
      await projectB.promise;
    });
    expect(await screen.findByText('\u9879\u76ee B')).toBeInTheDocument();
  });

  it('ignores a late result from the previous project parameter', async () => {
    const projectA = deferred<Project | undefined>();
    const projectB = deferred<Project | undefined>();
    const repository = {
      get: vi.fn((projectId: string) =>
        projectId === 'project-a' ? projectA.promise : projectB.promise,
      ),
    };
    renderSwitchableRoute(repository, { listByProject: async () => [] });

    await userEvent.click(screen.getByRole('button', {
      name: '\u5207\u6362\u9879\u76ee',
    }));
    await act(async () => {
      projectB.resolve(project(['consumer'], 'project-b', '\u9879\u76ee B'));
      await projectB.promise;
    });
    expect(await screen.findByText('\u9879\u76ee B')).toBeInTheDocument();

    await act(async () => {
      projectA.resolve(project(['consumer'], 'project-a', '\u9879\u76ee A'));
      await projectA.promise;
      await Promise.resolve();
    });
    expect(screen.getByText('\u9879\u76ee B')).toBeInTheDocument();
    expect(screen.queryByText('\u9879\u76ee A')).not.toBeInTheDocument();
  });

  it('reacts to real local document writes through the live query', async () => {
    const db = new AppDb('dashboard-live-' + crypto.randomUUID());
    const projects = new ProjectRepository(db);
    const evidenceRepository = new EvidenceRepository(db);
    const fileVault = new FileVault(db, { createId: () => 'document-1' });
    const documentRepository = new DocumentEvidenceRepository(db);
    await projects.save(project(['consumer']));
    await evidenceRepository.saveMany([
      evidence('company_name', 'ACME'),
      evidence('business_description', 'Subscription software'),
      evidence('team_summary', 'Experienced team'),
    ]);

    const view = renderRoute(
      projects,
      evidenceRepository,
      fileVault,
      documentRepository,
    );
    try {
      expect(await screen.findByText('\u793a\u4f8b\u9879\u76ee')).toBeInTheDocument();
      let quickLookGate = screen.getByRole('article', {
        name: '\u9879\u76ee\u901f\u89c8\u62a5\u544a',
      });
      expect(within(quickLookGate).getAllByText(
        '\u5c1a\u672a\u6ee1\u8db3\u6761\u4ef6',
      )).not.toHaveLength(0);

      await fileVault.store(
        'project-1',
        new NativeFile(['memo'], 'memo.pdf', {
          type: 'application/pdf',
        }) as unknown as File,
      );

      await waitFor(() => {
        quickLookGate = screen.getByRole('article', {
          name: '\u9879\u76ee\u901f\u89c8\u62a5\u544a',
        });
        expect(within(quickLookGate).getAllByText(
          '\u5df2\u6ee1\u8db3\u6761\u4ef6',
        )).not.toHaveLength(0);
      });
    } finally {
      view.unmount();
      await db.delete();
    }
  });
});
