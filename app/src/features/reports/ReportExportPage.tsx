import { useState } from 'react';
import { generateWordReport } from '../../infrastructure/reports/word-exporter';
import type { ReportData } from '../../infrastructure/reports/word-exporter';

function loadData(): ReportData {
  const company = JSON.parse(localStorage.getItem('dd-company-overview') || '{}');
  const team = JSON.parse(localStorage.getItem('dd-team-members') || '[]');
  const industry = JSON.parse(localStorage.getItem('dd-industry') || '{}');
  const comps = JSON.parse(localStorage.getItem('dd-competitors') || '[]');
  const fin = JSON.parse(localStorage.getItem('dd-financial-v2') || '{}');
  const riskItems = JSON.parse(localStorage.getItem('dd-risk-items') || '[]');
  const quality = JSON.parse(localStorage.getItem('dd-quality') || '{}');

  const riskMatrix = ['market','technology','customer','financial','financing','legal_compliance','governance','data_authenticity','exit'].map((cat) => {
    const items = riskItems.filter((r: any) => r.category === cat);
    if (items.length === 0) return { category: cat, residualRisk: '-', light: 'Not Assessed' };
    const max = Math.max(...items.map((r: any) => parseFloat(r.probability) * parseFloat(r.impact) * (1 - parseFloat(r.mitigationEffectiveness))));
    const light = max < 0.33 ? 'Green' : max < 0.67 ? 'Yellow' : 'Red';
    return { category: cat, residualRisk: max.toFixed(2), light };
  });

  return {
    projectName: company.name || 'Project',
    date: new Date().toISOString().slice(0, 10),
    decision: 'Pending',
    compositeScore: quality ? String(Object.values(quality).reduce((s: number, v: any) => s + parseFloat(v), 0) / 600) : '-',
    riskAdjustedScore: '-',
    highlights: (company.milestones || []).slice(0, 3),
    bearCase: 'Refer to risk assessment section.',
    description: company.description || '',
    industry: { tam: industry.tam || '-', sam: industry.sam || '-', som: industry.som || '-', growth: industry.growthRate || '-' },
    competitors: comps.map((c: any) => ({ name: c.name, stage: c.stage, share: c.share, diff: c.diff })),
    team: team.map((t: any) => ({ name: t.name, role: t.role, background: t.background })),
    financials: fin,
    riskMatrix,
    exitReturns: { moic: '-', irr: '-' },
    keyAssumptions: ['Revenue targets from management.', 'Market assumptions from industry reports.'],
    reversalConditions: ['Material adverse change in financial position.'],
    charts: [],
  };
}

export function ReportExportPage() {
  const [exporting, setExporting] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const export_ = async () => {
    setExporting(true);
    try {
      const blob = await generateWordReport(loadData());
      setBlobUrl(URL.createObjectURL(blob));
    } finally { setExporting(false); }
  };

  return (
    <div className="module-page">
      <h1>Report Export</h1>
      <p>Generate a professional Word (.docx) report from all due diligence modules.</p>
      <button className="button button-primary" onClick={export_} disabled={exporting} style={{margin:'20px 0'}}>
        {exporting ? 'Generating...' : 'Generate Word Report'}
      </button>
      {blobUrl && <a className="button button-primary" href={blobUrl} download={`DD_Report_${new Date().toISOString().slice(0,10)}.docx`}>Download</a>}
    </div>
  );
}
