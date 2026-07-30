import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';
import { TrendChart, type TrendLine } from './charts/TrendChart';

interface MetricDef { key: string; label: string; section: string }
const BASE_METRICS: MetricDef[] = [
  {key:'revenue',label:'营业收入',section:'损益表'},{key:'grossProfit',label:'毛利',section:'损益表'},
  {key:'ebitda',label:'EBITDA',section:'损益表'},{key:'netIncome',label:'净利润',section:'损益表'},
  {key:'operatingCashFlow',label:'经营现金流',section:'现金流'},{key:'freeCashFlow',label:'自由现金流',section:'现金流'},
  {key:'burnRate',label:'月消耗',section:'现金流'},{key:'cashBalance',label:'现金余额',section:'现金流'},
  {key:'customerCount',label:'客户数',section:'单位经济'},{key:'arpu',label:'ARPU',section:'单位经济'},
  {key:'cac',label:'获客成本',section:'单位经济'},{key:'ltv',label:'客户终身价值',section:'单位经济'},
];
const SAAS_METRICS: MetricDef[] = [
  {key:'arr',label:'ARR',section:'SaaS'},{key:'nrr',label:'净收入留存率',section:'SaaS'},
  {key:'logoChurn',label:'客户流失率',section:'SaaS'},{key:'burnMultiple',label:'资金消耗倍数',section:'SaaS'},
];
const CONSUMER_METRICS: MetricDef[] = [
  {key:'repurchaseRate',label:'复购率',section:'消费品'},{key:'skuConcentration',label:'SKU集中度',section:'消费品'},
  {key:'channelDependency',label:'渠道依赖度',section:'消费品'},{key:'inventoryTurnover',label:'库存周转',section:'消费品'},
];
const HARDTECH_METRICS: MetricDef[] = [
  {key:'trl',label:'技术就绪度(1-9)',section:'硬科技'},{key:'yieldRate',label:'良率',section:'硬科技'},
  {key:'capacityUtilization',label:'产能利用率',section:'硬科技'},{key:'orderBacklog',label:'在手订单',section:'硬科技'},
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
        <div className="metric-card"><strong>{computed.runway}</strong><span>现金跑道(月)</span></div>
        {templates.includes('saas') && <div className="metric-card"><strong>{computed.burnMultiple}</strong><span>资金消耗倍数</span></div>}
      </div>

      {/* Trend chart from multi-year data */}
      {(() => {
        try {
          // Pull from sales data (2023/2024/2025 per customer)
          const sales = JSON.parse(localStorage.getItem(`dd-p-${projectId}-sales`) || '[]');
          const revByYear: Record<string, number> = {};
          for (const s of sales) {
            for (const yr of ['2023','2024','2025']) {
              const v = parseFloat(s[`revenue${yr}`]) || 0;
              revByYear[yr] = (revByYear[yr] || 0) + v;
            }
          }
          // Also try LBO projections
          const proj = JSON.parse(localStorage.getItem(`dd-p-${projectId}-lbo-projections`) || '[]');
          for (const p of proj) {
            const yr = `第${p.year}年`;
            revByYear[yr] = parseFloat(p.revenue) || 0;
          }

          const years = Object.keys(revByYear).sort();
          const revenues = years.map(y => revByYear[y]);

          // Estimate EBITDA from gross margin if available
          const gm = parseFloat(data.grossMargin || '0');
          const ebitdas = revenues.map(r => gm > 0 && gm < 100 ? r * gm / 100 : r * 0.3);

          if (revenues.length < 2) return null;

          const trendLines: TrendLine[] = [
            { label: '收入', data: revenues, color: '#70b8b0' },
            { label: '估算EBITDA', data: ebitdas, color: '#f0b870', dashed: true },
          ];

          return (
            <>
              <h2 style={{marginTop:24}}>趋势分析</h2>
              <p style={{fontSize:'0.8rem',color:'#8ba8a8',marginBottom:8}}>
                收入数据来自销售分析模块（2023-2025）+ LBO预测（如有）
              </p>
              <TrendChart lines={trendLines} xLabels={years} title="收入与利润趋势" />
            </>
          );
        } catch { return null; }
      })()}
    </div>
  );
}
