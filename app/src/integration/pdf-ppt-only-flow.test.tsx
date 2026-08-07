import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvidenceCandidate } from '../domain/evidence/evidence-candidate';
import type { Project } from '../domain/project/project';
import type { SourceFragment } from '../domain/documents/source-fragment';
import { ProjectDataRoomRoute } from '../features/data-room/ProjectDataRoomRoute';
import { ProjectDashboardRoute } from '../features/dashboard/ProjectDashboardRoute';
import { AppDb } from '../infrastructure/db/app-db';
import { CandidateReviewService } from '../infrastructure/db/candidate-review-service';
import { DocumentEvidenceRepository } from '../infrastructure/db/document-evidence-repository';
import { EvidenceRepository } from '../infrastructure/db/evidence-repository';
import { ProjectRepository } from '../infrastructure/db/project-repository';
import { FileVault } from '../infrastructure/files/file-vault';
import type { DocumentExtractionRequest } from '../infrastructure/import/document-extractor';
import type { DocumentCandidateResult } from '../infrastructure/import/document-importer';

// 页面测试不涉及 AI 提取，密钥库统一按锁定处理
vi.mock('../features/ai-agents/useAiVault', () => ({
  useAiVault: () => ({ locked: true, settings: null }),
}));

const project: Project = {
  id: 'project-1',
  name: 'PDF \u79bb\u7ebf\u9879\u76ee',
  status: 'draft',
  currency: 'CNY',
  amountUnit: 'ten_thousand',
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
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

const candidateFacts = [
  ['company_name', 'ACME', 'ACME'],
  ['business_description', 'Subscription software', 'Subscription software'],
  ['team_summary', 'Experienced operating team', 'Experienced operating team'],
] as const;

function extractionResult(request: DocumentExtractionRequest): DocumentCandidateResult {
  const createdAt = '2026-07-24T01:00:00.000Z';
  const fragments: SourceFragment[] = candidateFacts.map(
    ([fieldId, , displayValue], index) => ({
      id: 'fragment-' + (index + 1),
      projectId: request.projectId,
      documentId: request.documentId,
      documentVersionId: request.documentVersionId,
      sourceKind: 'pdf_text',
      locator: { pageNumber: index + 1 },
      rawText: displayValue,
      normalizedText: displayValue,
      extractionMethod: 'pdfjs',
      extractionVersion: '1.0.0',
      contentHash: 'sha256:fragment-' + fieldId,
      createdAt,
    }),
  );
  const candidates: EvidenceCandidate[] = candidateFacts.map(
    ([fieldId, normalizedValue, displayValue], index) => ({
      id: 'candidate-' + (index + 1),
      projectId: request.projectId,
      documentId: request.documentId,
      fieldId,
      normalizedValue,
      displayValue,
      periodIdentity: 'source-document:' + request.documentId + ':undated',
      dimensionIdentity: 'project:' + request.projectId + ':default',
      sourceFragmentIds: ['fragment-' + (index + 1)],
      recognitionMethod: 'rule',
      sourceTypeHint: 'document_fact',
      confidence: 0.9,
      reviewStatus: 'pending',
      candidateFingerprint: 'sha256:candidate-' + fieldId,
      createdAt,
      updatedAt: createdAt,
    }),
  );

  return {
    projectId: request.projectId,
    documentId: request.documentId,
    fragments,
    candidates,
    needsOcrPageNumbers: [],
    warnings: [],
  };
}

interface Repositories {
  readonly projects: ProjectRepository;
  readonly evidence: EvidenceRepository;
  readonly vault: FileVault;
  readonly documents: DocumentEvidenceRepository;
  readonly reviews: CandidateReviewService;
}

function repositories(db: AppDb): Repositories {
  const projects = new ProjectRepository(db);
  const evidence = new EvidenceRepository(db);
  const vault = new FileVault(db, {
    createId: () => 'document-1',
    now: () => new Date('2026-07-24T00:30:00.000Z'),
  });
  const documents = new DocumentEvidenceRepository(db);
  return {
    projects,
    evidence,
    vault,
    documents,
    reviews: new CandidateReviewService(
      documents,
      evidence,
      () => new Date('2026-07-24T02:00:00.000Z'),
    ),
  };
}

function renderDataRoom(
  local: Repositories,
  documentInspector: (request: DocumentExtractionRequest) => Promise<DocumentCandidateResult>,
) {
  return render(
    <MemoryRouter initialEntries={['/projects/project-1/data-room']}>
      <Routes>
        <Route
          path="/projects/:projectId/data-room"
          element={
            <ProjectDataRoomRoute
              projectRepository={local.projects}
              vault={local.vault}
              evidenceRepository={local.evidence}
              documentRepository={local.documents}
              reviewService={local.reviews}
              documentInspector={documentInspector}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderDashboard(local: Repositories) {
  return render(
    <MemoryRouter initialEntries={['/projects/project-1']}>
      <Routes>
        <Route
          path="/projects/:projectId"
          element={
            <ProjectDashboardRoute
              projectRepository={local.projects}
              evidenceRepository={local.evidence}
              fileVault={local.vault}
              documentEvidenceRepository={local.documents}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PDF and PPT-only offline flow', () => {
  const dbName = 'pdf-ppt-only-' + crypto.randomUUID();
  let db: AppDb | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    db?.close();
    await new AppDb(dbName).delete();
  });

  it('persists reviewed PDF evidence without duplicate candidates and gates reports offline', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    db = new AppDb(dbName);
    let local = repositories(db);
    await local.projects.save(project);
    const inspector = vi.fn(async (request: DocumentExtractionRequest) => {
      expect(request.kind).toBe('pdf');
      expect(request.fileName).toBe('memo.pdf');
      expect(request.data).toBeInstanceOf(Uint8Array);
      expect([...request.data]).toEqual([37, 80, 68, 70]);
      return extractionResult(request);
    });

    const file = new NativeFile([new Uint8Array([37, 80, 68, 70])], 'memo.pdf', {
      type: 'application/pdf',
    });
    expect(file).toBeInstanceOf(NativeFile);
    expect(file).toBeInstanceOf(NativeBlob);

    const firstView = renderDataRoom(local, inspector);
    await screen.findByText('\u5c1a\u672a\u4e0a\u4f20\u8d44\u6599');
    fireEvent.change(await screen.findByLabelText('\u4e0a\u4f20\u8d44\u6599'), {
      target: { files: [file as unknown as File] },
    });
    expect(await screen.findByText('memo.pdf')).toBeInTheDocument();

    const stored = await local.vault.list(project.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.blob.size).toBe(file.size);
    expect(stored[0]?.blob.type).toBe('application/pdf');
    expect(new Uint8Array(await stored[0]!.blob.arrayBuffer())).toEqual(
      new Uint8Array([37, 80, 68, 70]),
    );

    await userEvent.click(screen.getByRole('button', { name: '\u89e3\u6790\u8d44\u6599' }));
    expect(await screen.findByRole('button', { name: '\u5ba1\u6838\u8bc1\u636e' })).toBeInTheDocument();
    expect(await local.documents.listFragments(project.id, 'document-1')).toHaveLength(3);
    expect(await local.documents.listCandidates(project.id)).toHaveLength(3);

    await userEvent.click(screen.getByRole('button', { name: '\u5ba1\u6838\u8bc1\u636e' }));
    for (const label of ['\u516c\u53f8\u540d\u79f0', '\u4e1a\u52a1\u63cf\u8ff0', '\u56e2\u961f\u6982\u89c8']) {
      const queue = await screen.findByLabelText('\u5019\u9009\u5b57\u6bb5\u5217\u8868');
      await userEvent.click(within(queue).getByRole('button', { name: new RegExp(label) }));
      await userEvent.click(screen.getByRole('button', { name: '\u786e\u8ba4\u5e76\u5165\u5e93' }));
      await screen.findByText('\u5df2\u751f\u6210\u6b63\u5f0f\u8bc1\u636e');
    }

    const firstEvidence = await local.evidence.listByProject(project.id);
    expect(firstEvidence.map(({ fieldId }) => fieldId).sort()).toEqual([
      'business_description',
      'company_name',
      'team_summary',
    ]);
    expect(firstEvidence.every(({ sourceType }) => sourceType === 'document_fact')).toBe(true);
    expect((await local.documents.listCandidates(project.id)).every(
      ({ reviewStatus }) => reviewStatus === 'confirmed',
    )).toBe(true);
    firstView.unmount();

    db.close();
    db = new AppDb(dbName);
    local = repositories(db);
    const replayView = renderDataRoom(local, inspector);
    expect(await screen.findByText('memo.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '\u89e3\u6790\u8d44\u6599' }));
    await waitFor(async () => {
      const [persistedEvidence, persistedCandidates, persistedDocuments] =
        await Promise.all([
          local.evidence.listByProject(project.id),
          local.documents.listCandidates(project.id),
          local.vault.list(project.id),
        ]);
      expect(inspector).toHaveBeenCalledTimes(2);
      expect(persistedEvidence).toHaveLength(3);
      expect(persistedCandidates).toHaveLength(3);
      expect(persistedCandidates.every(
        ({ reviewStatus }) => reviewStatus === 'confirmed',
      )).toBe(true);
      expect(persistedDocuments).toHaveLength(1);
      expect(persistedDocuments[0]).toMatchObject({ parseStatus: 'complete' });
    });

    const replayedCandidates = await local.documents.listCandidates(project.id);
    expect(new Set(replayedCandidates.map(({ id }) => id)).size).toBe(3);
    replayView.unmount();

    renderDashboard(local);
    expect(await screen.findByText('PDF \u79bb\u7ebf\u9879\u76ee')).toBeInTheDocument();
    const quickLookGate = screen.getByRole('article', { name: '\u9879\u76ee\u901f\u89c8\u62a5\u544a' });
    const formalGate = screen.getByRole('article', { name: '\u6b63\u5f0f\u6295\u8d44\u5907\u5fd8\u5f55' });
    expect(within(quickLookGate).getAllByText('\u5df2\u6ee1\u8db3\u6761\u4ef6')).not.toHaveLength(0);
    expect(within(formalGate).getByText('\u8425\u4e1a\u6536\u5165')).toBeInTheDocument();
    expect(within(formalGate).getByText('\u6bdb\u5229\u7387')).toBeInTheDocument();
    expect(screen.getByText('\u8d44\u6599\u4e0d\u8db3\uff0c\u6682\u7f13\u51b3\u7b56')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
