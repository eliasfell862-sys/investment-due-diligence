import { useLiveQuery } from 'dexie-react-hooks';
import { useParams } from 'react-router-dom';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
import { calculateReadiness } from '../../domain/readiness/calculate-readiness';
import type { EvidenceRepository } from '../../infrastructure/db/evidence-repository';
import type { ProjectRepository } from '../../infrastructure/db/project-repository';
import { ProjectDashboardPage } from './ProjectDashboardPage';

export interface ProjectDashboardRouteProps {
  readonly projectRepository: Pick<ProjectRepository, 'get'>;
  readonly evidenceRepository: Pick<EvidenceRepository, 'listByProject'>;
}

const coreRequiredFieldIds = [
  'company_name',
  'business_description',
  'revenue',
  'gross_margin',
] as const;

type DashboardRouteState =
  | { readonly status: 'not-found' }
  | { readonly status: 'error' }
  | {
      readonly status: 'ready';
      readonly projectName: string;
      readonly readiness: ReturnType<typeof calculateReadiness>;
    };

export function ProjectDashboardRoute({
  projectRepository,
  evidenceRepository,
}: ProjectDashboardRouteProps) {
  const { projectId = '' } = useParams();
  const state = useLiveQuery<DashboardRouteState>(async () => {
    try {
      const project = await projectRepository.get(projectId);
      if (!project) return { status: 'not-found' };

      const requiredFieldIds: string[] = [...coreRequiredFieldIds];
      if (
        project.dealProfile.industryTemplateIds.includes('saas') &&
        findTargetFieldDefinition('arr')?.importable
      ) {
        requiredFieldIds.push('arr');
      }

      const evidence = await evidenceRepository.listByProject(projectId);
      return {
        status: 'ready',
        projectName: project.name,
        readiness: calculateReadiness(projectId, requiredFieldIds, evidence),
      };
    } catch {
      return { status: 'error' };
    }
  }, [projectId, projectRepository, evidenceRepository]);

  if (!state) return <p role="status">正在读取项目就绪度…</p>;
  if (state.status === 'error') return <p role="alert">无法读取项目数据，请重试。</p>;
  if (state.status === 'not-found') return <h1>未找到项目</h1>;

  return (
    <ProjectDashboardPage
      readiness={state.readiness}
      projectName={state.projectName}
      dataRoomHref={`/projects/${projectId}/data-room`}
    />
  );
}
