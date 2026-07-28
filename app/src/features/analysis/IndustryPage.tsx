import { useState } from 'react';
export function IndustryPage() {
  const [data, setData] = useState(() => { const s = localStorage.getItem('dd-industry'); return s ? JSON.parse(s) : { tam: '', sam: '', som: '', growthRate: '', chainUp: '', chainMid: '', chainDown: '', trends: '' }; });
  const save = (k: string, v: string) => { const n = { ...data, [k]: v }; setData(n); localStorage.setItem('dd-industry', JSON.stringify(n)); };
  const fields: [string, string][] = [['tam','TAM'],['sam','SAM'],['som','SOM'],['growthRate','Growth Rate %'],['chainUp','Upstream'],['chainMid','Midstream'],['chainDown','Downstream'],['trends','Key Trends']];
  return (<div className="module-page"><h1>Industry & Market</h1><form className="module-form" onSubmit={e => e.preventDefault()}>{fields.map(([k,l]) => <label key={k}>{l}<input value={(data as any)[k]} onChange={e => save(k, e.target.value)} /></label>)}</form></div>);
}
