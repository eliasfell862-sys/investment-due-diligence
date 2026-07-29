import { useState } from 'react';
import { useParams } from 'react-router-dom';

interface CustomField {
  key: string;
  value: string;
}

function loadFields(projectId: string): CustomField[] {
  try {
    const raw = localStorage.getItem(`dd-p-${projectId}-custom-fields`);
    if (!raw) return [];
    const obj = JSON.parse(raw) as Record<string, string>;
    return Object.entries(obj).map(([key, value]) => ({ key, value }));
  } catch {
    return [];
  }
}

function saveFields(projectId: string, fields: CustomField[]): void {
  const obj: Record<string, string> = {};
  for (const f of fields) {
    if (f.key.trim()) obj[f.key.trim()] = f.value;
  }
  localStorage.setItem(`dd-p-${projectId}-custom-fields`, JSON.stringify(obj));
}

export function CustomFieldsPage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();
  const [fields, setFields] = useState<CustomField[]>(() => loadFields(projectId));

  const persist = (next: CustomField[]) => {
    setFields(next);
    saveFields(projectId, next);
  };

  const updateField = (index: number, update: Partial<CustomField>) => {
    const next = [...fields];
    next[index] = { ...next[index], ...update };
    persist(next);
  };

  const addField = () => {
    persist([...fields, { key: '', value: '' }]);
  };

  const removeField = (index: number) => {
    const next = fields.filter((_, i) => i !== index);
    persist(next);
  };

  return (
    <div className="module-page">
      <h1>自定义字段</h1>
      <p style={{ color: 'var(--ink-500)', fontSize: '0.85rem', marginBottom: 20 }}>
        AI 从文档中弹性提取的额外结构化信息，以及手动补充的字段。这些字段也会显示在报告中。
      </p>

      {fields.length === 0 && (
        <div className="loss-info" style={{ marginTop: 16 }}>
          <strong>暂无自定义字段</strong><br />
          AI 提取时若发现额外结构化信息会自动填充，您也可以点击下方按钮手动添加。
        </div>
      )}

      <table className="data-table" style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th style={{ width: '30%' }}>字段名</th>
            <th style={{ width: '50%' }}>字段值</th>
            <th style={{ width: '20%' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f, i) => (
            <tr key={i}>
              <td>
                <input
                  value={f.key}
                  onChange={(e) => updateField(i, { key: e.target.value })}
                  placeholder="字段名"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </td>
              <td>
                <input
                  value={f.value}
                  onChange={(e) => updateField(i, { value: e.target.value })}
                  placeholder="字段值"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </td>
              <td>
                <button
                  className="button"
                  onClick={() => removeField(i)}
                  style={{ color: '#9c3f36', borderColor: '#9c3f36', background: 'transparent', fontSize: '0.8rem', padding: '4px 10px' }}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        className="button"
        onClick={addField}
        style={{ marginTop: 12, color: 'var(--teal)', borderColor: 'var(--teal)', background: 'transparent' }}
      >
        + 添加字段
      </button>
    </div>
  );
}
