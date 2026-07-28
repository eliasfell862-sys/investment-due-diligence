import { useState } from 'react';
import { generateWordReport } from '../../infrastructure/reports/word-exporter';
import type { ReportData } from '../../infrastructure/reports/word-exporter';
import { renderChartToImage } from '../../infrastructure/charts/chart-renderer';
import { marginTrend, revenueWaterfall } from '../../infrastructure/charts/chart-options';
import type { ChartImage } from '../../infrastructure/charts/chart-renderer';

export function ReportExportPage() {
  const [exporting, setExporting] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [chartsReady, setChartsReady] = useState(false);

  const export_ = async () => {
    setExporting(true);
    try {
      const company = JSON.parse(localStorage.getItem('dd-company-overview') || '{}');
      const team = JSON.parse(localStorage.getItem('dd-team-members') || '[]');
      const industry = JSON.parse(localStorage.getItem('dd-industry') || '{}');
      const comps = JSON.parse(localStorage.getItem('dd-competitors') || '[]');
      const fin = JSON.parse(localStorage.getItem('dd-financial-v3') || localStorage.getItem('dd-financial-v2') || '{}');
      const riskItems = JSON.parse(localStorage.getItem('dd-risk-items') || '[]');
      const quality = JSON.parse(localStorage.getItem('dd-quality') || '{}');
      const decisionTier = localStorage.getItem('dd-decision-tier') || 'Pending';
      const assumptions = (localStorage.getItem('dd-assumptions') || '').split('\n').filter(Boolean);
      const bearCase = localStorage.getItem('dd-bearcase') || '';

      const riskMatrix = ['market','technology','customer','financial','financing','legal_compliance','governance','data_authenticity','exit'].map((cat) => {
        const items = riskItems.filter((r: any) => r.category === cat);
        if (items.length === 0) return { category: cat, residualRisk: '-', light: 'Not Assessed' };
        const max = Math.max(...items.map((r: any) => parseFloat(r.probability) * parseFloat(r.impact) * (1 - parseFloat(r.mitigationEffectiveness))));
        const light = max < 0.33 ? 'Green' : max < 0.67 ? 'Yellow' : 'Red';
        return { category: cat, residualRisk: max.toFixed(2), light };
      });

      // Generate charts
      const charts: { title: string; image: ChartImage }[] = [];
      try {
        if (fin.revenue) {
          const revChart = await renderChartToImage(revenueWaterfall(
            ['Revenue', 'COGS', 'Gross Profit', 'OpEx', 'EBITDA'],
            [parseFloat(fin.revenue)||0, -(parseFloat(fin.grossProfit) ? parseFloat(fin.revenue)-parseFloat(fin.grossProfit) : 0), parseFloat(fin.grossProfit)||0, -(parseFloat(fin.ebitda) ? (parseFloat(fin.grossProfit)||0)-parseFloat(fin.ebitda) : 0), parseFloat(fin.ebitda)||0],
            'Revenue Waterfall'
          ));
          charts.push({ title: 'Revenue Waterfall', image: revChart });
        }
        if (fin.grossProfit || fin.ebitda || fin.netIncome) {
          const gm = fin.grossProfit && fin.revenue ? (parseFloat(fin.grossProfit)/parseFloat(fin.revenue)*100).toFixed(1) : '0';
          const em = fin.ebitda && fin.revenue ? (parseFloat(fin.ebitda)/parseFloat(fin.revenue)*100).toFixed(1) : '0';
          const nm = fin.netIncome && fin.revenue ? (parseFloat(fin.netIncome)/parseFloat(fin.revenue)*100).toFixed(1) : '0';
          const marginChart = await renderChartToImage(marginTrend(
            ['Current'], [parseFloat(gm)], [parseFloat(em)], [parseFloat(nm)]
          ));
          charts.push({ title: 'Margin Analysis', image: marginChart });
        }
      } catch { /* Charts are optional */ }

      const data: ReportData = {
        projectName: company.name || 'Project',
        date: new Date().toISOString().slice(0, 10),
        decision: decisionTier,
        compositeScore: quality ? String(Object.values(quality).reduce((s: number, v: any) => s + parseFloat(v), 0) / 600) : '-',
        riskAdjustedScore: '-',
        highlights: (company.milestones || []).slice(0, 3),
        bearCase: bearCase || 'Refer to risk assessment section.',
        description: company.description || '',
        industry: { tam: industry.tam || '-', sam: industry.sam || '-', som: industry.som || '-', growth: industry.growthRate || '-' },
        competitors: comps.map((c: any) => ({ name: c.name || '', stage: c.stage || '', share: c.share || '', diff: c.diff || '' })),
        team: team.map((t: any) => ({ name: t.name || '', role: t.role || '', background: t.background || '' })),
        financials: fin,
        riskMatrix,
        exitReturns: { moic: '-', irr: '-' },
        keyAssumptions: assumptions.length > 0 ? assumptions : ['Please define assumptions in the Investment Decision page.'],
        reversalConditions: ['Material adverse change.', 'Key customer loss >20%.'],
        charts,
      };

      const blob = await generateWordReport(data);
      setBlobUrl(URL.createObjectURL(blob));
      setChartsReady(charts.length > 0);
    } finally { setExporting(false); }
  };

  return (
    <div className="module-page">
      <h1>Report Export</h1>
      <p className="page-intro">Generate a professional Word (.docx) report with embedded charts from all due diligence modules.</p>
      <div className="results-grid" style={{margin:'28px 0'}}>
        <div className="metric-card"><strong>IC Memo</strong><span>~15 pages</span></div>
        <div className="metric-card"><strong>Full DD</strong><span>~40 pages</span></div>
        <div className="metric-card"><strong>Charts</strong><span>{chartsReady ? 'Embedded' : 'On demand'}</span></div>
      </div>
      <button className="button button-primary" onClick={export_} disabled={exporting} style={{marginBottom:20}}>
        {exporting ? 'Building report with charts...' : 'Export Word Report (.docx)'}
      </button>
      {blobUrl && (
        <a className="button button-primary" href={blobUrl}
          download={`DD_Report_${new Date().toISOString().slice(0,10)}.docx`}
          style={{display:'inline-block',marginLeft:12}}>
          Download Report
        </a>
      )}
      <p style={{color:'var(--ink-500)',fontSize:'0.78rem',marginTop:12}}>
        Report includes: Executive Summary, Investment Highlights, Industry & Market, Competitors, Team, Financials, Risk Matrix, Investment Decision, and embedded charts.
      </p>
    </div>
  );
}
