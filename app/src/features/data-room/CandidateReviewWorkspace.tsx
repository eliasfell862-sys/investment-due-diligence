import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatSourceLocator,
  type SourceFragment,
} from '../../domain/documents/source-fragment';
import type { EvidenceCandidate } from '../../domain/evidence/evidence-candidate';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
import type { CandidateReviewService } from '../../infrastructure/db/candidate-review-service';
import type { DocumentEvidenceRepository } from '../../infrastructure/db/document-evidence-repository';
import type { EvidenceRepository } from '../../infrastructure/db/evidence-repository';

export interface CandidateReviewWorkspaceProps {
  readonly projectId: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly documentRepository: Pick<
    DocumentEvidenceRepository,
    'listFragments' | 'listCandidates'
  >;
  readonly reviewService: Pick<CandidateReviewService, 'confirm' | 'correct' | 'reject'>;
  readonly evidenceRepository: Pick<EvidenceRepository, 'listByProject'>;
  readonly onOpenManual: () => void;
}

type ReviewMode = 'view' | 'correct' | 'reject';

interface ReviewData {
  readonly fragments: SourceFragment[];
  readonly candidates: EvidenceCandidate[];
  readonly evidence: EvidenceItem[];
}

type WorkspaceState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: ReviewData }
  | { readonly status: 'error'; readonly message: string };

const recognitionLabels: Record<EvidenceCandidate['recognitionMethod'], string> = {
  rule: '规则识别',
  ocr_rule: 'OCR + 规则',
  ai_assisted: 'AI 辅助',
};

const sourceTypeLabels: Record<EvidenceCandidate['sourceTypeHint'], string> = {
  document_fact: '文档事实',
  management_forecast: '管理层预测',
};

const reviewStatusLabels: Record<EvidenceCandidate['reviewStatus'], string> = {
  pending: '待审核',
  conflicted: '存在冲突',
  confirmed: '已确认',
  corrected: '已更正',
  rejected: '已拒绝',
};

function candidateLabel(candidate: EvidenceCandidate): string {
  const field = findTargetFieldDefinition(candidate.fieldId)?.label ?? candidate.fieldId;
  return `${candidate.periodIdentity} · ${field}`;
}

function candidateValue(candidate: EvidenceCandidate): string {
  return candidate.displayValue?.trim() || candidate.normalizedValue;
}

function isPending(candidate: EvidenceCandidate): boolean {
  return candidate.reviewStatus === 'pending' || candidate.reviewStatus === 'conflicted';
}

function sourcePageIdentity(fragment: SourceFragment | undefined): string | undefined {
  if (!fragment) return undefined;
  const { locator } = fragment;
  if (locator.pageNumber !== undefined) return `page:${locator.pageNumber}`;
  if (locator.slideNumber !== undefined) return `slide:${locator.slideNumber}`;
  return undefined;
}

function nextPendingCandidate(
  candidates: readonly EvidenceCandidate[],
  fragmentsById: ReadonlyMap<string, SourceFragment>,
  previousCandidateId: string,
  pageIdentity: string | undefined,
): EvidenceCandidate | undefined {
  const pending = candidates.filter((candidate) => (
    candidate.id !== previousCandidateId && isPending(candidate)
  ));
  return pending.find((candidate) => (
    candidate.sourceFragmentIds.some((fragmentId) => (
      sourcePageIdentity(fragmentsById.get(fragmentId)) === pageIdentity
    ))
  ));
}

function candidateFragmentOnPage(
  candidate: EvidenceCandidate | undefined,
  fragmentsById: ReadonlyMap<string, SourceFragment>,
  pageIdentity: string | undefined,
): SourceFragment | undefined {
  return candidate?.sourceFragmentIds
    .map((fragmentId) => fragmentsById.get(fragmentId))
    .find((fragment) => sourcePageIdentity(fragment) === pageIdentity);
}

function reviewErrorMessage(): string {
  return '审核保存失败，请核对字段后重试。';
}

export function CandidateReviewWorkspace({
  projectId,
  documentId,
  documentName,
  documentRepository,
  reviewService,
  evidenceRepository,
  onOpenManual,
}: CandidateReviewWorkspaceProps) {
  const [state, setState] = useState<WorkspaceState>({ status: 'loading' });
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedFragmentId, setSelectedFragmentId] = useState<string | null>(null);
  const [mode, setMode] = useState<ReviewMode>('view');
  const [correctedValue, setCorrectedValue] = useState('');
  const [reason, setReason] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [promotedEvidence, setPromotedEvidence] = useState<EvidenceItem | null>(null);
  const [pending, setPending] = useState(false);
  const [reloadRequest, setReloadRequest] = useState(0);
  const requestId = useRef(0);
  const latest = useRef({
    projectId,
    documentId,
    documentRepository,
    reviewService,
    evidenceRepository,
  });
  latest.current = {
    projectId,
    documentId,
    documentRepository,
    reviewService,
    evidenceRepository,
  };

  function selectEvidenceContext(
    candidate?: EvidenceCandidate,
    fragment?: SourceFragment,
  ): void {
    setSelectedCandidateId(candidate?.id ?? null);
    setSelectedFragmentId(fragment?.id ?? null);
    setMode('view');
    setCorrectedValue(candidate?.correctedValue ?? candidate?.normalizedValue ?? '');
    setReason('');
    setDecisionError(null);
    setSuccessMessage(null);
    setPromotedEvidence(null);
  }

  async function loadData(currentRequest: number): Promise<ReviewData | undefined> {
    const context = latest.current;
    const [fragments, candidates, evidence] = await Promise.all([
      context.documentRepository.listFragments(context.projectId, context.documentId),
      context.documentRepository.listCandidates(context.projectId, context.documentId),
      context.evidenceRepository.listByProject(context.projectId),
    ]);
    const current = latest.current;
    if (
      requestId.current !== currentRequest
      || current.projectId !== context.projectId
      || current.documentId !== context.documentId
      || current.documentRepository !== context.documentRepository
      || current.reviewService !== context.reviewService
      || current.evidenceRepository !== context.evidenceRepository
    ) {
      return undefined;
    }
    return { fragments, candidates, evidence };
  }

  useEffect(() => {
    const currentRequest = ++requestId.current;
    setState({ status: 'loading' });
    selectEvidenceContext();

    void loadData(currentRequest).then(
      (data) => {
        if (!data) return;
        setState({ status: 'ready', data });
        const initial = data.candidates.find(isPending) ?? data.candidates[0];
        const initialFragment = data.fragments.find(
          ({ id }) => id === initial?.sourceFragmentIds[0],
        ) ?? data.fragments[0];
        selectEvidenceContext(initial, initialFragment);
      },
      () => {
        if (requestId.current === currentRequest) {
          setState({ status: 'error', message: '无法读取候选证据，请重试。' });
        }
      },
    );

    return () => {
      requestId.current += 1;
    };
  }, [
    projectId,
    documentId,
    documentRepository,
    reviewService,
    evidenceRepository,
    reloadRequest,
  ]);

  const data = state.status === 'ready' ? state.data : undefined;
  const fragmentsById = useMemo(
    () => new Map(data?.fragments.map((fragment) => [fragment.id, fragment]) ?? []),
    [data?.fragments],
  );
  const selectedCandidate = data?.candidates.find(
    ({ id }) => id === selectedCandidateId,
  );
  const selectedFragment = (
    (selectedFragmentId ? fragmentsById.get(selectedFragmentId) : undefined)
    ?? fragmentsById.get(selectedCandidate?.sourceFragmentIds[0] ?? '')
    ?? data?.fragments[0]
  );
  const formalEvidence = data?.evidence.filter(
    ({ candidateId }) => candidateId && candidateId === selectedCandidate?.id,
  ) ?? [];
  const pendingCount = data?.candidates.filter(isPending).length ?? 0;

  async function decide(
    action: 'confirm' | 'correct' | 'reject',
  ): Promise<void> {
    if (!selectedCandidate || pending) return;
    const trimmedReason = reason.trim();
    if (action === 'correct' && !trimmedReason) {
      setDecisionError('请填写更正原因。');
      return;
    }
    if (action === 'reject' && !trimmedReason) {
      setDecisionError('请填写拒绝原因。');
      return;
    }
    if (action === 'correct' && !correctedValue.trim()) {
      setDecisionError('请填写更正值。');
      return;
    }

    const decidedCandidate = selectedCandidate;
    const previousFragmentId = selectedFragment?.id;
    const previousPageIdentity = sourcePageIdentity(selectedFragment);
    setPending(true);
    setDecisionError(null);
    setSuccessMessage(null);
    setPromotedEvidence(null);
    try {
      if (action === 'confirm') {
        await reviewService.confirm(projectId, decidedCandidate.id);
      } else if (action === 'correct') {
        await reviewService.correct(projectId, decidedCandidate.id, {
          normalizedValue: correctedValue,
          reason: trimmedReason,
        });
      } else {
        await reviewService.reject(projectId, decidedCandidate.id, trimmedReason);
      }

      const currentRequest = ++requestId.current;
      const refreshed = await loadData(currentRequest);
      if (!refreshed) return;
      setState({ status: 'ready', data: refreshed });
      const refreshedFragments = new Map(
        refreshed.fragments.map((fragment) => [fragment.id, fragment]),
      );
      const next = nextPendingCandidate(
        refreshed.candidates,
        refreshedFragments,
        decidedCandidate.id,
        previousPageIdentity,
      );
      const decided = refreshed.candidates.find(({ id }) => id === decidedCandidate.id);
      const selection = next ?? decided ?? refreshed.candidates[0];
      const nextFragment = candidateFragmentOnPage(
        next,
        refreshedFragments,
        previousPageIdentity,
      );
      const preservedFragment = nextFragment ?? (
        (previousFragmentId ? refreshedFragments.get(previousFragmentId) : undefined)
        ?? refreshed.fragments.find((fragment) => (
          sourcePageIdentity(fragment) === previousPageIdentity
        ))
      );
      const selectedAfterDecisionFragment = preservedFragment
        ?? refreshedFragments.get(
          decidedCandidate.sourceFragmentIds.find((id) => refreshedFragments.has(id)) ?? '',
        )
        ?? refreshedFragments.get(selection?.sourceFragmentIds[0] ?? '')
        ?? refreshed.fragments[0];
      selectEvidenceContext(selection, selectedAfterDecisionFragment);
      const promoted = refreshed.evidence.find(
        ({ candidateId }) => candidateId === decidedCandidate.id,
      );
      setPromotedEvidence(promoted ?? null);
      setSuccessMessage(promoted ? '已生成正式证据' : '审核决定已保存');
    } catch {
      setDecisionError(reviewErrorMessage());
    } finally {
      setPending(false);
    }
  }

  if (state.status === 'loading') {
    return <section className="candidate-review-workspace" aria-busy="true"><p role="status">正在读取候选证据…</p></section>;
  }
  if (state.status === 'error') {
    return (
      <section className="candidate-review-workspace">
        <p role="alert">{state.message}</p>
        <button
          className="button document-action"
          type="button"
          onClick={() => setReloadRequest((request) => request + 1)}
        >
          重新加载审核数据
        </button>
      </section>
    );
  }
  if (state.data.candidates.length === 0) {
    return (
      <section className="candidate-review-workspace candidate-review-empty">
        <p className="eyebrow">EVIDENCE REVIEW</p>
        <h2>未识别到待审核字段</h2>
        <p>来源原文已保留，可返回文件列表使用手动录入。</p>
        <button className="button document-action" type="button" onClick={onOpenManual}>
          手动录入
        </button>
      </section>
    );
  }

  return (
    <section className="candidate-review-workspace" aria-busy={pending}>
      <header className="candidate-review-header">
        <div>
          <p className="eyebrow">EVIDENCE REVIEW / 候选审核</p>
          <h2>{documentName}</h2>
        </div>
        <p>{pendingCount} 项待审核</p>
      </header>

      {successMessage && <p className="review-success" role="status">{successMessage}</p>}
      {promotedEvidence && (
        <p className="review-promoted-evidence">
          正式证据 · {findTargetFieldDefinition(promotedEvidence.fieldId)?.label
            ?? promotedEvidence.fieldId} · {promotedEvidence.normalizedValue}
        </p>
      )}
      {decisionError && <p className="review-error" role="alert">{decisionError}</p>}

      <div className="candidate-review-grid">
        <nav className="source-navigation" aria-label="文件页码与幻灯片">
          <h3>来源索引</h3>
          {state.data.fragments.map((fragment) => (
            <button
              className={fragment.id === selectedFragment?.id ? 'source-nav-active' : undefined}
              type="button"
              key={fragment.id}
              onClick={() => {
                const linked = state.data.candidates.find(({ sourceFragmentIds }) => (
                  sourceFragmentIds.includes(fragment.id)
                ));
                selectEvidenceContext(linked, fragment);
              }}
            >
              <strong>{formatSourceLocator(fragment)}</strong>
              <span>{fragment.sourceKind.replaceAll('_', ' ')}</span>
            </button>
          ))}
        </nav>

        <section className="source-preview" aria-label="来源原文预览">
          <header>
            <span>来源原文</span>
            <strong>{selectedFragment ? formatSourceLocator(selectedFragment) : '无定位'}</strong>
          </header>
          {selectedFragment ? (
            <blockquote><mark>{selectedFragment.rawText}</mark></blockquote>
          ) : (
            <p>未找到候选字段对应的原文片段。</p>
          )}
        </section>

        <aside className="candidate-inspector" aria-label="候选证据审核">
          <div className="candidate-queue" aria-label="候选字段列表">
            {state.data.candidates.map((candidate) => (
              <button
                type="button"
                key={candidate.id}
                aria-pressed={candidate.id === selectedCandidate?.id}
                onClick={() => selectEvidenceContext(
                  candidate,
                  fragmentsById.get(candidate.sourceFragmentIds[0] ?? ''),
                )}
              >
                <span>{candidateLabel(candidate)}</span>
                <small>{reviewStatusLabels[candidate.reviewStatus]}</small>
              </button>
            ))}
          </div>

          {!selectedCandidate && (
            <p className="candidate-empty-state">该来源片段未关联候选字段</p>
          )}
          {selectedCandidate && (
            <div className="candidate-card">
              <p className="candidate-label-row">
                <span>机器识别</span>
                <span>{recognitionLabels[selectedCandidate.recognitionMethod]}</span>
                <span>{sourceTypeLabels[selectedCandidate.sourceTypeHint]}</span>
              </p>
              <h3>{candidateLabel(selectedCandidate)}</h3>
              <dl>
                <div><dt>原始值</dt><dd>{candidateValue(selectedCandidate)}</dd></div>
                {selectedCandidate.correctedValue && (
                  <div><dt>更正值</dt><dd>{selectedCandidate.correctedValue}</dd></div>
                )}
                <div><dt>来源定位</dt><dd>{selectedFragment ? formatSourceLocator(selectedFragment) : '—'}</dd></div>
                <div><dt>置信度</dt><dd>{Math.round(selectedCandidate.confidence * 100)}%</dd></div>
              </dl>

              {formalEvidence.length > 0 && (
                <p className="formal-evidence-note">已关联 {formalEvidence.length} 条正式证据</p>
              )}

              {isPending(selectedCandidate) ? (
                <>
                  {mode === 'correct' && (
                    <div className="candidate-decision-form">
                      <label htmlFor="candidate-corrected-value">更正值</label>
                      <input id="candidate-corrected-value" value={correctedValue} onChange={(event) => setCorrectedValue(event.target.value)} />
                      <label htmlFor="candidate-correction-reason">更正原因</label>
                      <textarea id="candidate-correction-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
                      <button className="button button-primary" type="button" disabled={pending} onClick={() => void decide('correct')}>提交更正</button>
                    </div>
                  )}
                  {mode === 'reject' && (
                    <div className="candidate-decision-form">
                      <label htmlFor="candidate-rejection-reason">拒绝原因</label>
                      <textarea id="candidate-rejection-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
                      <button className="button document-action-danger" type="button" disabled={pending} onClick={() => void decide('reject')}>确认拒绝</button>
                    </div>
                  )}
                  {mode === 'view' && (
                    <div className="candidate-actions">
                      <button className="button button-primary" type="button" disabled={pending} onClick={() => void decide('confirm')}>确认并入库</button>
                      <button className="button" type="button" disabled={pending} onClick={() => { setCorrectedValue(selectedCandidate.normalizedValue); setReason(''); setMode('correct'); }}>更正</button>
                      <button className="button document-action-danger" type="button" disabled={pending} onClick={() => { setReason(''); setMode('reject'); }}>拒绝</button>
                    </div>
                  )}
                </>
              ) : (
                <p className="candidate-complete-state">
                  该候选已完成审核：{reviewStatusLabels[selectedCandidate.reviewStatus]}
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
