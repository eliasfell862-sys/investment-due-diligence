import { useState, useMemo } from 'react';
interface Product { name: string; stage: string; revenuePct: string; moat: string }
export function ProductPage() {
  const [products, setProducts] = useState<Product[]>(() => { const s = localStorage.getItem('dd-products-v2'); return s ? JSON.parse(s) : []; });
  const [ip, setIp] = useState(() => localStorage.getItem('dd-ip')||'');
  const [rd, setRd] = useState(() => localStorage.getItem('dd-rd')||'');
  const save = () => { setProducts([...products]); localStorage.setItem('dd-products-v2',JSON.stringify(products)); };
  const add = () => { products.push({name:'',stage:'R&D',revenuePct:'',moat:''}); save(); };
  const update = (i:number,f:string,v:string) => { (products[i] as any)[f]=v; save(); };
  const remove = (i:number) => { products.splice(i,1); save(); };

  const analysis = useMemo(() => ({
    count: products.length,
    released: products.filter(p=>p.stage==='Released'||p.stage==='Scale'||p.stage==='Mature').length,
    totalRevPct: products.reduce((s,p)=>s+(parseFloat(p.revenuePct)||0),0),
    stages: { R_D: products.filter(p=>p.stage==='R&D'||p.stage==='Beta').length, Live: products.filter(p=>p.stage==='Released'||p.stage==='Scale'||p.stage==='Mature').length },
    moats: products.filter(p=>p.moat).map(p=>p.moat),
    hasIp: ip.length>0,
    hasRd: rd.length>0,
  }), [products, ip, rd]);

  return (<div className="module-page"><h1>Product & Technology</h1>
    <button onClick={add} className="primary-link">+ Add Product</button>
    {products.map((p,i)=>(<div key={i} className="card">
      <div className="flex-row">
        <input placeholder="Product Name" value={p.name} onChange={e=>update(i,'name',e.target.value)}/>
        <select value={p.stage} onChange={e=>update(i,'stage',e.target.value)}><option>R&D</option><option>Beta</option><option>Released</option><option>Scale</option><option>Mature</option></select>
        <input placeholder="Revenue %" value={p.revenuePct} onChange={e=>update(i,'revenuePct',e.target.value)}/>
      </div>
      <input placeholder="Moat / Barrier" value={p.moat} onChange={e=>update(i,'moat',e.target.value)} style={{width:'100%'}}/>
      <button onClick={()=>remove(i)} className="danger">Remove</button>
    </div>))}
    <form className="module-form" onSubmit={e=>e.preventDefault()} style={{marginTop:16}}>
      <label>IP / Patents<textarea rows={2} value={ip} onChange={e=>{setIp(e.target.value);localStorage.setItem('dd-ip',e.target.value);}}/></label>
      <label>R&D Pipeline<textarea rows={2} value={rd} onChange={e=>{setRd(e.target.value);localStorage.setItem('dd-rd',e.target.value);}}/></label>
    </form>

    {analysis.count>0&&<section style={{marginTop:24}}><h2>Analysis</h2>
      <div className="results-grid">
        <div className="metric-card"><strong>{analysis.count}</strong><span>Products</span></div>
        <div className="metric-card"><strong>{analysis.released}</strong><span>Live</span></div>
        <div className="metric-card"><strong>{analysis.totalRevPct}%</strong><span>Revenue Coverage</span></div>
        <div className="metric-card"><strong>{analysis.hasIp?'Yes':'No'}</strong><span>IP Protected</span></div>
      </div>
      {analysis.stages.Live>0&&<div className="loss-info" style={{background:'#e8f3f4',borderLeftColor:'#16766f'}}><strong>Pipeline:</strong> {analysis.stages.R_D} in R&D, {analysis.stages.Live} live</div>}
      {analysis.moats.length>0&&<div style={{marginTop:12}}><h3>Moats</h3><ul>{analysis.moats.map((m,i)=><li key={i}>{m}</li>)}</ul></div>}
    </section>}
  </div>);
}
