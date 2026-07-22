import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../domain/project/project';
import { AppDb } from '../../infrastructure/db/app-db';
import { ProjectRepository } from '../../infrastructure/db/project-repository';
import { ProjectListPage } from './ProjectListPage';

function project(id: string, name: string, updatedAt: string): Project {
  return {
    id,
    name,
    status: 'draft',
    currency: 'CNY',
    amountUnit: 'ten_thousand',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt,
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
}

describe('ProjectListPage', () => {
  let db: AppDb | undefined;

  afterEach(async () => {
    await db?.delete();
    db = undefined;
  });

  function renderPage(repository: Pick<ProjectRepository, 'list'>) {
    return render(
      <MemoryRouter>
        <ProjectListPage repository={repository} />
      </MemoryRouter>,
    );
  }

  it('shows loading and database error states', async () => {
    const loadingRepository = { list: () => new Promise<Project[]>(() => undefined) };
    const view = renderPage(loadingRepository);
    expect(screen.getByText('正在读取项目…')).toBeInTheDocument();

    view.unmount();
    renderPage({ list: async () => { throw new Error('database unavailable'); } });
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取本地项目，请重试。');
  });

  it('retries a failed project list query and recovers', async () => {
    const repository = {
      list: vi.fn()
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockResolvedValueOnce([project('recovered', '恢复项目', '2026-07-22T03:00:00.000Z')]),
    };
    renderPage(repository);

    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取本地项目，请重试。');
    await userEvent.click(screen.getByRole('button', { name: '重新读取项目' }));

    expect(await screen.findByRole('link', { name: '恢复项目' })).toBeInTheDocument();
    expect(repository.list).toHaveBeenCalledTimes(2);
  });

  it('lists persisted projects newest first and survives a component refresh', async () => {
    db = new AppDb(`project-list-${crypto.randomUUID()}`);
    const repository = new ProjectRepository(db);
    await repository.save(project('older', '较早项目', '2026-07-22T00:00:00.000Z'));
    await repository.save(project('newer', '最新项目', '2026-07-22T01:00:00.000Z'));

    const first = renderPage(repository);
    expect(await screen.findByRole('link', { name: '最新项目' })).toBeInTheDocument();
    const projectLinks = screen.getAllByRole('link').filter((link) =>
      link.getAttribute('href')?.startsWith('/projects/') &&
      link.getAttribute('href') !== '/projects/new',
    );
    expect(projectLinks.map((link) => link.textContent)).toEqual(['最新项目', '较早项目']);
    expect(projectLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/projects/newer',
      '/projects/older',
    ]);

    first.unmount();
    renderPage(new ProjectRepository(db));
    expect(await screen.findByRole('link', { name: '最新项目' })).toBeInTheDocument();
  });

  it('reacts live when a project is added to IndexedDB', async () => {
    db = new AppDb(`project-list-${crypto.randomUUID()}`);
    const repository = new ProjectRepository(db);
    renderPage(repository);
    expect(await screen.findByText('从一份清晰的投资命题开始')).toBeInTheDocument();

    await repository.save(project('live', '实时项目', '2026-07-22T02:00:00.000Z'));

    expect(await screen.findByRole('link', { name: '实时项目' })).toHaveAttribute(
      'href',
      '/projects/live',
    );
  });
});
