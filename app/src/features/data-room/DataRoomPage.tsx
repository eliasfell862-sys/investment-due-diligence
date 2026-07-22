import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import {
  FileVaultError,
  sortStoredDocuments,
  type FileVault,
  type FileVaultErrorCode,
} from '../../infrastructure/files/file-vault';
import {
  ExcelImportWorkspace,
  type EvidenceWriter,
  type WorkbookInspector,
} from './ExcelImportWorkspace';
import { formatFileSize } from './format-file-size';

export interface DataRoomPageProps {
  readonly projectId: string;
  readonly vault: FileVault;
  readonly inspector?: WorkbookInspector;
  readonly evidenceRepository?: EvidenceWriter;
  readonly completedImportKeys?: ReadonlySet<string>;
  readonly onImportCompleted?: (importKey: string) => void;
}

type DataRoomStatus =
  | 'loading'
  | 'ready'
  | 'uploading'
  | 'upload-error'
  | 'load-error'
  | 'refresh-error';

const GENERIC_UPLOAD_ERROR = '无法保存所选资料，请稍后重试。';
const LOAD_ERROR = '无法读取本地资料，请重新加载列表。';
const REFRESH_ERROR = '文件已保存，但列表刷新失败。';

const FILE_VAULT_ERROR_MESSAGES: Record<FileVaultErrorCode, string> = {
  'invalid-project': '项目标识无效，无法保存资料。',
  'invalid-file': '所选文件无效，请重新选择。',
  'unsupported-file': '不支持该文件格式，请选择 Excel、PDF、Word 或 PowerPoint 文件。',
  'file-too-large': '单个文件不能超过 100 MiB。',
  'duplicate-id': '文件保存冲突，请重新选择后重试。',
  'quota-exceeded': '本地存储空间不足，请清理浏览器存储后重试。',
  'batch-too-large': '单次最多上传 50 个文件，且总大小不能超过 250 MiB。',
};

function uploadErrorMessage(error: unknown): string {
  if (error instanceof FileVaultError) {
    return FILE_VAULT_ERROR_MESSAGES[error.code];
  }
  return GENERIC_UPLOAD_ERROR;
}

function mergeDocuments(
  existing: readonly StoredDocument[],
  stored: readonly StoredDocument[],
): StoredDocument[] {
  const byId = new Map(existing.map((document) => [document.id, document]));
  for (const document of stored) {
    byId.set(document.id, document);
  }
  return sortStoredDocuments([...byId.values()]);
}

function isExcelDocument(document: StoredDocument): boolean {
  return /\.(xlsx|xls)$/i.test(document.name);
}

export function DataRoomPage({
  projectId,
  vault,
  inspector,
  evidenceRepository,
  completedImportKeys,
  onImportCompleted,
}: DataRoomPageProps) {
  const [storedDocuments, setDocuments] = useState<StoredDocument[]>([]);
  const [status, setStatus] = useState<DataRoomStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestId = useRef(0);
  const [excelContext, setExcelContext] = useState<{
    readonly projectId: string;
    readonly vault: FileVault;
    readonly document: StoredDocument;
    readonly request: number;
  } | null>(null);
  const excelOpenRequest = useRef(0);
  const loadedContext = useRef<{ projectId: string; vault: FileVault } | null>(null);
  const contextMatches =
    loadedContext.current?.projectId === projectId && loadedContext.current.vault === vault;
  const documents = contextMatches ? storedDocuments : [];
  const displayStatus: DataRoomStatus = contextMatches ? status : 'loading';
  const isBusy = displayStatus === 'loading' || displayStatus === 'uploading';
  const canReload = displayStatus === 'load-error' || displayStatus === 'refresh-error';
  const activeExcel =
    excelContext?.projectId === projectId && excelContext.vault === vault
      ? excelContext
      : null;
  const isUploadDisabled = isBusy || canReload;

  useEffect(() => {
    const currentRequest = ++requestId.current;
    setDocuments([]);
    setErrorMessage(null);
    setStatus('loading');

    void vault.list(projectId).then(
      (loadedDocuments) => {
        if (requestId.current === currentRequest) {
          loadedContext.current = { projectId, vault };
          setDocuments(loadedDocuments);
          setStatus('ready');
        }
      },
      () => {
        if (requestId.current === currentRequest) {
          loadedContext.current = { projectId, vault };
          setErrorMessage(LOAD_ERROR);
          setStatus('load-error');
        }
      },
    );

    return () => {
      requestId.current += 1;
    };
  }, [projectId, vault]);

  async function reloadDocuments() {
    const failureStatus: DataRoomStatus =
      displayStatus === 'refresh-error' ? 'refresh-error' : 'load-error';
    const currentRequest = ++requestId.current;
    setErrorMessage(null);
    setStatus('loading');

    try {
      const loadedDocuments = await vault.list(projectId);
      if (requestId.current === currentRequest) {
        loadedContext.current = { projectId, vault };
        setDocuments(loadedDocuments);
        setStatus('ready');
      }
    } catch {
      if (requestId.current === currentRequest) {
        loadedContext.current = { projectId, vault };
        setErrorMessage(failureStatus === 'refresh-error' ? REFRESH_ERROR : LOAD_ERROR);
        setStatus(failureStatus);
      }
    }
  }

  async function uploadDocuments(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) {
      input.value = '';
      return;
    }

    const currentRequest = ++requestId.current;
    setErrorMessage(null);
    setStatus('uploading');

    let stored: StoredDocument[];
    try {
      stored = await vault.storeMany(projectId, files);
    } catch (error) {
      input.value = '';
      if (requestId.current === currentRequest) {
        setErrorMessage(uploadErrorMessage(error));
        setStatus('upload-error');
      }
      return;
    }

    if (requestId.current === currentRequest) {
      loadedContext.current = { projectId, vault };
      setDocuments((existing) => mergeDocuments(existing, stored));
    }

    try {
      const refreshedDocuments = await vault.list(projectId);
      if (requestId.current === currentRequest) {
        loadedContext.current = { projectId, vault };
        setDocuments(refreshedDocuments);
        setStatus('ready');
      }
    } catch {
      if (requestId.current === currentRequest) {
        setErrorMessage(REFRESH_ERROR);
        setStatus('refresh-error');
      }
    } finally {
      input.value = '';
    }
  }

  return (
    <section
      className="page data-room-page"
      role="region"
      aria-labelledby="data-room-heading"
      aria-busy={isBusy}
    >
      <header className="page-header">
        <div>
          <p className="eyebrow">Data Room / 本地资料</p>
          <h1 id="data-room-heading">资料中心</h1>
          <p className="page-intro">集中保存尽调原始资料，文件仅存储在当前设备。</p>
        </div>
        <label
          className="button button-primary data-room-upload"
          aria-disabled={isUploadDisabled}
        >
          {displayStatus === 'uploading' ? '正在保存…' : '上传资料'}
          <input
            className="visually-hidden"
            type="file"
            aria-label="上传资料"
            accept=".xlsx,.xls,.pdf,.doc,.docx,.ppt,.pptx"
            multiple
            disabled={isUploadDisabled}
            onChange={uploadDocuments}
          />
        </label>
      </header>

      {errorMessage && (
        <div className="form-error data-room-error" role="alert">
          <p>{errorMessage}</p>
          {canReload && (
            <button
              className="button data-room-retry"
              type="button"
              onClick={() => void reloadDocuments()}
            >
              重新加载列表
            </button>
          )}
        </div>
      )}

      {displayStatus === 'loading' ? (
        <div className="empty-state" role="status">
          <p className="empty-state-index">01 — DOCUMENTS</p>
          <div>
            <h2>正在加载资料…</h2>
            <p>正在读取当前项目保存在本设备上的原始文件。</p>
          </div>
        </div>
      ) : displayStatus === 'load-error' ? (
        <div className="empty-state data-room-failure-state">
          <p className="empty-state-index">01 — DOCUMENTS</p>
          <div>
            <h2>资料列表暂不可用</h2>
            <p>请重新加载列表后再继续上传，避免覆盖未知的本地资料状态。</p>
          </div>
        </div>
      ) : documents.length === 0 ? (
        <div className="empty-state" role="status">
          <p className="empty-state-index">01 — DOCUMENTS</p>
          <div>
            <h2>尚未上传资料</h2>
            <p>上传财务报表、商业计划书或其他尽调文件后，将在此处显示。</p>
          </div>
        </div>
      ) : (
        <section className="project-form data-room-register" aria-labelledby="document-list-heading">
          <div className="form-section">
            <div className="section-number" aria-hidden="true">01</div>
            <div className="form-section-content">
              <div className="section-heading">
                <h2 id="document-list-heading">已上传资料</h2>
                <p>{documents.length} 份原始文件存储在当前设备</p>
              </div>
              <ul className="document-list">
                {documents.map((document) => (
                  <li className="document-row" key={document.id}>
                    <span className="document-name" title={document.name}>
                      {document.name}
                    </span>
                    <small className="document-size">{formatFileSize(document.size)}</small>
                    {isExcelDocument(document) && (
                      <button
                        className="button document-excel-action"
                        type="button"
                        onClick={() => {
                          excelOpenRequest.current += 1;
                          setExcelContext({
                            projectId,
                            vault,
                            document,
                            request: excelOpenRequest.current,
                          });
                        }}
                      >
                        解析 {document.name}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
      {activeExcel && (
        <ExcelImportWorkspace
          key={`${activeExcel.projectId}:${activeExcel.document.id}:${activeExcel.request}`}
          projectId={projectId}
          document={activeExcel.document}
          inspector={inspector}
          evidenceRepository={evidenceRepository}
          completedImportKeys={completedImportKeys}
          onImportCompleted={onImportCompleted}
        />
      )}
    </section>
  );
}
