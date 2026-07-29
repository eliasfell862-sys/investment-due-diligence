import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
export function ExitPage() {
  const { projectId = "default" } = useParams<{ projectId: string }>();
  const [data, setData] = useState(() => { const s = localStorage.getItem(`dd-p-${projectId}-exit`); return s ? JSON.parse(s) : { exitValue: '', ownershipPct: '', investmentAmount: '', holdingYears: '' }; });
  const save = (k: string, v: string) => { const n = { ...data, [k]: v }; setData(n); localStorage.setItem(`dd-p-${projectId}-exit`, JSON.stringify(n)); };
  const returns = useMemo(() => {
    try {
      const ev = new AnalysisDecimal(data.exitValue || '0'); const own = new AnalysisDecimal(data.ownershipPct || '0');
      const inv = new AnalysisDecimal(data.investmentAmount || '0'); const yrs = new AnalysisDecimal(data.holdingYears || '1');
      if (inv.isZero() || own.isZero() || ev.isZero()) return { moic: '-', irr: '-' };
      const proceeds = ev.times(own.div(100));
      const moic = canonicalDecimal(proceeds.div(inv));
      const irr = canonicalDecimal(new AnalysisDecimal(moic).pow(new AnalysisDecimal(1).div(yrs)).minus(1));
      return { moic, irr };
    } catch { return { moic: '-', irr: '-' }; }
  }, [data]);
  return (<div className="module-page"><h1>Exit Path</h1>
    <form className="module-form" onSubmit={e => e.preventDefault()}>
      <label>Exit Value<input value={data.exitValue} onChange={e => save('exitValue', e.target.value)} /></label>
      <label>Ownership %<input value={data.ownershipPct} onChange={e => save('ownershipPct', e.target.value)} /></label>
      <label>Investment<input value={data.investmentAmount} onChange={e => save('investmentAmount', e.target.value)} /></label>
      <label>Holding Years<input value={data.holdingYears} onChange={e => save('holdingYears', e.target.value)} /></label>
    </form>
    <h2>Expected Returns</h2>
    <div className="results-grid">
      <div className="metric-card"><strong>{returns.moic}</strong><span>MOIC</span></div>
      <div className="metric-card"><strong>{returns.irr}</strong><span>IRR</span></div>
    </div></div>);
}
