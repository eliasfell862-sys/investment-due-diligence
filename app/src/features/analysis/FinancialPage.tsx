import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';

interface MetricDef { key: string; label: string; section: string }
const BASE_METRICS: MetricDef[] = [
  {key:'revenue',label:'Revenue',section:'P&L'},{key:'grossProfit',label:'Gross Profit',section:'P&L'},
  {key:'ebitda',label:'EBITDA',section:'P&L'},{key:'netIncome',label:'Net Income',section:'P&L'},
  {key:'operatingCashFlow',label:'Operating CF',section:'Cash Flow'},{key:'freeCashFlow',label:'Free CF',section:'Cash Flow'},
  {key:'burnRate',label:'Burn Rate',section:'Cash Flow'},{key:'cashBalance',label:'Cash Balance',section:'Cash Flow'},
  {key:'customerCount',label:'Customers',section:'Unit Economics'},{key:'arpu',label:'ARPU',section:'Unit Economics'},
  {key:'cac',label:'CAC',section:'Unit Economics'},{key:'ltv',label:'LTV',section:'Unit Economics'},
];
const SAAS_METRICS: MetricDef[] = [
  {key:'arr',label:'ARR',section:'SaaS'},{key:'nrr',label:'NRR %',section:'SaaS'},
  {key:'logoChurn',label:'Logo Churn %',section:'SaaS'},{key:'burnMultiple',label:'Burn Multiple',section:'SaaS'},
];
const CONSUMER_METRICS: MetricDef[] = [
  {key:'repurchaseRate',label:'Repurchase %',section:'Consumer'},{key:'skuConcentration',label:'SKU Concentration %',section:'Consumer'},
  {key:'channelDependency',label:'Channel Dep %',section:'Consumer'},{key:'inventoryTurnover',label:'Inventory Turnover',section:'Consumer'},
];
const HARDTECH_METRICS: MetricDef[] = [
  {key:'trl',label:'TRL (1-9)',section:'HardTech'},{key:'yieldRate',label:'Yield Rate %',section:'HardTech'},
  {key:'capacityUtilization',label:'Capacity Util %',section:'HardTech'},{key:'orderBacklog',label:'Order Backlog',section:'HardTech'},
];

function pct(a: string, b: string): string { try { return canonicalDecimal(new AnalysisDecimal(a).div(b).times(100))+'%'; } catch { return '-'; } }
function ratio(a: string, b: string): string { try { return canonicalDecimal(new AnalysisDecimal(a).div(b)); } catch { return '-'; } }

export function FinancialPage() {
  const { projectId = "default" } = useParams<{ projectId: string }>();
  const [templates] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(`dd-p-${projectId}-templates`)||'[]'); } catch { return []; } });
  const allMetrics = [...BASE_METRICS];
  if (templates.includes('saas')) allMetrics.push(...SAAS_METRICS);
  if (templates.includes('consumer')) allMetrics.push(...CONSUMER_METRICS);
  if (templates.includes('hardtech_manufacturing')) allMetrics.push(...HARDTECH_METRICS);

  const [data, setData] = useState<Record<string,string>>(() => {
    const saved = localStorage.getItem(`dd-p-${projectId}-financials`);
    if (saved) return JSON.parse(saved);
    return Object.fromEntries(allMetrics.map(m => [m.key, '']));
  });
  const save = (k: string, v: string) => { const n = { ...data, [k]: v }; setData(n); localStorage.setItem(`dd-p-${projectId}-financials`, JSON.stringify(n)); };

  const sections = [...new Set(allMetrics.map(m => m.section))];

  const computed = useMemo(() => ({
    grossMargin: pct(data.grossProfit, data.revenue),
    ebitdaMargin: pct(data.ebitda, data.revenue),
    netMargin: pct(data.netIncome, data.revenue),
    ltvCac: ratio(data.ltv, data.cac),
    runway: data.burnRate ? ratio(data.cashBalance, data.burnRate) : '-',
    burnMultiple: templates.includes('saas') ? ratio(data.burnRate, data.arr) : '-',
  }), [data, templates]);

  return (
    <div className="module-page">
      <h1>Financial Analysis</h1>
      {templates.length > 0 && <p style={{color:'var(--teal)',marginBottom:20}}>Templates: {templates.join(', ')}</p>}
      <form className="module-form" onSubmit={e => e.preventDefault()}>
        {sections.map(sec => (
          <div key={sec}><h2>{sec}</h2>
            <div className="form-grid">
              {allMetrics.filter(m => m.section === sec).map(m => (
                <label key={m.key}>{m.label}<input placeholder="0" value={data[m.key]||''} onChange={e => save(m.key, e.target.value)} /></label>
              ))}
            </div>
          </div>
        ))}
      </form>
      <h2>Key Ratios</h2>
      <div className="results-grid">
        <div className="metric-card"><strong>{computed.grossMargin}</strong><span>Gross Margin</span></div>
        <div className="metric-card"><strong>{computed.ebitdaMargin}</strong><span>EBITDA Margin</span></div>
        <div className="metric-card"><strong>{computed.netMargin}</strong><span>Net Margin</span></div>
        <div className="metric-card"><strong>{computed.ltvCac}</strong><span>LTV/CAC</span></div>
        <div className="metric-card"><strong>{computed.runway}</strong><span>Runway (mo)</span></div>
        {templates.includes('saas') && <div className="metric-card"><strong>{computed.burnMultiple}</strong><span>Burn Multiple</span></div>}
      </div>
    </div>
  );
}
