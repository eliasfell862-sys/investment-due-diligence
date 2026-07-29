import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';

export function ValuationPage() {
  const { projectId = "default" } = useParams<{ projectId: string }>();
  const [data, setData] = useState(() => { const s = localStorage.getItem(`dd-p-${projectId}-valuation`); return s ? JSON.parse(s) : { fcfBase: '', fcfGrowth: '', wacc: '', terminalGrowth: '', evRevenue: '', evEbitda: '', peRatio: '', targetIrr: '', holdingYears: '', entryValuation: '' }; });
  const save = (k: string, v: string) => { const n = { ...data, [k]: v }; setData(n); localStorage.setItem(`dd-p-${projectId}-valuation`, JSON.stringify(n)); };
  const dcf = useMemo(() => {
    try {
      const fcf = new AnalysisDecimal(data.fcfBase || '0');
      const g = new AnalysisDecimal(data.fcfGrowth || '0');
      const wacc = new AnalysisDecimal(data.wacc || '0.1');
      const tg = new AnalysisDecimal(data.terminalGrowth || '0.02');
      if (wacc.isZero() || wacc.lessThanOrEqualTo(tg)) return { pv: '-', tv: '-', ev: '-' };
      const f1 = fcf.times(new AnalysisDecimal(1).plus(g));
      const tv = f1.div(wacc.minus(tg));
      const pv = f1.div(new AnalysisDecimal(1).plus(wacc));
      const ev = pv.plus(tv.div(new AnalysisDecimal(1).plus(wacc)));
      return { pv: canonicalDecimal(pv), tv: canonicalDecimal(tv), ev: canonicalDecimal(ev) };
    } catch { return { pv: '-', tv: '-', ev: '-' }; }
  }, [data]);
  const fields: [string, string][] = [
    ['fcfBase', 'FCF'], ['fcfGrowth', 'FCF 增长率'], ['wacc', 'WACC'], ['terminalGrowth', '永续增长率'],
    ['evRevenue', 'EV/Revenue'], ['evEbitda', 'EV/EBITDA'], ['peRatio', 'P/E'],
    ['targetIrr', '目标 IRR'], ['holdingYears', '持有期(年)'], ['entryValuation', '进入估值'],
  ];
  return (
    <div className="module-page"><h1>估值模型</h1>
      <form className="module-form" onSubmit={e => e.preventDefault()}>
        <div className="form-grid">{fields.map(([k, l]) => <label key={k}>{l}<input placeholder="0" value={(data as any)[k]} onChange={e => save(k, e.target.value)} /></label>)}</div>
      </form>
      <h2>DCF 快速估算</h2>
      <div className="results-grid">
        <div className="metric-card"><strong>{dcf.pv}</strong><span>首年 PV</span></div>
        <div className="metric-card"><strong>{dcf.tv}</strong><span>终值</span></div>
        <div className="metric-card"><strong>{dcf.ev}</strong><span>企业价值</span></div>
      </div>
    </div>);
}
