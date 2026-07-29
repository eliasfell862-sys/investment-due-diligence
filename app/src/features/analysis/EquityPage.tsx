import { useState } from 'react';
import { useParams } from 'react-router-dom';
interface Shareholder { name: string; shares: string; pct: string; class_: string }
export function EquityPage() {
  const { projectId = "default" } = useParams<{ projectId: string }>();
  const [sh, setSh] = useState<Shareholder[]>(() => { const s = localStorage.getItem(`dd-p-${projectId}-equity`); return s ? JSON.parse(s) : []; });
  const [esop, setEsop] = useState(() => localStorage.getItem(`dd-p-${projectId}-esop`) || '10');
  const [invest, setInvest] = useState(() => localStorage.getItem(`dd-p-${projectId}-invest`) || '');
  const add = () => setSh([...sh, { name: '', shares: '', pct: '', class_: 'Common' }]);
  const update = (i: number, f: string, v: string) => { const n = sh.map((s, idx) => idx === i ? { ...s, [f]: v } : s); setSh(n); localStorage.setItem('dd-equity', JSON.stringify(n)); };
  const remove = (i: number) => { const n = sh.filter((_, idx) => idx !== i); setSh(n); localStorage.setItem('dd-equity', JSON.stringify(n)); };
  return (
    <div className="module-page"><h1>股权与融资</h1>
      <form className="module-form" onSubmit={e => e.preventDefault()}>
        <label>ESOP池%<input value={esop} onChange={e => { setEsop(e.target.value); localStorage.setItem(`dd-p-${projectId}-esop`, e.target.value); }} /></label>
        <label>投资金额<input value={invest} onChange={e => { setInvest(e.target.value); localStorage.setItem(`dd-p-${projectId}-invest`, e.target.value); }} /></label>
      </form>
      <h2>股权结构表</h2>
      <button onClick={add} className="primary-link">+ 添加</button>
      {sh.map((s, i) => (
        <div key={i} className="card flex-row">
          <input placeholder="Name" value={s.name} onChange={e => update(i, 'name', e.target.value)} />
          <input placeholder="Shares" value={s.shares} onChange={e => update(i, 'shares', e.target.value)} />
          <input placeholder="%" value={s.pct} onChange={e => update(i, 'pct', e.target.value)} />
          <select value={s.class_} onChange={e => update(i, 'class_', e.target.value)}>
            <option>普通股</option><option>优先股</option><option>ESOP</option>
          </select>
          <button onClick={() => remove(i)} className="danger">🗑</button>
        </div>
      ))}
    </div>);
}
