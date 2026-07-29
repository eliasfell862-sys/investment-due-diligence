import { useState, useMemo } from 'react';
interface Supplier { name: string; category: string; amount2023: string; amount2024: string; amount2025: string; contractDesc: string }
export function ProcurementPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => { const s = localStorage.getItem('dd-procurement'); return s ? JSON.parse(s) : []; });
  const save = () => { setSuppliers([...suppliers]); localStorage.setItem('dd-procurement', JSON.stringify(suppliers)); };
  const add = () => { suppliers.push({ name:'', category:'', amount2023:'', amount2024:'', amount2025:'', contractDesc:'' }); save(); };
  const update = (i:number,f:string,v:string) => { (suppliers[i] as any)[f]=v; save(); };
  const remove = (i:number) => { suppliers.splice(i,1); save(); };
  const analysis = useMemo(() => {
    const byCat: Record<string, { total: number; count: number }> = {};
    let total25 = 0;
    for (const s of suppliers) { const a25 = parseFloat(s.amount2025)||0; total25 += a25; if (s.category) { if (!byCat[s.category]) byCat[s.category]={total:0,count:0}; byCat[s.category]!.total+=a25; byCat[s.category]!.count++; } }
    return { total25, byCat };
  }, [suppliers]);
  return (<div className="module-page" style={{maxWidth:1000}}><h1>采购分析</h1>
    <button onClick={add} className="primary-link">+ 添加供应商</button>
    {suppliers.map((s,i)=>(<div key={i} className="card">
      <div className="flex-row"><input placeholder="供应商名称" value={s.name} onChange={e=>update(i,'name',e.target.value)} /><select value={s.category} onChange={e=>update(i,'category',e.target.value)}><option value="">类别</option><option>算力租赁</option><option>数据采购</option><option>云服务</option><option>技术服务外包</option><option>法律服务</option><option>房租物业</option><option>硬件采购</option><option>其他</option></select></div>
      <div className="flex-row"><input placeholder="2023金额(万)" value={s.amount2023} onChange={e=>update(i,'amount2023',e.target.value)} /><input placeholder="2024金额(万)" value={s.amount2024} onChange={e=>update(i,'amount2024',e.target.value)} /><input placeholder="2025金额(万)" value={s.amount2025} onChange={e=>update(i,'amount2025',e.target.value)} /></div>
      <input placeholder="合同内容简述" value={s.contractDesc} onChange={e=>update(i,'contractDesc',e.target.value)} style={{width:'100%'}} />
      <button onClick={()=>remove(i)} className="danger">删除</button>
    </div>))}
    {suppliers.length>0&&<section style={{marginTop:24}}><h2>分析</h2><div className="results-grid"><div className="metric-card"><strong>{analysis.total25.toLocaleString()}万</strong><span>2025 总采购</span></div></div>
      <table className="data-table"><thead><tr><th>类别</th><th>金额(万)</th><th>占比</th><th>供应商数</th></tr></thead><tbody>{Object.entries(analysis.byCat).sort((a,b)=>b[1].total-a[1].total).map(([n,d])=><tr key={n}><td>{n}</td><td>{d.total.toLocaleString()}</td><td>{analysis.total25>0?(d.total/analysis.total25*100).toFixed(1):'-'}%</td><td>{d.count}</td></tr>)}</tbody></table></section>}
  </div>);
}
