import { useState, useCallback } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import {
  generateCompanySearchQueries, baiduSearchUrl, bingSearchUrl,
} from '../../infrastructure/search/search-adapter';
import { profileCompany, type CompanyProfile, type ProfileResult } from '../../engines/research/company-profiler';
import { loadResearchConfig } from '../../infrastructure/research/research-adapter';

function parseNum(s: unknown): number { return parseFloat(String(s ?? '0')) || 0; }

export function CompanySearchPage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();

  const hasAI = !!loadResearchConfig();

  // Company name from project
  const [companyName, setCompanyName] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dd-p-${projectId}-company-overview`) || '{}').name || ''; } catch { return ''; }
  });

  // State
  const [researching, setResearching] = useState(false);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [profileResult, setProfileResult] = useState<ProfileResult | null>(null);
  const [error, setError] = useState('');
  const [fillMsg, setFillMsg] = useState('');

  const handleResearch = useCallback(async () => {
    if (!companyName.trim()) return;
    setResearching(true);
    setError('');
    setProfile(null);
    setProfileResult(null);
    try {
      const pr = await profileCompany(companyName.trim());
      setProfile(pr.profile);
      setProfileResult(pr);
      if (pr.error) setError(pr.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : '研究失败');
    } finally {
      setResearching(false);
    }
  }, [companyName]);

  // Auto-fill
  const handleAutoFill = useCallback(() => {
    if (!profile || !projectId) return;
    const filled: string[] = [];
    const setIfMissing = (_key: string, obj: Record<string, unknown>, field: string, val: string, label: string) => {
      if (val && val !== 'null' && val !== 'undefined' && !obj[field]) { obj[field] = val; filled.push(label); }
    };

    // Company Overview
    {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-company-overview`) || '{}');
      setIfMissing('company', existing, 'name', profile.companyName, '公司名称');
      setIfMissing('company', existing, 'description', profile.businessDescription, '业务描述');
      setIfMissing('company', existing, 'founded', profile.founded, '成立时间');
      setIfMissing('company', existing, 'headquarters', profile.headquarters, '总部');
      setIfMissing('company', existing, 'website', profile.website, '网站');
      setIfMissing('company', existing, 'businessModel', profile.businessModel, '商业模式');
      setIfMissing('company', existing, 'employeeCount', profile.employeeCount, '员工数');
      localStorage.setItem(`dd-p-${projectId}-company-overview`, JSON.stringify(existing));
    }

    // Industry
    if (profile.industry || profile.tam || profile.marketGrowth) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-industry`) || '{}');
      setIfMissing('industry', existing, 'industryName', profile.industry, '行业');
      setIfMissing('industry', existing, 'tam', profile.tam, 'TAM');
      setIfMissing('industry', existing, 'growthRate', profile.marketGrowth, '市场增速');
      localStorage.setItem(`dd-p-${projectId}-industry`, JSON.stringify(existing));
    }

    // Financial
    {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financials`) || '{}');
      setIfMissing('fin', existing, 'revenue', String(parseNum(profile.revenue) || profile.revenue), '营收');
      setIfMissing('fin', existing, 'grossMargin', String(parseNum(profile.grossMargin) || profile.grossMargin), '毛利率');
      setIfMissing('fin', existing, 'netIncome', String(parseNum(profile.netIncome) || profile.netIncome), '净利润');
      setIfMissing('fin', existing, 'ebitda', String(parseNum(profile.ebitda) || profile.ebitda), 'EBITDA');
      localStorage.setItem(`dd-p-${projectId}-financials`, JSON.stringify(existing));
    }

    // Team
    if (profile.founders.length > 0) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-team-members`) || '[]');
      if (existing.length === 0) {
        const members = profile.founders.map(f => ({
          name: f.name, role: f.role, background: f.background || '', ownership: '', isKey: f.role.includes('CEO') || f.role.includes('创始人'),
        }));
        localStorage.setItem(`dd-p-${projectId}-team-members`, JSON.stringify(members));
        filled.push(`团队(${members.length}人)`);
      }
    }

    // Competitors
    if (profile.competitors.length > 0) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-competitors`) || '[]');
      if (existing.length === 0) {
        const comps = profile.competitors.map(c => ({
          name: c.name, stage: '', scale: '', pricing: '', share: '', funding: '', differentiation: c.description || '',
        }));
        localStorage.setItem(`dd-p-${projectId}-competitors`, JSON.stringify(comps));
        filled.push(`竞品(${comps.length}个)`);
      }
    }

    // Valuation
    if (profile.valuation || profile.totalFunding) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-valuation`) || '{}');
      setIfMissing('val', existing, 'entryValuation', String(parseNum(profile.valuation) || profile.valuation), '估值');
      localStorage.setItem(`dd-p-${projectId}-valuation`, JSON.stringify(existing));
    }

    // Financing
    if (profile.latestRound) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financing-history`) || '[]');
      if (existing.length === 0) {
        const round = {
          name: profile.latestRound, date: profile.latestRoundDate || '', amount: profile.latestRoundAmount || '',
          preMoneyVal: '', postMoneyVal: profile.valuation || '', investors: (profile.keyInvestors || []).join(', '),
        };
        localStorage.setItem(`dd-p-${projectId}-financing-history`, JSON.stringify([round]));
        filled.push('融资历史');
      }
    }

    setFillMsg(filled.length > 0 ? `✅ 已填充: ${filled.join('、')}` : '没有需要补充的字段（已有数据不会被覆盖）');
    setTimeout(() => setFillMsg(''), 5000);
  }, [profile, projectId]);

  const fmt = (n: string) => {
    if (!n) return '';
    const v = parseFloat(n);
    if (isNaN(v)) return n;
    if (v >= 10000) return `${(v / 10000).toFixed(1)}亿`;
    return `${v}万`;
  };

  return (
    <div className="module-page">
      <NavLink to={`/projects/${projectId}/analysis/company`} style={{ color: '#70b8b0', fontSize: '0.85rem', marginBottom: 12, display: 'inline-block' }}>
        ← 返回分析工作台
      </NavLink>
      <h1>🔎 公司信息搜索</h1>
      <p style={{ color: '#8ba8a8', fontSize: '0.85rem', marginBottom: 16 }}>
        基于你已配置的 AI 模型知识库自动研究公司信息。无需额外 API Key。<br />
        AI 训练数据覆盖大多数已知公司——对知名公司准确率较高，早期创业公司建议手动补充。
      </p>

      {/* AI not configured warning */}
      {!hasAI && (
        <div style={{ background: '#2a1a1a', padding: '16px', borderRadius: 8, marginBottom: 16, border: '1px solid #5a3a3a' }}>
          <strong>⚠️ 尚未配置 AI 模型</strong>
          <p style={{ fontSize: '0.85rem', color: '#f0b870', margin: '8px 0' }}>
            请先在 <NavLink to={`/projects/${projectId}/research`} style={{ color: '#70b8b0' }}>AI 研究页面</NavLink> 配置 AI 模型（DeepSeek/OpenAI/Ollama）。
          </p>
        </div>
      )}

      {/* Search bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'end' }}>
        <label style={{ flex: 1, fontSize: '0.9rem' }}>
          公司名称
          <input value={companyName} onChange={e => setCompanyName(e.target.value)}
            placeholder="输入公司全称（如：字节跳动、比亚迪、小米）" style={{ fontSize: '1.1rem', padding: '10px' }} />
        </label>
        <button className="button" onClick={handleResearch}
          disabled={researching || !companyName.trim() || !hasAI}
          style={{ background: researching ? '#3a5a5a' : '#70b8b0', color: '#0d1a1a', padding: '10px 24px', fontSize: '1rem', fontWeight: 'bold' }}>
          {researching ? 'AI 研究中...' : '🔍 AI 研究'}
        </button>
      </div>

      {/* Manual search fallback */}
      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', color: '#8ba8a8', fontSize: '0.85rem' }}>💡 AI 不知道？手动搜索引擎查（百度 / Bing）</summary>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, background: '#1a2a2a', padding: 12, borderRadius: 8 }}>
          {companyName.trim()
            ? generateCompanySearchQueries(companyName).map(q => (
              <div key={q.label} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
                <span style={{ color: '#8ba8a8', minWidth: 80 }}>{q.label}</span>
                <a href={q.engine === 'baidu' ? baiduSearchUrl(q.query) : bingSearchUrl(q.query)}
                  target="_blank" rel="noopener" style={{ color: '#70b8b0', flex: 1 }}>
                  🔗 {q.engine === 'baidu' ? '百度' : 'Bing'}: {q.query}
                </a>
              </div>
            ))
            : <p style={{ color: '#8ba8a8', fontSize: '0.85rem' }}>请先输入公司名称</p>
          }
        </div>
      </details>

      {error && (
        <div style={{ background: '#2a1a1a', padding: '12px 16px', borderRadius: 8, marginBottom: 16, color: '#f87171', fontSize: '0.85rem' }}>
          ⚠️ {error}
        </div>
      )}

      {/* Profile Result */}
      {profile && (
        <div style={{ background: '#1a2a2a', padding: 20, borderRadius: 8, marginBottom: 16, border: '1px solid #3a5a5a' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>
              📋 {profile.companyName}
              <span style={{ marginLeft: 12, fontSize: '0.8rem', color: profileResult?.confidence === 'high' ? '#70b8b0' : '#f0b870' }}>
                {profileResult?.confidence === 'high' ? '🟢 高可信' : profileResult?.confidence === 'medium' ? '🟡 中可信' : '🔴 低可信'}
              </span>
              <span style={{ marginLeft: 8, fontSize: '0.8rem', color: '#8ba8a8' }}>
                ({profileResult?.filledFields.length} 字段)
              </span>
            </h2>
            <button className="button" onClick={handleAutoFill}
              style={{ background: '#70b8b0', color: '#0d1a1a', padding: '8px 20px', fontWeight: 'bold' }}>
              📥 一键填充到分析
            </button>
          </div>

          {fillMsg && (
            <div style={{ background: '#1a3a1a', padding: '8px 12px', borderRadius: 4, marginBottom: 12, color: '#70b8b0', fontSize: '0.85rem' }}>
              {fillMsg}
            </div>
          )}

          {/* Data grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10 }}>
            <FC label="公司名称" v={profile.companyName} />
            <FC label="成立时间" v={profile.founded} />
            <FC label="总部" v={profile.headquarters} />
            <FC label="网站" v={profile.website} isUrl />
            <FC label="商业模式" v={profile.businessModel} />
            <FC label="员工数" v={profile.employeeCount} />
            <FC label="行业" v={profile.industry} />
            <FC label="营收" v={fmt(profile.revenue) || profile.revenue} />
            <FC label="营收增速" v={profile.revenueGrowth ? `${profile.revenueGrowth}%` : ''} />
            <FC label="毛利率" v={profile.grossMargin ? `${profile.grossMargin}%` : ''} />
            <FC label="净利润" v={fmt(profile.netIncome) || profile.netIncome} />
            <FC label="EBITDA" v={fmt(profile.ebitda) || profile.ebitda} />
            <FC label="TAM" v={fmt(profile.tam) || profile.tam} />
            <FC label="市场增速" v={profile.marketGrowth ? `${profile.marketGrowth}%` : ''} />
            <FC label="估值" v={fmt(profile.valuation) || profile.valuation} />
            <FC label="累计融资" v={fmt(profile.totalFunding) || profile.totalFunding} />
            <FC label="最新轮次" v={[profile.latestRound, profile.latestRoundAmount, profile.latestRoundDate].filter(Boolean).join(' ')} />
          </div>

          {profile.founders.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3>👤 核心团队</h3>
              {profile.founders.map((f, i) => (
                <div key={i} style={{ fontSize: '0.85rem', marginBottom: 4 }}>
                  <strong>{f.name}</strong> — {f.role}{f.background ? `（${f.background}）` : ''}
                </div>
              ))}
            </div>
          )}

          {profile.competitors.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3>🏢 竞品</h3>
              {profile.competitors.map((c, i) => (
                <div key={i} style={{ fontSize: '0.85rem', marginBottom: 2 }}>
                  <strong>{c.name}</strong>{c.description ? ` — ${c.description}` : ''}
                </div>
              ))}
            </div>
          )}

          {profile.mainProducts.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3>📦 主要产品</h3>
              {profile.mainProducts.map((p, i) => (
                <div key={i} style={{ fontSize: '0.85rem', marginBottom: 2 }}>
                  <strong>{p.name}</strong>{p.description ? ` — ${p.description}` : ''}
                </div>
              ))}
            </div>
          )}

          <p style={{ marginTop: 16, fontSize: '0.7rem', color: '#5a7a7a' }}>
            ⚠️ 信息来自 AI 模型训练数据，可能不是最新。关键数据请以官方披露为准。
          </p>
        </div>
      )}
    </div>
  );
}

function FC({ label, v, isUrl }: { label: string; v: string; isUrl?: boolean }) {
  if (!v || v === 'null' || v === 'undefined') return null;
  return (
    <div style={{ background: '#0d1a1a', padding: '8px 12px', borderRadius: 6, fontSize: '0.85rem' }}>
      <div style={{ color: '#5a7a7a', fontSize: '0.7rem', marginBottom: 2 }}>{label}</div>
      <div style={{ wordBreak: 'break-all' }}>
        {isUrl ? (
          <a href={v.startsWith('http') ? v : `https://${v}`} target="_blank" rel="noopener" style={{ color: '#70b8b0' }}>{v}</a>
        ) : v}
      </div>
    </div>
  );
}
