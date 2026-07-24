import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SourceFragment } from '../../domain/documents/source-fragment';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import { CandidateReviewWorkspace } from './CandidateReviewWorkspace';

function fragment(id: string, pageNumber: number, rawText: string): SourceFragment {
  return {
    id,
    projectId: 'project-1',
    documentId: 'document-1',
    documentVersionId: 'version-1',
    sourceKind: 'pdf_table',
    locator: { pageNumber, tableIndex: 2, tableRow: 4, tableColumn: 3 },
    rawText,
    normalizedText: rawText,
    extractionMethod: 'pdfjs',
    extractionVersion: '1',
    contentHash: `${id}-hash`,
    createdAt: '2026-07-24T00:00:00.000Z',
  };
}

function candidate(
  id: string,
  sourceId: string,
  status: EvidenceCandidate['reviewStatus'] = 'pending',
): EvidenceCandidate {
  return {
    id,
    projectId: 'project-1',
    documentId: 'document-1',
    fieldId: 'revenue',
    normalizedValue: id === 'candidate-1' ? '120000000' : '130000000',
    displayValue: id === 'candidate-1' ? '1.2亿元' : '1.3亿元',
    periodIdentity: id === 'candidate-1' ? '2025' : '2026',
    dimensionIdentity: 'company=星云科技',
    sourceFragmentIds: [sourceId],
    recognitionMethod: 'ocr_rule',
    sourceTypeHint: 'document_fact',
    confidence: 0.82,
    reviewStatus: status,
    candidateFingerprint: `${id}-fingerprint`,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  };
}

function evidence(candidateId: string, normalizedValue = '120000000'): EvidenceItem {
  return {
    id: 'evidence-1',
    projectId: 'project-1',
    fieldId: 'revenue',
    periodIdentity: '2025',
    dimensionIdentity: 'company=星云科技',
    normalizedValue,
    importBatchId: 'candidate',
    sourceSheet: 'PDF',
    sourceRow: 12,
    rawValue: '1.2亿元',
    confidence: 0.82,
    conflictStatus: 'none',
    updatedAt: '2026-07-24T00:00:00.000Z',
    candidateId,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setup() {
  let candidates = [
    candidate('candidate-1', 'fragment-1'),
    candidate('candidate-2', 'fragment-2'),
  ];
  let evidenceItems: EvidenceItem[] = [];
  const documentRepository = {
    listFragments: vi.fn().mockResolvedValue([
      fragment('fragment-1', 12, '星云科技 2025年营业收入 1.2亿元'),
      fragment('fragment-2', 13, '星云科技 2026年营业收入 1.3亿元'),
    ]),
    listCandidates: vi.fn().mockImplementation(async () => candidates),
  };
  const confirm = vi.fn(async (_projectId: string, candidateId: string) => {
    candidates = candidates.map((item) => (
      item.id === candidateId ? { ...item, reviewStatus: 'confirmed' as const } : item
    ));
    evidenceItems = [evidence(candidateId)];
  });
  const correct = vi.fn(async (_projectId: string, candidateId: string) => {
    candidates = candidates.map((item) => (
      item.id === candidateId ? { ...item, reviewStatus: 'corrected' as const } : item
    ));
    evidenceItems = [evidence(candidateId, '125000000')];
  });
  const reject = vi.fn(async (_projectId: string, candidateId: string) => {
    candidates = candidates.map((item) => (
      item.id === candidateId ? { ...item, reviewStatus: 'rejected' as const } : item
    ));
  });
  const reviewService = { confirm, correct, reject };
  const evidenceRepository = {
    listByProject: vi.fn().mockImplementation(async () => evidenceItems),
  };

  render(
    <CandidateReviewWorkspace
      projectId="project-1"
      documentId="document-1"
      documentName="星云科技 BP.pdf"
      documentRepository={documentRepository}
      reviewService={reviewService}
      evidenceRepository={evidenceRepository}
      onOpenManual={vi.fn()}
    />,
  );
  return { documentRepository, reviewService };
}

describe('CandidateReviewWorkspace', () => {
  it('selects candidates and renders semantic source, locator, confidence, and machine labels', async () => {
    setup();

    const navigation = await screen.findByRole('navigation', { name: '文件页码与幻灯片' });
    expect(within(navigation).getByRole('button', { name: /第 12 页/ })).toBeInTheDocument();
    const preview = screen.getByRole('region', { name: '来源原文预览' });
    expect(preview).toHaveTextContent('2025年营业收入');
    expect(within(preview).getByText('星云科技 2025年营业收入 1.2亿元').tagName)
      .toBe('MARK');
    expect(screen.getByRole('complementary', { name: '候选证据审核' }))
      .toHaveTextContent('第 12 页 / 表格 2 / 第 4 行第 3 列');
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('机器识别')).toBeInTheDocument();
    expect(screen.getByText('OCR + 规则')).toBeInTheDocument();
    expect(screen.getByText('文档事实')).toBeInTheDocument();
    expect(screen.getByText('1.2亿元')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /2026 · 营业收入/ }));
    expect(screen.getByRole('region', { name: '来源原文预览' }))
      .toHaveTextContent('1.3亿元');
  });

  it('confirms, reloads formal evidence, and advances to the next pending candidate', async () => {
    const { reviewService, documentRepository } = setup();
    await screen.findByText('1.2亿元');

    await userEvent.click(screen.getByRole('button', { name: '确认并入库' }));

    expect(reviewService.confirm).toHaveBeenCalledWith('project-1', 'candidate-1');
    expect(await screen.findByText('已生成正式证据')).toBeInTheDocument();
    expect(screen.getByText('正式证据 · 营业收入 · 120000000'))
      .toBeInTheDocument();
    expect(documentRepository.listCandidates).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: /2026 · 营业收入/ }))
      .toHaveAttribute('aria-pressed', 'true');
    const preview = screen.getByRole('region', { name: '来源原文预览' });
    expect(preview).toHaveTextContent('2025年营业收入 1.2亿元');
    expect(preview).not.toHaveTextContent('2026年营业收入 1.3亿元');
  });

  it('advances to the next pending candidate at the same source locator', async () => {
    let candidates = [
      candidate('candidate-1', 'fragment-1'),
      candidate('candidate-2', 'fragment-1'),
    ];
    const documentRepository = {
      listFragments: vi.fn().mockResolvedValue([
        fragment('fragment-1', 12, '同一页同一定位的营业收入证据'),
      ]),
      listCandidates: vi.fn().mockImplementation(async () => candidates),
    };
    render(
      <CandidateReviewWorkspace
        projectId="project-1"
        documentId="document-1"
        documentName="星云科技 BP.pdf"
        documentRepository={documentRepository}
        reviewService={{
          confirm: vi.fn(async () => {
            candidates = candidates.map((item) => (
              item.id === 'candidate-1'
                ? { ...item, reviewStatus: 'confirmed' as const }
                : item
            ));
          }),
          correct: vi.fn(),
          reject: vi.fn(),
        }}
        evidenceRepository={{ listByProject: vi.fn().mockResolvedValue([]) }}
        onOpenManual={vi.fn()}
      />,
    );
    await screen.findByText('1.2亿元');

    await userEvent.click(screen.getByRole('button', { name: '确认并入库' }));

    await waitFor(() => expect(
      screen.getByRole('button', { name: /2026 · 营业收入/ }),
    ).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('region', { name: '来源原文预览' }))
      .toHaveTextContent('同一页同一定位的营业收入证据');
  });

  it('disables every visible decision action while a review is pending', async () => {
    const pendingDecision = deferred<void>();
    render(
      <CandidateReviewWorkspace
        projectId="project-1"
        documentId="document-1"
        documentName="星云科技 BP.pdf"
        documentRepository={{
          listFragments: vi.fn().mockResolvedValue([
            fragment('fragment-1', 12, '待审核原文'),
          ]),
          listCandidates: vi.fn().mockResolvedValue([
            candidate('candidate-1', 'fragment-1'),
          ]),
        }}
        reviewService={{
          confirm: vi.fn(() => pendingDecision.promise),
          correct: vi.fn(),
          reject: vi.fn(),
        }}
        evidenceRepository={{ listByProject: vi.fn().mockResolvedValue([]) }}
        onOpenManual={vi.fn()}
      />,
    );
    await screen.findByText('1.2亿元');

    await userEvent.click(screen.getByRole('button', { name: '确认并入库' }));

    expect(screen.getByRole('button', { name: '确认并入库' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '更正' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeDisabled();
    await act(async () => {
      pendingDecision.resolve(undefined);
      await pendingDecision.promise;
    });
  });

  it('requires a correction reason and submits the corrected value', async () => {
    const { reviewService } = setup();
    await screen.findByText('1.2亿元');
    await userEvent.click(screen.getByRole('button', { name: '更正' }));
    await userEvent.clear(screen.getByLabelText('更正值'));
    await userEvent.type(screen.getByLabelText('更正值'), '125000000');
    await userEvent.click(screen.getByRole('button', { name: '提交更正' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请填写更正原因');

    await userEvent.type(screen.getByLabelText('更正原因'), '按审计表调整');
    await userEvent.click(screen.getByRole('button', { name: '提交更正' }));

    await waitFor(() => expect(reviewService.correct).toHaveBeenCalledWith(
      'project-1',
      'candidate-1',
      { normalizedValue: '125000000', reason: '按审计表调整' },
    ));
    expect(await screen.findByText('已生成正式证据')).toBeInTheDocument();
    expect(screen.getByText('正式证据 · 营业收入 · 125000000'))
      .toBeInTheDocument();
  });

  it('requires a rejection reason before calling the service', async () => {
    const { reviewService } = setup();
    await screen.findByText('1.2亿元');
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }));
    await userEvent.click(screen.getByRole('button', { name: '确认拒绝' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请填写拒绝原因');
    expect(reviewService.reject).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('拒绝原因'), '重复字段');
    await userEvent.click(screen.getByRole('button', { name: '确认拒绝' }));
    await waitFor(() => expect(reviewService.reject).toHaveBeenCalledWith(
      'project-1',
      'candidate-1',
      '重复字段',
    ));
  });

  it('keeps the selected candidate editable after a failed decision so retry is deterministic', async () => {
    const { reviewService } = setup();
    reviewService.confirm
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined);
    await screen.findByText('1.2亿元');

    await userEvent.click(screen.getByRole('button', { name: '确认并入库' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('审核保存失败');
    expect(screen.getByText('1.2亿元')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '确认并入库' }));
    await waitFor(() => expect(reviewService.confirm).toHaveBeenCalledTimes(2));
  });

  it('renders a clear zero-candidate state', async () => {
    const onOpenManual = vi.fn();
    render(
      <CandidateReviewWorkspace
        projectId="project-1"
        documentId="document-1"
        documentName="memo.pdf"
        documentRepository={{
          listFragments: vi.fn().mockResolvedValue([]),
          listCandidates: vi.fn().mockResolvedValue([]),
        }}
        reviewService={{ confirm: vi.fn(), correct: vi.fn(), reject: vi.fn() }}
        evidenceRepository={{ listByProject: vi.fn().mockResolvedValue([]) }}
        onOpenManual={onOpenManual}
      />,
    );

    expect(await screen.findByText('未识别到待审核字段')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '手动录入' }));
    expect(onOpenManual).toHaveBeenCalledOnce();
  });

  it('shows the completed state for terminal candidates', async () => {
    render(
      <CandidateReviewWorkspace
        projectId="project-1"
        documentId="document-1"
        documentName="memo.pdf"
        documentRepository={{
          listFragments: vi.fn().mockResolvedValue([
            fragment('fragment-1', 12, '已确认原文'),
          ]),
          listCandidates: vi.fn().mockResolvedValue([
            candidate('candidate-1', 'fragment-1', 'confirmed'),
          ]),
        }}
        reviewService={{ confirm: vi.fn(), correct: vi.fn(), reject: vi.fn() }}
        evidenceRepository={{ listByProject: vi.fn().mockResolvedValue([]) }}
        onOpenManual={vi.fn()}
      />,
    );

    expect(await screen.findByText('该候选已完成审核：已确认')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认并入库' })).not.toBeInTheDocument();
  });
});
