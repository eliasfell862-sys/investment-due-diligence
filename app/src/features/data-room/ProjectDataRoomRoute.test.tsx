import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../domain/project/project';
import { AppDb, type StoredDocument } from '../../infrastructure/db/app-db';
import type { ProjectRepository } from '../../infrastructure/db/project-repository';
import { FileVault } from '../../infrastructure/files/file-vault';
import { ProjectDataRoomRoute } from './ProjectDataRoomRoute';

// 页面测试不涉及 AI 提取，密钥库统一按锁定处理
vi.mock('../ai-agents/useAiVault', () => ({
  useAiVault: () => ({ locked: true, settings: null }),
}));

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

function project(id: string, name: string): Project {
  return { ...storedProject, id, name };
}

function storedDocument(projectId: string, name: string): StoredDocument {
  return {
    id: `${projectId}:${name}`,
    projectId,
    name,
    mimeType: 'application/pdf',
    size: 1,
    uploadedAt: '2026-07-22T00:00:00.000Z',
    parseStatus: 'unparsed',
    blob: new Blob(['x'], { type: 'application/pdf' }),
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
    <button type="button" onClick={() => navigate(`/projects/${projectId}/data-room`)}>
      切换项目
    </button>
  );
}

describe('ProjectDataRoomRoute', () => {
  let db: AppDb | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
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

  function renderSwitchableRoute(
    projectRepository: Pick<ProjectRepository, 'get'>,
    documentsByProject: Readonly<Record<string, readonly StoredDocument[]>>,
  ) {
    db = new AppDb(`project-data-room-switch-${crypto.randomUUID()}`);
    const vault = new FileVault(db);
    vi.spyOn(vault, 'list').mockImplementation(async (projectId) => [
      ...(documentsByProject[projectId] ?? []),
    ]);

    return render(
      <MemoryRouter initialEntries={['/projects/project-a/data-room']}>
        <SwitchProjectButton projectId="project-b" />
        <Routes>
          <Route
            path="/projects/:projectId/data-room"
            element={
              <ProjectDataRoomRoute
                projectRepository={projectRepository}
                vault={vault}
                evidenceRepository={{
                  saveMany: async () => undefined,
                  listByProject: async () => [],
                }}
                documentRepository={{
                  markParsing: async () => undefined,
                  saveExtraction: async () => undefined,
                  markFailed: async () => undefined,
                  listFragments: async () => [],
                  listCandidates: async () => [],
                }}
                reviewService={{
                  confirm: async () => undefined,
                  correct: async () => undefined,
                  reject: async () => undefined,
                }}
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

  it('retries a failed project query and recovers the Data Room', async () => {
    const projectRepository = {
      get: vi.fn()
        .mockRejectedValueOnce(new Error('database failed'))
        .mockResolvedValueOnce(storedProject),
    };
    renderRoute(projectRepository);

    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取项目数据，请重试。');
    await userEvent.click(screen.getByRole('button', { name: '重新读取项目数据' }));

    expect(await screen.findByText('示例项目')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '尚未上传资料' })).toBeInTheDocument();
    expect(projectRepository.get).toHaveBeenCalledTimes(2);
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

  it('clears the previous project before loading the next Data Room', async () => {
    const projectB = deferred<Project | undefined>();
    const repository = {
      get: vi.fn((projectId: string) =>
        projectId === 'project-a'
          ? Promise.resolve(project('project-a', '项目 A'))
          : projectB.promise,
      ),
    };
    renderSwitchableRoute(repository, {
      'project-a': [storedDocument('project-a', 'A.pdf')],
      'project-b': [storedDocument('project-b', 'B.pdf')],
    });

    expect(await screen.findByText('项目 A')).toBeInTheDocument();
    expect(await screen.findByText('A.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解析资料' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '切换项目' }));

    expect(screen.getByText('正在读取项目资料…')).toBeInTheDocument();
    expect(screen.queryByText('项目 A')).not.toBeInTheDocument();
    expect(screen.queryByText('B.pdf')).not.toBeInTheDocument();

    await act(async () => {
      projectB.resolve(project('project-b', '项目 B'));
      await projectB.promise;
    });
    expect(await screen.findByText('项目 B')).toBeInTheDocument();
    expect(await screen.findByText('B.pdf')).toBeInTheDocument();
    expect(screen.queryByText('A.pdf')).not.toBeInTheDocument();
  });

  it('ignores a late project result after the Data Room parameter changes', async () => {
    const projectA = deferred<Project | undefined>();
    const projectB = deferred<Project | undefined>();
    const repository = {
      get: vi.fn((projectId: string) =>
        projectId === 'project-a' ? projectA.promise : projectB.promise,
      ),
    };
    renderSwitchableRoute(repository, {
      'project-a': [storedDocument('project-a', 'A.pdf')],
      'project-b': [storedDocument('project-b', 'B.pdf')],
    });

    await userEvent.click(screen.getByRole('button', { name: '切换项目' }));
    await act(async () => {
      projectB.resolve(project('project-b', '项目 B'));
      await projectB.promise;
    });
    expect(await screen.findByText('项目 B')).toBeInTheDocument();
    expect(await screen.findByText('B.pdf')).toBeInTheDocument();

    await act(async () => {
      projectA.resolve(project('project-a', '项目 A'));
      await projectA.promise;
      await Promise.resolve();
    });
    expect(screen.getByText('项目 B')).toBeInTheDocument();
    expect(screen.getByText('B.pdf')).toBeInTheDocument();
    expect(screen.queryByText('项目 A')).not.toBeInTheDocument();
    expect(screen.queryByText('A.pdf')).not.toBeInTheDocument();
  });
});
