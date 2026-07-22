import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '../../domain/project/project';
import { AppDb } from '../../infrastructure/db/app-db';
import type { ProjectRepository } from '../../infrastructure/db/project-repository';
import { FileVault } from '../../infrastructure/files/file-vault';
import { ProjectDataRoomRoute } from './ProjectDataRoomRoute';

const storedProject: Project = {
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
    industryTemplateIds: ['consumer'],
  },
};

describe('ProjectDataRoomRoute', () => {
  let db: AppDb | undefined;

  afterEach(async () => {
    await db?.delete();
    db = undefined;
  });

  function renderRoute(projectRepository: Pick<ProjectRepository, 'get'>) {
    db = new AppDb(`project-data-room-route-${crypto.randomUUID()}`);

    return render(
      <MemoryRouter initialEntries={['/projects/project-1/data-room']}>
        <Routes>
          <Route
            path="/projects/:projectId/data-room"
            element={
              <ProjectDataRoomRoute
                projectRepository={projectRepository}
                vault={new FileVault(db)}
                evidenceRepository={{ saveMany: async () => undefined }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('shows loading, database error, and not-found states', async () => {
    const loading = renderRoute({
      get: () => new Promise<Project | undefined>(() => undefined),
    });
    expect(screen.getByText('正在读取项目资料…')).toBeInTheDocument();
    loading.unmount();

    const failed = renderRoute({
      get: async () => { throw new Error('database failed'); },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取项目数据，请重试。');
    failed.unmount();

    renderRoute({ get: async () => undefined });
    expect(await screen.findByRole('heading', { name: '未找到项目' })).toBeInTheDocument();
  });

  it('renders the project Data Room and links back to its dashboard', async () => {
    renderRoute({ get: async () => storedProject });

    expect(await screen.findByRole('heading', { name: '资料中心' })).toBeInTheDocument();
    expect(screen.getByText('示例项目')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /返回项目总览/ })).toHaveAttribute(
      'href',
      '/projects/project-1',
    );
    expect(await screen.findByRole('heading', { name: '尚未上传资料' })).toBeInTheDocument();
  });
});
