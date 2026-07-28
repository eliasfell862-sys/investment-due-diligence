import { useState } from 'react';
interface Comp { name: string; stage: string; scale: string; pricing: string; share: string; diff: string }
export function CompetitorsPage() {
  const [comps, setComps] = useState<Comp[]>(() => { const s = localStorage.getItem('dd-competitors'); return s ? JSON.parse(s) : []; });
  const add = () => setComps([...comps, { name: '', stage: '', scale: '', pricing: '', share: '', diff: '' }]);
  const update = (i: number, f: string, v: string) => { const n = comps.map((c, idx) => idx === i ? { ...c, [f]: v } : c); setComps(n); localStorage.setItem('dd-competitors', JSON.stringify(n)); };
  const remove = (i: number) => { setComps(comps.filter((_, idx) => idx !== i)); };
  return (<div className="module-page"><h1>Competitors</h1><button onClick={add} className="primary-link">+ Add</button>
    {comps.map((c, i) => (<div key={i} className="card"><div className="flex-row">
      <input placeholder="Name" value={c.name} onChange={e => update(i, 'name', e.target.value)} />
      <input placeholder="Stage" value={c.stage} onChange={e => update(i, 'stage', e.target.value)} />
      <input placeholder="Scale" value={c.scale} onChange={e => update(i, 'scale', e.target.value)} />
    </div><div className="flex-row">
      <input placeholder="Pricing" value={c.pricing} onChange={e => update(i, 'pricing', e.target.value)} />
      <input placeholder="Share" value={c.share} onChange={e => update(i, 'share', e.target.value)} />
      <input placeholder="Differentiation" value={c.diff} onChange={e => update(i, 'diff', e.target.value)} />
    </div><button onClick={() => remove(i)} className="danger">X</button></div>))}
  </div>);
}
