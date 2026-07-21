import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import { FileVaultError, type FileVault } from '../../infrastructure/files/file-vault';
import { formatFileSize } from './format-file-size';

interface DataRoomPageProps {
  projectId: string;
  vault: FileVault;
}

type DataRoomStatus = 'loading' | 'ready' | 'uploading' | 'error';

const GENERIC_UPLOAD_ERROR = '无法保存所选资料，请检查文件后重试。';
const QUOTA_UPLOAD_ERROR = '本地存储空间不足，请清理浏览器存储后重试。';
const LOAD_ERROR = '无法读取本地资料，请稍后重试。';


function uploadErrorMessage(error: unknown): string {
  if (error instanceof FileVaultError && error.code === 'quota-exceeded') {
    return QUOTA_UPLOAD_ERROR;
  }
  return GENERIC_UPLOAD_ERROR;
}

export function DataRoomPage({ projectId, vault }: DataRoomPageProps) {
  const [storedDocuments, setDocuments] = useState<StoredDocument[]>([]);
  const [status, setStatus] = useState<DataRoomStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestId = useRef(0);
  const loadedContext = useRef<{ projectId: string; vault: FileVault } | null>(null);
  const contextMatches =
    loadedContext.current?.projectId === projectId && loadedContext.current.vault === vault;
  const documents = contextMatches ? storedDocuments : [];
  const displayStatus: DataRoomStatus = contextMatches ? status : 'loading';
  const isBusy = displayStatus === 'loading' || displayStatus === 'uploading';

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
          setErrorMessage(LOAD_ERROR);
          loadedContext.current = { projectId, vault };
          setStatus('error');
        }
      },
    );

    return () => {
      requestId.current += 1;
    };
  }, [projectId, vault]);

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
    let failure: unknown;
    let hasFailure = false;

    try {
      await vault.storeMany(projectId, files);
    } catch (error) {
      failure = error;
      hasFailure = true;
    }

    try {
      const refreshedDocuments = await vault.list(projectId);
      if (requestId.current === currentRequest) {
        setDocuments(refreshedDocuments);
        loadedContext.current = { projectId, vault };
      }
    } catch (error) {
      if (!hasFailure) {
        failure = error;
        hasFailure = true;
      }
    } finally {
      input.value = '';
      if (requestId.current === currentRequest) {
        if (hasFailure) {
          setErrorMessage(uploadErrorMessage(failure));
          setStatus('error');
        } else {
          setStatus('ready');
        }
      }
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
          aria-disabled={isBusy}
        >
          {status === 'uploading' ? '正在保存…' : '上传资料'}
          <input
            className="visually-hidden"
            type="file"
            aria-label="上传资料"
            accept=".xlsx,.xls,.pdf,.doc,.docx,.ppt,.pptx"
            multiple
            disabled={isBusy}
            onChange={uploadDocuments}
          />
        </label>
      </header>

      {errorMessage && (
        <p className="form-error data-room-error" role="alert">
          {errorMessage}
        </p>
      )}

      {displayStatus === 'loading' ? (
        <div className="empty-state" role="status">
          <p className="empty-state-index">01 — DOCUMENTS</p>
          <div>
            <h2>正在加载资料…</h2>
            <p>正在读取当前项目保存在本设备上的原始文件。</p>
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
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
