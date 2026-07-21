import { useRef, useState, type FormEvent } from 'react';
import type { InspectedSheet } from '../../infrastructure/import/excel-importer';

export interface ExcelMappingPanelProps {
  sheet: InspectedSheet;
  onMap: (mapping: Record<string, string>) => void | Promise<void>;
}

const TARGET_OPTIONS = [
  { value: '', label: '\u4e0d\u5bfc\u5165' },
  { value: 'company_name', label: 'company_name \u516c\u53f8\u540d\u79f0' },
  { value: 'revenue', label: 'revenue \u8425\u4e1a\u6536\u5165' },
  { value: 'gross_margin', label: 'gross_margin \u6bdb\u5229\u7387' },
  { value: 'net_profit', label: 'net_profit \u51c0\u5229\u6da6' },
  { value: 'operating_cash_flow', label: 'operating_cash_flow \u7ecf\u8425\u73b0\u91d1\u6d41' },
  { value: 'arr', label: 'arr ARR' },
] as const;

function displayCell(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '\u2014';
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function sheetIdentity(sheet: InspectedSheet): string {
  return JSON.stringify([sheet.name, sheet.headers]);
}

function ExcelMappingForm({ sheet, onMap }: ExcelMappingPanelProps) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submissionInProgress = useRef(false);

  async function submitMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInProgress.current) {
      return;
    }

    const mapping = Object.fromEntries(
      sheet.headers
        .map((header) => [header, selections[header] ?? ''] as const)
        .filter((entry) => entry[1] !== ''),
    );
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
    } finally {
      submissionInProgress.current = false;
      setPending(false);
    }
  }

  return (
    <section
      className="excel-mapping-panel"
      aria-labelledby="excel-mapping-heading"
      aria-busy={pending}
    >
      <header className="excel-mapping-header">
        <div>
          <p className="eyebrow">{'Excel / \u5b57\u6bb5\u6620\u5c04'}</p>
          <h2 id="excel-mapping-heading">{sheet.name}</h2>
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
                const selectId = `excel-map-${index}`;
                return (
                  <tr key={header}>
                    <th scope="row">{header}</th>
                    <td>
                      <label htmlFor={selectId}>{`${header} \u6620\u5c04\u5b57\u6bb5`}</label>
                      <select
                        id={selectId}
                        value={selections[header] ?? ''}
                        disabled={pending}
                        onChange={(event) => {
                          setSelections((current) => ({
                            ...current,
                            [header]: event.target.value,
                          }));
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
                      <td key={header}>{displayCell(row[header])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="excel-mapping-actions">
          <p>{'\u672a\u9009\u62e9\u76ee\u6807\u7684\u5217\u4e0d\u4f1a\u5bfc\u5165\u3002'}</p>
          <button className="button button-primary" type="submit" disabled={pending}>
            {pending ? '\u6b63\u5728\u5bfc\u5165\u2026' : '\u786e\u8ba4\u5bfc\u5165'}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ExcelMappingPanel(props: ExcelMappingPanelProps) {
  const identity = sheetIdentity(props.sheet);
  return <ExcelMappingForm key={identity} {...props} />;
}
