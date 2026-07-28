import { useState } from 'react';
export function FinancialPage() {
  const [data, setData] = useState(() => { const s = localStorage.getItem('dd-financial'); return s ? JSON.parse(s) : { revenue: '', grossMargin: '', ebitda: '', cashFlow: '' }; });
  const save = (f: string, v: string) => { const n = { ...data, [f]: v }; setData(n); localStorage.setItem('dd-financial', JSON.stringify(n)); };
  return <div className="module-page"><h1>财务分析</h1><form className="module-form"><label>营业收入<input value={data.revenue} onChange={e => save('revenue', e.target.value)} /></label><label>毛利率<input value={data.grossMargin} onChange={e => save('grossMargin', e.target.value)} /></label><label>EBITDA<input value={data.ebitda} onChange={e => save('ebitda', e.target.value)} /></label><label>经营现金流<input value={data.cashFlow} onChange={e => save('cashFlow', e.target.value)} /></label></form></div>;
}
