import { useState, useCallback } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import {
  searchCompany, loadSearchConfig, saveSearchConfig,
  generateCompanySearchQueries, searchUrl,
  SEARCH_PROVIDER_PRESETS, type SearchConfig, type SearchProvider, type SearchResult,
} from '../../infrastructure/search/search-adapter';
import { profileCompanyFromSearch, type CompanyProfile, type ProfileResult } from '../../engines/research/company-profiler';

function parseNum(s: unknown): number { return parseFloat(String(s ?? '0')) || 0; }

export function CompanySearchPage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();

  // Search config
  const [searchConfig, setSearchConfig] = useState<SearchConfig | null>(() => loadSearchConfig());
  const [configOpen, setConfigOpen] = useState(!searchConfig);
  const [provider, setProvider] = useState<SearchProvider>(searchConfig?.provider || 'bing');
  const [apiKey, setApiKey] = useState(searchConfig?.apiKey || '');

  const saveConfig = () => {
    const cfg: SearchConfig = { provider, apiKey };
    saveSearchConfig(cfg);
    setSearchConfig(cfg);
    setConfigOpen(false);
  };

  // Search state
  const [companyName, setCompanyName] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dd-p-${projectId}-company-overview`) || '{}').name || ''; } catch { return ''; }
  });
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [profileResult, setProfileResult] = useState<ProfileResult | null>(null);
  const [error, setError] = useState('');
  const [fillMsg, setFillMsg] = useState('');

  // Manual search queries
  const [manualQuery, setManualQuery] = useState('');

  const handleSearch = useCallback(async () => {
    if (!companyName.trim() || !searchConfig) return;
    setSearching(true);
    setError('');
    setProfile(null);
    setProfileResult(null);
    try {
      const resp = await searchCompany(companyName.trim(), searchConfig);
      setResults([...resp.results]);

      if (resp.results.length > 0) {
        const pr = await profileCompanyFromSearch(companyName.trim(), resp.results);
        setProfile(pr.profile);
        setProfileResult(pr);
        if (pr.error) setError(pr.error);
      } else {
        setError('未找到相关搜索结果。请尝试其他搜索词。');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '搜索失败');
    } finally {
      setSearching(false);
    }
  }, [companyName, searchConfig]);

  // Auto-fill into analysis modules
  const handleAutoFill = useCallback(() => {
    if (!profile || !projectId) return;

    const filled: string[] = [];

    // Company Overview
    if (profile.companyName || profile.businessDescription || profile.founded || profile.headquarters || profile.website) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-company-overview`) || '{}');
      const merged = { ...existing };
      if (profile.companyName && !existing.name) { merged.name = profile.companyName; filled.push('公司名称'); }
      if (profile.businessDescription && !existing.description) { merged.description = profile.businessDescription; filled.push('业务描述'); }
      if (profile.founded && !existing.founded) { merged.founded = profile.founded; filled.push('成立时间'); }
      if (profile.headquarters && !existing.headquarters) { merged.headquarters = profile.headquarters; filled.push('总部'); }
      if (profile.website && !existing.website) { merged.website = profile.website; filled.push('网站'); }
      if (profile.businessModel && !existing.businessModel) { merged.businessModel = profile.businessModel; filled.push('商业模式'); }
      if (profile.employeeCount && !existing.employeeCount) { merged.employeeCount = profile.employeeCount; filled.push('员工数'); }
      localStorage.setItem(`dd-p-${projectId}-company-overview`, JSON.stringify(merged));
    }

    // Industry & Market
    if (profile.industry || profile.tam || profile.marketGrowth) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-industry`) || '{}');
      const merged = { ...existing };
      if (profile.industry && !existing.industryName) { merged.industryName = profile.industry; filled.push('行业'); }
      if (profile.tam && !existing.tam) { merged.tam = profile.tam; filled.push('TAM'); }
      if (profile.marketGrowth && !existing.growthRate) { merged.growthRate = profile.marketGrowth; filled.push('市场增速'); }
      localStorage.setItem(`dd-p-${projectId}-industry`, JSON.stringify(merged));
    }

    // Financial
    if (profile.revenue || profile.grossMargin || profile.revenueGrowth) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financials`) || '{}');
      const merged = { ...existing };
      if (profile.revenue && !existing.revenue) { merged.revenue = String(parseNum(profile.revenue)); filled.push('营收'); }
      if (profile.grossMargin && !existing.grossMargin) { merged.grossMargin = String(parseNum(profile.grossMargin)); filled.push('毛利率'); }
      if (profile.netIncome && !existing.netIncome) { merged.netIncome = String(parseNum(profile.netIncome)); filled.push('净利润'); }
      if (profile.ebitda && !existing.ebitda) { merged.ebitda = String(parseNum(profile.ebitda)); filled.push('EBITDA'); }
      localStorage.setItem(`dd-p-${projectId}-financials`, JSON.stringify(merged));
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
      const merged = { ...existing };
      if (profile.valuation && !existing.entryValuation) { merged.entryValuation = String(parseNum(profile.valuation)); filled.push('估值'); }
      localStorage.setItem(`dd-p-${projectId}-valuation`, JSON.stringify(merged));
    }

    // Financing History
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

    setFillMsg(filled.length > 0 ? `已填充: ${filled.join('、')}` : '没有需要补充的字段（已有数据不会被覆盖）');
    setTimeout(() => setFillMsg(''), 5000);
  }, [profile, projectId]);

  const fmt = (n: string) => n ? (parseFloat(n) >= 10000 ? `${(parseFloat(n)/10000).toFixed(1)}亿` : `${n}万`) : '';

  return (
    <div className="module-page">
      <NavLink to={`/projects/${projectId}/analysis/company`} style={{color:'#70b8b0',fontSize:'0.85rem',marginBottom:12,display:'inline-block'}}>← 返回分析工作台</NavLink>
      <h1>🔎 公司信息搜索</h1>
      <p style={{color:'#8ba8a8',fontSize:'0.85rem',marginBottom:16}}>
        输入公司名，自动搜索网络信息并用 AI 提取关键字段，一键补全到分析模块。
      </p>

      {/* Config */}
      {!searchConfig && (
        <div style={{background:'#2a1a1a',padding:'16px',borderRadius:8,marginBottom:16,border:'1px solid #5a3a3a'}}>
          <strong>⚠️ 需要配置搜索服务</strong>
          <p style={{fontSize:'0.85rem',color:'#f0b870',margin:'8px 0'}}>
            推荐用 <strong>Bing Web Search API</strong>（微软官方，中文搜索效果好，免费试用）：
            去 <a href="https://portal.azure.com/#create/Microsoft.BingSearch" target="_blank" rel="noopener" style={{color:'#70b8b0'}}>Azure 门户</a> 创建 Bing Search 资源获取 API Key
          </p>
        </div>
      )}

      <details open={configOpen} style={{marginBottom:16}}>
        <summary style={{cursor:'pointer',color:'#8ba8a8',fontSize:'0.9rem'}}>⚙️ 搜索配置</summary>
        <div style={{marginTop:8,display:'flex',gap:12,alignItems:'end',flexWrap:'wrap'}}>
          <label style={{fontSize:'0.85rem'}}>提供商
            <select value={provider} onChange={e => setProvider(e.target.value as SearchProvider)}>
              {Object.entries(SEARCH_PROVIDER_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label style={{fontSize:'0.85rem'}}>API Key
            <input value={apiKey} onChange={e => setApiKey(e.target.value)} type="password" placeholder="tvly-..." style={{width:280}} />
          </label>
          <button className="button" onClick={saveConfig} style={{background:'#70b8b0',color:'#0d1a1a'}}>保存配置</button>
        </div>
      </details>

      {/* Search bar */}
      <div style={{display:'flex',gap:8,marginBottom:16,alignItems:'end'}}>
        <label style={{flex:1,fontSize:'0.9rem'}}>
          公司名称
          <input value={companyName} onChange={e => setCompanyName(e.target.value)}
            placeholder="输入公司全称..." style={{fontSize:'1.1rem',padding:'10px'}} />
        </label>
        <button className="button" onClick={handleSearch} disabled={searching || !companyName.trim() || !searchConfig}
          style={{background:searching?'#3a5a5a':'#70b8b0',color:'#0d1a1a',padding:'10px 24px',fontSize:'1rem',fontWeight:'bold'}}>
          {searching ? '搜索中...' : '🔍 搜索'}
        </button>
      </div>

      {/* Manual fallback */}
      {!searchConfig && (
        <div style={{marginBottom:16,background:'#1a2a2a',padding:'12px 16px',borderRadius:8}}>
          <p style={{fontSize:'0.85rem',color:'#8ba8a8',marginBottom:8}}>💡 或直接打开搜索链接（手动复制信息到 AI 提取）：</p>
          {companyName.trim() ? (
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {generateCompanySearchQueries(companyName).map(q => (
                <a key={q.label} href={searchUrl(q.query)} target="_blank" rel="noopener"
                  style={{color:'#70b8b0',fontSize:'0.85rem'}}>
                  🔗 {q.label}: {q.query}
                </a>
              ))}
            </div>
          ) : (
            <div style={{display:'flex',gap:8}}>
              <input value={manualQuery} onChange={e => setManualQuery(e.target.value)} placeholder="或手动输入搜索词..."
                style={{flex:1}} />
              <a href={searchUrl(manualQuery || '公司名称 融资 估值')} target="_blank" rel="noopener"
                className="button" style={{color:'#70b8b0'}}>🔗 百度搜索</a>
            </div>
          )}
        </div>
      )}

      {error && <div style={{background:'#2a1a1a',padding:'12px 16px',borderRadius:8,marginBottom:16,color:'#f87171',fontSize:'0.85rem'}}>⚠️ {error}</div>}

      {/* Profile Result */}
      {profile && (
        <div style={{background:'#1a2a2a',padding:'20px',borderRadius:8,marginBottom:16,border:'1px solid #3a5a5a'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <h2 style={{margin:0}}>
              📋 {profile.companyName}
              <span style={{marginLeft:12,fontSize:'0.8rem',color: profileResult?.confidence === 'high' ? '#70b8b0' : '#f0b870'}}>
                {profileResult?.confidence === 'high' ? '🟢 高可信度' : profileResult?.confidence === 'medium' ? '🟡 中可信度' : '🔴 低可信度'}
              </span>
              <span style={{marginLeft:8,fontSize:'0.8rem',color:'#8ba8a8'}}>({profileResult?.filledFields.length} 个字段)</span>
            </h2>
            <button className="button" onClick={handleAutoFill} style={{background:'#70b8b0',color:'#0d1a1a',padding:'8px 20px',fontWeight:'bold'}}>
              📥 一键填充到分析
            </button>
          </div>

          {fillMsg && (
            <div style={{background:'#1a3a1a',padding:'8px 12px',borderRadius:4,marginBottom:12,color:'#70b8b0',fontSize:'0.85rem'}}>
              ✅ {fillMsg}
            </div>
          )}

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
            {/* Basic info */}
            <FieldCard label="公司名称" value={profile.companyName} />
            <FieldCard label="成立时间" value={profile.founded} />
            <FieldCard label="总部" value={profile.headquarters} />
            <FieldCard label="网站" value={profile.website} isUrl />
            <FieldCard label="商业模式" value={profile.businessModel} />
            <FieldCard label="员工数" value={profile.employeeCount} />
            <FieldCard label="行业" value={profile.industry} />

            {/* Financial */}
            <FieldCard label="营收" value={fmt(profile.revenue) || profile.revenue} />
            <FieldCard label="营收增速" value={profile.revenueGrowth ? `${profile.revenueGrowth}%` : ''} />
            <FieldCard label="毛利率" value={profile.grossMargin ? `${profile.grossMargin}%` : ''} />
            <FieldCard label="净利润" value={fmt(profile.netIncome) || profile.netIncome} />
            <FieldCard label="EBITDA" value={fmt(profile.ebitda) || profile.ebitda} />

            {/* Market */}
            <FieldCard label="TAM" value={fmt(profile.tam) || profile.tam} />
            <FieldCard label="市场增速" value={profile.marketGrowth ? `${profile.marketGrowth}%` : ''} />

            {/* Investment */}
            <FieldCard label="估值" value={fmt(profile.valuation) || profile.valuation} />
            <FieldCard label="累计融资" value={fmt(profile.totalFunding) || profile.totalFunding} />
            <FieldCard label="最新轮次" value={`${profile.latestRound || ''} ${profile.latestRoundAmount ? fmt(profile.latestRoundAmount) || profile.latestRoundAmount : ''} ${profile.latestRoundDate || ''}`} />
          </div>

          {/* Founders */}
          {profile.founders.length > 0 && (
            <div style={{marginTop:16}}>
              <h3>👤 核心团队</h3>
              {profile.founders.map((f, i) => (
                <div key={i} style={{fontSize:'0.85rem',marginBottom:4}}>
                  <strong>{f.name}</strong> — {f.role}{f.background ? `（${f.background}）` : ''}
                </div>
              ))}
            </div>
          )}

          {/* Competitors */}
          {profile.competitors.length > 0 && (
            <div style={{marginTop:12}}>
              <h3>🏢 竞品</h3>
              {profile.competitors.map((c, i) => (
                <div key={i} style={{fontSize:'0.85rem',marginBottom:2}}>
                  <strong>{c.name}</strong>{c.description ? ` — ${c.description}` : ''}
                </div>
              ))}
            </div>
          )}

          {/* Products */}
          {profile.mainProducts.length > 0 && (
            <div style={{marginTop:12}}>
              <h3>📦 主要产品</h3>
              {profile.mainProducts.map((p, i) => (
                <div key={i} style={{fontSize:'0.85rem',marginBottom:2}}>
                  <strong>{p.name}</strong>{p.description ? ` — ${p.description}` : ''}
                </div>
              ))}
            </div>
          )}

          {/* Sources */}
          <details style={{marginTop:16}}>
            <summary style={{fontSize:'0.8rem',color:'#8ba8a8',cursor:'pointer'}}>📚 信息来源 ({profile.sources.length})</summary>
            <div style={{marginTop:8,maxHeight:200,overflowY:'auto'}}>
              {profile.sources.map((s, i) => (
                <div key={i} style={{fontSize:'0.75rem',marginBottom:4}}>
                  <a href={s.url} target="_blank" rel="noopener" style={{color:'#70b8b0'}}>{s.title}</a>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Raw results */}
      {results.length > 0 && !profile && (
        <div>
          <h2>搜索结果 ({results.length})</h2>
          {results.slice(0, 10).map((r, i) => (
            <div key={i} style={{marginBottom:8,fontSize:'0.85rem'}}>
              <a href={r.url} target="_blank" rel="noopener" style={{color:'#70b8b0',fontWeight:'bold'}}>{r.title}</a>
              <p style={{color:'#8ba8a8',margin:'2px 0'}}>{r.snippet.slice(0, 300)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldCard({ label, value, isUrl }: { label: string; value: string; isUrl?: boolean }) {
  if (!value || value === 'null' || value === 'undefined') return null;
  return (
    <div style={{background:'#0d1a1a',padding:'8px 12px',borderRadius:6,fontSize:'0.85rem'}}>
      <div style={{color:'#5a7a7a',fontSize:'0.7rem',marginBottom:2}}>{label}</div>
      <div style={{wordBreak:'break-all'}}>
        {isUrl ? <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noopener" style={{color:'#70b8b0'}}>{value}</a> : value}
      </div>
    </div>
  );
}
