import { useState, useCallback } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { generateCompanySearchQueries, baiduSearchUrl, bingSearchUrl } from '../../infrastructure/search/search-adapter';
import { profileCompany, type CompanyProfile, type ProfileResult } from '../../engines/research/company-profiler';
import { loadResearchConfig } from '../../infrastructure/research/research-adapter';

function pn(s: unknown): string { const v = parseFloat(String(s ?? '0')); return isNaN(v) ? '' : String(v); }

export function CompanySearchPage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();
  const hasAI = !!loadResearchConfig();

  const [companyName, setCompanyName] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dd-p-${projectId}-company-overview`) || '{}').name || ''; } catch { return ''; }
  });
  const [researching, setResearching] = useState(false);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [profileResult, setProfileResult] = useState<ProfileResult | null>(null);
  const [error, setError] = useState('');
  const [fillMsg, setFillMsg] = useState('');

  const handleResearch = useCallback(async () => {
    if (!companyName.trim()) return;
    setResearching(true); setError(''); setProfile(null); setProfileResult(null);
    try {
      const pr = await profileCompany(companyName.trim());
      setProfile(pr.profile); setProfileResult(pr);
      if (pr.error) setError(pr.error);
    } catch (e) { setError(e instanceof Error ? e.message : '研究失败'); }
    finally { setResearching(false); }
  }, [companyName]);

  const setIfMissing = (_store: string, existing: Record<string, unknown>, field: string, val: string, label: string, filled: string[]) => {
    if (val && val !== 'null' && val !== 'undefined' && !existing[field]) { existing[field] = val; filled.push(label); }
  };

  const handleAutoFill = useCallback(() => {
    if (!profile || !projectId) return;
    const filled: string[] = [];

    // 1. Company Overview
    {
      const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-company-overview`) || '{}');
      setIfMissing('co', d, 'name', profile.companyName, '公司名称', filled);
      setIfMissing('co', d, 'description', profile.businessDescription, '业务描述', filled);
      setIfMissing('co', d, 'founded', profile.founded, '成立时间', filled);
      setIfMissing('co', d, 'headquarters', profile.headquarters, '总部', filled);
      setIfMissing('co', d, 'website', profile.website, '网站', filled);
      setIfMissing('co', d, 'businessModel', profile.businessModel, '商业模式', filled);
      setIfMissing('co', d, 'employeeCount', profile.employeeCount, '员工数', filled);
      if (profile.milestones.length > 0 && (!d.milestones || d.milestones.length === 0)) { d.milestones = profile.milestones; filled.push('里程碑'); }
      localStorage.setItem(`dd-p-${projectId}-company-overview`, JSON.stringify(d));
    }

    // 2. Team
    if (profile.founders.length > 0 || profile.keyExecutives.length > 0) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-team-members`) || '[]');
      if (existing.length === 0) {
        const allPeople = [...profile.founders, ...profile.keyExecutives.map(e => ({ ...e, ownership: '' }))];
        const seen = new Set<string>();
        const members = allPeople.filter(p => { if (seen.has(p.name)) return false; seen.add(p.name); return true; }).map(p => ({
          name: p.name, role: p.role, background: p.background || '', ownership: (p as any).ownership || '', isKey: p.role.includes('CEO') || p.role.includes('创始人'),
        }));
        localStorage.setItem(`dd-p-${projectId}-team-members`, JSON.stringify(members));
        filled.push(`团队(${members.length}人)`);
      }
    }

    // 3. Industry & Market
    {
      const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-industry`) || '{}');
      setIfMissing('ind', d, 'industryName', profile.industry, '行业', filled);
      setIfMissing('ind', d, 'tam', pn(profile.tam), 'TAM', filled);
      setIfMissing('ind', d, 'sam', pn(profile.sam), 'SAM', filled);
      setIfMissing('ind', d, 'som', pn(profile.som), 'SOM', filled);
      setIfMissing('ind', d, 'growthRate', pn(profile.marketGrowth), '市场增速', filled);
      setIfMissing('ind', d, 'chainUp', profile.chainUp, '产业链上游', filled);
      setIfMissing('ind', d, 'chainMid', profile.chainMid, '产业链位置', filled);
      setIfMissing('ind', d, 'chainDown', profile.chainDown, '产业链下游', filled);
      setIfMissing('ind', d, 'keyTrends', profile.keyTrends, '行业趋势', filled);
      setIfMissing('ind', d, 'entryBarriers', profile.entryBarriers, '进入壁垒', filled);
      setIfMissing('ind', d, 'regulation', profile.regulation, '监管环境', filled);
      localStorage.setItem(`dd-p-${projectId}-industry`, JSON.stringify(d));
    }

    // 4. Competitors
    if (profile.competitors.length > 0) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-competitors`) || '[]');
      if (existing.length === 0) {
        localStorage.setItem(`dd-p-${projectId}-competitors`, JSON.stringify(profile.competitors.map(c => ({
          name: c.name, stage: c.stage || '', scale: c.scale || '', pricing: '', share: '', funding: c.funding || '', differentiation: c.advantage || '',
        }))));
        filled.push(`竞品(${profile.competitors.length}个)`);
      }
    }

    // 5. Products
    if (profile.mainProducts.length > 0 || profile.ipPatents || profile.rdPipeline) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-products`) || '[]');
      if (existing.length === 0 && profile.mainProducts.length > 0) {
        localStorage.setItem(`dd-p-${projectId}-products`, JSON.stringify(profile.mainProducts.map(p => ({
          name: p.name, stage: p.stage || '', revenuePct: p.revenuePct || '', moat: p.description || '',
        }))));
        filled.push(`产品(${profile.mainProducts.length}个)`);
      }
      if (profile.ipPatents) { localStorage.setItem(`dd-p-${projectId}-ip`, profile.ipPatents); filled.push('知识产权'); }
      if (profile.rdPipeline) { localStorage.setItem(`dd-p-${projectId}-rd`, profile.rdPipeline); filled.push('研发管线'); }
    }

    // 6. Financials
    {
      const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financials`) || '{}');
      setIfMissing('fin', d, 'revenue', pn(profile.revenue), '营收', filled);
      setIfMissing('fin', d, 'revenue2023', pn(profile.revenue2023), '2023营收', filled);
      setIfMissing('fin', d, 'revenue2024', pn(profile.revenue2024), '2024营收', filled);
      setIfMissing('fin', d, 'revenue2025', pn(profile.revenue2025), '2025营收', filled);
      setIfMissing('fin', d, 'grossProfit', pn(profile.grossProfit), '毛利', filled);
      setIfMissing('fin', d, 'netIncome', pn(profile.netIncome), '净利润', filled);
      setIfMissing('fin', d, 'ebitda', pn(profile.ebitda), 'EBITDA', filled);
      setIfMissing('fin', d, 'grossMargin', pn(profile.grossMargin), '毛利率', filled);
      setIfMissing('fin', d, 'operatingCashFlow', pn(profile.operatingCashFlow), '经营现金流', filled);
      setIfMissing('fin', d, 'freeCashFlow', pn(profile.freeCashFlow), '自由现金流', filled);
      setIfMissing('fin', d, 'cashBalance', pn(profile.cashBalance), '现金余额', filled);
      setIfMissing('fin', d, 'burnRate', pn(profile.burnRate), '月消耗', filled);
      setIfMissing('fin', d, 'customerCount', pn(profile.customerCount), '客户数', filled);
      setIfMissing('fin', d, 'arpu', pn(profile.arpu), 'ARPU', filled);
      setIfMissing('fin', d, 'cac', pn(profile.cac), 'CAC', filled);
      setIfMissing('fin', d, 'ltv', pn(profile.ltv), 'LTV', filled);
      setIfMissing('fin', d, 'arr', pn(profile.arr), 'ARR', filled);
      setIfMissing('fin', d, 'nrr', pn(profile.nrr), 'NRR', filled);
      localStorage.setItem(`dd-p-${projectId}-financials`, JSON.stringify(d));
    }

    // 7. Valuation
    {
      const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-valuation`) || '{}');
      setIfMissing('val', d, 'entryValuation', pn(profile.entryValuation || profile.valuation), '估值', filled);
      setIfMissing('val', d, 'fcfBase', pn(profile.valFcf), 'FCF基准', filled);
      setIfMissing('val', d, 'wacc', pn(profile.valWacc), 'WACC', filled);
      setIfMissing('val', d, 'terminalGrowth', pn(profile.valGrowth), '永续增长率', filled);
      setIfMissing('val', d, 'targetIrr', pn(profile.targetIrr), '目标IRR', filled);
      setIfMissing('val', d, 'holdingYears', pn(profile.holdingYears), '持有期', filled);
      localStorage.setItem(`dd-p-${projectId}-valuation`, JSON.stringify(d));
    }

    // 8. Exit
    {
      const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-exit`) || '{}');
      setIfMissing('exit', d, 'exitValuation', pn(profile.exitValue), '退出估值', filled);
      setIfMissing('exit', d, 'ownershipPct', pn(profile.ownershipPct), '持股%', filled);
      setIfMissing('exit', d, 'holdingYears', pn(profile.holdingYears), '持有年数', filled);
      setIfMissing('exit', d, 'targetIrr', pn(profile.targetIrr), '目标IRR', filled);
      localStorage.setItem(`dd-p-${projectId}-exit`, JSON.stringify(d));
    }

    // 9. Financing History
    if (profile.financingRounds.length > 0 || profile.latestRound) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financing-history`) || '[]');
      if (existing.length === 0) {
        const rounds = profile.financingRounds.length > 0 ? profile.financingRounds : [{
          name: profile.latestRound, date: profile.latestRoundDate || '', amount: profile.latestRoundAmount || '',
          preMoneyVal: '', postMoneyVal: profile.valuation || '', investors: (profile.keyInvestors || []).join(', '),
        }];
        localStorage.setItem(`dd-p-${projectId}-financing-history`, JSON.stringify(rounds.map(r => ({
          name: r.name, date: r.date || '', amount: String(r.amount || ''), preMoneyVal: String(r.preMoneyVal || ''),
          postMoneyVal: String(r.postMoneyVal || ''), investors: String(r.investors || ''),
        }))));
        filled.push(`融资历史(${rounds.length}轮)`);
      }
    }

    // 9b. Equity/ESOP
    if (profile.esopPct) {
      const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-equity`) || '{}');
      setIfMissing('equity', d, 'esopPct', pn(profile.esopPct), 'ESOP%', filled);
      localStorage.setItem(`dd-p-${projectId}-equity`, JSON.stringify(d));
    }

    // 10. Sales
    if (profile.sales.length > 0) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-sales`) || '[]');
      if (existing.length === 0) {
        localStorage.setItem(`dd-p-${projectId}-sales`, JSON.stringify(profile.sales.map(s => ({
          customerName: s.customerName, businessLine: s.businessLine || '', revenue2024: s.revenue2024 || '', revenue2025: s.revenue2025 || '', grossMargin: s.grossMargin || '', contractAmount: '', progress: '',
        }))));
        filled.push(`客户(${profile.sales.length}个)`);
      }
    }

    // 11. Procurement
    if (profile.procurement.length > 0) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-procurement`) || '[]');
      if (existing.length === 0) {
        localStorage.setItem(`dd-p-${projectId}-procurement`, JSON.stringify(profile.procurement.map(p => ({
          supplierName: p.supplierName, category: p.category || '', amount2024: p.amount2024 || '', amount2025: p.amount2025 || '', contractDesc: '',
        }))));
        filled.push(`供应商(${profile.procurement.length}个)`);
      }
    }

    // 12. Contracts
    if (profile.contracts.length > 0) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-contracts`) || '[]');
      if (existing.length === 0) {
        localStorage.setItem(`dd-p-${projectId}-contracts`, JSON.stringify(profile.contracts.map(c => ({
          name: c.name, party: c.party || '', amount: c.amount || '', startDate: c.startDate || '', endDate: c.endDate || '', content: c.content || '', progress: '',
        }))));
        filled.push(`合同(${profile.contracts.length}份)`);
      }
    }

    // 13. Risk Items
    if (profile.riskFactors.length > 0) {
      const existing = JSON.parse(localStorage.getItem(`dd-p-${projectId}-risk-items`) || '[]');
      if (existing.length === 0) {
        const catMap: Record<string, string> = { '市场': 'market', '客户': 'customer', '技术': 'technology', '财务': 'financial', '融资': 'financing', '合规': 'legal_compliance', '监管': 'legal_compliance', '法律': 'legal_compliance', '治理': 'governance', '数据': 'data_authenticity', '退出': 'exit', '人才': 'governance', '现金流': 'financial', '竞争': 'market' };
        const items = profile.riskFactors.map((rf: string) => {
          const cat = Object.entries(catMap).find(([k]) => rf.includes(k))?.[1] || 'market';
          return { riskId: crypto.randomUUID(), category: cat, title: rf, probability: '0.5', impact: '0.5', mitigationEffectiveness: '0' };
        });
        localStorage.setItem(`dd-p-${projectId}-risk-items`, JSON.stringify(items));
        filled.push(`风险(${items.length}项)`);
      }
    }

    // 14. Decision / Strategy data
    if (profile.competitiveAdvantage) {
      const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-strategy-data`) || '{}');
      setIfMissing('strat', d, 'competitiveAdvantage', profile.competitiveAdvantage, '竞争优势', filled);
      localStorage.setItem(`dd-p-${projectId}-strategy-data`, JSON.stringify(d));
    }

    setFillMsg(filled.length > 0 ? `✅ 已填充: ${filled.join('、')}` : '所有字段已有数据，无需补充');
    setTimeout(() => setFillMsg(''), 6000);
  }, [profile, projectId]);

  const fmt = (n: string) => { if (!n) return ''; const v = parseFloat(n); if (isNaN(v)) return n; if (v >= 10000) return `${(v / 10000).toFixed(1)}亿`; return `${v}万`; };

  // Group fields by module for display
  const moduleGroups: { module: string; fields: [string, string][] }[] = profile ? [
    { module: '🏢 公司概览', fields: [['公司名称', profile.companyName], ['业务描述', profile.businessDescription], ['成立', profile.founded], ['总部', profile.headquarters], ['网站', profile.website], ['模式', profile.businessModel], ['员工', profile.employeeCount], ['里程碑', profile.milestones.length > 0 ? `${profile.milestones.length}条` : '']] },
    { module: '👤 团队', fields: [['创始人', profile.founders.length > 0 ? `${profile.founders.length}人` : ''], ['高管', profile.keyExecutives.length > 0 ? `${profile.keyExecutives.length}人` : '']] },
    { module: '🌍 行业市场', fields: [['行业', profile.industry], ['细分', profile.subIndustry], ['TAM', fmt(profile.tam) || profile.tam], ['SAM', fmt(profile.sam) || profile.sam], ['SOM', fmt(profile.som) || profile.som], ['增速', profile.marketGrowth ? `${profile.marketGrowth}%` : ''], ['上游', profile.chainUp], ['趋势', profile.keyTrends], ['壁垒', profile.entryBarriers], ['监管', profile.regulation]] },
    { module: '🏢 竞品', fields: [['核心优势', profile.competitiveAdvantage], ['竞品数', profile.competitors.length > 0 ? `${profile.competitors.length}家` : '']] },
    { module: '📦 产品技术', fields: [['产品数', profile.mainProducts.length > 0 ? `${profile.mainProducts.length}个` : ''], ['知识产权', profile.ipPatents], ['研发管线', profile.rdPipeline]] },
    { module: '💰 财务', fields: [['营收', fmt(profile.revenue) || profile.revenue], ['2023', profile.revenue2023], ['2024', profile.revenue2024], ['2025', profile.revenue2025], ['毛利', fmt(profile.grossProfit) || profile.grossProfit], ['净利', fmt(profile.netIncome) || profile.netIncome], ['EBITDA', fmt(profile.ebitda) || profile.ebitda], ['毛利率', profile.grossMargin ? `${profile.grossMargin}%` : ''], ['经营CF', fmt(profile.operatingCashFlow) || profile.operatingCashFlow], ['客户数', profile.customerCount], ['ARPU', profile.arpu], ['CAC', profile.cac], ['LTV', profile.ltv], ['ARR', profile.arr], ['NRR', profile.nrr ? `${profile.nrr}%` : '']] },
    { module: '📈 估值退出', fields: [['估值', fmt(profile.valuation) || profile.valuation], ['累计融资', fmt(profile.totalFunding) || profile.totalFunding], ['FCF', profile.valFcf], ['WACC', profile.valWacc], ['目标IRR', profile.targetIrr ? `${profile.targetIrr}%` : ''], ['进入估值', profile.entryValuation], ['ESOP', profile.esopPct ? `${profile.esopPct}%` : ''], ['退出估值', profile.exitValue], ['持有年数', profile.holdingYears]] },
    { module: '🏦 融资历史', fields: [['最新轮次', profile.latestRound], ['最新金额', fmt(profile.latestRoundAmount) || profile.latestRoundAmount], ['日期', profile.latestRoundDate], ['投资方', profile.keyInvestors.join(', ')], ['历史轮次', profile.financingRounds.length > 0 ? `${profile.financingRounds.length}轮` : '']] },
    { module: '📋 销售采购', fields: [['客户', profile.sales.length > 0 ? `${profile.sales.length}个` : ''], ['供应商', profile.procurement.length > 0 ? `${profile.procurement.length}个` : ''], ['合同', profile.contracts.length > 0 ? `${profile.contracts.length}份` : '']] },
    { module: '⚠️ 风险', fields: [['风险因素', profile.riskFactors.length > 0 ? `${profile.riskFactors.length}项` : ''], ['法律合规', profile.legalIssues]] },
  ] : [];

  return (
    <div className="module-page">
      <NavLink to={`/projects/${projectId}/analysis/company`} style={{ color: '#70b8b0', fontSize: '0.85rem', marginBottom: 12, display: 'inline-block' }}>← 返回分析工作台</NavLink>
      <h1>🔎 公司信息搜索</h1>
      <p style={{ color: '#aaa', fontSize: '0.85rem', marginBottom: 16 }}>
        基于你已配置的 AI 模型知识库，<strong>10 路并行查询</strong>覆盖分析工作台全部模块。<br />
        <span style={{ color: '#8ba8a8' }}>零额外 API — 知名公司数据全面，早期公司建议手动补充搜索链接。</span>
      </p>

      {!hasAI && (
        <div style={{ background: '#2a1a1a', padding: 16, borderRadius: 8, marginBottom: 16, border: '1px solid #5a3a3a' }}>
          <strong style={{ color: '#f87171' }}>⚠️ 尚未配置 AI 模型</strong>
          <p style={{ fontSize: '0.85rem', color: '#f0b870', margin: '8px 0' }}>
            请先在 <NavLink to={`/projects/${projectId}/research`} style={{ color: '#70b8b0' }}>AI 研究页面</NavLink> 配置 AI 模型。
          </p>
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'end' }}>
        <label style={{ flex: 1 }}>
          <span style={{ fontSize: '0.85rem', color: '#aaa' }}>公司名称</span>
          <input value={companyName} onChange={e => setCompanyName(e.target.value)}
            placeholder="输入公司全称（如：字节跳动、比亚迪、宁德时代）"
            style={{ fontSize: '1.1rem', padding: '10px 14px', background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', borderRadius: 6, width: '100%' }} />
        </label>
        <button className="button" onClick={handleResearch}
          disabled={researching || !companyName.trim() || !hasAI}
          style={{ background: researching ? '#3a5a5a' : '#70b8b0', color: '#0d1a1a', padding: '10px 24px', fontSize: '1rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
          {researching ? '⏳ 研究中...' : '🔍 AI 研究'}
        </button>
      </div>

      {/* Progress during research */}
      {researching && (
        <div style={{ color: '#70b8b0', fontSize: '0.85rem', padding: '8px 0' }}>
          ⏳ 正在并行查询 10 个模块（公司概览 / 团队 / 行业 / 竞品 / 产品 / 财务 / 估值 / 融资 / 供应链 / 风险）...
        </div>
      )}

      {/* Manual search fallback */}
      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', color: '#8ba8a8', fontSize: '0.85rem' }}>💡 AI 数据不全？点此打开百度/Bing 手动搜索补充</summary>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, background: '#1a2a2a', padding: 12, borderRadius: 8 }}>
          {companyName.trim()
            ? generateCompanySearchQueries(companyName).map(q => (
              <div key={q.label} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
                <span style={{ color: '#8ba8a8', minWidth: 80 }}>{q.label}</span>
                <a href={q.engine === 'baidu' ? baiduSearchUrl(q.query) : bingSearchUrl(q.query)}
                  target="_blank" rel="noopener" style={{ color: '#70b8b0' }}>
                  {q.engine === 'baidu' ? '百度' : 'Bing'}: {q.query}
                </a>
              </div>
            ))
            : <p style={{ color: '#8ba8a8' }}>请先输入公司名称</p>
          }
        </div>
      </details>

      {error && (
        <div style={{ background: '#2a1a1a', padding: '12px 16px', borderRadius: 8, marginBottom: 16, color: '#f87171', fontSize: '0.85rem', border: '1px solid #5a3a3a' }}>
          ⚠️ {error}
        </div>
      )}

      {/* Results */}
      {profile && (
        <div style={{ background: '#1a2a2a', padding: 20, borderRadius: 8, marginBottom: 16, border: '1px solid #3a5a5a' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h2 style={{ margin: 0, color: '#e0e0e0' }}>
                📋 {profile.companyName}
                <span style={{ marginLeft: 12, fontSize: '0.8rem', color: profileResult?.confidence === 'high' ? '#70b8b0' : profileResult?.confidence === 'medium' ? '#f0b870' : '#f87171' }}>
                  {profileResult?.confidence === 'high' ? '🟢 高可信' : profileResult?.confidence === 'medium' ? '🟡 中可信' : '🔴 低可信'}
                </span>
              </h2>
              {/* Module coverage tags */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {profileResult?.moduleCoverage.filter(m => m.fields > 0).map(m => (
                  <span key={m.module} style={{ background: '#0d2a2a', color: '#70b8b0', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{m.module}: {m.fields}字段</span>
                ))}
              </div>
            </div>
            <button className="button" onClick={handleAutoFill}
              style={{ background: '#70b8b0', color: '#0d1a1a', padding: '10px 24px', fontWeight: 'bold', fontSize: '0.95rem' }}>
              📥 一键填充全部 ({profileResult?.filledFields.length} 字段)
            </button>
          </div>

          {fillMsg && (
            <div style={{ background: '#1a3a1a', padding: '10px 14px', borderRadius: 6, marginBottom: 12, color: '#70b8b0', fontSize: '0.85rem', border: '1px solid #2a5a2a' }}>
              {fillMsg}
            </div>
          )}

          {/* Module Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 12 }}>
            {moduleGroups.map(g => {
              const filledFields = g.fields.filter(([, v]) => v);
              if (filledFields.length === 0) return null;
              return (
                <div key={g.module} style={{ background: '#0d1f1f', borderRadius: 8, padding: 12, border: '1px solid #2a4a4a' }}>
                  <div style={{ color: '#70b8b0', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: 8 }}>{g.module}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {g.fields.map(([label, value]) => {
                      if (!value) return null;
                      const isUrl = label === '网站';
                      return (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', lineHeight: 1.5 }}>
                          <span style={{ color: '#5a7a7a', flexShrink: 0, marginRight: 8 }}>{label}</span>
                          <span style={{ color: '#e0e0e0', textAlign: 'right', wordBreak: 'break-all' }}>
                            {isUrl ? (
                              <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noopener" style={{ color: '#70b8b0' }}>{value}</a>
                            ) : value}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detailed lists */}
          {profile.founders.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary style={{ color: '#e0e0e0', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' }}>👤 核心团队详情</summary>
              <div style={{ marginTop: 8 }}>
                {profile.founders.map((f, i) => (
                  <div key={i} style={{ fontSize: '0.85rem', marginBottom: 6, color: '#ccc', background: '#0d1f1f', padding: '8px 12px', borderRadius: 6 }}>
                    <strong style={{ color: '#e0e0e0' }}>{f.name}</strong> — {f.role}
                    {f.background && <div style={{ color: '#8ba8a8', fontSize: '0.78rem', marginTop: 2 }}>{f.background}</div>}
                    {f.ownership && <div style={{ color: '#70b8b0', fontSize: '0.75rem' }}>持股: {f.ownership}%</div>}
                  </div>
                ))}
                {profile.keyExecutives.filter(e => !profile.founders.some(f => f.name === e.name)).map((e, i) => (
                  <div key={`exec-${i}`} style={{ fontSize: '0.85rem', marginBottom: 4, color: '#aaa' }}>
                    <strong style={{ color: '#ddd' }}>{e.name}</strong> — {e.role}{e.background ? `（${e.background}）` : ''}
                  </div>
                ))}
              </div>
            </details>
          )}

          {profile.competitors.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ color: '#e0e0e0', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' }}>🏢 竞品详情</summary>
              <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 6 }}>
                {profile.competitors.map((c, i) => (
                  <div key={i} style={{ background: '#0d1f1f', padding: '8px 12px', borderRadius: 6, fontSize: '0.82rem' }}>
                    <div style={{ color: '#e0e0e0', fontWeight: 'bold' }}>{c.name}</div>
                    {c.stage && <div style={{ color: '#8ba8a8' }}>阶段: {c.stage}</div>}
                    {c.scale && <div style={{ color: '#8ba8a8' }}>规模: {c.scale}</div>}
                    {c.advantage && <div style={{ color: '#70b8b0', marginTop: 2 }}>{c.advantage}</div>}
                  </div>
                ))}
              </div>
            </details>
          )}

          {profile.financingRounds.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ color: '#e0e0e0', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' }}>🏦 融资历史详情</summary>
              <table className="data-table" style={{ marginTop: 8 }}>
                <thead><tr><th>轮次</th><th>日期</th><th>金额(万)</th><th>投前估值(万)</th><th>投后估值(万)</th><th>投资方</th></tr></thead>
                <tbody>
                  {profile.financingRounds.map((r, i) => (
                    <tr key={i}><td>{r.name}</td><td>{r.date}</td><td>{r.amount}</td><td>{r.preMoneyVal}</td><td>{r.postMoneyVal}</td><td style={{color:'#aaa'}}>{r.investors}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {profile.riskFactors.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ color: '#e0e0e0', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' }}>⚠️ 风险因素</summary>
              <div style={{ marginTop: 8 }}>
                {profile.riskFactors.map((r, i) => (
                  <div key={i} style={{ color: '#f0b870', fontSize: '0.85rem', marginBottom: 4, padding: '6px 10px', background: '#1a1a0d', borderRadius: 4 }}>
                    ⚠ {r}
                  </div>
                ))}
                {profile.legalIssues && profile.legalIssues !== 'null' && (
                  <div style={{ color: '#f87171', fontSize: '0.85rem', marginTop: 8, padding: '8px 12px', background: '#2a1a1a', borderRadius: 6 }}>
                    <strong>法律/合规：</strong>{profile.legalIssues}
                  </div>
                )}
              </div>
            </details>
          )}

          <p style={{ marginTop: 16, fontSize: '0.72rem', color: '#5a7a7a' }}>
            ⚠️ 信息来自 AI 模型训练数据，可能不是最新。关键数据请以官方披露和尽调材料为准。
          </p>
        </div>
      )}
    </div>
  );
}
