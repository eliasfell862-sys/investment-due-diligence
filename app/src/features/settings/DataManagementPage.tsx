import { useState } from 'react';

function exportAllData(): string {
  const data: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('dd-')) {
      try { data[key] = JSON.parse(localStorage.getItem(key)!); } catch { data[key] = localStorage.getItem(key); }
    }
  }
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data }, null, 2);
}

function importAllData(json: string): { success: boolean; count: number; error?: string } {
  try {
    const parsed = JSON.parse(json);
    if (!parsed.data || typeof parsed.data !== 'object') return { success: false, count: 0, error: 'Invalid format' };
    let count = 0;
    for (const [key, value] of Object.entries(parsed.data)) {
      if (typeof key === 'string' && key.startsWith('dd-')) {
        localStorage.setItem(key, typeof value === 'string' ? value as string : JSON.stringify(value));
        count++;
      }
    }
    return { success: true, count };
  } catch (err) { return { success: false, count: 0, error: String(err) }; }
}

function clearAllData(): number {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('dd-')) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
  return keys.length;
}

export function DataManagementPage() {
  const [msg, setMsg] = useState('');
  const dataSize = new Blob([exportAllData()]).size;

  return (
    <div className="module-page">
      <h1>数据管理</h1>
      <p>All project data is stored locally. Backup regularly to avoid data loss.</p>
      <div className="results-grid" style={{marginBottom:28}}>
        <div className="metric-card"><strong>{localStorage.length}</strong><span>Keys</span></div>
        <div className="metric-card"><strong>{(dataSize/1024).toFixed(1)} KB</strong><span>Size</span></div>
      </div>
      <button className="button button-primary" onClick={() => {
        const json = exportAllData();
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `dd-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
        setMsg('Downloaded.');
      }}>Download Backup</button>
      <div style={{margin:'16px 0'}}>
        <input type="file" accept=".json" onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          const r = importAllData(await f.text());
          setMsg(r.success ? `Restored ${r.count} keys. Reload page.` : `Error: ${r.error}`);
        }} />
      </div>
      <button className="danger" onClick={() => {
        if (confirm('Delete all data?')) setMsg(`Cleared ${clearAllData()} keys.`);
      }}>Clear All Data</button>
      {msg && <div className="loss-info" style={{marginTop:20}}>{msg}</div>}
    </div>
  );
}
