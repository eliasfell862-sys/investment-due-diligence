import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { generateWordReport } from '../../infrastructure/reports/word-exporter';
import type { ReportData } from '../../infrastructure/reports/word-exporter';
import { appDb } from '../../infrastructure/db/app-db';
import { syncEvidenceToAnalysis } from '../../infrastructure/db/analysis-sync';

function loadReportData(): { data: ReportData; preview: ReportPreview } {
  const company = JSON.parse(localStorage.getItem('dd-company-overview') || '{}');
  const team = JSON.parse(localStorage.getItem('dd-team-members') || '[]');
  const industry = JSON.parse(localStorage.getItem('dd-industry-v2') || localStorage.getItem('dd-industry') || '{}');
  const comps = JSON.parse(localStorage.getItem('dd-competitors-v2') || localStorage.getItem('dd-competitors') || '[]');
  const fin = JSON.parse(localStorage.getItem('dd-financial-v3') || localStorage.getItem('dd-financial-v2') || '{}');
  const riskItems = JSON.parse(localStorage.getItem('dd-risk-items') || '[]');
  const quality = JSON.parse(localStorage.getItem('dd-quality') || '{}');
  const assumptions = (localStorage.getItem('dd-assumptions') || '').split('\n').filter(Boolean);
  const bearCase = localStorage.getItem('dd-bearcase') || '';
  const strategy = localStorage.getItem('dd-strategy') || 'growth';
  const decisionTier = localStorage.getItem('dd-decision-tier') || 'Pending';

  const riskMatrix = ['market','technology','customer','financial','financing','legal_compliance','governance','data_authenticity','exit'].map((cat) => {
    const items = riskItems.filter((r: any) => r.category === cat);
    if (items.length === 0) return { category: cat, residualRisk: '-', light: 'Not Assessed' };
    const max = Math.max(...items.map((r: any) => parseFloat(r.probability) * parseFloat(r.impact) * (1 - parseFloat(r.mitigationEffectiveness))));
    const light = max < 0.33 ? 'Green' : max < 0.67 ? 'Yellow' : 'Red';
    return { category: cat, residualRisk: max.toFixed(2), light };
  });

  const compositeScore = quality ? String(Object.values(quality).reduce((s: number, v: any) => s + parseFloat(v), 0) / 600) : '-';

  return {
    data: {
      projectName: company.name || 'Project',
      date: new Date().toISOString().slice(0, 10),
      decision: decisionTier,
      compositeScore,
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
      keyAssumptions: assumptions.length > 0 ? assumptions : ['Define assumptions in Investment Decision.'],
      reversalConditions: ['Material adverse change.', 'Key customer loss >20%.'],
      charts: [],
    },
    preview: {
      companyName: company.name,
      description: company.description,
      founded: company.founded,
      milestones: company.milestones || [],
      team,
      industry,
      competitors: comps,
      financials: fin,
      riskMatrix,
      strategy,
      decisionTier,
      compositeScore,
      assumptions,
      bearCase,
    },
  };
}

interface ReportPreview {
  companyName: string;
  description: string;
  founded: string;
  milestones: string[];
  team: any[];
  industry: any;
  competitors: any[];
  financials: Record<string, string>;
  riskMatrix: { category: string; residualRisk: string; light: string }[];
  strategy: string;
  decisionTier: string;
  compositeScore: string;
  assumptions: string[];
  bearCase: string;
}

const CAT_LABELS: Record<string, string> = {
  market:'市场', technology:'技术', customer:'客户', financial:'财务',
  financing:'融资', legal_compliance:'法律合规', governance:'治理',
  data_authenticity:'数据真实性', exit:'退出',
};

const FIN_LABELS: Record<string, string> = {
  revenue:'营业收入', grossProfit:'毛利', ebitda:'EBITDA', netIncome:'净利润',
  operatingCashFlow:'经营现金流', freeCashFlow:'自由现金流',
  customerCount:'客户数', arpu:'ARPU', cac:'获客成本', ltv:'客户终身价值',
  arr:'年度经常性收入', nrr:'净收入留存率', burnRate:'月消耗', cashBalance:'现金余额',
  grossMargin:'毛利率', burnMultiple:'Burn Multiple',
};

export function ReportExportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [exporting, setExporting] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!projectId || synced) return;
    syncEvidenceToAnalysis(appDb, projectId).then(() => setSynced(true)).catch(() => {});
  }, [projectId, synced]);

  const { data: reportData, preview } = useMemo(() => loadReportData(), []);

  const export_ = async () => {
    setExporting(true);
    setError(null);
    try {
      const blob = await generateWordReport(reportData);
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      // Auto-download
      const a = document.createElement('a');
      a.href = url;
      a.download = `DD_Report_${new Date().toISOString().slice(0,10)}.docx`;
      a.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally { setExporting(false); }
  };

  return (
    <div className="module-page" style={{maxWidth:960}}>
      <h1>投资尽调报告</h1>

      {/* === PREVIEW === */}
      <div style={{background:'#fff',border:'1px solid var(--line)',padding:'32px 40px',marginTop:20}}>
        <p style={{color:'var(--ink-500)',fontSize:'0.7rem',letterSpacing:'0.15em',textTransform:'uppercase'}}>机密 · 投资备忘录</p>
        <h2 style={{fontSize:'2rem',margin:'8px 0 4px',color:'#123a52'}}>{preview.companyName || 'Project'}</h2>
        <p style={{color:'var(--ink-500)',margin:'0 0 24px'}}>{preview.description || '暂无描述。'}</p>

        <div style={{display:'flex',gap:16,marginBottom:28,flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:140,background:'#e8f3f4',padding:'14px 18px',borderRadius:4}}>
            <strong style={{color:'#16766f',fontSize:'1.4rem'}}>{preview.decisionTier || '待定'}</strong>
            <span style={{display:'block',fontSize:'0.75rem',color:'var(--ink-500)'}}>投资判定</span>
          </div>
          <div style={{flex:1,minWidth:140,background:'#f7f8fa',padding:'14px 18px',borderRadius:4}}>
            <strong style={{fontSize:'1.4rem'}}>{preview.compositeScore}</strong>
            <span style={{display:'block',fontSize:'0.75rem',color:'var(--ink-500)'}}>综合评分</span>
          </div>
          <div style={{flex:1,minWidth:140,background:'#f7f8fa',padding:'14px 18px',borderRadius:4}}>
            <strong style={{fontSize:'1.4rem'}}>{preview.strategy === 'vc_early' ? '早期VC' : preview.strategy === 'growth' ? '成长期' : preview.strategy === 'pe_buyout' ? 'PE并购' : preview.strategy}</strong>
            <span style={{display:'block',fontSize:'0.75rem',color:'var(--ink-500)'}}>投资阶段</span>
          </div>
        </div>

        {/* Highlights */}
        {preview.milestones.length > 0 && (
          <section style={{marginBottom:24}}>
            <h3 style={{color:'#123a52',borderBottom:'2px solid #16766f',paddingBottom:8}}>关键里程碑</h3>
            <ul>{preview.milestones.map((m: string, i: number) => <li key={i}>{m}</li>)}</ul>
          </section>
        )}

        {/* Industry */}
        {(preview.industry.tam || preview.industry.chainMid) && (
          <section style={{marginBottom:24}}>
            <h3 style={{color:'#123a52',borderBottom:'2px solid #16766f',paddingBottom:8}}>行业与市场</h3>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
              <div><strong>总可寻址市场</strong><br/>{preview.industry.tam || '-'}</div>
              <div><strong>可服务市场</strong><br/>{preview.industry.sam || '-'}</div>
              <div><strong>可获取市场</strong><br/>{preview.industry.som || '-'}</div>
              <div><strong>市场增速</strong><br/>{preview.industry.growthRate || '-'}%</div>
            </div>
            {preview.industry.chainMid && <p style={{marginTop:8}}><strong>产业链位置：</strong> {preview.industry.chainMid}</p>}
          </section>
        )}

        {/* Financials */}
        {Object.values(preview.financials).some(v => v) && (
          <section style={{marginBottom:24}}>
            <h3 style={{color:'#123a52',borderBottom:'2px solid #16766f',paddingBottom:8}}>财务数据</h3>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
              {Object.entries(preview.financials).filter(([,v]) => v).slice(0,8).map(([k,v]) => (
                <div key={k}><strong>{FIN_LABELS[k] || k}</strong><br/>{v}</div>
              ))}
            </div>
          </section>
        )}

        {/* Team */}
        {preview.team.length > 0 && (
          <section style={{marginBottom:24}}>
            <h3 style={{color:'#123a52',borderBottom:'2px solid #16766f',paddingBottom:8}}>核心团队 ({preview.team.length}人)</h3>
            <table className="data-table">
              <thead><tr><th>姓名</th><th>职位</th></tr></thead>
              <tbody>{preview.team.map((t: any) => <tr key={t.id || t.name}><td>{t.name}</td><td>{t.role}</td></tr>)}</tbody>
            </table>
          </section>
        )}

        {/* Competitors */}
        {preview.competitors.length > 0 && (
          <section style={{marginBottom:24}}>
            <h3 style={{color:'#123a52',borderBottom:'2px solid #16766f',paddingBottom:8}}>竞品对比 ({preview.competitors.length}家)</h3>
            <table className="data-table">
              <thead><tr><th>公司</th><th>阶段</th><th>份额</th><th>差异化</th></tr></thead>
              <tbody>{preview.competitors.map((c: any, i: number) => <tr key={i}><td>{c.name}</td><td>{c.stage}</td><td>{c.share}</td><td>{c.diff}</td></tr>)}</tbody>
            </table>
          </section>
        )}

        {/* Risk Matrix */}
        {preview.riskMatrix.some(r => r.residualRisk !== '-') && (
          <section style={{marginBottom:24}}>
            <h3 style={{color:'#123a52',borderBottom:'2px solid #16766f',paddingBottom:8}}>风险矩阵</h3>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
              {preview.riskMatrix.map((r) => (
                <div key={r.category} style={{
                  padding:'10px 14px',borderRadius:4,fontSize:'0.85rem',
                  background: r.light === 'Green' ? '#dff3e6' : r.light === 'Yellow' ? '#fff0c2' : r.light === 'Red' ? '#ffe0df' : '#f7f8fa',
                  color: r.light === 'Green' ? '#176239' : r.light === 'Yellow' ? '#7a5600' : r.light === 'Red' ? '#8c2825' : '#86868b',
                }}>
                  <strong>{CAT_LABELS[r.category] || r.category}</strong>
                  <span style={{float:'right'}}>{r.residualRisk}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Assumptions & Bear Case */}
        {(preview.assumptions.length > 0 || preview.bearCase) && (
          <section style={{marginBottom:24}}>
            <h3 style={{color:'#123a52',borderBottom:'2px solid #16766f',paddingBottom:8}}>关键假设与反面逻辑</h3>
            {preview.assumptions.length > 0 && <ul>{preview.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
            {preview.bearCase && <p style={{color:'#9c3f36',marginTop:8}}><strong>反面逻辑：</strong> {preview.bearCase}</p>}
          </section>
        )}

        <p style={{color:'var(--ink-500)',fontSize:'0.7rem',borderTop:'1px solid var(--line)',paddingTop:16,marginTop:24}}>
          本报告仅供投资委员会内部审阅，数据来源详见附录。
        </p>
      </div>

      {/* === EXPORT BUTTONS === */}
      <div style={{margin:'28px 0',display:'flex',gap:16,alignItems:'center'}}>
        <button className="button button-primary" onClick={export_} disabled={exporting} style={{fontSize:'1rem',padding:'14px 28px'}}>
          {exporting ? 'Generating...' : 'Download Word Report (.docx)'}
        </button>
        {blobUrl && (
          <a className="button" href={blobUrl}
            download={`DD_Report_${new Date().toISOString().slice(0,10)}.docx`}
            style={{textDecoration:'none',color:'var(--teal)',border:'1px solid var(--teal)',padding:'14px 28px',display:'inline-block'}}>
            Re-download
          </a>
        )}
      </div>
      {error && <div className="loss-info">{error}</div>}
    </div>
  );
}
