import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import type { Project } from '../../domain/project/project';
import type { EvidenceRepository } from '../../infrastructure/db/evidence-repository';
import type { ProjectRepository } from '../../infrastructure/db/project-repository';
import { ProjectDashboardRoute } from './ProjectDashboardRoute';

function project(
  templateIds: Project['dealProfile']['industryTemplateIds'],
  id = 'project-1',
  name = '示例项目',
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
    periodIdentity: '2025',
    dimensionIdentity: 'company=acme',
    normalizedValue,
    importBatchId: 'batch',
    sourceDocumentId: 'document',
    sourceSheet: 'Sheet1',
    sourceRow: 2,
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
    <button type="button" onClick={() => navigate(`/projects/${projectId}`)}>
      切换项目
    </button>
  );
}

function renderRoute(
  projectRepository: Pick<ProjectRepository, 'get'>,
  evidenceRepository: Pick<EvidenceRepository, 'listByProject'>,
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
    expect(screen.getByText('正在读取项目就绪度…')).toBeInTheDocument();
    loading.unmount();

    const failed = renderRoute(
      { get: async () => { throw new Error('database failed'); } },
      { listByProject: async () => [] },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取项目数据，请重试。');
    failed.unmount();

    renderRoute(

      { get: async () => undefined },
      { listByProject: async () => [] },
    );
    expect(await screen.findByRole('heading', { name: '未找到项目' })).toBeInTheDocument();
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
    renderRoute(projectRepository, evidenceRepository);

    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取项目数据，请重试。');
    await userEvent.click(screen.getByRole('button', { name: '重新读取项目数据' }));

    expect(await screen.findByText('示例项目')).toBeInTheDocument();
    expect(projectRepository.get).toHaveBeenCalledTimes(2);
    expect(evidenceRepository.listByProject).toHaveBeenCalledOnce();
  });

  it('calculates core readiness and links the dashboard to Data Room', async () => {
    renderRoute(
      { get: async () => project(['consumer']) },
      { listByProject: async () => [evidence('company_name', 'ACME')] },
    );

    expect(await screen.findByText('示例项目')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入资料中心' })).toHaveAttribute(
      'href',
      '/projects/project-1/data-room',
    );
    expect(screen.getByText('业务描述')).toBeInTheDocument();
    expect(screen.getByText('营业收入')).toBeInTheDocument();
    expect(screen.getByText('毛利率')).toBeInTheDocument();
    expect(screen.queryByText('ARR')).not.toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('requires ARR only for a SaaS project with the canonical import chain', async () => {
    renderRoute(
      { get: async () => project(['saas', 'hardtech_manufacturing']) },
      {
        listByProject: async () => [
          evidence('company_name', 'ACME'),
          evidence('business_description', '订阅软件'),
          evidence('revenue', '1200'),
          evidence('gross_margin', '0.4'),
        ],
      },
    );

    expect(await screen.findByText('ARR')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('clears a ready project immediately when the route parameter changes', async () => {
    const projectB = deferred<Project | undefined>();
    const repository = {
      get: vi.fn((projectId: string) =>
        projectId === 'project-a'
          ? Promise.resolve(project(['consumer'], 'project-a', '项目 A'))
          : projectB.promise,
      ),
    };
    renderSwitchableRoute(repository, { listByProject: async () => [] });

    expect(await screen.findByText('项目 A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '切换项目' }));

    expect(screen.getByText('正在读取项目就绪度…')).toBeInTheDocument();
    expect(screen.queryByText('项目 A')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '进入资料中心' })).not.toBeInTheDocument();

    await act(async () => {
      projectB.resolve(project(['consumer'], 'project-b', '项目 B'));
      await projectB.promise;
    });
    expect(await screen.findByText('项目 B')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入资料中心' })).toHaveAttribute(
      'href',
      '/projects/project-b/data-room',
    );
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

    await userEvent.click(screen.getByRole('button', { name: '切换项目' }));
    await act(async () => {
      projectB.resolve(project(['consumer'], 'project-b', '项目 B'));
      await projectB.promise;
    });
    expect(await screen.findByText('项目 B')).toBeInTheDocument();

    await act(async () => {
      projectA.resolve(project(['consumer'], 'project-a', '项目 A'));
      await projectA.promise;
      await Promise.resolve();
    });
    expect(screen.getByText('项目 B')).toBeInTheDocument();
    expect(screen.queryByText('项目 A')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入资料中心' })).toHaveAttribute(
      'href',
      '/projects/project-b/data-room',
    );
  });
});
