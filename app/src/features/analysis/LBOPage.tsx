import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { calculateLBO, type LBOInput, type LBODebtTranche, type LBOProjectionYear } from '../../engines/valuation/calculate-lbo';

const DEFAULT_INPUT = {
  entryEnterpriseValue: '10000',
  entryNetDebt: '1000',
  entryFees: '2',
  holdingYears: '5',
  exitMultiple: '10',
  taxRate: '25',
  minimumCash: '500',
};

function parseNum(s: string): number { return parseFloat(s) || 0; }

export function LBOPage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();
  const [data, setData] = useState(() => {
    try { const s = localStorage.getItem(`dd-p-${projectId}-lbo`); return s ? JSON.parse(s) : DEFAULT_INPUT; } catch { return DEFAULT_INPUT; }
  });
  const save = (k: string, v: string) => { const n = { ...data, [k]: v }; setData(n); localStorage.setItem(`dd-p-${projectId}-lbo`, JSON.stringify(n)); };

  // Debt tranches
  const [tranches, setTranches] = useState<LBODebtTranche[]>(() => {
    try { const s = localStorage.getItem(`dd-p-${projectId}-lbo-tranches`); return s ? JSON.parse(s) : [
      { label: '高级债', amount: 5000, rate: 0.07, amortPercent: 0.1, seniority: 1 },
      { label: '夹层债', amount: 2000, rate: 0.12, amortPercent: 0, seniority: 2 },
    ]; } catch { return []; }
  });
  const saveTranches = (t: LBODebtTranche[]) => { setTranches(t); localStorage.setItem(`dd-p-${projectId}-lbo-tranches`, JSON.stringify(t)); };

  // Projections
  const [projections, setProjections] = useState<LBOProjectionYear[]>(() => {
    try { const s = localStorage.getItem(`dd-p-${projectId}-lbo-projections`); return s ? JSON.parse(s) : [
      { year: 1, revenue: 5000, ebitda: 1000, dda: 200, capex: 300, nwcIncrease: 50 },
      { year: 2, revenue: 5500, ebitda: 1100, dda: 200, capex: 280, nwcIncrease: 40 },
      { year: 3, revenue: 6100, ebitda: 1250, dda: 200, capex: 260, nwcIncrease: 35 },
      { year: 4, revenue: 6800, ebitda: 1400, dda: 200, capex: 240, nwcIncrease: 30 },
      { year: 5, revenue: 7500, ebitda: 1600, dda: 200, capex: 220, nwcIncrease: 25 },
    ]; } catch { return []; }
  });
  const saveProjections = (p: LBOProjectionYear[]) => { setProjections(p); localStorage.setItem(`dd-p-${projectId}-lbo-projections`, JSON.stringify(p)); };

  // Results
  const result = useMemo(() => {
    try {
      const input: LBOInput = {
        entryEnterpriseValue: parseNum(data.entryEnterpriseValue),
        entryNetDebt: parseNum(data.entryNetDebt),
        entryFees: parseNum(data.entryFees) / 100,
        holdingYears: parseNum(data.holdingYears),
        exitMultiple: parseNum(data.exitMultiple),
        taxRate: parseNum(data.taxRate) / 100,
        minimumCash: parseNum(data.minimumCash),
        debtTranches: tranches,
        projections,
      };
      if (input.entryEnterpriseValue <= 0 || input.holdingYears <= 0) return null;
      return calculateLBO(input);
    } catch { return null; }
  }, [data, tranches, projections]);

  const fmt = (n: number) => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e4 ? `${(n/1e4).toFixed(1)}万` : n.toFixed(0);
  const pct = (n: number) => `${(n*100).toFixed(1)}%`;

  return (
    <div className="module-page">
      <h1>LBO 杠杆收购模型</h1>

      {/* Entry Parameters */}
      <h2>交易参数</h2>
      <form className="module-form" onSubmit={e => e.preventDefault()}>
        <div className="form-grid">
          {[
            ['entryEnterpriseValue', '企业价值(万)'],
            ['entryNetDebt', '承接净债务(万)'],
            ['entryFees', '交易费用(%)'],
            ['holdingYears', '持有期(年)'],
            ['exitMultiple', '退出 EV/EBITDA'],
            ['taxRate', '所得税率(%)'],
            ['minimumCash', '最低现金(万)'],
          ].map(([k, l]) => (
            <label key={k}>{l}<input value={(data as any)[k]} onChange={e => save(k, e.target.value)} placeholder="0" /></label>
          ))}
        </div>
      </form>

      {/* Debt Tranches */}
      <h2>债务结构</h2>
      <table className="data-table">
        <thead><tr><th>名称</th><th>金额(万)</th><th>利率(%)</th><th>年摊还(%)</th><th>优先级</th><th></th></tr></thead>
        <tbody>
          {tranches.map((t, i) => (
            <tr key={i}>
              <td><input value={t.label} onChange={e => { const n = [...tranches]; n[i] = { ...n[i], label: e.target.value }; saveTranches(n); }} /></td>
              <td><input type="number" value={t.amount} onChange={e => { const n = [...tranches]; n[i] = { ...n[i], amount: parseNum(e.target.value) }; saveTranches(n); }} /></td>
              <td><input type="number" value={t.rate*100} onChange={e => { const n = [...tranches]; n[i] = { ...n[i], rate: parseNum(e.target.value)/100 }; saveTranches(n); }} /></td>
              <td><input type="number" value={t.amortPercent*100} onChange={e => { const n = [...tranches]; n[i] = { ...n[i], amortPercent: parseNum(e.target.value)/100 }; saveTranches(n); }} /></td>
              <td><input type="number" value={t.seniority} onChange={e => { const n = [...tranches]; n[i] = { ...n[i], seniority: parseInt(e.target.value)||1 }; saveTranches(n); }} /></td>
              <td><button className="button" onClick={() => saveTranches(tranches.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="button" style={{marginTop:8}} onClick={() => saveTranches([...tranches, { label: '新债务', amount: 1000, rate: 0.08, amortPercent: 0, seniority: tranches.length + 1 }])}>+ 添加债务层</button>

      {/* Projections */}
      <h2>财务预测（年度）</h2>
      <table className="data-table">
        <thead><tr><th>年份</th><th>收入(万)</th><th>EBITDA(万)</th><th>折旧摊销(万)</th><th>Capex(万)</th><th>NWC变动(万)</th><th></th></tr></thead>
        <tbody>
          {projections.map((p, i) => (
            <tr key={i}>
              <td>第{p.year}年</td>
              <td><input type="number" value={p.revenue} onChange={e => { const n = [...projections]; n[i] = { ...n[i], revenue: parseNum(e.target.value) }; saveProjections(n); }} /></td>
              <td><input type="number" value={p.ebitda} onChange={e => { const n = [...projections]; n[i] = { ...n[i], ebitda: parseNum(e.target.value) }; saveProjections(n); }} /></td>
              <td><input type="number" value={p.dda} onChange={e => { const n = [...projections]; n[i] = { ...n[i], dda: parseNum(e.target.value) }; saveProjections(n); }} /></td>
              <td><input type="number" value={p.capex} onChange={e => { const n = [...projections]; n[i] = { ...n[i], capex: parseNum(e.target.value) }; saveProjections(n); }} /></td>
              <td><input type="number" value={p.nwcIncrease} onChange={e => { const n = [...projections]; n[i] = { ...n[i], nwcIncrease: parseNum(e.target.value) }; saveProjections(n); }} /></td>
              <td><button className="button" onClick={() => saveProjections(projections.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="button" style={{marginTop:8}} onClick={() => saveProjections([...projections, { year: projections.length + 1, revenue: 0, ebitda: 0, dda: 0, capex: 0, nwcIncrease: 0 }])}>+ 添加预测年</button>

      {/* Results */}
      {result && (
        <>
          <h2 style={{marginTop:32}}>Sources & Uses</h2>
          <table className="data-table">
            <thead><tr><th colSpan={3} style={{textAlign:'center',background:'#1a3a3a'}}>资金来源</th></tr></thead>
            <thead><tr><th>来源</th><th>金额(万)</th><th>占比</th></tr></thead>
            <tbody>
              {result.sourcesAndUses.sources.map((s, i) => (
                <tr key={i}><td>{s.label}</td><td>{fmt(s.amount)}</td><td>{pct(s.percent)}</td></tr>
              ))}
            </tbody>
            <thead><tr><th colSpan={3} style={{textAlign:'center',background:'#1a3a3a'}}>资金用途</th></tr></thead>
            <thead><tr><th>用途</th><th>金额(万)</th><th>占比</th></tr></thead>
            <tbody>
              {result.sourcesAndUses.uses.map((u, i) => (
                <tr key={i}><td>{u.label}</td><td>{fmt(u.amount)}</td><td>{pct(u.percent)}</td></tr>
              ))}
            </tbody>
          </table>

          <h2>关键指标</h2>
          <div className="results-grid">
            <div className="metric-card"><strong>{result.keyMetrics.entryEvToEbitda}x</strong><span>Entry EV/EBITDA</span></div>
            <div className="metric-card"><strong>{result.keyMetrics.debtToEbitda}x</strong><span>Debt/EBITDA</span></div>
            <div className="metric-card"><strong>{fmt(result.keyMetrics.equityCheck)}万</strong><span>股权投资额</span></div>
            <div className="metric-card"><strong>{result.exit.moic}x</strong><span>MOIC</span></div>
            <div className="metric-card"><strong>{result.exit.irr}%</strong><span>IRR</span></div>
            <div className="metric-card"><strong>{result.keyMetrics.averageInterestCoverage}x</strong><span>平均利息覆盖</span></div>
          </div>

          <h2>债务偿还表</h2>
          <div style={{overflowX:'auto'}}>
            <table className="data-table">
              <thead><tr><th>年份</th><th>期初债务</th><th>利息</th><th>偿还</th><th>期末债务</th></tr></thead>
              <tbody>
                {result.debtSchedule.map((r, i) => (
                  <tr key={i}><td>第{r.year}年</td><td>{fmt(r.totalDebtBegin)}</td><td>{fmt(r.totalInterest)}</td><td>{fmt(r.totalRepayment)}</td><td>{fmt(r.totalDebtEnd)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>现金流瀑布</h2>
          <div style={{overflowX:'auto'}}>
            <table className="data-table">
              <thead><tr><th>年份</th><th>EBITDA</th><th>经营CF</th><th>自由CF</th><th>付息</th><th>偿债</th><th>净现金流</th><th>现金余额</th></tr></thead>
              <tbody>
                {result.cashFlows.map((cf, i) => (
                  <tr key={i}><td>第{cf.year}年</td><td>{fmt(cf.ebitda)}</td><td>{fmt(cf.operatingCashFlow)}</td><td>{fmt(cf.freeCashFlow)}</td><td>{fmt(cf.interestPaid)}</td><td>{fmt(cf.debtRepayment)}</td><td style={{color:cf.netCashFlow<0?'#f87171':'#70b8b0'}}>{fmt(cf.netCashFlow)}</td><td>{fmt(cf.cashBalance)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>退出分析</h2>
          <div className="results-grid">
            <div className="metric-card"><strong>{fmt(result.exit.exitEbitda)}万</strong><span>退出 EBITDA</span></div>
            <div className="metric-card"><strong>{fmt(result.exit.exitEnterpriseValue)}万</strong><span>退出企业价值</span></div>
            <div className="metric-card"><strong>{fmt(result.exit.exitEquityValue)}万</strong><span>退出股权价值</span></div>
            <div className="metric-card"><strong>{result.exit.moic}x</strong><span>MOIC</span></div>
            <div className="metric-card"><strong>{result.exit.irr}%</strong><span>IRR</span></div>
          </div>

          <h2>敏感度分析（IRR %）</h2>
          <p style={{fontSize:'0.8rem',color:'#8ba8a8'}}>行 = Entry EV/EBITDA，列 = Exit EV/EBITDA</p>
          <div style={{overflowX:'auto'}}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Entry ↓ / Exit →</th>
                  {[...new Set(result.sensitivity.map(s => s.exitMultiple))].sort((a,b)=>a-b).map(em => (
                    <th key={em}>{em}x</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...new Set(result.sensitivity.map(s => s.entryMultiple))].sort((a,b)=>a-b).map(en => (
                  <tr key={en}>
                    <th>{en}x</th>
                    {[...new Set(result.sensitivity.map(s => s.exitMultiple))].sort((a,b)=>a-b).map(em => {
                      const pt = result.sensitivity.find(s => s.entryMultiple === en && s.exitMultiple === em);
                      const irr = pt?.irr ?? 0;
                      return (
                        <td key={em} style={{
                          background: irr >= 25 ? '#145252' : irr >= 15 ? '#1a3a3a' : irr >= 10 ? '#2a2a2a' : '#3a2020',
                          color: irr >= 20 ? '#70b8b0' : irr >= 10 ? '#ddd' : '#f87171'
                        }}>
                          {irr.toFixed(1)}%
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
