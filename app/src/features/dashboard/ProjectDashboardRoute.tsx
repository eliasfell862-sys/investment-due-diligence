import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useParams } from 'react-router-dom';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
import { calculateReportReadiness } from '../../domain/readiness/calculate-report-readiness';
import type { EvidenceSummary } from '../../domain/readiness/calculate-readiness';
import type { DocumentEvidenceRepository } from '../../infrastructure/db/document-evidence-repository';
import type { EvidenceRepository } from '../../infrastructure/db/evidence-repository';
import type { ProjectRepository } from '../../infrastructure/db/project-repository';
import type { FileVault } from '../../infrastructure/files/file-vault';
import { ProjectDashboardPage } from './ProjectDashboardPage';

const LOCAL_STORAGE_FIELD_MAP: Record<string, { module: string; field: string }> = {
  company_name: { module: 'company-overview', field: 'name' },
  business_description: { module: 'company-overview', field: 'description' },
  revenue: { module: 'financials', field: 'revenue' },
  gross_margin: { module: 'financials', field: 'grossProfit' },
  arr: { module: 'financials', field: 'arr' },
  nrr: { module: 'financials', field: 'nrr' },
  net_profit: { module: 'financials', field: 'netIncome' },
  operating_cash_flow: { module: 'financials', field: 'operatingCashFlow' },
  team_summary: { module: 'team-members', field: '_count' },
  product_summary: { module: 'products', field: '_count' },
  market_summary: { module: 'industry', field: 'chainMid' },
};

function readLocalStorageEvidence(projectId: string): EvidenceSummary[] {
  const results: EvidenceSummary[] = [];
  const now = new Date().toISOString().slice(0, 10);

  for (const [fieldId, { module, field }] of Object.entries(LOCAL_STORAGE_FIELD_MAP)) {
    try {
      const key = `dd-p-${projectId}-${module}`;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);

      // _count means use array length
      let value: string;
      if (field === '_count') {
        const len = Array.isArray(parsed) ? parsed.length : 0;
        if (len === 0) continue;
        value = String(len);
      } else {
        value = parsed[field];
        if (!value || (typeof value === 'string' && value.trim().length === 0)) continue;
        value = typeof value === 'string' ? value.trim() : String(value);
      }

      results.push({
        projectId,
        fieldId,
        periodIdentity: now,
        dimensionIdentity: 'ai-extracted',
        normalizedValue: value,
        conflictStatus: 'none',
      });
    } catch { /* skip broken localStorage entries */ }
  }

  return results;
}

export interface ProjectDashboardRouteProps {
  readonly projectRepository: Pick<ProjectRepository, 'get'>;
  readonly evidenceRepository: Pick<EvidenceRepository, 'listByProject'>;
  readonly fileVault: Pick<FileVault, 'countByProject'>;
  readonly documentEvidenceRepository: Pick<DocumentEvidenceRepository, 'countPendingByProject'>;
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

      const [evidence, documentCount, pendingCandidateCount] = await Promise.all([
        evidenceRepository.listByProject(projectId),
        fileVault.countByProject(projectId),
        documentEvidenceRepository.countPendingByProject(projectId),
      ]);
      // Supplement IndexedDB evidence with AI-extracted localStorage data
      const localEvidence = readLocalStorageEvidence(projectId);
      const mergedEvidence = [...evidence, ...localEvidence];
      // If AI extracted data exists, count at least 1 virtual document for readiness
      const effectiveDocCount = Math.max(documentCount, localEvidence.length > 0 ? 1 : 0);

      return {
        status: 'ready',
        projectName: project.name,
        readiness: calculateReportReadiness({
          projectId,
          documentCount: effectiveDocCount,
          pendingCandidateCount,
          evidence: mergedEvidence,
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
      projectId={state.projectId}
      dataRoomHref={`/projects/${state.projectId}/data-room`}
    />
  );
}
