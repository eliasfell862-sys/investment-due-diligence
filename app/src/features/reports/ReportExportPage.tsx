import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { generateWordReport } from '../../infrastructure/reports/word-exporter';
import type { ReportData } from '../../infrastructure/reports/word-exporter';
import { evaluateDecision } from '../../engines/decision/evaluate-decision';
import { evaluateRisk } from '../../engines/risk/evaluate-risk';
import { generateOperationalRiskItems } from '../../domain/analysis/operational-risk-bridge';
import { appDb } from '../../infrastructure/db/app-db';
import { syncEvidenceToAnalysis } from '../../infrastructure/db/analysis-sync';

/* ── Label maps ── */
const CAT_LABELS: Record<string, string> = {
  market:'市场', technology:'技术', customer:'客户', financial:'财务',
  financing:'融资', legal_compliance:'法律合规', governance:'治理',
  data_authenticity:'数据真实性', exit:'退出',
};
const FIN_LABELS: Record<string, string> = {
  revenue:'营业收入', grossProfit:'毛利', ebitda:'EBITDA', netIncome:'净利润',
  operatingCashFlow:'经营现金流', freeCashFlow:'自由现金流',
  customerCount:'客户数', arpu:'ARPU', cac:'获客成本', ltv:'客户终身价值',
  arr:'ARR', nrr:'NRR', burnRate:'月消耗', cashBalance:'现金余额',
  burnMultiple:'Burn Multiple',
};
const DECISION_LABELS: Record<string, string> = {
  strong_recommend:'强烈推荐', conditional_invest:'有条件投资',
  continue_observing:'继续观察', defer:'暂缓', do_not_invest:'不投资',
};

/* ── Data loader ── */
function loadAllData() {
  const company = JSON.parse(localStorage.getItem('dd-company-overview') || '{}');
  const team = JSON.parse(localStorage.getItem('dd-team-members') || '[]');
  const industry = JSON.parse(localStorage.getItem('dd-industry-v2') || localStorage.getItem('dd-industry') || '{}');
  const comps = JSON.parse(localStorage.getItem('dd-competitors-v2') || localStorage.getItem('dd-competitors') || '[]');
  const products = JSON.parse(localStorage.getItem('dd-products-v2') || '[]');
  const fin = JSON.parse(localStorage.getItem('dd-financial-v3') || localStorage.getItem('dd-financial-v2') || '{}');
  const riskItems = JSON.parse(localStorage.getItem('dd-risk-items') || '[]');
  // Merge auto-generated operational risk items for display
  const opRiskItems = generateOperationalRiskItems();
  const allRiskItemsForDisplay = [...riskItems, ...[opRiskItems.customerConcentration, opRiskItems.revenueGrowth, opRiskItems.supplierConcentration, opRiskItems.valuationDownRound].filter(Boolean)];
  let quality = JSON.parse(localStorage.getItem('dd-quality') || '{}');
  // Auto-calculate if empty — uses already-loaded variables
  if (!quality || Object.keys(quality).length === 0) {
    const tam = parseFloat(industry.tam) || 0;
    const growth = parseFloat(industry.growthRate) || 0;
    const sa = JSON.parse(localStorage.getItem('dd-sales') || '[]');
    const r23 = sa.reduce((s: number, c: any) => s + (parseFloat(c.revenue2023) || 0), 0);
    const r25 = sa.reduce((s: number, c: any) => s + (parseFloat(c.revenue2025) || 0), 0);
    const cagr = r23 > 0 && r25 > 0 ? (Math.pow(r25 / r23, 0.5) - 1) * 100 : 0;
    quality = {
      teamAndGovernance: String(Math.min(100, 50 + team.length * 5 + (team.some((t:any) => t.background?.length > 20) ? 15 : 0))),
      marketAndIndustry: String(Math.min(100, 50 + (tam > 100000 ? 15 : 0) + (tam > 1000000 ? 10 : 0) + (growth > 10 ? 10 : 0) + (growth > 30 ? 10 : 0))),
      productAndTechnology: String(Math.min(100, 50 + products.length * 10 + (localStorage.getItem('dd-ip') ? 10 : 0))),
      commercializationAndGrowth: String(Math.max(0, Math.min(100, 50 + (cagr > 30 ? 25 : cagr > 15 ? 15 : cagr > 5 ? 5 : cagr < 0 ? -20 : 0)))),
      financialAndCashFlow: String(Math.min(100, 50 + (fin.revenue ? 10 : 0) + (fin.netIncome && parseFloat(fin.netIncome) > 0 ? 15 : 0))),
      valuationAndReturn: String(Math.min(100, 50 + (localStorage.getItem('dd-exit') ? 10 : 0))),
    };
    localStorage.setItem('dd-quality', JSON.stringify(quality));
  }
  const assumptions = (localStorage.getItem('dd-assumptions') || '').split('\n').filter(Boolean);
  let bearCase = localStorage.getItem('dd-bearcase') || '';

  // Auto-generate highlights from available data if empty
  let highlights: string[] = company.milestones || [];
  if (highlights.length === 0) {
    const autoHighlights: string[] = [];
    if (fin.revenue) autoHighlights.push(`营业收入：${fin.revenue}万元`);
    if (fin.grossProfit && fin.revenue) autoHighlights.push(`毛利率：${(parseFloat(fin.grossProfit)/parseFloat(fin.revenue)*100).toFixed(1)}%`);
    if (team.length >= 3) autoHighlights.push(`核心团队${team.length}人`);
    if (products.length >= 1) autoHighlights.push(`${products.length}个产品线`);
    if (industry.tam) autoHighlights.push(`TAM：${parseFloat(industry.tam).toLocaleString()}万元`);
    const saArr = JSON.parse(localStorage.getItem('dd-sales') || '[]');
    const salesTotal25 = saArr.reduce((s: number, c: any) => s + (parseFloat(c.revenue2025) || 0), 0);
    if (salesTotal25 > 0) autoHighlights.push(`2025年营收：${salesTotal25.toLocaleString()}万元`);
    if (autoHighlights.length > 0) highlights = autoHighlights;
  }

  // Auto-generate bear case if empty
  if (!bearCase) {
    const risks: string[] = [];
    const saArr2 = JSON.parse(localStorage.getItem('dd-sales') || '[]');
    const sorted = [...saArr2].filter((s: any) => (parseFloat(s.revenue2025)||0) > 0).sort((a:any,b:any) => (parseFloat(b.revenue2025)||0) - (parseFloat(a.revenue2025)||0));
    const total25 = sorted.reduce((s: number, c: any) => s + (parseFloat(c.revenue2025) || 0), 0);
    if (total25 > 0 && sorted.length > 0) {
      const top1 = (parseFloat(sorted[0].revenue2025)||0) / total25;
      if (top1 > 0.3) risks.push(`客户集中度风险：最大客户占比${(top1*100).toFixed(1)}%`);
    }
    const procArr = JSON.parse(localStorage.getItem('dd-procurement') || '[]');
    const pTotal = procArr.reduce((s: number, p: any) => s + (parseFloat(p.amount2025)||0), 0);
    if (pTotal > 0 && procArr.length > 0) {
      const pSorted = [...procArr].sort((a:any,b:any) => (parseFloat(b.amount2025)||0) - (parseFloat(a.amount2025)||0));
      const pTop1 = (parseFloat(pSorted[0].amount2025)||0) / pTotal;
      if (pTop1 > 0.3) risks.push(`供应商集中风险：最大供应商占比${(pTop1*100).toFixed(1)}%`);
    }
    const r23 = saArr2.reduce((s: number, c: any) => s + (parseFloat(c.revenue2023)||0), 0);
    const r25 = saArr2.reduce((s: number, c: any) => s + (parseFloat(c.revenue2025)||0), 0);
    if (r23 > 0 && r25 > 0) {
      const cagr = ((Math.pow(r25/r23, 0.5) - 1) * 100).toFixed(1);
      if (parseFloat(cagr) < 0) risks.push(`收入负增长：CAGR ${cagr}%`);
    }
    if (risks.length > 0) bearCase = risks.join('；');
  }
  const strategy = localStorage.getItem('dd-strategy') || 'growth';
  const esop = localStorage.getItem('dd-esop') || '';
  const invest = localStorage.getItem('dd-invest') || '';
  const ip = localStorage.getItem('dd-ip') || '';
  const rd = localStorage.getItem('dd-rd') || '';
  const exit_ = JSON.parse(localStorage.getItem('dd-exit') || '{}');
  const valuation = JSON.parse(localStorage.getItem('dd-valuation') || '{}');
  const sales = JSON.parse(localStorage.getItem('dd-sales') || '[]');
  const procurement = JSON.parse(localStorage.getItem('dd-procurement') || '[]');
  const financingHistory = JSON.parse(localStorage.getItem('dd-financing-history') || '[]');
  const contracts = JSON.parse(localStorage.getItem('dd-contracts') || '[]');

  const riskMatrix = CAT_KEYS.map((cat) => {
    const items = allRiskItemsForDisplay.filter((r: any) => r.category === cat);
    if (items.length === 0) return { category: cat, residualRisk: '-', light: '未评估' as const };
    const max = Math.max(...items.map((r: any) => parseFloat(r.probability) * parseFloat(r.impact) * (1 - parseFloat(r.mitigationEffectiveness))));
    const light = max < 0.33 ? '绿' as const : max < 0.67 ? '黄' as const : '红' as const;
    return { category: cat, residualRisk: max.toFixed(2), light };
  });

  // Run actual risk engine
  const riskResult = evaluateRisk({
    version: '1', asOfDate: new Date().toISOString().slice(0, 10),
    riskItems: allRiskItemsForDisplay,
    fatalFlaws: [
      { fatalFlawId: 'material_data_or_business_fraud', status: 'clear', evidenceRefs: [] },
      { fatalFlawId: 'core_ownership_or_license_unclear', status: 'clear', evidenceRefs: [] },
      { fatalFlawId: 'irremediable_major_illegality', status: 'clear', evidenceRefs: [] },
      { fatalFlawId: 'business_model_unverifiable', status: 'clear', evidenceRefs: [] },
      { fatalFlawId: 'pre_close_cash_break', status: 'clear', evidenceRefs: [] },
      { fatalFlawId: 'founder_integrity_failure', status: 'clear', evidenceRefs: [] },
    ],
  });
  const riskPenaltyVal = riskResult.status === 'ok' ? (riskResult.value.overall.riskPenalty || '5') : '5';
  const residualRisk = riskResult.status === 'ok' ? (riskResult.value.overall.residualRisk || '0.3') : '0.3';
  const fatalOutcomeVal = riskResult.status === 'ok' ? riskResult.value.fatalFlaws.fatalOutcome : 'none';
  const permLossLower = riskResult.status === 'ok' ? riskResult.value.permanentLoss.lower : '0.05';
  const permLossUpper = riskResult.status === 'ok' ? riskResult.value.permanentLoss.upper : '0.2';

  // Run actual decision engine with real risk data
  const exitVal = exit_ as Record<string, string>;
  const targetIrr = (valuation as Record<string, string>).targetIrr || '0.25';
  const targetMoic = '3';
  const baseMoic = exitVal.moic || null;
  const baseIrr = exitVal.irr || null;
  const decisionResult = evaluateDecision({
    version: '1', strategy: strategy as any,
    qualityScores: quality as any,
    fatalOutcome: fatalOutcomeVal,
    notCurableByClause: fatalOutcomeVal === 'reject',
    returnMetrics: {
      targetIrr, targetMoic,
      baseCaseIrr: baseIrr, baseCaseMoic: baseMoic,
      permanentLossProbabilityLower: permLossLower,
      permanentLossProbabilityUpper: permLossUpper,
    },
    keyAssumptions: assumptions,
    bearCaseArguments: bearCase ? [bearCase] : [],
    riskPenalty: riskPenaltyVal,
    overallResidualRisk: residualRisk,
  });
  const compositeScore = decisionResult.status === 'ok' ? parseFloat(decisionResult.value.compositeScore || '0') : 0;
  const riskAdjustedScore = decisionResult.status === 'ok' ? (decisionResult.value.riskAdjustedScore || '-') : '-';
  const decisionTier = decisionResult.status === 'ok' ? decisionResult.value.tier : 'Pending';

  const finEntries = Object.entries(fin).filter(([,v]) => v).map(([k,v]) => ({ label: FIN_LABELS[k] || k, value: String(v) }));

  return {
    company, team, industry, comps, products, finEntries, riskMatrix, allRiskItemsForDisplay,
    quality, assumptions, bearCase, strategy, esop, invest, ip, rd, exit_, valuation,
    compositeScore, riskAdjustedScore, decisionTier,
    sales, procurement, financingHistory, contracts,
  };
}
const CAT_KEYS = ['market','technology','customer','financial','financing','legal_compliance','governance','data_authenticity','exit'] as const;

function Section({ title, children, isEmpty }: { title: string; children: React.ReactNode; isEmpty?: boolean }) {
  if (isEmpty) return null;
  return (
    <section style={{marginBottom:24}}>
      <h3 style={{color:'#123a52',borderBottom:'2px solid #16766f',paddingBottom:8,marginBottom:12}}>{title}</h3>
      {children}
    </section>
  );
}

function MetricGrid({ items }: { items: { label: string; value: string }[] }) {
  if (items.length === 0) return <p style={{color:'var(--ink-500)'}}>暂无数据</p>;
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:10}}>
      {items.map((m, i) => (
        <div key={i} style={{background:'#f7f8fa',padding:'10px 14px',borderRadius:4}}>
          <strong style={{fontSize:'0.8rem',color:'var(--ink-500)'}}>{m.label}</strong>
          <span style={{display:'block',fontSize:'1.1rem',fontWeight:700}}>{m.value || '—'}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Page ── */
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

  const [refreshKey, setRefreshKey] = useState(0);
  const d = useMemo(() => loadAllData(), [refreshKey]);

  const export_ = async () => {
    setExporting(true); setError(null);
    try {
      const reportData: ReportData = {
        projectName: d.company.name || '项目',
        date: new Date().toISOString().slice(0, 10),
        decision: DECISION_LABELS[d.decisionTier] || d.decisionTier || '待定',
        compositeScore: (d.compositeScore * 100).toFixed(1),
        riskAdjustedScore: d.riskAdjustedScore || '-',
        highlights: d.company.milestones || [],
        bearCase: d.bearCase || '参见风险评估章节。',
        description: d.company.description || '',
        industry: { tam: d.industry.tam || '-', sam: d.industry.sam || '-', som: d.industry.som || '-', growth: d.industry.growthRate || '-' },
        competitors: d.comps.map((c: any) => ({ name: c.name||'', stage: c.stage||'', share: c.share||'', diff: c.diff||'' })),
        team: d.team.map((t: any) => ({ name: t.name||'', role: t.role||'', background: t.background||'' })),
        financials: d.finEntries.map(m => [m.label, m.value]),
        riskMatrix: d.riskMatrix.map(r => ({ category: CAT_LABELS[r.category]||r.category, residualRisk: r.residualRisk, light: r.light })),
        exitReturns: { moic: d.exit_.moic || '-', irr: d.exit_.irr || '-' },
        keyAssumptions: d.assumptions.length > 0 ? d.assumptions : ['请在投资建议页面定义假设。'],
        reversalConditions: ['重大不利变化', '关键客户流失超过20%'],
        charts: [],
        extended: {
          founded: d.company.founded,
          businessModel: d.company.businessModel,
          chainUp: d.industry.chainUp, chainMid: d.industry.chainMid, chainDown: d.industry.chainDown,
          trends: d.industry.trends, drivers: d.industry.drivers, regulation: d.industry.regulation,
          products: d.products, ip: d.ip, rd: d.rd,
          esop: d.esop, investmentAmount: d.invest,
          valuationFcf: d.valuation.fcfBase, valuationWacc: d.valuation.wacc,
          exitValue: d.exit_.exitValue, ownershipPct: d.exit_.ownershipPct,
        },
      };
      const blob = await generateWordReport(reportData);
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      const a = document.createElement('a');
      a.href = url; a.download = `DD_Report_${new Date().toISOString().slice(0,10)}.docx`; a.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally { setExporting(false); }
  };

  const hasData = d.company.name || d.finEntries.length > 0;

  return (
    <div className="module-page" style={{maxWidth:960}}>
      <h1>投资尽调报告</h1>
      <button className="button" onClick={() => setRefreshKey(k => k + 1)} style={{marginBottom:16,color:'var(--teal)',borderColor:'var(--teal)',background:'transparent'}}>🔄 刷新数据</button>

      {!hasData && (
        <div className="loss-info" style={{marginTop:20}}>
          <strong>暂无数据</strong><br />
          请先上传资料并使用 AI 智能提取，或在分析工作台中手动填写各模块数据。
        </div>
      )}

      {hasData && (
        <div style={{background:'#fff',border:'1px solid var(--line)',padding:'36px 40px',marginTop:20}}>

          {/* ── COVER ── */}
          <p style={{color:'var(--ink-500)',fontSize:'0.7rem',letterSpacing:'0.15em',textTransform:'uppercase'}}>机密 · 投资备忘录</p>
          <h2 style={{fontSize:'2.2rem',margin:'8px 0 4px',color:'#123a52'}}>{d.company.name || '未命名项目'}</h2>
          {d.company.description && <p style={{color:'var(--ink-500)',margin:'0 0 24px'}}>{d.company.description}</p>}

          <div style={{display:'flex',gap:16,marginBottom:28,flexWrap:'wrap'}}>
            <div style={{flex:1,minWidth:140,background:'#e8f3f4',padding:'14px 18px',borderRadius:4}}>
              <strong style={{color:'#16766f',fontSize:'1.4rem'}}>{DECISION_LABELS[d.decisionTier] || d.decisionTier || '待定'}</strong>
              <span style={{display:'block',fontSize:'0.75rem',color:'var(--ink-500)'}}>投资判定</span>
            </div>
            <div style={{flex:1,minWidth:140,background:'#f7f8fa',padding:'14px 18px',borderRadius:4}}>
              <strong style={{fontSize:'1.4rem'}}>{(d.compositeScore * 100).toFixed(1)}</strong>
              <span style={{display:'block',fontSize:'0.75rem',color:'var(--ink-500)'}}>综合评分</span>
            </div>
            <div style={{flex:1,minWidth:140,background:'#f7f8fa',padding:'14px 18px',borderRadius:4}}>
              <strong style={{fontSize:'1.4rem'}}>{d.strategy === 'vc_early' ? '早期VC' : d.strategy === 'growth' ? '成长期' : d.strategy === 'pe_buyout' ? 'PE并购' : d.strategy}</strong>
              <span style={{display:'block',fontSize:'0.75rem',color:'var(--ink-500)'}}>投资阶段</span>
            </div>
          </div>

          {/* ── 1. EXECUTIVE SUMMARY ── */}
          <Section title="一、执行摘要">
            <p>{d.company.description || '暂无公司描述。'}</p>
            {d.company.founded && <p style={{marginTop:4}}><strong>成立时间：</strong>{d.company.founded}</p>}
            {d.company.businessModel && <p><strong>商业模式：</strong>{d.company.businessModel}</p>}
            {d.company.milestones?.length > 0 && (
              <div style={{marginTop:8}}>
                <strong>关键里程碑：</strong>
                <ul style={{margin:'4px 0 0'}}>{d.company.milestones.map((m: string, i: number) => <li key={i}>{m}</li>)}</ul>
              </div>
            )}
          </Section>

          {/* ── 2. INVESTMENT HIGHLIGHTS & BEAR CASE ── */}
          <Section title="二、投资亮点与反面逻辑">
            <strong style={{color:'#16766f'}}>核心亮点</strong>
            {d.company.milestones?.length > 0
              ? <ul>{d.company.milestones.slice(0,5).map((m: string, i: number) => <li key={i}>{m}</li>)}</ul>
              : <p style={{color:'var(--ink-500)'}}>暂无亮点记录。</p>}
            <strong style={{color:'#9c3f36',marginTop:12,display:'block'}}>反面逻辑 / 风险因素</strong>
            <p style={{color:'#9c3f36'}}>{d.bearCase || '未定义反面逻辑。请在投资建议页面填写。'}</p>
          </Section>

          {/* ── 3. COMPANY & BUSINESS MODEL ── */}
          <Section title="三、公司与商业模式" isEmpty={!d.company.name && !d.company.founded}>
            <MetricGrid items={[
              {label:'公司名称',value:d.company.name||''},
              {label:'成立时间',value:d.company.founded||''},
              {label:'总部',value:d.company.headquarters||''},
              {label:'网站',value:d.company.website||''},
              {label:'商业模式',value:d.company.businessModel||''},
            ].filter(m=>m.value)} />
          </Section>

          {/* ── 4. INDUSTRY & MARKET ── */}
          <Section title="四、行业与市场" isEmpty={!d.industry.tam && !d.industry.chainMid && !d.industry.growthRate}>
            <MetricGrid items={[
              {label:'总可寻址市场(TAM)',value:d.industry.tam||''},
              {label:'可服务市场(SAM)',value:d.industry.sam||''},
              {label:'可获取市场(SOM)',value:d.industry.som||''},
              {label:'市场增速',value:d.industry.growthRate ? d.industry.growthRate+'%' : ''},
            ].filter(m=>m.value)} />
            {d.industry.chainUp && <p style={{marginTop:8}}><strong>产业链上游：</strong>{d.industry.chainUp}</p>}
            {d.industry.chainMid && <p><strong>产业链中游（公司位置）：</strong>{d.industry.chainMid}</p>}
            {d.industry.chainDown && <p><strong>产业链下游：</strong>{d.industry.chainDown}</p>}
            {d.industry.drivers && <p><strong>关键驱动因素：</strong>{d.industry.drivers}</p>}
            {d.industry.trends && <p><strong>技术/政策趋势：</strong>{d.industry.trends}</p>}
            {d.industry.regulation && <p><strong>监管环境：</strong>{d.industry.regulation}</p>}
            {!d.industry.tam && !d.industry.chainMid && <p style={{color:'var(--ink-500)'}}>暂无行业数据。</p>}
          </Section>

          {/* ── 5. COMPETITORS ── */}
          <Section title={`五、竞品对比${d.comps.length ? ` (${d.comps.length}家)` : ''}`} isEmpty={d.comps.length === 0}>
            {d.comps.length > 0 ? (
              <table className="data-table">
                <thead><tr><th>公司</th><th>阶段</th><th>份额</th><th>资金</th><th>差异化</th></tr></thead>
                <tbody>{d.comps.map((c: any, i: number) => (
                  <tr key={i}><td>{c.name}</td><td>{c.stage}</td><td>{c.share}</td><td>{c.funding}</td><td>{c.diff}</td></tr>
                ))}</tbody>
              </table>
            ) : <p style={{color:'var(--ink-500)'}}>暂无竞品数据。</p>}
          </Section>

          {/* ── 6. TEAM ── */}
          <Section title={`六、核心团队${d.team.length ? ` (${d.team.length}人)` : ''}`} isEmpty={d.team.length === 0}>
            {d.team.length > 0 ? (
              <table className="data-table">
                <thead><tr><th>姓名</th><th>职位</th><th>背景</th><th>持股</th><th>关键人</th></tr></thead>
                <tbody>{d.team.map((t: any) => (
                  <tr key={t.id || t.name}><td>{t.name}</td><td>{t.role}</td><td style={{maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.background}</td><td>{t.ownership}</td><td>{t.isKey ? '是' : ''}</td></tr>
                ))}</tbody>
              </table>
            ) : <p style={{color:'var(--ink-500)'}}>暂无团队数据。</p>}
          </Section>

          {/* ── 7. PRODUCTS ── */}
          <Section title={`七、产品与技术${d.products.length ? ` (${d.products.length}个产品)` : ''}`} isEmpty={d.products.length === 0 && !d.ip && !d.rd}>
            {d.products.length > 0 ? (
              <table className="data-table">
                <thead><tr><th>产品名</th><th>阶段</th><th>收入占比</th><th>护城河</th></tr></thead>
                <tbody>{d.products.map((p: any, i: number) => (
                  <tr key={i}><td>{p.name}</td><td>{p.stage}</td><td>{p.revenuePct}%</td><td>{p.moat}</td></tr>
                ))}</tbody>
              </table>
            ) : <p style={{color:'var(--ink-500)'}}>暂无产品数据。</p>}
            {d.ip && <p style={{marginTop:8}}><strong>知识产权/专利：</strong>{d.ip}</p>}
            {d.rd && <p><strong>研发管线：</strong>{d.rd}</p>}
          </Section>

          {/* ── 8. FINANCIALS ── */}
          <Section title="八、财务分析" isEmpty={d.finEntries.length === 0}>
            {d.finEntries.length > 0 ? (
              <MetricGrid items={d.finEntries} />
            ) : <p style={{color:'var(--ink-500)'}}>暂无财务数据。</p>}
          </Section>

          {/* ── 8.5 SALES ── */}
          <Section title={`销售分析${d.sales.length ? ` (${d.sales.length}条记录)` : ''}`} isEmpty={d.sales.length === 0}>
            {d.sales.length > 0 && (<>
              <table className="data-table"><thead><tr><th>客户</th><th>业务线</th><th>2024(万)</th><th>2025(万)</th><th>毛利率%</th><th>合同金额(万)</th></tr></thead>
                <tbody>{d.sales.map((s:any,i:number)=><tr key={i}><td>{s.name}</td><td>{s.businessLine}</td><td>{s.revenue2024}</td><td>{s.revenue2025}</td><td>{s.grossMargin}</td><td>{s.contractAmount}</td></tr>)}</tbody></table>
              <p style={{marginTop:8,fontSize:'0.8rem',color:'var(--ink-500)'}}>2025总营收：{d.sales.reduce((t:number,s:any)=>t+(parseFloat(s.revenue2025)||0),0).toLocaleString()}万元</p>
            </>)}
          </Section>

          {/* ── 8.6 PROCUREMENT ── */}
          <Section title={`采购分析${d.procurement.length ? ` (${d.procurement.length}家供应商)` : ''}`} isEmpty={d.procurement.length === 0}>
            {d.procurement.length > 0 && (<>
              <table className="data-table"><thead><tr><th>供应商</th><th>类别</th><th>2024(万)</th><th>2025(万)</th><th>内容</th></tr></thead>
                <tbody>{d.procurement.map((s:any,i:number)=><tr key={i}><td>{s.name}</td><td>{s.category}</td><td>{s.amount2024}</td><td>{s.amount2025}</td><td style={{maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.contractDesc}</td></tr>)}</tbody></table>
              <p style={{marginTop:8,fontSize:'0.8rem',color:'var(--ink-500)'}}>2025总采购：{d.procurement.reduce((t:number,s:any)=>t+(parseFloat(s.amount2025)||0),0).toLocaleString()}万元</p>
            </>)}
          </Section>

          {/* ── 8.7 FINANCING HISTORY ── */}
          <Section title={`融资历史${d.financingHistory.length ? ` (${d.financingHistory.length}轮)` : ''}`} isEmpty={d.financingHistory.length === 0}>
            {d.financingHistory.length > 0 && (
              <table className="data-table"><thead><tr><th>轮次</th><th>日期</th><th>金额(万)</th><th>投前估值(万)</th><th>投后估值(万)</th><th>投资方</th></tr></thead>
                <tbody>{d.financingHistory.map((r:any,i:number)=><tr key={i}><td>{r.name}</td><td>{r.date}</td><td>{r.amount}</td><td>{r.preMoneyVal}</td><td>{r.postMoneyVal}</td><td>{r.investors}</td></tr>)}</tbody></table>
            )}
          </Section>

          {/* ── 8.8 CONTRACTS ── */}
          <Section title={`合同台账${d.contracts.length ? ` (${d.contracts.length}份)` : ''}`} isEmpty={d.contracts.length === 0}>
            {d.contracts.length > 0 && (
              <table className="data-table"><thead><tr><th>合同名称</th><th>对方</th><th>金额(万)</th><th>期限</th><th>进度</th></tr></thead>
                <tbody>{d.contracts.map((c:any,i:number)=><tr key={i}><td>{c.name}</td><td>{c.party}</td><td>{c.amount}</td><td>{c.startDate}~{c.endDate}</td><td>{c.progress}%</td></tr>)}</tbody></table>
            )}
          </Section>

          {/* ── 9. VALUATION ── */}
          <Section title="九、估值模型" isEmpty={!d.valuation.fcfBase}>
            {d.valuation.fcfBase ? (
              <MetricGrid items={[
                {label:'基准FCF',value:d.valuation.fcfBase},
                {label:'FCF增长率',value:d.valuation.fcfGrowth||''},
                {label:'WACC',value:d.valuation.wacc||''},
                {label:'永续增长率',value:d.valuation.terminalGrowth||''},
                {label:'EV/Revenue',value:d.valuation.evRevenue||''},
                {label:'EV/EBITDA',value:d.valuation.evEbitda||''},
                {label:'目标IRR',value:d.valuation.targetIrr||''},
                {label:'进入估值',value:d.valuation.entryValuation||''},
              ].filter(m=>m.value)} />
            ) : <p style={{color:'var(--ink-500)'}}>暂无估值数据。</p>}
          </Section>

          {/* ── 10. EQUITY ── */}
          <Section title="十、股权与融资" isEmpty={!d.esop && !d.invest}>
            <MetricGrid items={[
              {label:'ESOP池',value:d.esop ? d.esop+'%' : ''},
              {label:'本轮投资额',value:d.invest||''},
            ].filter(m=>m.value)} />
          </Section>

          {/* ── 11. RISK ── */}
          <Section title="十一、风险评估">
            {d.riskMatrix.some(r => r.residualRisk !== '-') ? (
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:8}}>
                {d.riskMatrix.map((r) => (
                  <div key={r.category} style={{
                    padding:'10px 14px',borderRadius:4,fontSize:'0.85rem',
                    background: r.light==='绿'?'#dff3e6':r.light==='黄'?'#fff0c2':r.light==='红'?'#ffe0df':'#f7f8fa',
                    color: r.light==='绿'?'#176239':r.light==='黄'?'#7a5600':r.light==='红'?'#8c2825':'#86868b',
                  }}>
                    <strong>{CAT_LABELS[r.category]||r.category}</strong>
                    <span style={{float:'right'}}>{r.residualRisk}</span>
                    <span style={{display:'block',fontSize:'0.7rem'}}>{r.light}</span>
                  </div>
                ))}
              </div>
            ) : <p style={{color:'var(--ink-500)'}}>暂无风险评估数据。</p>}
            {d.allRiskItemsForDisplay.length > 0 && (
              <div style={{marginTop:12}}>
                <strong>风险项详情 ({d.allRiskItemsForDisplay.length}项，含自动分析)：</strong>
                <table className="data-table" style={{marginTop:8}}>
                  <thead><tr><th>类别</th><th>标题</th><th>概率</th><th>影响</th><th>缓释</th></tr></thead>
                  <tbody>{d.allRiskItemsForDisplay.map((r: any) => (
                    <tr key={r.riskId}><td>{CAT_LABELS[r.category]||r.category}</td><td>{r.title}</td><td>{r.probability}</td><td>{r.impact}</td><td>{r.mitigationEffectiveness}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ── 12. EXIT & RETURNS ── */}
          <Section title="十二、退出路径与回报" isEmpty={!d.exit_.exitValue}>
            <MetricGrid items={[
              {label:'退出估值',value:d.exit_.exitValue||''},
              {label:'持股比例',value:d.exit_.ownershipPct?d.exit_.ownershipPct+'%':''},
              {label:'投资额',value:d.exit_.investmentAmount||''},
              {label:'持有年限',value:d.exit_.holdingYears||''},
              {label:'预期MOIC',value:d.exit_.moic||''},
              {label:'预期IRR',value:d.exit_.irr||''},
            ].filter(m=>m.value)} />
          </Section>

          {/* ── 13. DECISION ── */}
          <Section title="十三、投资判定与条件">
            <p><strong>判定：</strong>{DECISION_LABELS[d.decisionTier] || d.decisionTier || '待定'}</p>
            <p><strong>综合评分：</strong>{(d.compositeScore * 100).toFixed(1)}</p>
            <p><strong>投资阶段权重：</strong>{d.strategy === 'vc_early' ? '早期VC' : d.strategy === 'growth' ? '成长期' : 'PE并购'}</p>
            {d.assumptions.length > 0 && (
              <div style={{marginTop:8}}>
                <strong>关键假设：</strong>
                <ul>{d.assumptions.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>
              </div>
            )}
            {d.bearCase && <p style={{marginTop:8,color:'#9c3f36'}}><strong>反面逻辑：</strong>{d.bearCase}</p>}
            <p style={{marginTop:8}}><strong>结论反转条件：</strong>重大不利变化；关键客户流失超过20%。</p>
          </Section>

          <p style={{color:'var(--ink-500)',fontSize:'0.7rem',borderTop:'1px solid var(--line)',paddingTop:16,marginTop:24}}>
            本报告仅供投资委员会内部审阅，数据来源详见附录。不构成投资建议。
          </p>
        </div>
      )}

      {/* ── EXPORT ── */}
      <div style={{margin:'28px 0',display:'flex',gap:16,alignItems:'center'}}>
        <button className="button button-primary" onClick={export_} disabled={exporting} style={{fontSize:'1rem',padding:'14px 28px'}}>
          {exporting ? '生成中…' : '下载 Word 报告 (.docx)'}
        </button>
        {blobUrl && <a className="button" href={blobUrl} download={`DD_Report_${new Date().toISOString().slice(0,10)}.docx`}
          style={{textDecoration:'none',color:'var(--teal)',border:'1px solid var(--teal)',padding:'14px 28px',display:'inline-block'}}>重新下载</a>}
      </div>
      {error && <div className="loss-info">{error}</div>}
    </div>
  );
}
