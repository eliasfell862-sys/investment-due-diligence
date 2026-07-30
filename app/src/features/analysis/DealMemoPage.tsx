import { useState, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';

function parseStr(key: string, projectId: string, field: string, fallback = ''): string {
  try { const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-${key}`) || '{}'); return String(d[field] || d || ''); } catch { return fallback; }
}

function parseList(key: string, projectId: string): any[] {
  try { return JSON.parse(localStorage.getItem(`dd-p-${projectId}-${key}`) || '[]'); } catch { return []; }
}

export function DealMemoPage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();
  const memoRef = useRef<HTMLDivElement>(null);

  // Auto-populate from project data
  const data = useMemo(() => {
    const company = JSON.parse(localStorage.getItem(`dd-p-${projectId}-company-overview`) || '{}');
    const industry = JSON.parse(localStorage.getItem(`dd-p-${projectId}-industry`) || '{}');
    const team = parseList('team-members', projectId);
    const comps = parseList('competitors', projectId);
    const valuation = JSON.parse(localStorage.getItem(`dd-p-${projectId}-valuation`) || '{}');
    const exit = JSON.parse(localStorage.getItem(`dd-p-${projectId}-exit`) || '{}');
    const decision = JSON.parse(localStorage.getItem(`dd-p-${projectId}-decision`) || '{}');
    const bearCase = localStorage.getItem(`dd-p-${projectId}-bearcase`) || '';
    const assumptions = (localStorage.getItem(`dd-p-${projectId}-assumptions`) || '').split('\n').filter(Boolean);
    const riskItems = parseList('risk-items', projectId);
    const highlights = parseList('investment-highlights', projectId);

    return {
      companyName: company.name || company.companyName || '未命名项目',
      founded: company.founded || '',
      hq: company.headquarters || company.hq || '',
      businessModel: company.businessModel || '',
      description: company.description || '',
      revenue: parseStr('financial', projectId, 'revenue') || parseStr('financial', projectId, 'revenue2025'),
      ebitda: parseStr('financial', projectId, 'ebitda') || parseStr('financial', projectId, 'ebitda2025'),
      grossMargin: parseStr('financial', projectId, 'grossMargin'),
      growthRate: industry.growthRate || '',
      tam: industry.tam || '',
      team: team.map((t: any) => `${t.name}（${t.role}）`).join('、'),
      competitors: comps.slice(0, 5).map((c: any) => c.name).join('、'),
      entryValuation: valuation.entryValuation || '',
      targetIrr: exit.targetIrr || valuation.targetIrr || '',
      moic: exit.moic || exit.targetMoic || '',
      strategy: decision.strategy || '',
      tier: decision.tier || '',
      bearCase,
      assumptions,
      riskItems: riskItems.slice(0, 5),
      highlights: highlights.slice(0, 5),
    };
  }, [projectId]);

  const [customThesis, setCustomThesis] = useState('');
  const [customHighlights, setCustomHighlights] = useState('');
  const [customRisks, setCustomRisks] = useState('');
  const [customAsk, setCustomAsk] = useState('');

  const highlights = customHighlights
    ? customHighlights.split('\n').filter(Boolean)
    : data.highlights.length > 0
      ? data.highlights.map((h: any) => typeof h === 'string' ? h : h.text || h.title || '')
      : [
          `市场规模：TAM ${data.tam ? (parseFloat(data.tam) >= 10000 ? `${(parseFloat(data.tam)/10000).toFixed(0)}亿` : `${data.tam}万`) : '待填'}`,
          `团队：${data.team || '待填'}`,
          `收入增速 ${data.growthRate || data.revenue ? `${data.growthRate || '-'}%` : '待填'}`,
        ];

  const risks = customRisks
    ? customRisks.split('\n').filter(Boolean)
    : data.riskItems.length > 0
      ? data.riskItems.map((r: any) => r.title || r.description || '').filter(Boolean).slice(0, 3)
      : ['关键人员流失风险', '市场竞争加剧', '监管政策不确定性'];

  const thesis = customThesis || `${data.companyName} 在 ${data.description ? data.description.slice(0, 30) + '...' : '（待补充描述）'} 领域 ${data.revenue ? `已实现 ${parseFloat(data.revenue) >= 10000 ? `${(parseFloat(data.revenue)/10000).toFixed(1)}亿` : `${data.revenue}万`} 收入` : ''}，${data.tam ? `面对 ${parseFloat(data.tam) >= 10000 ? `${(parseFloat(data.tam)/10000).toFixed(0)}亿` : `${data.tam}万`} 市场` : ''}`;

  const handleCopy = () => {
    const text = [
      `【投资备忘录】${data.companyName}`,
      '',
      `一句话投资逻辑：${thesis}`,
      '',
      `亮点：`,
      ...highlights.map((h: string, i: number) => `${i+1}. ${h}`),
      '',
      `风险：`,
      ...risks.map((r: string, i: number) => `${i+1}. ${r}`),
      '',
      `核心数据：`,
      `  收入：${data.revenue || '-'} 万`,
      `  EBITDA：${data.ebitda || '-'} 万`,
      `  毛利率：${data.grossMargin || '-'}%`,
      `  增速：${data.growthRate || '-'}%`,
      `  TAM：${data.tam || '-'} 万`,
      `  进入估值：${data.entryValuation || '-'} 万`,
      `  目标 IRR：${data.targetIrr || '-'}% / MOIC：${data.moic || '-'}x`,
      data.founded ? `  成立时间：${data.founded}` : '',
      data.hq ? `  总部：${data.hq}` : '',
      '',
      data.assumptions.length > 0 ? `关键假设：\n${data.assumptions.map((a: string) => `  - ${a}`).join('\n')}` : '',
      data.bearCase ? `\n反面逻辑：\n  ${data.bearCase}` : '',
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(text).then(() => alert('已复制到剪贴板')).catch(() => alert('复制失败'));
  };

  return (
    <div className="module-page">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h1>📋 一页 Deal Memo</h1>
        <button className="button" onClick={handleCopy} style={{background:'#70b8b0',color:'#0d1a1a'}}>📋 复制全文</button>
      </div>
      <p style={{color:'#8ba8a8',fontSize:'0.85rem',marginBottom:16}}>
        天使轮/种子轮专用的一页投资备忘录。自动从项目数据填充，也可手动编辑。
      </p>

      <div ref={memoRef} style={{background:'#fff',color:'#1a1a1a',padding:'32px 40px',borderRadius:8,maxWidth:700,fontFamily:'SimSun, serif',lineHeight:1.8,boxShadow:'0 4px 24px rgba(0,0,0,0.3)'}}>
        {/* Header */}
        <div style={{borderBottom:'3px solid #1a1a1a',paddingBottom:16,marginBottom:20}}>
          <h2 style={{margin:0,fontSize:'1.4rem',fontWeight:'bold'}}>投资备忘录 — {data.companyName}</h2>
          <p style={{color:'#666',margin:'4px 0 0',fontSize:'0.85rem'}}>
            {data.founded ? `成立 ${data.founded} · ` : ''}
            {data.hq ? `${data.hq} · ` : ''}
            {data.businessModel ? `${data.businessModel} · ` : ''}
            {new Date().toISOString().slice(0, 10)}
          </p>
        </div>

        {/* Thesis */}
        <div style={{marginBottom:20}}>
          <h3 style={{fontSize:'0.95rem',margin:'0 0 6px',color:'#333'}}>一句话投资逻辑</h3>
          <textarea
            value={customThesis}
            onChange={e => setCustomThesis(e.target.value)}
            placeholder={thesis}
            rows={2}
            style={{width:'100%',border:'none',background:'#f5f5f5',padding:8,fontSize:'0.9rem',fontFamily:'SimSun, serif',lineHeight:1.6,resize:'vertical'}}
          />
        </div>

        {/* Highlights */}
        <div style={{marginBottom:20}}>
          <h3 style={{fontSize:'0.95rem',margin:'0 0 6px',color:'#1a6b1a'}}>投资亮点</h3>
          <textarea
            value={customHighlights}
            onChange={e => setCustomHighlights(e.target.value)}
            placeholder={highlights.map((h: string, i: number) => `${i+1}. ${h}`).join('\n')}
            rows={4}
            style={{width:'100%',border:'none',background:'#f5f5f5',padding:8,fontSize:'0.85rem',fontFamily:'SimSun, serif',lineHeight:1.6,resize:'vertical'}}
          />
        </div>

        {/* Risks */}
        <div style={{marginBottom:20}}>
          <h3 style={{fontSize:'0.95rem',margin:'0 0 6px',color:'#8b1a1a'}}>主要风险</h3>
          <textarea
            value={customRisks}
            onChange={e => setCustomRisks(e.target.value)}
            placeholder={risks.map((r: string, i: number) => `${i+1}. ${r}`).join('\n')}
            rows={4}
            style={{width:'100%',border:'none',background:'#f5f5f5',padding:8,fontSize:'0.85rem',fontFamily:'SimSun, serif',lineHeight:1.6,resize:'vertical'}}
          />
        </div>

        {/* Key Metrics */}
        <div style={{marginBottom:20}}>
          <h3 style={{fontSize:'0.95rem',margin:'0 0 6px',color:'#333'}}>核心数据</h3>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.8rem'}}>
            <tbody>
              {[
                ['收入(万)', data.revenue], ['EBITDA(万)', data.ebitda],
                ['毛利率', data.grossMargin ? `${data.grossMargin}%` : ''],
                ['增速', data.growthRate ? `${data.growthRate}%` : ''],
                ['TAM(万)', data.tam],
                ['进入估值(万)', data.entryValuation],
                ['目标 IRR', data.targetIrr ? `${data.targetIrr}%` : ''], ['目标 MOIC', data.moic ? `${data.moic}x` : ''],
              ].filter(([, v]) => v).map(([label, value]) => (
                <tr key={label as string} style={{borderBottom:'1px solid #eee'}}>
                  <td style={{padding:'4px 8px',color:'#666',width:'40%'}}>{label}</td>
                  <td style={{padding:'4px 8px',fontWeight:'bold'}}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Assumptions / Bear Case */}
        {data.assumptions.length > 0 && (
          <div style={{marginBottom:20}}>
            <h3 style={{fontSize:'0.95rem',margin:'0 0 6px',color:'#333'}}>关键假设</h3>
            <ul style={{margin:0,paddingLeft:20,fontSize:'0.8rem'}}>
              {data.assumptions.map((a: string, i: number) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        )}

        {data.bearCase && (
          <div style={{marginBottom:20}}>
            <h3 style={{fontSize:'0.95rem',margin:'0 0 6px',color:'#8b1a1a'}}>反面逻辑</h3>
            <p style={{fontSize:'0.8rem',color:'#666'}}>{data.bearCase}</p>
          </div>
        )}

        {/* Ask */}
        <div style={{borderTop:'1px solid #ddd',paddingTop:16}}>
          <h3 style={{fontSize:'0.95rem',margin:'0 0 6px',color:'#333'}}>融资需求 / Ask</h3>
          <textarea
            value={customAsk}
            onChange={e => setCustomAsk(e.target.value)}
            placeholder="本轮融资额、估值、用途..."
            rows={2}
            style={{width:'100%',border:'none',background:'#f5f5f5',padding:8,fontSize:'0.85rem',fontFamily:'SimSun, serif',lineHeight:1.6,resize:'vertical'}}
          />
        </div>
      </div>
    </div>
  );
}
