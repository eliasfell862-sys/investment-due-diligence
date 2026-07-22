import { useId, useRef, useState, type FormEvent } from 'react';
import { importableTargetFieldDefinitions } from '../../domain/evidence/target-fields';
import {
  createExcelImportKey,
  type InspectedCell,
  type InspectedSheet,
} from '../../infrastructure/import/excel-importer';

export interface ExcelMappingPanelProps {
  sheet: InspectedSheet;
  documentId: string;
  onMap: (mapping: Record<string, string>) => void | Promise<void>;
  completedImportKeys: ReadonlySet<string>;
  onImportCompleted: (importKey: string) => void;
}

const TARGET_OPTIONS = [
  { value: '', label: '\u4e0d\u5bfc\u5165' },
  ...importableTargetFieldDefinitions.map(({ id, label }) => ({ value: id, label })),
];

function displayCell(value: unknown, cell?: InspectedCell): string {
  if (cell?.w !== undefined) {
    return cell.w;
  }
  if (value === null || value === undefined || value === '') {
    return '\u2014';
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function sheetIdentity(sheet: InspectedSheet, documentId: string): string {
  return createExcelImportKey(documentId, sheet);
}

function createSelectionRecord(): Record<string, string> {
  return Object.create(null);
}

function ownSelection(selections: Record<string, string>, header: string): string {
  return Object.prototype.hasOwnProperty.call(selections, header) ? selections[header] ?? '' : '';
}

function ExcelMappingForm({
  sheet,
  documentId,
  onMap,
  completedImportKeys,
  onImportCompleted,
}: ExcelMappingPanelProps) {
  const [selections, setSelections] = useState<Record<string, string>>(createSelectionRecord);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completedLocally, setCompletedLocally] = useState(false);
  const importKey = sheetIdentity(sheet, documentId);
  const completed = completedLocally || completedImportKeys.has(importKey);
  const submissionInProgress = useRef(false);
  const idPrefix = useId();
  const headingId = `${idPrefix}-excel-mapping-heading`;

  async function submitMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInProgress.current || completed) {
      return;
    }

    const mapping = Object.fromEntries(
      sheet.headers
        .map((header) => [header, ownSelection(selections, header)] as const)
        .filter((entry) => entry[1] !== ''),
    );
    if (Object.keys(mapping).length === 0) {
      setErrorMessage('\u81f3\u5c11\u6620\u5c04\u4e00\u4e2a\u5b57\u6bb5\u540e\u624d\u80fd\u5bfc\u5165\u3002');
      return;
    }
    const targets = Object.values(mapping);
    if (new Set(targets).size !== targets.length) {
      setErrorMessage('\u6bcf\u4e2a\u76ee\u6807\u5b57\u6bb5\u53ea\u80fd\u6620\u5c04\u4e00\u6b21\uff0c\u8bf7\u8c03\u6574\u540e\u91cd\u8bd5\u3002');
      return;
    }

    submissionInProgress.current = true;
    setPending(true);
    setErrorMessage(null);
    try {
      await onMap(mapping);
    } catch {
      setErrorMessage('\u5bfc\u5165\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002');
      return;
    } finally {
      submissionInProgress.current = false;
      setPending(false);
    }
    setCompletedLocally(true);
    try {
      onImportCompleted(importKey);
    } catch {
      // Completion reporting cannot make a successful import retryable.
    }
  }

  return (
    <section
      className="excel-mapping-panel"
      aria-labelledby={headingId}
      aria-busy={pending}
    >
      <header className="excel-mapping-header">
        <div>
          <p className="eyebrow">{'Excel / \u5b57\u6bb5\u6620\u5c04'}</p>
          <h2 id={headingId}>{sheet.name}</h2>
        </div>
        <p className="excel-row-count">{`${sheet.rows.length} \u884c\u6570\u636e`}</p>
      </header>

      <form onSubmit={(event) => void submitMapping(event)}>
        <div className="excel-table-scroll">
          <table className="excel-mapping-table">
            <caption>{`${sheet.name} \u5b57\u6bb5\u6620\u5c04`}</caption>
            <thead>
              <tr>
                <th scope="col">{'\u6e90\u5b57\u6bb5'}</th>
                <th scope="col">{'\u5bfc\u5165\u76ee\u6807'}</th>
              </tr>
            </thead>
            <tbody>
              {sheet.headers.map((header, index) => {
                const selectId = `${idPrefix}-excel-map-${index}`;
                return (
                  <tr key={header}>
                    <th scope="row">{header}</th>
                    <td>
                      <label htmlFor={selectId}>{`${header} \u6620\u5c04\u5b57\u6bb5`}</label>
                      <select
                        id={selectId}
                        value={ownSelection(selections, header)}
                        disabled={pending || completed}
                        onChange={(event) => {
                          setSelections((current) => {
                            const next = createSelectionRecord();
                            Object.assign(next, current);
                            next[header] = event.target.value;
                            return next;
                          });
                          setErrorMessage(null);
                        }}
                      >
                        {TARGET_OPTIONS.map((option) => (
                          <option key={option.value || 'skip'} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {errorMessage && (
          <p className="form-error excel-mapping-error" role="alert">
            {errorMessage}
          </p>
        )}

        <div className="excel-preview-block">
          <div className="excel-preview-heading">
            <h3>{'\u6570\u636e\u9884\u89c8'}</h3>
            <p>{'\u4ec5\u663e\u793a\u524d\u4e94\u884c\uff0c\u6570\u503c\u4fdd\u6301\u539f\u59cb\u5355\u5143\u683c\u8868\u793a\u3002'}</p>
          </div>
          <div className="excel-table-scroll">
            <table className="excel-preview-table">
              <caption>{`${sheet.name} \u524d\u4e94\u884c\u9884\u89c8`}</caption>
              <thead>
                <tr>
                  {sheet.headers.map((header) => (
                    <th key={header} scope="col">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(0, 5).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {sheet.headers.map((header) => (
                      <td key={header}>
                        {displayCell(row[header], sheet.cells[rowIndex]?.[header])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="excel-mapping-actions">
          <p>{'\u672a\u9009\u62e9\u76ee\u6807\u7684\u5217\u4e0d\u4f1a\u5bfc\u5165\u3002'}</p>
          <button className="button button-primary" type="submit" disabled={pending || completed}>
            {completed
              ? '\u5bfc\u5165\u5b8c\u6210'
              : pending ? '\u6b63\u5728\u5bfc\u5165\u2026' : '\u786e\u8ba4\u5bfc\u5165'}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ExcelMappingPanel(props: ExcelMappingPanelProps) {
  const identity = sheetIdentity(props.sheet, props.documentId);
  return <ExcelMappingForm key={identity} {...props} />;
}
