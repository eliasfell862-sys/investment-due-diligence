import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useParams } from 'react-router-dom';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
import { calculateReportReadiness } from '../../domain/readiness/calculate-report-readiness';
import type { DocumentEvidenceRepository } from '../../infrastructure/db/document-evidence-repository';
import type { EvidenceRepository } from '../../infrastructure/db/evidence-repository';
import type { ProjectRepository } from '../../infrastructure/db/project-repository';
import type { FileVault } from '../../infrastructure/files/file-vault';
import { ProjectDashboardPage } from './ProjectDashboardPage';

export interface ProjectDashboardRouteProps {
  readonly projectRepository: Pick<ProjectRepository, 'get'>;
  readonly evidenceRepository: Pick<EvidenceRepository, 'listByProject'>;
  readonly fileVault: Pick<FileVault, 'list'>;
  readonly documentEvidenceRepository: Pick<DocumentEvidenceRepository, 'listCandidates'>;
}

const coreRequiredFieldIds = [
  'company_name',
  'business_description',
  'revenue',
  'gross_margin',
] as const;

type DashboardRouteState =
  | { readonly status: 'not-found'; readonly projectId: string }
  | { readonly status: 'error'; readonly projectId: string }
  | {
      readonly status: 'ready';
      readonly projectId: string;
      readonly projectName: string;
      readonly readiness: ReturnType<typeof calculateReportReadiness>;
    };

export function ProjectDashboardRoute({
  projectRepository,
  evidenceRepository,
  fileVault,
  documentEvidenceRepository,
}: ProjectDashboardRouteProps) {
  const [retryCount, setRetryCount] = useState(0);
  const { projectId = '' } = useParams();
  const state = useLiveQuery<DashboardRouteState>(async () => {
    try {
      const project = await projectRepository.get(projectId);
      if (!project) return { status: 'not-found', projectId };

      const requiredFieldIds: string[] = [...coreRequiredFieldIds];
      if (
        project.dealProfile.industryTemplateIds.includes('saas') &&
        findTargetFieldDefinition('arr')?.importable
      ) {
        requiredFieldIds.push('arr');
      }

      const [evidence, documents, candidates] = await Promise.all([
        evidenceRepository.listByProject(projectId),
        fileVault.list(projectId),
        documentEvidenceRepository.listCandidates(projectId),
      ]);
      const pendingCandidateCount = candidates.filter(
        ({ reviewStatus }) =>
          reviewStatus === 'pending' || reviewStatus === 'conflicted',
      ).length;
      return {
        status: 'ready',
        projectName: project.name,
        readiness: calculateReportReadiness({
          projectId,
          documentCount: documents.length,
          pendingCandidateCount,
          evidence,
          formalRequiredFieldIds: requiredFieldIds,
        }),
        projectId,
      };
    } catch {
      return { status: 'error', projectId };
    }
  }, [
    projectId,
    projectRepository,
    evidenceRepository,
    fileVault,
    documentEvidenceRepository,
    retryCount,
  ]);

  if (!state || state.projectId !== projectId) {
    return <p role="status">正在读取项目就绪度…</p>;
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
    <ProjectDashboardPage
      readiness={state.readiness}
      projectName={state.projectName}
      dataRoomHref={`/projects/${state.projectId}/data-room`}
    />
  );
}
