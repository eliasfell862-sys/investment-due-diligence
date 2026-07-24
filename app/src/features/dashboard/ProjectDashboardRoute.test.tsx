import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import type { Project } from '../../domain/project/project';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import type { DocumentEvidenceRepository } from '../../infrastructure/db/document-evidence-repository';
import type { EvidenceRepository } from '../../infrastructure/db/evidence-repository';
import type { ProjectRepository } from '../../infrastructure/db/project-repository';
import type { FileVault } from '../../infrastructure/files/file-vault';
import { ProjectDashboardRoute } from './ProjectDashboardRoute';

function project(
  templateIds: Project['dealProfile']['industryTemplateIds'],
): Project {
  return {
    id: 'project-1',
    name: '\u793a\u4f8b\u9879\u76ee',
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
    periodIdentity: 'source-document:document-1:undated',
    dimensionIdentity: 'project:project-1:default',
    normalizedValue,
    importBatchId: 'batch',
    sourceDocumentId: 'document-1',
    sourceType: 'document_fact',
    sourceSheet: 'Document',
    sourceRow: 1,
    rawValue: normalizedValue,
    confidence: 0.8,
    conflictStatus: 'none',
    updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

function document(): StoredDocument {
  return {
    id: 'document-1',
    projectId: 'project-1',
    name: 'memo.pdf',
    mimeType: 'application/pdf',
    size: 4,
    uploadedAt: '2026-07-22T00:00:00.000Z',
    parseStatus: 'review',
    blob: new Blob(['memo'], { type: 'application/pdf' }),
  };
}

function candidate(
  id: string,
  reviewStatus: EvidenceCandidate['reviewStatus'],
): EvidenceCandidate {
  return {
    id,
    projectId: 'project-1',
    documentId: 'document-1',
    fieldId: 'company_name',
    normalizedValue: 'ACME',
    displayValue: 'ACME',
    periodIdentity: 'source-document:document-1:undated',
    dimensionIdentity: 'project:project-1:default',
    sourceFragmentIds: ['fragment-1'],
    recognitionMethod: 'rule',
    sourceTypeHint: 'document_fact',
    confidence: 0.9,
    reviewStatus,
    candidateFingerprint: 'sha256:' + id,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

function renderRoute(
  projectRepository: Pick<ProjectRepository, 'get'>,
  evidenceRepository: Pick<EvidenceRepository, 'listByProject'>,
  fileVault: Pick<FileVault, 'list'> = { list: async () => [document()] },
  documentRepository: Pick<DocumentEvidenceRepository, 'listCandidates'> = {
    listCandidates: async () => [],
  },
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
              fileVault={fileVault}
              documentEvidenceRepository={documentRepository}
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
    expect(screen.getByText('\u6b63\u5728\u8bfb\u53d6\u9879\u76ee\u5c31\u7eea\u5ea6\u2026')).toBeInTheDocument();
    loading.unmount();

    const failed = renderRoute(
      { get: async () => { throw new Error('database failed'); } },
      { listByProject: async () => [] },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('\u65e0\u6cd5\u8bfb\u53d6\u9879\u76ee\u6570\u636e\uff0c\u8bf7\u91cd\u8bd5\u3002');
    failed.unmount();

    renderRoute(
      { get: async () => undefined },
      { listByProject: async () => [] },
    );
    expect(await screen.findByRole('heading', { name: '\u672a\u627e\u5230\u9879\u76ee' })).toBeInTheDocument();
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
    renderRoute(projectRepository, evidenceRepository, { list: async () => [] });

    expect(await screen.findByRole('alert')).toHaveTextContent('\u65e0\u6cd5\u8bfb\u53d6\u9879\u76ee\u6570\u636e\uff0c\u8bf7\u91cd\u8bd5\u3002');
    await userEvent.click(screen.getByRole('button', { name: '\u91cd\u65b0\u8bfb\u53d6\u9879\u76ee\u6570\u636e' }));

    expect(await screen.findByText('\u793a\u4f8b\u9879\u76ee')).toBeInTheDocument();
    expect(projectRepository.get).toHaveBeenCalledTimes(2);
    expect(evidenceRepository.listByProject).toHaveBeenCalledOnce();
  });

  it('queries local documents and candidates for both report gates', async () => {
    const fileVault = { list: vi.fn().mockResolvedValue([document()]) };
    const documentRepository = {
      listCandidates: vi.fn().mockResolvedValue([
        candidate('candidate-1', 'pending'),
        candidate('candidate-2', 'conflicted'),
        candidate('candidate-3', 'confirmed'),
      ]),
    };
    renderRoute(
      { get: async () => project(['consumer']) },
      {
        listByProject: async () => [
          evidence('company_name', 'ACME'),
          evidence('business_description', 'Subscription software'),
          evidence('team_summary', 'Experienced team'),
        ],
      },
      fileVault,
      documentRepository,
    );

    expect(await screen.findByText('\u793a\u4f8b\u9879\u76ee')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '\u8fdb\u5165\u8d44\u6599\u4e2d\u5fc3' })).toHaveAttribute(
      'href',
      '/projects/project-1/data-room',
    );
    expect(screen.getByText('2 \u9879\u5f85\u5ba1\u6838')).toBeInTheDocument();
    expect(screen.getByText('\u8d44\u6599\u4e0d\u8db3\uff0c\u6682\u7f13\u51b3\u7b56')).toBeInTheDocument();
    const quickLookGate = screen.getByRole('article', { name: '\u9879\u76ee\u901f\u89c8\u62a5\u544a' });
    expect(within(quickLookGate).getAllByText('\u5df2\u6ee1\u8db3\u6761\u4ef6')).not.toHaveLength(0);
    const formalGate = screen.getByRole('article', { name: '\u6b63\u5f0f\u6295\u8d44\u5907\u5fd8\u5f55' });
    expect(within(formalGate).getByText('\u8425\u4e1a\u6536\u5165')).toBeInTheDocument();
    expect(within(formalGate).getByText('\u6bdb\u5229\u7387')).toBeInTheDocument();
    expect(fileVault.list).toHaveBeenCalledWith('project-1');
    expect(documentRepository.listCandidates).toHaveBeenCalledWith('project-1');
  });

  it('requires ARR only for a SaaS project', async () => {
    renderRoute(
      { get: async () => project(['saas', 'hardtech_manufacturing']) },
      {
        listByProject: async () => [
          evidence('company_name', 'ACME'),
          evidence('business_description', '\u8ba2\u9605\u8f6f\u4ef6'),
          evidence('revenue', '1200'),
          evidence('gross_margin', '0.4'),
        ],
      },
    );

    expect(await screen.findByText('\u793a\u4f8b\u9879\u76ee')).toBeInTheDocument();
    const formalGate = screen.getByRole('article', { name: '\u6b63\u5f0f\u6295\u8d44\u5907\u5fd8\u5f55' });
    expect(within(formalGate).getByText('ARR')).toBeInTheDocument();
  });
});
