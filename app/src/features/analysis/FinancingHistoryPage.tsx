import { useState, useMemo } from 'react';
interface Round { name: string; date: string; amount: string; preMoneyVal: string; postMoneyVal: string; investors: string }
export function FinancingHistoryPage() {
  const [rounds, setRounds] = useState<Round[]>(() => { const s = localStorage.getItem('dd-financing-history'); return s ? JSON.parse(s) : []; });
  const save = () => { setRounds([...rounds]); localStorage.setItem('dd-financing-history', JSON.stringify(rounds)); };
  const add = () => { rounds.push({ name:'', date:'', amount:'', preMoneyVal:'', postMoneyVal:'', investors:'' }); save(); };
  const update = (i:number,f:string,v:string) => { (rounds[i] as any)[f]=v; save(); };
  const remove = (i:number) => { rounds.splice(i,1); save(); };
  const sorted = useMemo(() => [...rounds].sort((a,b)=>a.date.localeCompare(b.date)), [rounds]);
  return (<div className="module-page"><h1>融资历史</h1><button onClick={add} className="primary-link">+ 添加轮次</button>
    {rounds.map((r,i)=>(<div key={i} className="card">
      <div className="flex-row"><input placeholder="轮次(如A轮)" value={r.name} onChange={e=>update(i,'name',e.target.value)} /><input placeholder="日期" value={r.date} onChange={e=>update(i,'date',e.target.value)} /><input placeholder="金额(万)" value={r.amount} onChange={e=>update(i,'amount',e.target.value)} /><input placeholder="投前估值(万)" value={r.preMoneyVal} onChange={e=>update(i,'preMoneyVal',e.target.value)} /><input placeholder="投后估值(万)" value={r.postMoneyVal} onChange={e=>update(i,'postMoneyVal',e.target.value)} /></div>
      <input placeholder="投资方(逗号分隔)" value={r.investors} onChange={e=>update(i,'investors',e.target.value)} style={{width:'100%'}} />
      <button onClick={()=>remove(i)} className="danger">删除</button>
    </div>))}
    {sorted.length>0&&<section style={{marginTop:24}}><h2>融资时间线</h2><table className="data-table"><thead><tr><th>轮次</th><th>日期</th><th>金额(万)</th><th>投前估值(万)</th><th>投后估值(万)</th><th>投资方</th></tr></thead><tbody>{sorted.map((r,i)=><tr key={i}><td>{r.name}</td><td>{r.date}</td><td>{r.amount}</td><td>{r.preMoneyVal}</td><td>{r.postMoneyVal}</td><td>{r.investors}</td></tr>)}</tbody></table></section>}
  </div>);
}
