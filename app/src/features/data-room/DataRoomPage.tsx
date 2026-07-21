import { useState, type ChangeEvent } from 'react';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import type { FileVault } from '../../infrastructure/files/file-vault';

interface DataRoomPageProps {
  projectId: string;
  fileVault: FileVault;
}

export function DataRoomPage({ projectId, fileVault }: DataRoomPageProps) {
  const [documents, setDocuments] = useState<StoredDocument[]>([]);

  async function uploadDocuments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    for (const file of files) {
      await fileVault.store(projectId, file);
    }

    setDocuments(await fileVault.list(projectId));
  }

  return (
    <section className="page data-room-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Data Room / 本地资料</p>
          <h1>资料中心</h1>
          <p className="page-intro">集中保存尽调原始资料，文件仅存储在当前设备。</p>
        </div>
        <label className="button button-primary">
          上传资料
          <input
            className="visually-hidden"
            type="file"
            aria-label="上传资料"
            accept=".xlsx,.xls,.pdf,.doc,.docx,.ppt,.pptx"
            multiple
            onChange={uploadDocuments}
          />
        </label>
      </header>

      {documents.length === 0 ? (
        <div className="empty-state" role="status">
          <p className="empty-state-index">01 — DOCUMENTS</p>
          <div>
            <h2>尚未上传资料</h2>
            <p>上传财务报表、商业计划书或其他尽调文件后，将在此处显示。</p>
          </div>
        </div>
      ) : (
        <section className="project-form" aria-labelledby="document-list-heading">
          <div className="form-section">
            <div className="section-number" aria-hidden="true">01</div>
            <div className="form-section-content">
              <div className="section-heading">
                <h2 id="document-list-heading">已上传资料</h2>
                <p>{documents.length} 份原始文件存储在当前设备</p>
              </div>
              <ul>
                {documents.map((document) => (
                  <li key={document.id}>
                    <span>{document.name}</span>{' '}
                    <small>{(document.size / 1024).toFixed(1)} KB</small>
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
