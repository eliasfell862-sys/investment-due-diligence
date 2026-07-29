import { useState } from 'react';
interface Contract { id: string; name: string; party: string; amount: string; startDate: string; endDate: string; content: string; progress: string }
export function ContractLedgerPage() {
  const [contracts, setContracts] = useState<Contract[]>(() => { const s = localStorage.getItem('dd-contracts'); return s ? JSON.parse(s) : []; });
  const save = () => { setContracts([...contracts]); localStorage.setItem('dd-contracts', JSON.stringify(contracts)); };
  const add = () => { contracts.push({ id: crypto.randomUUID(), name:'', party:'', amount:'', startDate:'', endDate:'', content:'', progress:'' }); save(); };
  const update = (i:number,f:string,v:string) => { (contracts[i] as any)[f]=v; save(); };
  const remove = (i:number) => { contracts.splice(i,1); save(); };
  return (<div className="module-page" style={{maxWidth:1100}}><h1>合同台账</h1><button onClick={add} className="primary-link">+ 添加合同</button>
    {contracts.map((c,i)=>(<div key={c.id} className="card">
      <div className="flex-row"><input placeholder="合同名称" value={c.name} onChange={e=>update(i,'name',e.target.value)} style={{flex:2}} /><input placeholder="对方名称" value={c.party} onChange={e=>update(i,'party',e.target.value)} /><input placeholder="合同金额(万)" value={c.amount} onChange={e=>update(i,'amount',e.target.value)} /></div>
      <div className="flex-row"><input placeholder="开始日期" value={c.startDate} onChange={e=>update(i,'startDate',e.target.value)} /><input placeholder="结束日期" value={c.endDate} onChange={e=>update(i,'endDate',e.target.value)} /><input placeholder="进度%" value={c.progress} onChange={e=>update(i,'progress',e.target.value)} /></div>
      <input placeholder="合同主要内容" value={c.content} onChange={e=>update(i,'content',e.target.value)} style={{width:'100%'}} />
      <button onClick={()=>remove(i)} className="danger">删除</button>
    </div>))}
    {contracts.length>0&&<section style={{marginTop:24}}><h2>合同汇总 ({contracts.length}份)</h2><table className="data-table"><thead><tr><th>合同名称</th><th>对方</th><th>金额(万)</th><th>期限</th><th>进度</th></tr></thead><tbody>{contracts.map((c,i)=><tr key={i}><td>{c.name}</td><td>{c.party}</td><td>{c.amount}</td><td>{c.startDate}~{c.endDate}</td><td>{c.progress}%</td></tr>)}</tbody></table></section>}
  </div>);
}
