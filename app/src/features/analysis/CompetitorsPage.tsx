import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
interface Comp { name: string; stage: string; scale: string; pricing: string; share: string; diff: string; funding: string }
export function CompetitorsPage() {
  const { projectId = "default" } = useParams<{ projectId: string }>();
  const [comps, setComps] = useState<Comp[]>(() => { const s = localStorage.getItem(`dd-p-${projectId}-competitors`); return s ? JSON.parse(s) : []; });
  const [targetShare, setTargetShare] = useState(() => localStorage.getItem(`dd-p-${projectId}-target-share`) || '');
  const save = () => { setComps([...comps]); localStorage.setItem(`dd-p-${projectId}-competitors`, JSON.stringify(comps)); };
  const add = () => { comps.push({ name:'',stage:'',scale:'',pricing:'',share:'',diff:'',funding:'' }); save(); };
  const update = (i:number,f:string,v:string) => { (comps[i] as any)[f]=v; save(); };
  const remove = (i:number) => { comps.splice(i,1); save(); };

  const analysis = useMemo(() => ({
    count: comps.length,
    totalShare: comps.reduce((s,c) => s + (parseFloat(c.share)||0), 0),
    stages: comps.reduce((acc,c) => { acc[c.stage]=(acc[c.stage]||0)+1; return acc; }, {} as Record<string,number>),
    hasTarget: parseFloat(targetShare) > 0,
    gap: parseFloat(targetShare) - comps.reduce((s,c) => s + (parseFloat(c.share)||0), 0),
  }), [comps, targetShare]);

  return (<div className="module-page"><h1>Competitor Analysis</h1>
    <label style={{marginBottom:16}}>Target Company Share %<input value={targetShare} onChange={e=>{setTargetShare(e.target.value);localStorage.setItem(`dd-p-${projectId}-target-share`,e.target.value);}} style={{width:120,marginLeft:12}}/></label>
    <button onClick={add} className="primary-link">+ Add Competitor</button>
    {comps.map((c,i)=>(<div key={i} className="card">
      <div className="flex-row">
        <input placeholder="Name" value={c.name} onChange={e=>update(i,'name',e.target.value)} />
        <select value={c.stage} onChange={e=>update(i,'stage',e.target.value)}><option value="">Stage</option><option>Seed</option><option>Series A</option><option>Series B+</option><option>Public</option></select>
        <input placeholder="Scale" value={c.scale} onChange={e=>update(i,'scale',e.target.value)} />
      </div>
      <div className="flex-row">
        <input placeholder="Pricing" value={c.pricing} onChange={e=>update(i,'pricing',e.target.value)} />
        <input placeholder="Share %" value={c.share} onChange={e=>update(i,'share',e.target.value)} />
        <input placeholder="Funding" value={c.funding} onChange={e=>update(i,'funding',e.target.value)} />
      </div>
      <input placeholder="Differentiation / Moat" value={c.diff} onChange={e=>update(i,'diff',e.target.value)} style={{width:'100%'}} />
      <button onClick={()=>remove(i)} className="danger">Remove</button>
    </div>))}
    {analysis.count>0&&<section style={{marginTop:24}}><h2>Analysis</h2>
      <div className="results-grid">
        <div className="metric-card"><strong>{analysis.count}</strong><span>Competitors</span></div>
        <div className="metric-card"><strong>{analysis.totalShare}%</strong><span>Total Share</span></div>
        <div className="metric-card"><strong>{analysis.hasTarget?(analysis.gap>0?`+${analysis.gap}% gap`:'Saturated'):'—'}</strong><span>vs Target</span></div>
      </div>
      {Object.keys(analysis.stages).length>0&&<div className="loss-info" style={{background:'#e8f3f4',borderLeftColor:'#16766f'}}>
        <strong>Stage Distribution:</strong> {Object.entries(analysis.stages).map(([s,c])=>`${s}: ${c}`).join(' | ')}
      </div>}
      {comps.some(c=>c.diff)&&<div style={{marginTop:16}}><h3>Differentiation Summary</h3><ul>{comps.filter(c=>c.diff).map((c,i)=><li key={i}><strong>{c.name}:</strong> {c.diff}</li>)}</ul></div>}
    </section>}
  </div>);
}
