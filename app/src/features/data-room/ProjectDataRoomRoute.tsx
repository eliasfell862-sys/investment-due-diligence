import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import type { ProjectRepository } from '../../infrastructure/db/project-repository';
import type { FileVault } from '../../infrastructure/files/file-vault';
import { DataRoomPage } from './DataRoomPage';
import type { EvidenceWriter, WorkbookInspector } from './ExcelImportWorkspace';

export interface ProjectDataRoomRouteProps {
  readonly projectRepository: Pick<ProjectRepository, 'get'>;
  readonly vault: FileVault;
  readonly evidenceRepository: EvidenceWriter;
  readonly inspector?: WorkbookInspector;
}

type DataRoomRouteState =
  | { readonly status: 'not-found' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly projectName: string };

export function ProjectDataRoomRoute({
  projectRepository,
  vault,
  evidenceRepository,
  inspector,
}: ProjectDataRoomRouteProps) {
  const { projectId = '' } = useParams();
  const [completedImportKeys, setCompletedImportKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const state = useLiveQuery<DataRoomRouteState>(async () => {
    try {
      const project = await projectRepository.get(projectId);
      return project
        ? { status: 'ready', projectName: project.name }
        : { status: 'not-found' };
    } catch {
      return { status: 'error' };
    }
  }, [projectId, projectRepository]);

  if (!state) return <p role="status">正在读取项目资料…</p>;
  if (state.status === 'error') return <p role="alert">无法读取项目数据，请重试。</p>;
  if (state.status === 'not-found') return <h1>未找到项目</h1>;

  return (
    <>
      <Link className="back-link" to={`/projects/${projectId}`}>← 返回项目总览</Link>
      <p>{state.projectName}</p>
      <DataRoomPage
        projectId={projectId}
        vault={vault}
        inspector={inspector}
        evidenceRepository={evidenceRepository}
        completedImportKeys={completedImportKeys}
        onImportCompleted={(importKey) => {
          setCompletedImportKeys((current) => new Set(current).add(importKey));
        }}
      />
    </>
  );
}
