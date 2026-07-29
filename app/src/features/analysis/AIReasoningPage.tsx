import { useState } from 'react';
import { runAIReasoning } from '../../infrastructure/research/ai-reasoning';
import type { AIReasoningResult } from '../../infrastructure/research/ai-reasoning';
import { loadResearchConfig } from '../../infrastructure/research/research-adapter';

export function AIReasoningPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AIReasoningResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = loadResearchConfig();

  const run = async () => {
    setLoading(true); setError(null);
    try {
      const r = await runAIReasoning();
      if (r.error) { setError(r.error); return; }
      if (r.result) setResult(r.result);
    } catch (err) { setError(err instanceof Error ? err.message : '推理失败'); }
    finally { setLoading(false); }
  };

  return (<div className="module-page" style={{maxWidth:960}}>
    <h1>AI 综合分析</h1>
    <p style={{color:'var(--ink-500)',marginBottom:20}}>AI 将读取所有模块数据（公司、团队、行业、竞品、产品、财务、销售、采购、融资、风险等），综合推理产出投资判断。</p>

    {!config && <div className="loss-info">请先在「AI 研究」页面配置 AI 模型。</div>}
    {config && (
      <button className="button button-primary" onClick={run} disabled={loading} style={{marginBottom:24,fontSize:'1.1rem',padding:'14px 32px'}}>
        {loading ? 'AI 分析中…（可能需要30秒-2分钟）' : '🤖 启动 AI 综合分析'}
      </button>
    )}
    {error && <div className="loss-info" style={{marginBottom:20}}>{error}</div>}

    {result && (<div style={{background:'#fff',border:'1px solid var(--line)',padding:'32px 40px'}}>
      {/* Header */}
      <div style={{display:'flex',gap:20,marginBottom:28,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:180,background:'#e8f3f4',padding:'20px',borderRadius:6}}>
          <strong style={{fontSize:'1.6rem',color:'#16766f',display:'block'}}>{result.recommendation}</strong>
          <span style={{fontSize:'0.8rem',color:'var(--ink-500)'}}>投资建议</span>
        </div>
        <div style={{flex:1,minWidth:120,background:result.riskLevel==='低'?'#dff3e6':result.riskLevel==='高'?'#ffe0df':'#fff0c2',padding:'20px',borderRadius:6}}>
          <strong style={{fontSize:'1.6rem',display:'block'}}>{result.riskLevel}</strong>
          <span style={{fontSize:'0.8rem',color:'var(--ink-500)'}}>综合风险</span>
        </div>
        <div style={{flex:1,minWidth:120,background:result.convictionLevel==='高'?'#dff3e6':result.convictionLevel==='低'?'#ffe0df':'#fff0c2',padding:'20px',borderRadius:6}}>
          <strong style={{fontSize:'1.6rem',display:'block'}}>{result.convictionLevel}</strong>
          <span style={{fontSize:'0.8rem',color:'var(--ink-500)'}}>信心水平</span>
        </div>
      </div>

      {/* Investment Thesis */}
      <section style={{marginBottom:24}}><h3 style={{color:'#123a52',borderBottom:'2px solid #16766f',paddingBottom:8}}>投资逻辑</h3>
        <p style={{lineHeight:1.9,fontSize:'1.05rem'}}>{result.investmentThesis}</p>
      </section>

      {/* Highlights */}
      {result.keyHighlights.length > 0 && (<section style={{marginBottom:24}}><h3 style={{color:'#123a52',borderBottom:'2px solid #16766f',paddingBottom:8}}>核心亮点</h3>
        <ul style={{lineHeight:2}}>{result.keyHighlights.map((h,i)=><li key={i} style={{color:'#16766f'}}>{h}</li>)}</ul>
      </section>)}

      {/* Risks + Mitigations */}
      {result.keyRisks.length > 0 && (<section style={{marginBottom:24}}><h3 style={{color:'#123a52',borderBottom:'2px solid #16766f',paddingBottom:8}}>关键风险及应对</h3>
        <table className="data-table"><thead><tr><th>风险</th><th>建议应对措施</th></tr></thead>
          <tbody>{result.keyRisks.map((r,i)=><tr key={i}><td style={{color:'#9c3f36'}}>{r.risk}</td><td>{r.mitigation}</td></tr>)}</tbody></table>
      </section>)}

      {/* Detail sections */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:16,marginBottom:24}}>
        {[{t:'竞争地位',v:result.competitivePosition},{t:'估值判断',v:result.valuationOpinion},{t:'增长前景',v:result.growthOutlook},{t:'团队评估',v:result.teamAssessment},{t:'商业模式',v:result.businessModelQuality}].filter(d=>d.v).map(d=>(
          <div key={d.t} style={{background:'#f7f8fa',padding:16,borderRadius:4}}>
            <strong style={{color:'#123a52',display:'block',marginBottom:6}}>{d.t}</strong>
            <p style={{margin:0,fontSize:'0.9rem',lineHeight:1.7}}>{d.v}</p>
          </div>
        ))}
      </div>

      {/* Conditions */}
      {result.keyConditions.length > 0 && (<section style={{marginBottom:24}}><h3 style={{color:'#123a52',borderBottom:'2px solid #16766f',paddingBottom:8}}>投资先决条件</h3>
        <ol>{result.keyConditions.map((c,i)=><li key={i} style={{lineHeight:2}}>{c}</li>)}</ol>
      </section>)}

      <p style={{color:'var(--ink-500)',fontSize:'0.75rem',borderTop:'1px solid var(--line)',paddingTop:16}}>
        ⚠️ AI 分析结果仅供参考，不构成投资建议。最终投资决策需由投资委员会结合人工尽调独立判断。
      </p>
    </div>)}
  </div>);
}
