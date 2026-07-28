import { useEffect, useRef, useState } from 'react';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import type { DocumentEvidenceRepository } from '../../infrastructure/db/document-evidence-repository';
import type { DocumentExtractionRequest } from '../../infrastructure/import/document-extractor';
import {
  inspectDocumentInWorker,
  serializeDocumentExtractorError,
  type DocumentCandidateResult,
} from '../../infrastructure/import/document-importer';
import { extractFieldsWithAI, applyExtractedFields } from '../../infrastructure/import/ai-field-extractor';
import { loadResearchConfig } from '../../infrastructure/research/research-adapter';

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
  readonly documentBlob: Blob;
  readonly fileName: string;
  readonly kind: DocumentExtractionRequest['kind'] | undefined;
}

type ExtractionRepository = DocumentExtractionWorkspaceProps['documentRepository'];
type PersistenceToken = symbol;

const latestPersistenceTokens = new WeakMap<
  ExtractionRepository,
  Map<string, PersistenceToken>
>();

function persistenceTargetKey(projectId: string, documentId: string): string {
  return JSON.stringify([projectId, documentId]);
}

function beginPersistenceRequest(context: ExtractionContext): PersistenceToken {
  let repositoryTokens = latestPersistenceTokens.get(context.documentRepository);
  if (!repositoryTokens) {
    repositoryTokens = new Map();
    latestPersistenceTokens.set(context.documentRepository, repositoryTokens);
  }
  const token = Symbol('document-extraction');
  repositoryTokens.set(persistenceTargetKey(context.projectId, context.documentId), token);
  return token;
}

function isLatestPersistenceRequest(
  context: ExtractionContext,
  token: PersistenceToken,
): boolean {
  return latestPersistenceTokens.get(context.documentRepository)?.get(
    persistenceTargetKey(context.projectId, context.documentId),
  ) === token;
}

function finishPersistenceRequest(context: ExtractionContext, token: PersistenceToken): void {
  const repositoryTokens = latestPersistenceTokens.get(context.documentRepository);
  const targetKey = persistenceTargetKey(context.projectId, context.documentId);
  if (repositoryTokens?.get(targetKey) !== token) return;
  repositoryTokens.delete(targetKey);
  if (repositoryTokens.size === 0) {
    latestPersistenceTokens.delete(context.documentRepository);
  }
}

function isSameUiContext(
  left: ExtractionContext,
  right: ExtractionContext,
): boolean {
  return (
    left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.documentRepository === right.documentRepository
    && left.documentInspector === right.documentInspector
    && left.documentBlob === right.documentBlob
    && left.fileName === right.fileName
    && left.kind === right.kind
  );
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
    const msg = error.message;
    // Translate common error codes
    if (msg.includes('unsupported-format') || msg.includes('Unsupported')) return '不支持该文件格式，请上传 PDF 或 PPTX。';
    if (msg.includes('password-protected')) return 'PDF 有密码保护，请上传未加密的文件。';
    if (msg.includes('worker-timeout')) return '文件解析超时，文件可能过大或格式异常。';
    if (msg.includes('input-too-large')) return '文件超过 100MB 上限，请压缩后重试。';
    if (msg.includes('malformed-document')) return '文件格式异常，无法解析。';
    if (msg.includes('text-limit')) return '文件文本量超过解析上限。';
    return msg;
  }
  return '解析失败，请重试或改用手动录入。';
}

function isUnsupportedFile(name: string): string | null {
  const lower = name.toLowerCase();
  if (/\.(doc|docx|rtf|txt|csv)$/i.test(lower)) return '暂不支持 Word/RTF/CSV 文件，请转换为 PDF 后上传。';
  if (/\.(png|jpg|jpeg|gif|bmp|tiff?|webp)$/i.test(lower)) return '暂不支持图片文件，请使用含文本的 PDF。';
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lower)) return '暂不支持压缩包，请解压后上传单个文件。';
  if (!/\.(pdf|pptx|ppt|xlsx|xls)$/i.test(lower)) return '不支持该文件格式。可解析：PDF、PPTX、Excel。';
  return null;
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
  const kind = documentKind(document.name);
  const [state, setState] = useState<ExtractionState>({ status: 'idle' });
  const [aiStatus, setAiStatus] = useState<'idle' | 'extracting' | 'done' | 'error'>('idle');
  const [aiMessage, setAiMessage] = useState('');
  const savedConfig = loadResearchConfig();
  const hasAiConfigured = savedConfig !== null && (savedConfig.provider === 'ollama' || !!savedConfig.apiKey);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const latestContext = useRef<ExtractionContext>({
    projectId,
    documentId: document.id,
    documentRepository,
    documentInspector,
    documentBlob: document.blob,
    fileName: document.name,
    kind,
  });
  latestContext.current = {
    projectId,
    documentId: document.id,
    documentRepository,
    documentInspector,
    documentBlob: document.blob,
    fileName: document.name,
    kind,
  };

  useEffect(() => {
    setState({ status: 'idle' });
  }, [
    projectId,
    document.id,
    document.blob,
    document.name,
    documentRepository,
    documentInspector,
    kind,
  ]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const legacyPowerPoint = isLegacyPowerPoint(document.name);
  const isLoading = state.status === 'loading';
  const canReview = (
    (state.status === 'ready' && state.candidateCount > 0)
    || document.parseStatus === 'review'
    || document.parseStatus === 'partial'
    || document.parseStatus === 'complete'
  );

  function isCurrentUi(
    context: ExtractionContext,
    token: PersistenceToken,
  ): boolean {
    return (
      mounted.current
      && isSameUiContext(latestContext.current, context)
      && isLatestPersistenceRequest(context, token)
    );
  }

  async function parseDocument(): Promise<void> {
    const context = latestContext.current;
    if (!context.kind || isLoading) return;

    // Pre-check for unsupported file types
    const unsupportedMsg = isUnsupportedFile(context.fileName);
    if (unsupportedMsg) {
      setState({
        status: 'error',
        requestId: ++requestId.current,
        message: unsupportedMsg,
      });
      return;
    }

    const currentRequestId = ++requestId.current;
    const persistenceToken = beginPersistenceRequest(context);
    setState({ status: 'loading', requestId: currentRequestId });

    try {
      await context.documentRepository.markParsing(context.projectId, context.documentId);
      if (!isLatestPersistenceRequest(context, persistenceToken)) return;

      const buffer = await context.documentBlob.arrayBuffer();
      if (!isLatestPersistenceRequest(context, persistenceToken)) return;

      const inspected = await context.documentInspector({
        projectId: context.projectId,
        documentId: context.documentId,
        documentVersionId: context.documentId,
        fileName: context.fileName,
        kind: context.kind,
        data: new Uint8Array(buffer),
      });
      if (!isLatestPersistenceRequest(context, persistenceToken)) return;

      await context.documentRepository.saveExtraction(
        context.projectId,
        context.documentId,
        inspected.fragments,
        inspected.candidates,
      );
      if (!isCurrentUi(context, persistenceToken)) return;

      setState({
        status: 'ready',
        requestId: currentRequestId,
        candidateCount: inspected.candidates.length,
        warningCount: inspected.warnings.length,
      });
      onExtractionSaved?.(context.documentId, inspected.candidates.length);
    } catch (error) {
      if (!isLatestPersistenceRequest(context, persistenceToken)) return;
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
      if (!isCurrentUi(context, persistenceToken)) return;
      setState({
        status: 'error',
        requestId: currentRequestId,
        message: errorMessage(error),
      });
    } finally {
      finishPersistenceRequest(context, persistenceToken);
    }
  }

  async function aiExtractDocument(): Promise<void> {
    const context = latestContext.current;
    if (!context.documentBlob || !hasAiConfigured) return;
    setAiStatus('extracting');
    setAiMessage('');
    try {
      // Re-extract text from the document
      const buffer = await context.documentBlob.arrayBuffer();
      const inspected = await (context.documentInspector ?? inspectDocumentInWorker)({
        projectId: context.projectId,
        documentId: context.documentId,
        documentVersionId: context.documentId,
        fileName: context.fileName,
        kind: context.kind ?? 'pdf',
        data: new Uint8Array(buffer),
      });
      const fullText = inspected.fragments.map((f) => f.normalizedText).join('\n\n');
      if (!fullText.trim()) { setAiStatus('error'); setAiMessage('文档无可提取文本，可能为扫描件。'); return; }

      const result = await extractFieldsWithAI(fullText);
      if (result.error) { setAiStatus('error'); setAiMessage(result.error); return; }
      if (!result.fields) { setAiStatus('error'); setAiMessage('AI 未返回有效结果。'); return; }

      const applied = applyExtractedFields(result.fields);
      setAiStatus('done');
      setAiMessage(`已提取 ${applied.length} 项：${applied.join('、')}。请进入分析工作台查看。`);
    } catch (err) {
      setAiStatus('error');
      setAiMessage(err instanceof Error ? err.message : 'AI 提取失败。');
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
        <div className="loss-info" style={{margin:'8px 0',background:'#fff8e1',borderLeftColor:'#ff9f0a'}}>
          <strong>未识别到结构化字段</strong><br />
          该 PDF 的文本已提取并保留，但未能自动匹配到公司名称、财务数据等字段。<br />
          <strong>建议：</strong>点击下方「手动录入」对照原文填写，或直接进入「分析工作台」在各模块表单中填写。
        </div>
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
      {!hasAiConfigured ? (
        <a
          className="button document-action"
          href={`/projects/${projectId}/research`}
          style={{ textDecoration: 'none', background: '#16766f', color: '#fff', fontWeight: 700 }}
        >
          🤖 配置 AI 模型以启用智能提取 →
        </a>
      ) : (
        <button
          className="button document-action"
          type="button"
          onClick={() => void aiExtractDocument()}
          disabled={aiStatus === 'extracting'}
          style={{ background: aiStatus === 'done' ? '#dff3e6' : '#16766f', color: '#fff', fontWeight: 700, border: 'none' }}
        >
          {aiStatus === 'extracting' ? 'AI 提取中…' : aiStatus === 'done' ? '✓ AI 提取完成' : '🤖 AI 智能提取'}
        </button>
      )}
      {aiMessage && (
        <span className={aiStatus === 'error' ? 'document-parse-error' : 'document-status document-status-review'} style={{display:'block',marginTop:6}}>
          {aiMessage}
        </span>
      )}
    </div>
  );
}
