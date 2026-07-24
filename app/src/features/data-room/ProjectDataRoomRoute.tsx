import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import type { ProjectRepository } from '../../infrastructure/db/project-repository';
import type { FileVault } from '../../infrastructure/files/file-vault';
import {
  DataRoomPage,
  type DataRoomEvidenceRepository,
  type DataRoomPageProps,
} from './DataRoomPage';
import type { WorkbookInspector } from './ExcelImportWorkspace';
import type { DocumentInspector } from './DocumentExtractionWorkspace';

export interface ProjectDataRoomRouteProps {
  readonly projectRepository: Pick<ProjectRepository, 'get'>;
  readonly vault: FileVault;
  readonly evidenceRepository: DataRoomEvidenceRepository;
  readonly documentRepository?: DataRoomPageProps['documentRepository'];
  readonly reviewService?: DataRoomPageProps['reviewService'];
  readonly inspector?: WorkbookInspector;
  readonly documentInspector?: DocumentInspector;
}

type DataRoomRouteState =
  | { readonly status: 'not-found'; readonly projectId: string }
  | { readonly status: 'error'; readonly projectId: string }
  | { readonly status: 'ready'; readonly projectId: string; readonly projectName: string };

export function ProjectDataRoomRoute({
  projectRepository,
  vault,
  evidenceRepository,
  documentRepository,
  reviewService,
  inspector,
  documentInspector,
}: ProjectDataRoomRouteProps) {
  const { projectId = '' } = useParams();
  const [completedImportKeys, setCompletedImportKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [retryCount, setRetryCount] = useState(0);
  const state = useLiveQuery<DataRoomRouteState>(async () => {
    try {
      const project = await projectRepository.get(projectId);
      return project
        ? { status: 'ready', projectId, projectName: project.name }
        : { status: 'not-found', projectId };
    } catch {
      return { status: 'error', projectId };
    }
  }, [projectId, projectRepository, retryCount]);

  if (!state || state.projectId !== projectId) {
    return <p role="status">正在读取项目资料…</p>;
  }
  if (state.status === 'error') {
    return (
      <div>
        <p role="alert">无法读取项目数据，请重试。</p>
        <button type="button" onClick={() => setRetryCount((current) => current + 1)}>
          重新读取项目数据
        </button>
      </div>
    );
  }
  if (state.status === 'not-found') return <h1>未找到项目</h1>;

  return (
    <>
      <Link className="back-link" to={`/projects/${state.projectId}`}>← 返回项目总览</Link>
      <p>{state.projectName}</p>
      <DataRoomPage
        projectId={state.projectId}
        vault={vault}
        inspector={inspector}
        documentInspector={documentInspector}
        evidenceRepository={evidenceRepository}
        documentRepository={documentRepository}
        reviewService={reviewService}
        completedImportKeys={completedImportKeys}
        onImportCompleted={(importKey) => {
          setCompletedImportKeys((current) => new Set(current).add(importKey));
        }}
      />
    </>
  );
}
