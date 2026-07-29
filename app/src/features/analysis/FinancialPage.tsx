import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';

interface MetricDef { key: string; label: string; section: string }
const BASE_METRICS: MetricDef[] = [
  {key:'revenue',label:'Revenue',section:'损益表'},{key:'grossProfit',label:'Gross Profit',section:'损益表'},
  {key:'ebitda',label:'EBITDA',section:'损益表'},{key:'netIncome',label:'Net Income',section:'损益表'},
  {key:'operatingCashFlow',label:'Operating CF',section:'现金流'},{key:'freeCashFlow',label:'Free CF',section:'现金流'},
  {key:'burnRate',label:'Burn Rate',section:'现金流'},{key:'cashBalance',label:'Cash Balance',section:'现金流'},
  {key:'customerCount',label:'Customers',section:'单位经济'},{key:'arpu',label:'ARPU',section:'单位经济'},
  {key:'cac',label:'CAC',section:'单位经济'},{key:'ltv',label:'LTV',section:'单位经济'},
];
const SAAS_METRICS: MetricDef[] = [
  {key:'arr',label:'ARR',section:'SaaS'},{key:'nrr',label:'NRR %',section:'SaaS'},
  {key:'logoChurn',label:'Logo Churn %',section:'SaaS'},{key:'burnMultiple',label:'资金消耗倍数',section:'SaaS'},
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
      <h1>财务分析</h1>
      {templates.length > 0 && <p style={{color:'var(--teal)',marginBottom:20}}>行业模板：{templates.join(', ')}</p>}
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
      <h2>关键比率</h2>
      <div className="results-grid">
        <div className="metric-card"><strong>{computed.grossMargin}</strong><span>毛利率</span></div>
        <div className="metric-card"><strong>{computed.ebitdaMargin}</strong><span>EBITDA率</span></div>
        <div className="metric-card"><strong>{computed.netMargin}</strong><span>净利率</span></div>
        <div className="metric-card"><strong>{computed.ltvCac}</strong><span>LTV/CAC</span></div>
        <div className="metric-card"><strong>{computed.runway}</strong><span>现金跑道 (mo)</span></div>
        {templates.includes('saas') && <div className="metric-card"><strong>{computed.burnMultiple}</strong><span>资金消耗倍数</span></div>}
      </div>
    </div>
  );
}
