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

  return (<div className="module-page"><h1>竞品分析</h1>
    <label style={{marginBottom:16}}>目标公司份额%<input value={targetShare} onChange={e=>{setTargetShare(e.target.value);localStorage.setItem(`dd-p-${projectId}-target-share`,e.target.value);}} style={{width:120,marginLeft:12}}/></label>
    <button onClick={add} className="primary-link">+ 添加竞品</button>
    {comps.map((c,i)=>(<div key={i} className="card">
      <div className="flex-row">
        <input placeholder="名称" value={c.name} onChange={e=>update(i,'name',e.target.value)} />
        <select value={c.stage} onChange={e=>update(i,'stage',e.target.value)}><option value="">阶段</option><option>种子轮</option><option>A轮</option><option>B轮及以上</option><option>已上市</option></select>
        <input placeholder="规模" value={c.scale} onChange={e=>update(i,'scale',e.target.value)} />
      </div>
      <div className="flex-row">
        <input placeholder="定价" value={c.pricing} onChange={e=>update(i,'pricing',e.target.value)} />
        <input placeholder="份额%" value={c.share} onChange={e=>update(i,'share',e.target.value)} />
        <input placeholder="融资额" value={c.funding} onChange={e=>update(i,'funding',e.target.value)} />
      </div>
      <input placeholder="差异化/护城河" value={c.diff} onChange={e=>update(i,'diff',e.target.value)} style={{width:'100%'}} />
      <button onClick={()=>remove(i)} className="danger">删除</button>
    </div>))}
    {analysis.count>0&&<section style={{marginTop:24}}><h2>分析</h2>
      <div className="results-grid">
        <div className="metric-card"><strong>{analysis.count}</strong><span>竞品</span></div>
        <div className="metric-card"><strong>{analysis.totalShare}%</strong><span>总份额</span></div>
        <div className="metric-card"><strong>{analysis.hasTarget?(analysis.gap>0?`+${analysis.gap}% 差距`:'饱和'):'—'}</strong><span>vs 目标</span></div>
      </div>
      {Object.keys(analysis.stages).length>0&&<div className="loss-info" style={{background:'#e8f3f4',borderLeftColor:'#16766f'}}>
        <strong>阶段分布:</strong> {Object.entries(analysis.stages).map(([s,c])=>`${s}: ${c}`).join(' | ')}
      </div>}
      {comps.some(c=>c.diff)&&<div style={{marginTop:16}}><h3>差异化总结</h3><ul>{comps.filter(c=>c.diff).map((c,i)=><li key={i}><strong>{c.name}:</strong> {c.diff}</li>)}</ul></div>}
    </section>}
  </div>);
}
