import { useEffect, useRef, useState } from 'react';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import type { DocumentEvidenceRepository } from '../../infrastructure/db/document-evidence-repository';
import type { DocumentExtractionRequest } from '../../infrastructure/import/document-extractor';
import {
  inspectDocumentInWorker,
  serializeDocumentExtractorError,
  type DocumentCandidateResult,
} from '../../infrastructure/import/document-importer';

export type DocumentInspector = (
  request: DocumentExtractionRequest,
) => Promise<DocumentCandidateResult>;

export type ExtractionState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly requestId: number }
  | {
      readonly status: 'ready';
      readonly requestId: number;
      readonly candidateCount: number;
      readonly warningCount: number;
    }
  | {
      readonly status: 'error';
      readonly requestId: number;
      readonly message: string;
    };

export interface DocumentExtractionWorkspaceProps {
  readonly projectId: string;
  readonly document: StoredDocument;
  readonly documentRepository: Pick<
    DocumentEvidenceRepository,
    'markParsing' | 'saveExtraction' | 'markFailed'
  >;
  readonly documentInspector?: DocumentInspector;
  readonly onOpenManual: (document: StoredDocument) => void;
  readonly onOpenReview: (document: StoredDocument) => void;
  readonly onExtractionSaved?: (documentId: string, candidateCount: number) => void;
}

interface ExtractionContext {
  readonly projectId: string;
  readonly documentId: string;
  readonly documentRepository: DocumentExtractionWorkspaceProps['documentRepository'];
  readonly documentInspector: DocumentInspector;
}

function documentKind(name: string): DocumentExtractionRequest['kind'] | undefined {
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.pptx$/i.test(name)) return 'pptx';
  return undefined;
}

function isLegacyPowerPoint(name: string): boolean {
  return /\.ppt$/i.test(name);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return '本地解析失败，请重试或改用手动录入。';
}

function initialStatus(document: StoredDocument): string | undefined {
  switch (document.parseStatus) {
    case 'review':
      return '待审核';
    case 'partial':
      return '部分字段待处理';
    case 'complete':
      return '审核完成';
    case 'parsing':
      return '上次解析未完成';
    case 'failed':
      return '解析失败';
    default:
      return undefined;
  }
}

export function DocumentExtractionWorkspace({
  projectId,
  document,
  documentRepository,
  documentInspector = inspectDocumentInWorker,
  onOpenManual,
  onOpenReview,
  onExtractionSaved,
}: DocumentExtractionWorkspaceProps) {
  const [state, setState] = useState<ExtractionState>({ status: 'idle' });
  const requestId = useRef(0);
  const latestContext = useRef<ExtractionContext>({
    projectId,
    documentId: document.id,
    documentRepository,
    documentInspector,
  });
  latestContext.current = {
    projectId,
    documentId: document.id,
    documentRepository,
    documentInspector,
  };

  useEffect(() => {
    requestId.current += 1;
    setState({ status: 'idle' });
  }, [projectId, document.id, documentRepository, documentInspector]);

  const kind = documentKind(document.name);
  const legacyPowerPoint = isLegacyPowerPoint(document.name);
  const isLoading = state.status === 'loading';
  const canReview = (
    (state.status === 'ready' && state.candidateCount > 0)
    || document.parseStatus === 'review'
    || document.parseStatus === 'partial'
    || document.parseStatus === 'complete'
  );

  function isCurrent(context: ExtractionContext, currentRequestId: number): boolean {
    const latest = latestContext.current;
    return (
      requestId.current === currentRequestId
      && latest.projectId === context.projectId
      && latest.documentId === context.documentId
      && latest.documentRepository === context.documentRepository
      && latest.documentInspector === context.documentInspector
    );
  }

  async function parseDocument(): Promise<void> {
    if (!kind || isLoading) return;
    const currentRequestId = ++requestId.current;
    const context = latestContext.current;
    setState({ status: 'loading', requestId: currentRequestId });

    try {
      await context.documentRepository.markParsing(context.projectId, context.documentId);
      if (!isCurrent(context, currentRequestId)) return;

      const buffer = await document.blob.arrayBuffer();
      if (!isCurrent(context, currentRequestId)) return;

      const inspected = await context.documentInspector({
        projectId: context.projectId,
        documentId: context.documentId,
        documentVersionId: context.documentId,
        fileName: document.name,
        kind,
        data: new Uint8Array(buffer),
      });
      if (!isCurrent(context, currentRequestId)) return;

      await context.documentRepository.saveExtraction(
        context.projectId,
        context.documentId,
        inspected.fragments,
        inspected.candidates,
      );
      if (!isCurrent(context, currentRequestId)) return;

      setState({
        status: 'ready',
        requestId: currentRequestId,
        candidateCount: inspected.candidates.length,
        warningCount: inspected.warnings.length,
      });
      onExtractionSaved?.(context.documentId, inspected.candidates.length);
    } catch (error) {
      if (!isCurrent(context, currentRequestId)) return;
      const serialized = serializeDocumentExtractorError(error);
      try {
        await context.documentRepository.markFailed(
          context.projectId,
          context.documentId,
          serialized.code,
        );
      } catch {
        // The primary extraction error remains the actionable user-facing failure.
      }
      if (!isCurrent(context, currentRequestId)) return;
      setState({
        status: 'error',
        requestId: currentRequestId,
        message: errorMessage(error),
      });
    }
  }

  return (
    <div className="document-extraction-actions" aria-busy={isLoading}>
      {legacyPowerPoint && <span className="document-format-note">请另存为 PPTX</span>}

      {kind && state.status !== 'error' && (
        <button
          className="button document-action"
          type="button"
          disabled={isLoading}
          onClick={() => void parseDocument()}
        >
          {isLoading ? '正在解析…' : '解析资料'}
        </button>
      )}

      {state.status === 'error' && (
        <>
          <span className="document-parse-error" role="alert">
            审核解析失败：{state.message}
          </span>
          <button
            className="button document-action document-action-danger"
            type="button"
            onClick={() => void parseDocument()}
          >
            重试解析
          </button>
        </>
      )}

      {state.status === 'ready' && state.candidateCount > 0 && (
        <span className="document-status document-status-review">待审核</span>
      )}
      {state.status === 'ready' && state.candidateCount === 0 && (
        <span className="document-zero-candidates">
          未识别到结构化字段，可手动录入
        </span>
      )}
      {state.status === 'idle' && initialStatus(document) && (
        <span className="document-status">{initialStatus(document)}</span>
      )}

      {canReview && (
        <button
          className="button document-action"
          type="button"
          onClick={() => onOpenReview(document)}
        >
          审核证据
        </button>
      )}
      <button
        className="button document-action document-manual-action"
        type="button"
        onClick={() => onOpenManual(document)}
      >
        手动录入
      </button>
    </div>
  );
}
