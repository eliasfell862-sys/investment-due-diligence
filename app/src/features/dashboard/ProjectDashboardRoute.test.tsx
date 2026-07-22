import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import type { Project } from '../../domain/project/project';
import type { ProjectRepository } from '../../infrastructure/db/project-repository';
import type { EvidenceRepository } from '../../infrastructure/db/evidence-repository';
import { ProjectDashboardRoute } from './ProjectDashboardRoute';

function project(templateIds: Project['dealProfile']['industryTemplateIds']): Project {
  return {
    id: 'project-1',
    name: '示例项目',
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
});
