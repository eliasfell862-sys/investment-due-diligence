import { useState, useMemo } from 'react';

export function IndustryPage() {
  const [data, setData] = useState(() => { const s = localStorage.getItem('dd-industry-v2'); return s ? JSON.parse(s) : { tam:'',sam:'',som:'',growthRate:'',chainUp:'',chainMid:'',chainDown:'',trends:'',drivers:'',regulation:'' }; });
  const save = (k: string, v: string) => { const n = { ...data, [k]: v }; setData(n); localStorage.setItem('dd-industry-v2', JSON.stringify(n)); };
  const a = useMemo(() => {
    const tam = parseFloat(data.tam)||0, sam = parseFloat(data.sam)||0, som = parseFloat(data.som)||0;
    return { somPct: tam>0?((som/tam)*100).toFixed(1):'-', samTam: tam>0?((sam/tam)*100).toFixed(0):'-', hasChain:!!(data.chainUp||data.chainMid||data.chainDown), tam };
  }, [data]);
  return (<div className="module-page"><h1>Industry & Market</h1>
    <form className="module-form" onSubmit={e=>e.preventDefault()}>
      <div className="form-grid">{[['tam','TAM'],['sam','SAM'],['som','SOM'],['growthRate','Growth Rate %']].map(([k,l])=><label key={k}>{l}<input value={(data as any)[k]} onChange={e=>save(k,e.target.value)} placeholder="e.g. 50000000000"/></label>)}</div>
      <h2>Industry Chain</h2>
      {[['chainUp','Upstream'],['chainMid','Midstream (Company)'],['chainDown','Downstream']].map(([k,l])=><label key={k}>{l}<input value={(data as any)[k]} onChange={e=>save(k,e.target.value)}/></label>)}
      {[['drivers','Key Growth Drivers'],['trends','Technology/Policy Trends'],['regulation','Regulatory Environment']].map(([k,l])=><label key={k}>{l}<textarea rows={2} value={(data as any)[k]} onChange={e=>save(k,e.target.value)}/></label>)}
    </form>
    {a.tam>0&&<section style={{marginTop:24}}><h2>Analysis</h2><div className="results-grid">
      <div className="metric-card"><strong>{a.tam.toLocaleString()}</strong><span>TAM</span></div>
      <div className="metric-card"><strong>{a.samTam}%</strong><span>SAM/TAM</span></div>
      <div className="metric-card"><strong>{a.somPct}%</strong><span>SOM/TAM</span></div>
      <div className="metric-card"><strong>{data.growthRate}%</strong><span>Growth</span></div>
    </div>{a.hasChain&&<div className="loss-info" style={{background:'#e8f3f4',borderLeftColor:'#16766f'}}><strong>Chain:</strong> {[data.chainUp,data.chainMid,data.chainDown].filter(Boolean).join(' → ')}</div>}</section>}
  </div>);
}
