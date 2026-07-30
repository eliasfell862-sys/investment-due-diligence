import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  calculateQoE, QOE_CATEGORY_LABELS, QOE_CATEGORY_EXPLANATIONS, PE_QOE_TEMPLATES,
  type QoEAdjustment, type QoECategory,
} from '../../engines/valuation/calculate-qoe';

function parseNum(s: unknown): number { return parseFloat(String(s ?? '0')) || 0; }

const ALL_CATEGORIES: QoECategory[] = [
  'non_recurring_income', 'non_recurring_expense', 'related_party', 'owner_compensation',
  'accounting_policy', 'restructuring', 'litigation', 'inventory', 'revenue_recognition', 'other',
];

export function QoEPage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();
  const [showTemplate, setShowTemplate] = useState<string | null>(null);

  // Load reported EBITDA from financial module
  const finEbitda = useMemo(() => {
    try {
      const fin = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financial`) || '{}');
      return parseNum(fin.ebitda || fin.ebitda2025);
    } catch { return 0; }
  }, [projectId]);

  const [reportedEbitda, setReportedEbitda] = useState(() => {
    try { const s = localStorage.getItem(`dd-p-${projectId}-qoe-input`); return s ? parseNum(JSON.parse(s).reportedEbitda) : finEbitda; } catch { return finEbitda; }
  });
  const [reportedRevenue, setReportedRevenue] = useState(() => {
    try { const s = localStorage.getItem(`dd-p-${projectId}-qoe-input`); return s ? parseNum(JSON.parse(s).reportedRevenue) : 0; } catch { return 0; }
  });

  const [adjustments, setAdjustments] = useState<QoEAdjustment[]>(() => {
    try { const s = localStorage.getItem(`dd-p-${projectId}-qoe`); return s ? JSON.parse(s) : []; } catch { return []; }
  });

  const save = () => {
    localStorage.setItem(`dd-p-${projectId}-qoe-input`, JSON.stringify({ reportedEbitda, reportedRevenue }));
    localStorage.setItem(`dd-p-${projectId}-qoe`, JSON.stringify(adjustments));
  };

  const addAdjustment = (item?: { category: QoECategory; description: string }) => {
    setAdjustments([...adjustments, {
      category: item?.category || 'other',
      description: item?.description || '',
      amount: 0,
      confidence: 'medium' as const,
    }]);
  };

  const updateAdjustment = (i: number, patch: Partial<QoEAdjustment>) => {
    const n = [...adjustments];
    n[i] = { ...n[i], ...patch };
    setAdjustments(n);
  };

  const removeAdjustment = (i: number) => {
    setAdjustments(adjustments.filter((_, j) => j !== i));
  };

  const applyTemplate = (templateLabel: string) => {
    const template = PE_QOE_TEMPLATES.find(t => t.label === templateLabel);
    if (!template) return;
    const newItems: QoEAdjustment[] = template.items.map(item => ({
      category: item.category,
      description: item.description,
      amount: 0,
      confidence: 'medium' as const,
    }));
    setAdjustments([...adjustments, ...newItems]);
    setShowTemplate(null);
  };

  const result = useMemo(() => {
    if (reportedEbitda <= 0) return null;
    try {
      return calculateQoE({ reportedEbitda, reportedRevenue, adjustments });
    } catch { return null; }
  }, [reportedEbitda, reportedRevenue, adjustments]);

  // Auto-save
  useMemo(() => { save(); }, [reportedEbitda, reportedRevenue, adjustments]);

  const fmt = (n: number) => {
    if (Math.abs(n) >= 1e8) return `${(n/1e8).toFixed(2)}亿`;
    if (Math.abs(n) >= 1e4) return `${(n/1e4).toFixed(1)}万`;
    return n.toFixed(0);
  };

  return (
    <div className="module-page">
      <h1>🔍 盈利质量分析 Quality of Earnings</h1>
      <p style={{color:'#8ba8a8',fontSize:'0.85rem',marginBottom:16}}>
        调整报告 EBITDA 中的非经常性/非经营性项目，得到可用于估值和 LBO 模型的 Normalized EBITDA。
      </p>

      {/* Base inputs */}
      <h2>基准数据</h2>
      <form className="module-form" onSubmit={e => e.preventDefault()}>
        <div className="form-grid">
          <label>报告 EBITDA(万)<input type="number" value={reportedEbitda} onChange={e => setReportedEbitda(parseNum(e.target.value))} /></label>
          <label>营业收入(万，算利润率用)<input type="number" value={reportedRevenue} onChange={e => setReportedRevenue(parseNum(e.target.value))} /></label>
          {finEbitda > 0 && reportedEbitda !== finEbitda && (
            <label style={{alignSelf:'end'}}><button className="button" type="button" onClick={() => setReportedEbitda(finEbitda)}>同步财务模块 EBITDA：{fmt(finEbitda)}</button></label>
          )}
        </div>
      </form>

      {/* Templates */}
      <h2>行业模板（快速生成调整项）</h2>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
        {PE_QOE_TEMPLATES.map(tpl => (
          <div key={tpl.label} style={{position:'relative'}}>
            <button className="button" onClick={() => setShowTemplate(showTemplate === tpl.label ? null : tpl.label)}>
              📋 {tpl.label}
            </button>
            {showTemplate === tpl.label && (
              <div style={{position:'absolute',top:'100%',left:0,zIndex:10,background:'#1a2a2a',border:'1px solid #3a5a5a',borderRadius:8,padding:12,minWidth:320,marginTop:4}}>
                <p style={{fontSize:'0.8rem',color:'#8ba8a8',marginBottom:8}}>{tpl.description}</p>
                {tpl.items.map((item, i) => (
                  <div key={i} style={{fontSize:'0.78rem',color:'#aac',marginBottom:4}}>
                    • {item.description} <span style={{color:'#6a8a8a'}}>{item.typicalAmountHint}</span>
                  </div>
                ))}
                <button className="button" style={{marginTop:8}} onClick={() => applyTemplate(tpl.label)}>应用此模板</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Adjustments table */}
      <h2>调整项</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>类别</th><th>说明</th><th>金额(万)</th><th>确定程度</th><th></th>
          </tr>
        </thead>
        <tbody>
          {adjustments.map((adj, i) => (
            <tr key={i}>
              <td>
                <select value={adj.category} onChange={e => updateAdjustment(i, { category: e.target.value as QoECategory })}>
                  {ALL_CATEGORIES.map(c => <option key={c} value={c}>{QOE_CATEGORY_LABELS[c]}</option>)}
                </select>
              </td>
              <td><input value={adj.description} onChange={e => updateAdjustment(i, { description: e.target.value })} placeholder="调整说明" /></td>
              <td><input type="number" value={adj.amount} onChange={e => updateAdjustment(i, { amount: parseNum(e.target.value) })} style={{width:100}} /></td>
              <td>
                <select value={adj.confidence} onChange={e => updateAdjustment(i, { confidence: e.target.value as QoEAdjustment['confidence'] })}>
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </td>
              <td><button className="button" onClick={() => removeAdjustment(i)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="button" style={{marginTop:8}} onClick={() => addAdjustment()}>+ 添加调整项</button>

      {/* Results */}
      {result && (
        <>
          <h2 style={{marginTop:32}}>调整结果</h2>
          <div className="results-grid">
            <div className="metric-card"><strong>{fmt(result.reportedEbitda)}</strong><span>报告 EBITDA</span></div>
            <div className="metric-card">
              <strong style={{color: result.totalAdjustments > 0 ? '#70b8b0' : '#f87171'}}>{result.totalAdjustments >= 0 ? '+' : ''}{fmt(result.totalAdjustments)}</strong>
              <span>调整合计 ({result.adjustmentPercent}%)</span>
            </div>
            <div className="metric-card" style={{border: '2px solid #70b8b0'}}>
              <strong style={{fontSize:'1.3rem'}}>{fmt(result.normalizedEbitda)}</strong>
              <span>Normalized EBITDA</span>
            </div>
            <div className="metric-card"><strong>{result.reportedMargin}%</strong><span>报告利润率</span></div>
            <div className="metric-card"><strong>{result.normalizedMargin}%</strong><span>Normalized 利润率</span></div>
            <div className="metric-card">
              <strong style={{color: result.confidenceScore >= 70 ? '#70b8b0' : result.confidenceScore >= 40 ? '#f0b870' : '#f87171'}}>
                {result.confidenceScore}/100
              </strong>
              <span>可信度评分</span>
            </div>
          </div>

          {/* Category breakdown */}
          {result.byCategory.length > 0 && (
            <>
              <h2>分类汇总</h2>
              <table className="data-table">
                <thead><tr><th>类别</th><th>项数</th><th>合计</th><th>占比</th></tr></thead>
                <tbody>
                  {result.byCategory.map(c => (
                    <tr key={c.category}>
                      <td title={QOE_CATEGORY_EXPLANATIONS[c.category]} style={{cursor:'help'}}>{c.label}</td>
                      <td>{c.count}</td>
                      <td style={{color: c.total > 0 ? '#70b8b0' : '#f87171'}}>{c.total >= 0 ? '+' : ''}{fmt(c.total)}</td>
                      <td>{Math.round(Math.abs(c.total) / Math.max(1, Math.abs(result.totalAdjustments || 1)) * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Red flags */}
          {result.redFlags.length > 0 && (
            <>
              <h2>⚠️ 警示信号</h2>
              <div style={{background:'#2a1a1a',padding:'12px 16px',borderRadius:8,border:'1px solid #5a3a3a'}}>
                {result.redFlags.map((flag, i) => (
                  <div key={i} style={{color:'#f87171',fontSize:'0.85rem',marginBottom:4}}>⚠ {flag}</div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
