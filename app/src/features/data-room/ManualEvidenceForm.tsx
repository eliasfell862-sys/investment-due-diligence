import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createManualEvidence,
  ManualEvidenceError,
} from '../../domain/evidence/create-manual-evidence';
import type { EvidenceSourceType } from '../../domain/evidence/evidence';
import {
  findTargetFieldDefinition,
  targetFieldDefinitions,
} from '../../domain/evidence/target-fields';
import { validateNormalizedTargetValue } from '../../domain/evidence/validate-normalized-target-value';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import type { EvidenceRepository } from '../../infrastructure/db/evidence-repository';

export interface ManualEvidenceFormProps {
  readonly projectId: string;
  readonly documents: readonly StoredDocument[];
  readonly initialDocumentId?: string;
  readonly evidenceRepository: Pick<EvidenceRepository, 'saveMany'>;
  readonly onClose: () => void;
  readonly onSaved?: () => void;
}

const sourceTypeOptions: ReadonlyArray<{
  readonly value: EvidenceSourceType;
  readonly label: string;
}> = [
  { value: 'document_fact', label: '文档事实' },
  { value: 'interview', label: '人工访谈' },
  { value: 'investor_assumption', label: '投资者假设' },
  { value: 'management_forecast', label: '管理层预测' },
];

function manualErrorMessage(error: unknown): string {
  if (error instanceof ManualEvidenceError) {
    if (error.code === 'invalid-value') return '请输入有效的字段值。';
    if (error.code === 'invalid-field') return '请选择有效的目标字段。';
    if (error.code === 'invalid-period') return '管理层预测必须填写明确期间。';
    if (error.code === 'invalid-source') return '请完整填写与来源类型匹配的来源信息。';
  }
  return '人工证据保存失败，请重试。';
}

export function ManualEvidenceForm({
  projectId,
  documents,
  initialDocumentId,
  evidenceRepository,
  onClose,
  onSaved,
}: ManualEvidenceFormProps) {
  const [sourceType, setSourceType] = useState<EvidenceSourceType>('document_fact');
  const [fieldId, setFieldId] = useState<string>(targetFieldDefinitions[0].id);
  const [value, setValue] = useState('');
  const [periodIdentity, setPeriodIdentity] = useState('');
  const [dimensionIdentity, setDimensionIdentity] = useState('');
  const [sourceDocumentId, setSourceDocumentId] = useState(initialDocumentId ?? '');
  const [sourceLocator, setSourceLocator] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const requestId = useRef(0);
  const latest = useRef({ projectId, evidenceRepository });
  latest.current = { projectId, evidenceRepository };

  useEffect(() => {
    requestId.current += 1;
    setSourceDocumentId(initialDocumentId ?? '');
    setStatus('idle');
    setMessage(null);
  }, [projectId, initialDocumentId, evidenceRepository]);

  const usesDocument = sourceType === 'document_fact' || sourceType === 'management_forecast';
  const needsNote = sourceType === 'interview' || sourceType === 'investor_assumption';

  function validateBeforeSubmit(): string | undefined {
    if (!value.trim()) return '请填写字段值。';
    const definition = findTargetFieldDefinition(fieldId);
    if (
      !definition
      || validateNormalizedTargetValue(definition, value).status !== 'valid'
    ) {
      return '请输入有效的字段值。';
    }
    if (sourceType === 'management_forecast' && !periodIdentity.trim()) {
      return '管理层预测必须填写明确期间。';
    }
    if (sourceType === 'document_fact') {
      if (!sourceDocumentId) return '请选择来源文件。';
      if (!sourceLocator.trim()) return '请填写来源定位。';
    }
    if (needsNote && !sourceNote.trim()) return '请填写来源说明。';
    if (
      sourceType === 'management_forecast'
      && sourceDocumentId
      && !sourceLocator.trim()
    ) {
      return '已选择来源文件时必须填写来源定位。';
    }
    if (
      sourceType === 'management_forecast'
      && !sourceDocumentId
      && !sourceNote.trim()
    ) {
      return '管理层预测必须填写来源文件定位或来源说明。';
    }
    return undefined;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (status === 'saving') return;
    const validationMessage = validateBeforeSubmit();
    if (validationMessage) {
      setStatus('error');
      setMessage(validationMessage);
      return;
    }

    const currentRequest = ++requestId.current;
    const context = latest.current;
    setStatus('saving');
    setMessage(null);
    try {
      const evidence = createManualEvidence({
        projectId: context.projectId,
        fieldId,
        value,
        sourceType,
        ...(periodIdentity.trim() ? { periodIdentity } : {}),
        ...(dimensionIdentity.trim() ? { dimensionIdentity } : {}),
        ...(usesDocument && sourceDocumentId ? { sourceDocumentId } : {}),
        ...(usesDocument && sourceLocator.trim() ? { sourceLocator } : {}),
        ...(sourceNote.trim() ? { sourceNote } : {}),
      });
      await context.evidenceRepository.saveMany([evidence]);
      if (
        requestId.current !== currentRequest
        || latest.current.projectId !== context.projectId
        || latest.current.evidenceRepository !== context.evidenceRepository
      ) {
        return;
      }
      setStatus('success');
      setMessage('人工证据已保存');
      onSaved?.();
    } catch (error) {
      if (
        requestId.current !== currentRequest
        || latest.current.projectId !== context.projectId
        || latest.current.evidenceRepository !== context.evidenceRepository
      ) {
        return;
      }
      setStatus('error');
      setMessage(manualErrorMessage(error));
    }
  }

  return (
    <aside className="manual-evidence-drawer" aria-labelledby="manual-evidence-heading">
      <header>
        <div>
          <p className="eyebrow">MANUAL EVIDENCE / 人工证据</p>
          <h2 id="manual-evidence-heading">录入可追溯证据</h2>
        </div>
        <button className="button drawer-close" type="button" onClick={onClose}>
          关闭
        </button>
      </header>

      <form onSubmit={(event) => void submit(event)}>
        <div className="manual-form-grid">
          <div className="field">
            <label htmlFor="manual-source-type">来源类型</label>
            <select
              id="manual-source-type"
              value={sourceType}
              onChange={(event) => {
                setSourceType(event.target.value as EvidenceSourceType);
                setMessage(null);
                setStatus('idle');
              }}
            >
              {sourceTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="manual-field-id">目标字段</label>
            <select id="manual-field-id" value={fieldId} onChange={(event) => setFieldId(event.target.value)}>
              {targetFieldDefinitions.map((field) => (
                <option key={field.id} value={field.id}>{field.label}</option>
              ))}
            </select>
          </div>

          <div className="field manual-field-wide">
            <label htmlFor="manual-value">字段值</label>
            <textarea id="manual-value" value={value} onChange={(event) => setValue(event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="manual-period">期间标识</label>
            <input id="manual-period" value={periodIdentity} placeholder="例如 2025 或 FY2027" onChange={(event) => setPeriodIdentity(event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="manual-dimension">维度标识（可选）</label>
            <input id="manual-dimension" value={dimensionIdentity} placeholder="留空使用项目默认维度" onChange={(event) => setDimensionIdentity(event.target.value)} />
          </div>

          {usesDocument && (
            <>
              <div className="field">
                <label htmlFor="manual-document">来源文件</label>
                <select id="manual-document" value={sourceDocumentId} onChange={(event) => setSourceDocumentId(event.target.value)}>
                  <option value="">不使用文件</option>
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>{document.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="manual-locator">来源定位</label>
                <input id="manual-locator" value={sourceLocator} placeholder="例如 第12页 / 表格2 / 第4行第3列" onChange={(event) => setSourceLocator(event.target.value)} />
              </div>
            </>
          )}

          {(needsNote || sourceType === 'management_forecast') && (
            <div className="field manual-field-wide">
              <label htmlFor="manual-source-note">来源说明</label>
              <textarea id="manual-source-note" value={sourceNote} placeholder="记录访谈对象、假设依据或预测口径，不填写未经证实的数值" onChange={(event) => setSourceNote(event.target.value)} />
            </div>
          )}
        </div>

        {message && (
          <p className={status === 'success' ? 'review-success' : 'review-error'} role={status === 'success' ? 'status' : 'alert'}>
            {message}
          </p>
        )}
        <div className="manual-form-actions">
          <p>人工录入不会把投资者假设标记为文档事实。</p>
          <button className="button button-primary" type="submit" disabled={status === 'saving'}>
            {status === 'saving' ? '正在保存…' : '保存正式证据'}
          </button>
        </div>
      </form>
    </aside>
  );
}
