import { useEffect, useState } from 'react';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import {
  inspectWorkbookInWorker,
  mapRowsToEvidence,
  type InspectedWorkbook,
} from '../../infrastructure/import/excel-importer';
import { ExcelMappingPanel } from './ExcelMappingPanel';
import { ExcelMappingSubmissionError } from './excel-mapping-error';

export type WorkbookInspector = (
  data: Uint8Array,
) => Promise<InspectedWorkbook>;

export interface EvidenceWriter {
  saveMany(items: readonly EvidenceItem[]): Promise<void>;
}

export interface ExcelImportWorkspaceProps {
  readonly projectId: string;
  readonly document: StoredDocument;
  readonly inspector?: WorkbookInspector;
  readonly evidenceRepository?: EvidenceWriter;
  readonly completedImportKeys?: ReadonlySet<string>;
  readonly onImportCompleted?: (importKey: string) => void;
}

const emptyCompletedImportKeys = new Set<string>();

export function ExcelImportWorkspace({
  projectId,
  document,
  inspector = inspectWorkbookInWorker,
  evidenceRepository,
  completedImportKeys = emptyCompletedImportKeys,
  onImportCompleted = () => undefined,
}: ExcelImportWorkspaceProps) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [workbook, setWorkbook] = useState<InspectedWorkbook | null>(null);
  const [selectedSheetName, setSelectedSheetName] = useState('');

  useEffect(() => {
    let current = true;
    setStatus('loading');
    setWorkbook(null);
    setSelectedSheetName('');

    void document.blob.arrayBuffer()
      .then((buffer) => inspector(new Uint8Array(buffer)))
      .then(
        (inspected) => {
          if (!current || inspected.sheetNames.length === 0) return;
          setWorkbook(inspected);
          setSelectedSheetName(inspected.sheetNames[0]!);
          setStatus('ready');
        },
        () => {
          if (current) setStatus('error');
        },
      );

    return () => {
      current = false;
    };
  }, [attempt, document, inspector]);

  if (status === 'loading') {
    return (
      <section className="excel-import-workspace" aria-busy="true">
        <p role="status">正在解析 {document.name}…</p>
      </section>
    );
  }

  if (status === 'error' || !workbook) {
    return (
      <section className="excel-import-workspace excel-import-error">
        <p role="alert">无法解析 Excel 文件，请重试。</p>
        <button
          className="button data-room-retry"
          type="button"
          onClick={() => setAttempt((current) => current + 1)}
        >
          重新解析 {document.name}
        </button>
      </section>
    );
  }

  const sheet = workbook.sheets[selectedSheetName];
  if (!sheet) {
    return null;
  }

  return (
    <section className="excel-import-workspace" aria-label={`${document.name} Excel 导入`}>
      <div className="field excel-sheet-selector">
        <label htmlFor="data-room-sheet-select">选择工作表</label>
        <select
          id="data-room-sheet-select"
          value={selectedSheetName}
          onChange={(event) => setSelectedSheetName(event.target.value)}
        >
          {workbook.sheetNames.map((sheetName) => (
            <option key={sheetName} value={sheetName}>{sheetName}</option>
          ))}
        </select>
      </div>

      <ExcelMappingPanel
        documentId={document.id}
        sheet={sheet}
        completedImportKeys={completedImportKeys}
        onImportCompleted={onImportCompleted}
        onMap={async (mapping) => {
          if (!evidenceRepository) {
            throw new Error('Evidence repository is required for Excel import.');
          }
          const evidence = mapRowsToEvidence(projectId, document.id, sheet, mapping);
          if (evidence.length === 0) {
            throw new ExcelMappingSubmissionError('no-importable-data');
          }
          await evidenceRepository.saveMany(evidence);
        }}
      />
    </section>
  );
}
