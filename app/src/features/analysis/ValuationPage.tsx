import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
import { HeatmapChart, type HeatmapCell } from './charts/HeatmapChart';

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

  // Sensitivity heatmap: WACC × terminal growth → Enterprise Value
  const heatmapCells = useMemo<HeatmapCell[]>(() => {
    try {
      const fcf = parseFloat(data.fcfBase || '0');
      const g = parseFloat(data.fcfGrowth || '0');
      if (fcf <= 0) return [];
      const f1 = fcf * (1 + g);
      const waccs = [0.06, 0.08, 0.10, 0.12, 0.14];
      const tgs = [0.01, 0.02, 0.03, 0.04, 0.05];
      const allEvs: number[] = [];
      const cells: HeatmapCell[] = [];
      for (const w of waccs) {
        for (const t of tgs) {
          if (w <= t) continue;
          const ev = f1 / (w - t);
          allEvs.push(ev);
          cells.push({ rowLabel: `${(w*100).toFixed(0)}%`, colLabel: `${(t*100).toFixed(0)}%`, value: ev, colorValue: 0 });
        }
      }
      const minEv = Math.min(...allEvs);
      const maxEv = Math.max(...allEvs);
      // Set colorValue based on percentile
      for (const c of cells) {
        c.colorValue = maxEv > minEv ? (c.value - minEv) / (maxEv - minEv) : 0.5;
      }
      return cells;
    } catch { return []; }
  }, [data]);

  const fmtEv = (v: number) => v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e4 ? `${(v/1e4).toFixed(1)}万` : v.toFixed(0);
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
        <div className="metric-card"><strong>{dcf.pv}</strong><span>首年现值</span></div>
        <div className="metric-card"><strong>{dcf.tv}</strong><span>终值</span></div>
        <div className="metric-card"><strong>{dcf.ev}</strong><span>企业价值</span></div>
      </div>

      {heatmapCells.length > 0 && (
        <>
          <h2 style={{marginTop:24}}>DCF 敏感度分析</h2>
          <p style={{fontSize:'0.8rem',color:'#8ba8a8',marginBottom:8}}>WACC × 永续增长率 → 企业价值（颜色越深价值越高）</p>
          <HeatmapChart
            title="企业价值敏感度"
            rowLabel="WACC →"
            colLabel="永续增长率 →"
            rows={['6%','8%','10%','12%','14%']}
            cols={['1%','2%','3%','4%','5%']}
            cells={heatmapCells}
            valueFormatter={fmtEv}
          />
        </>
      )}
    </div>);
}
