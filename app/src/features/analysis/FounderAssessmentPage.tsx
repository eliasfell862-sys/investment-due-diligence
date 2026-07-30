import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  assessTeam, FOUNDER_DIMENSION_LABELS, FOUNDER_DIMENSION_PROMPTS,
  type FounderInput, type FounderScore, type FounderDimension,
} from '../../engines/team/founder-assessment';

const ALL_DIMENSIONS: FounderDimension[] = [
  'industry_experience', 'execution_track', 'leadership',
  'integrity', 'domain_expertise', 'resilience',
];

function defaultScores(): FounderScore[] {
  return ALL_DIMENSIONS.map(d => ({ dimension: d, score: 5, evidence: '' }));
}

export function FounderAssessmentPage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();

  const [founders, setFounders] = useState<FounderInput[]>(() => {
    try { const s = localStorage.getItem(`dd-p-${projectId}-founders`); return s ? JSON.parse(s) : [{ name: '', role: 'CEO', yearsInIndustry: 5, priorExits: 0, priorCompaniesFounded: 0, education: '', scores: defaultScores() }]; }
    catch { return [{ name: '', role: 'CEO', yearsInIndustry: 5, priorExits: 0, priorCompaniesFounded: 0, education: '', scores: defaultScores() }]; }
  });

  const [teamSize, setTeamSize] = useState(() => {
    try { const s = localStorage.getItem(`dd-p-${projectId}-founders-team`); return s ? JSON.parse(s).teamSize : 5; } catch { return 5; }
  });
  const [totalKeyRoles, setTotalKeyRoles] = useState(() => {
    try { const s = localStorage.getItem(`dd-p-${projectId}-founders-team`); return s ? JSON.parse(s).totalKeyRoles : 5; } catch { return 5; }
  });
  const [equityNotes, setEquityNotes] = useState(() => {
    try { const s = localStorage.getItem(`dd-p-${projectId}-founders-team`); return s ? JSON.parse(s).equitySplitNotes : ''; } catch { return ''; }
  });

  const save = () => {
    localStorage.setItem(`dd-p-${projectId}-founders`, JSON.stringify(founders));
    localStorage.setItem(`dd-p-${projectId}-founders-team`, JSON.stringify({ teamSize, totalKeyRoles, equitySplitNotes: equityNotes }));
  };

  const updateFounder = (i: number, patch: Partial<FounderInput>) => {
    const n = [...founders];
    n[i] = { ...n[i], ...patch };
    setFounders(n);
  };

  const updateScore = (fi: number, dim: FounderDimension, patch: Partial<FounderScore>) => {
    const n = [...founders];
    const scores = [...n[fi].scores];
    const idx = scores.findIndex(s => s.dimension === dim);
    if (idx >= 0) scores[idx] = { ...scores[idx], ...patch };
    n[fi] = { ...n[fi], scores };
    setFounders(n);
  };

  const addFounder = () => {
    setFounders([...founders, { name: '', role: 'CTO', yearsInIndustry: 0, priorExits: 0, priorCompaniesFounded: 0, education: '', scores: defaultScores() }]);
  };

  const removeFounder = (i: number) => setFounders(founders.filter((_, j) => j !== i));

  const keyRolesFilled = founders.filter(f => f.name.trim() !== '').length;

  const teamResult = useMemo(() => {
    const valid = founders.filter(f => f.name.trim() !== '');
    if (valid.length === 0) return null;
    try {
      return assessTeam({ founders: valid, teamSize, keyRolesFilled, totalKeyRoles, equitySplitNotes: equityNotes });
    } catch { return null; }
  }, [founders, teamSize, keyRolesFilled, totalKeyRoles, equityNotes]);

  useMemo(() => { save(); }, [founders, teamSize, totalKeyRoles, equityNotes]);

  const scoreColor = (s: number) => s >= 8 ? '#70b8b0' : s >= 6 ? '#f0b870' : s <= 3 ? '#f87171' : '#ddd';

  return (
    <div className="module-page">
      <h1>👤 创始人评估</h1>
      <p style={{color:'#8ba8a8',fontSize:'0.85rem',marginBottom:16}}>
        从 6 个维度结构化评估创始团队——早期投资的核心是投人。每个维度 0-10 分，附具体证据。
      </p>

      {founders.map((founder, fi) => (
        <div key={fi} style={{background:'#1a2a2a',borderRadius:8,padding:16,marginBottom:16,border:'1px solid #2a4a4a'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <h3 style={{margin:0}}>创始人 {fi + 1}</h3>
            {founders.length > 1 && <button className="button" onClick={() => removeFounder(fi)}>移除</button>}
          </div>

          <div className="form-grid" style={{marginBottom:16}}>
            <label>姓名<input value={founder.name} onChange={e => updateFounder(fi, { name: e.target.value })} /></label>
            <label>角色<input value={founder.role} onChange={e => updateFounder(fi, { role: e.target.value })} /></label>
            <label>行业年限<input type="number" value={founder.yearsInIndustry} onChange={e => updateFounder(fi, { yearsInIndustry: parseInt(e.target.value) || 0 })} /></label>
            <label>成功退出数<input type="number" value={founder.priorExits} onChange={e => updateFounder(fi, { priorExits: parseInt(e.target.value) || 0 })} /></label>
            <label>曾创立公司数<input type="number" value={founder.priorCompaniesFounded} onChange={e => updateFounder(fi, { priorCompaniesFounded: parseInt(e.target.value) || 0 })} /></label>
            <label>教育背景<input value={founder.education} onChange={e => updateFounder(fi, { education: e.target.value })} placeholder="如：清华 CS 本科" /></label>
          </div>

          <h4 style={{marginBottom:8}}>维度评分</h4>
          {ALL_DIMENSIONS.map(dim => {
            const score = founder.scores.find(s => s.dimension === dim);
            return (
              <div key={dim} style={{display:'flex',alignItems:'center',gap:12,marginBottom:8}}>
                <span style={{width:120,fontSize:'0.85rem',flexShrink:0}} title={FOUNDER_DIMENSION_PROMPTS[dim]}>{FOUNDER_DIMENSION_LABELS[dim]}</span>
                <input type="range" min="0" max="10" value={score?.score ?? 5}
                  onChange={e => updateScore(fi, dim, { score: parseInt(e.target.value) })}
                  style={{flex:1,accentColor:scoreColor(score?.score ?? 5)}} />
                <strong style={{width:24,textAlign:'center',color:scoreColor(score?.score ?? 5),fontSize:'0.9rem'}}>{score?.score ?? 5}</strong>
                <input
                  value={score?.evidence ?? ''}
                  onChange={e => updateScore(fi, dim, { evidence: e.target.value })}
                  placeholder="具体证据..."
                  style={{flex:2,fontSize:'0.8rem',background:'#0d1a1a',border:'1px solid #2a4a4a',color:'#aaa',padding:'4px 8px',borderRadius:4}}
                />
              </div>
            );
          })}
        </div>
      ))}

      <button className="button" onClick={addFounder} style={{marginBottom:24}}>+ 添加联合创始人</button>

      {/* Team meta */}
      <h2>团队配置</h2>
      <div className="form-grid">
        <label>团队总人数<input type="number" value={teamSize} onChange={e => setTeamSize(parseInt(e.target.value) || 0)} /></label>
        <label>已到位关键岗位<input type="number" value={keyRolesFilled} readOnly style={{opacity:0.6}} /></label>
        <label>关键岗位总数<input type="number" value={totalKeyRoles} onChange={e => setTotalKeyRoles(parseInt(e.target.value) || 0)} /></label>
        <label>股权分配说明<input value={equityNotes} onChange={e => setEquityNotes(e.target.value)} placeholder="如：CEO 60%, CTO 40%" /></label>
      </div>

      {/* Results */}
      {teamResult && (
        <>
          <h2 style={{marginTop:32}}>评估结果</h2>
          <div className="results-grid">
            <div className="metric-card">
              <strong style={{fontSize:'1.3rem',color: teamResult.averageFounderScore >= 70 ? '#70b8b0' : teamResult.averageFounderScore >= 50 ? '#f0b870' : '#f87171'}}>
                {teamResult.averageFounderScore}/100
              </strong>
              <span>创始人综合评分</span>
            </div>
            <div className="metric-card">
              <strong style={{fontSize:'1.3rem'}}>{teamResult.overallLabel}</strong>
              <span>团队等级</span>
            </div>
            <div className="metric-card">
              <strong style={{color: teamResult.teamCompleteness >= 70 ? '#70b8b0' : '#f0b870'}}>{teamResult.teamCompleteness}%</strong>
              <span>团队完备度</span>
            </div>
          </div>

          {/* Per-founder results */}
          {teamResult.founderResults.map((fr, i) => (
            <div key={i} style={{background:'#1a2a2a',padding:'12px 16px',borderRadius:8,marginBottom:8}}>
              <h4 style={{margin:'0 0 8px'}}>
                {founders[i]?.name || `创始人 ${i+1}`}
                <span style={{marginLeft:8,fontSize:'0.85rem',color: fr.normalizedScore >= 70 ? '#70b8b0' : fr.normalizedScore >= 50 ? '#f0b870' : '#f87171'}}>
                  {fr.normalizedScore}/100 — {fr.tierLabel}
                </span>
              </h4>
              {fr.strengths.length > 0 && (
                <div style={{fontSize:'0.8rem',color:'#70b8b0'}}>
                  ✅ {fr.strengths.slice(0, 3).join(' · ')}
                </div>
              )}
              {fr.concerns.length > 0 && (
                <div style={{fontSize:'0.8rem',color:'#f0b870',marginTop:4}}>
                  ⚡ {fr.concerns.slice(0, 3).join(' · ')}
                </div>
              )}
            </div>
          ))}

          {/* Red flags */}
          {teamResult.teamRedFlags.length > 0 && (
            <div style={{background:'#2a1a1a',padding:'12px 16px',borderRadius:8,border:'1px solid #5a3a3a',marginTop:12}}>
              {teamResult.teamRedFlags.map((f, i) => (
                <div key={i} style={{color:'#f87171',fontSize:'0.85rem',marginBottom:4}}>{f}</div>
              ))}
            </div>
          )}

          {/* Recommendation */}
          <div style={{background:'#1a2a2a',padding:'16px',borderRadius:8,marginTop:16,border:'1px solid #2a4a4a'}}>
            <strong>投资建议：</strong>
            <p style={{color:'#ddd',marginTop:8,lineHeight:1.6}}>{teamResult.recommendation}</p>
          </div>
        </>
      )}
    </div>
  );
}
