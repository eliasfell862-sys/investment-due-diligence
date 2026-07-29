import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';

interface CustomerRevenue { name: string; businessLine: string; revenue2023: string; revenue2024: string; revenue2025: string; grossMargin: string; contractAmount: string; progress: string }

export function SalesAnalysisPage() {
  const { projectId = "default" } = useParams<{ projectId: string }>();
  const [customers, setCustomers] = useState<CustomerRevenue[]>(() => { const s = localStorage.getItem(`dd-p-${projectId}-sales`); return s ? JSON.parse(s) : []; });
  const save = () => { setCustomers([...customers]); localStorage.setItem(`dd-p-${projectId}-sales`, JSON.stringify(customers)); };
  const add = () => { customers.push({ name:'', businessLine:'', revenue2023:'', revenue2024:'', revenue2025:'', grossMargin:'', contractAmount:'', progress:'' }); save(); };
  const update = (i:number,f:string,v:string) => { (customers[i] as any)[f]=v; save(); };
  const remove = (i:number) => { customers.splice(i,1); save(); };
  const analysis = useMemo(() => {
    const byBiz: Record<string, { rev25: number; count: number; gm: number[] }> = {};
    let total25 = 0;
    for (const c of customers) {
      const r25 = parseFloat(c.revenue2025)||0;
      total25 += r25;
      if (c.businessLine) { if (!byBiz[c.businessLine]) byBiz[c.businessLine] = { rev25:0, count:0, gm:[] }; byBiz[c.businessLine]!.rev25 += r25; byBiz[c.businessLine]!.count++; if (c.grossMargin) byBiz[c.businessLine]!.gm.push(parseFloat(c.grossMargin)||0); }
    }
    const top5 = [...customers].sort((a,b) => (parseFloat(b.revenue2025)||0) - (parseFloat(a.revenue2025)||0)).slice(0,5);
    return { total25, byBiz, top5 };
  }, [customers]);

  return (<div className="module-page" style={{maxWidth:1100}}><h1>销售分析</h1>
    <button onClick={add} className="primary-link">+ 添加客户收入</button>
    {customers.map((c,i)=>(<div key={i} className="card">
      <div className="flex-row">
        <input placeholder="客户名称" value={c.name} onChange={e=>update(i,'name',e.target.value)} />
        <select value={c.businessLine} onChange={e=>update(i,'businessLine',e.target.value)}><option value="">业务线</option><option>法律智能</option><option>端侧智能-汽车</option><option>端侧智能-手机</option><option>教育智能</option><option>政企定制</option><option>海外</option><option>其他</option></select>
      </div>
      <div className="flex-row">
        <input placeholder="2023收入(万)" value={c.revenue2023} onChange={e=>update(i,'revenue2023',e.target.value)} />
        <input placeholder="2024收入(万)" value={c.revenue2024} onChange={e=>update(i,'revenue2024',e.target.value)} />
        <input placeholder="2025收入(万)" value={c.revenue2025} onChange={e=>update(i,'revenue2025',e.target.value)} />
        <input placeholder="毛利率%" value={c.grossMargin} onChange={e=>update(i,'grossMargin',e.target.value)} />
        <input placeholder="合同金额(万)" value={c.contractAmount} onChange={e=>update(i,'contractAmount',e.target.value)} />
        <input placeholder="进度%" value={c.progress} onChange={e=>update(i,'progress',e.target.value)} />
      </div>
      <button onClick={()=>remove(i)} className="danger">删除</button>
    </div>))}
    {customers.length>0&&<section style={{marginTop:24}}><h2>分析汇总</h2>
      <div className="results-grid">
        <div className="metric-card"><strong>{analysis.total25.toLocaleString()}万</strong><span>2025 总营收</span></div>
        <div className="metric-card"><strong>{analysis.top5.length}</strong><span>Top5 客户</span></div>
      </div>
      <h3>按业务线 (2025)</h3>
      <table className="data-table"><thead><tr><th>业务线</th><th>收入(万)</th><th>占比</th><th>客户数</th><th>平均毛利率</th></tr></thead>
        <tbody>{Object.entries(analysis.byBiz).sort((a,b)=>b[1].rev25-a[1].rev25).map(([name,data])=><tr key={name}><td>{name}</td><td>{data.rev25.toLocaleString()}</td><td>{analysis.total25>0?(data.rev25/analysis.total25*100).toFixed(1):'-'}%</td><td>{data.count}</td><td>{data.gm.length>0?(data.gm.reduce((a,b)=>a+b,0)/data.gm.length).toFixed(1):'-'}%</td></tr>)}</tbody></table>
      <h3>前5大客户</h3><ol>{analysis.top5.map((c,i)=><li key={i}><strong>{c.name}</strong> — 2025年: {c.revenue2025||'0'}万, 毛利率: {c.grossMargin||'-'}%</li>)}</ol>
    </section>}
  </div>);
}
