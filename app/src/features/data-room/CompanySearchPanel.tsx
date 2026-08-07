import { useState, useCallback } from 'react';
import { generateCompanySearchQueries, baiduSearchUrl, bingSearchUrl } from '../../infrastructure/search/search-adapter';
import { profileCompany, type CompanyProfile, type ProfileResult } from '../../engines/research/company-profiler';
import { useAiVault } from '../ai-agents/useAiVault';

function pn(s: unknown): string { const v = parseFloat(String(s ?? '0')); return isNaN(v) ? '' : String(v); }

interface Props {
  projectId: string;
  companyName?: string;
  onFill?: (filled: string[]) => void;
}

export function CompanySearchPanel({ projectId, companyName: initialName, onFill }: Props) {
  const vault = useAiVault();
  const hasAI = !vault.locked && vault.settings !== null;
  const [companyName, setCompanyName] = useState(initialName || '');
  const [researching, setResearching] = useState(false);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [profileResult, setProfileResult] = useState<ProfileResult | null>(null);
  const [error, setError] = useState('');
  const [fillMsg, setFillMsg] = useState('');
  const [expanded, setExpanded] = useState(false);

  const handleResearch = useCallback(async () => {
    if (!companyName.trim()) return;
    setResearching(true); setError(''); setExpanded(true);
    try {
      const pr = await profileCompany(companyName.trim());
      setProfile(pr.profile); setProfileResult(pr);
      if (pr.error) setError(pr.error);
    } catch (e) { setError(e instanceof Error ? e.message : '搜索失败'); }
    finally { setResearching(false); }
  }, [companyName]);

  const setIfMissing = (_s: string, obj: Record<string, unknown>, field: string, val: string, label: string, filled: string[]) => {
    if (val && val !== 'null' && val !== 'undefined' && !obj[field]) { obj[field] = val; filled.push(label); }
  };

  const handleFill = useCallback(() => {
    if (!profile || !projectId) return;
    const filled: string[] = [];
    // Company
    { const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-company-overview`) || '{}');
      setIfMissing('', d, 'name', profile.companyName, '公司名称', filled);
      setIfMissing('', d, 'description', profile.businessDescription, '业务描述', filled);
      setIfMissing('', d, 'founded', profile.founded, '成立时间', filled);
      setIfMissing('', d, 'headquarters', profile.headquarters, '总部', filled);
      setIfMissing('', d, 'website', profile.website, '网站', filled);
      setIfMissing('', d, 'businessModel', profile.businessModel, '商业模式', filled);
      localStorage.setItem(`dd-p-${projectId}-company-overview`, JSON.stringify(d)); }
    // Industry
    { const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-industry`) || '{}');
      setIfMissing('', d, 'industryName', profile.industry, '行业', filled);
      setIfMissing('', d, 'tam', pn(profile.tam), 'TAM', filled);
      setIfMissing('', d, 'sam', pn(profile.sam), 'SAM', filled);
      setIfMissing('', d, 'growthRate', pn(profile.marketGrowth), '增速', filled);
      setIfMissing('', d, 'chainUp', profile.chainUp, '上游', filled);
      setIfMissing('', d, 'chainMid', profile.chainMid, '链位', filled);
      setIfMissing('', d, 'chainDown', profile.chainDown, '下游', filled);
      setIfMissing('', d, 'keyTrends', profile.keyTrends, '趋势', filled);
      setIfMissing('', d, 'entryBarriers', profile.entryBarriers, '壁垒', filled);
      setIfMissing('', d, 'regulation', profile.regulation, '监管', filled);
      localStorage.setItem(`dd-p-${projectId}-industry`, JSON.stringify(d)); }
    // Financial
    { const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financials`) || '{}');
      setIfMissing('', d, 'revenue', pn(profile.revenue), '营收', filled);
      setIfMissing('', d, 'revenue2023', pn(profile.revenue2023), '23营收', filled);
      setIfMissing('', d, 'revenue2024', pn(profile.revenue2024), '24营收', filled);
      setIfMissing('', d, 'revenue2025', pn(profile.revenue2025), '25营收', filled);
      setIfMissing('', d, 'grossProfit', pn(profile.grossProfit), '毛利', filled);
      setIfMissing('', d, 'netIncome', pn(profile.netIncome), '净利', filled);
      setIfMissing('', d, 'ebitda', pn(profile.ebitda), 'EBITDA', filled);
      setIfMissing('', d, 'grossMargin', pn(profile.grossMargin), '毛利率', filled);
      setIfMissing('', d, 'customerCount', pn(profile.customerCount), '客户数', filled);
      setIfMissing('', d, 'arpu', pn(profile.arpu), 'ARPU', filled);
      setIfMissing('', d, 'cac', pn(profile.cac), 'CAC', filled);
      setIfMissing('', d, 'ltv', pn(profile.ltv), 'LTV', filled);
      setIfMissing('', d, 'arr', pn(profile.arr), 'ARR', filled);
      setIfMissing('', d, 'nrr', pn(profile.nrr), 'NRR', filled);
      localStorage.setItem(`dd-p-${projectId}-financials`, JSON.stringify(d)); }
    // Team
    if (profile.founders.length > 0) {
      const e = JSON.parse(localStorage.getItem(`dd-p-${projectId}-team-members`) || '[]');
      if (e.length === 0) {
        const members = [...profile.founders, ...profile.keyExecutives.map(x => ({ ...x, ownership: '' }))]
          .filter((p, i, a) => a.findIndex(x => x.name === p.name) === i)
          .map(p => ({ name: p.name, role: p.role, background: p.background || '', ownership: (p as any).ownership || '', isKey: p.role.includes('CEO') || p.role.includes('创始人') }));
        localStorage.setItem(`dd-p-${projectId}-team-members`, JSON.stringify(members));
        filled.push(`团队(${members.length}人)`);
      }
    }
    // Competitors
    if (profile.competitors.length > 0) {
      const e = JSON.parse(localStorage.getItem(`dd-p-${projectId}-competitors`) || '[]');
      if (e.length === 0) {
        localStorage.setItem(`dd-p-${projectId}-competitors`, JSON.stringify(profile.competitors.map(c => ({ name: c.name, stage: c.stage || '', scale: c.scale || '', pricing: '', share: '', funding: c.funding || '', differentiation: c.advantage || '' }))));
        filled.push(`竞品(${profile.competitors.length}个)`);
      }
    }
    // Products
    if (profile.mainProducts.length > 0) {
      const e = JSON.parse(localStorage.getItem(`dd-p-${projectId}-products`) || '[]');
      if (e.length === 0) {
        localStorage.setItem(`dd-p-${projectId}-products`, JSON.stringify(profile.mainProducts.map(p => ({ name: p.name, stage: p.stage || '', revenuePct: p.revenuePct || '', moat: p.description || '' }))));
        filled.push(`产品(${profile.mainProducts.length}个)`);
      }
    }
    if (profile.ipPatents) { localStorage.setItem(`dd-p-${projectId}-ip`, profile.ipPatents); filled.push('知识产权'); }
    // Valuation
    { const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-valuation`) || '{}');
      setIfMissing('', d, 'entryValuation', pn(profile.entryValuation || profile.valuation), '估值', filled);
      setIfMissing('', d, 'fcfBase', pn(profile.valFcf), 'FCF', filled);
      setIfMissing('', d, 'wacc', pn(profile.valWacc), 'WACC', filled);
      setIfMissing('', d, 'targetIrr', pn(profile.targetIrr), 'IRR', filled);
      localStorage.setItem(`dd-p-${projectId}-valuation`, JSON.stringify(d)); }
    // Exit
    { const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-exit`) || '{}');
      setIfMissing('', d, 'exitValuation', pn(profile.exitValue), '退出估值', filled);
      setIfMissing('', d, 'ownershipPct', pn(profile.ownershipPct), '持股%', filled);
      setIfMissing('', d, 'holdingYears', pn(profile.holdingYears), '持有年', filled);
      localStorage.setItem(`dd-p-${projectId}-exit`, JSON.stringify(d)); }
    // Financing
    if (profile.financingRounds.length > 0 || profile.latestRound) {
      const e = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financing-history`) || '[]');
      if (e.length === 0) {
        const rounds = profile.financingRounds.length > 0 ? profile.financingRounds : [{ name: profile.latestRound, date: profile.latestRoundDate || '', amount: profile.latestRoundAmount || '', preMoneyVal: '', postMoneyVal: profile.valuation || '', investors: (profile.keyInvestors || []).join(', ') }];
        localStorage.setItem(`dd-p-${projectId}-financing-history`, JSON.stringify(rounds.map(r => ({ name: r.name, date: r.date || '', amount: String(r.amount || ''), preMoneyVal: String(r.preMoneyVal || ''), postMoneyVal: String(r.postMoneyVal || ''), investors: String(r.investors || '') }))));
        filled.push('融资历史');
      }
    }
    // Risk
    if (profile.riskFactors.length > 0) {
      const e = JSON.parse(localStorage.getItem(`dd-p-${projectId}-risk-items`) || '[]');
      if (e.length === 0) {
        const catMap: Record<string, string> = { '市场': 'market', '客户': 'customer', '技术': 'technology', '财务': 'financial', '融资': 'financing', '合规': 'legal_compliance', '监管': 'legal_compliance', '法律': 'legal_compliance', '治理': 'governance', '数据': 'data_authenticity', '退出': 'exit', '人才': 'governance', '现金流': 'financial', '竞争': 'market' };
        const items = profile.riskFactors.map((rf: string) => {
          const cat = Object.entries(catMap).find(([k]) => rf.includes(k))?.[1] || 'market';
          return { riskId: crypto.randomUUID(), category: cat, title: rf, probability: '0.5', impact: '0.5', mitigationEffectiveness: '0' };
        });
        localStorage.setItem(`dd-p-${projectId}-risk-items`, JSON.stringify(items));
        filled.push(`风险(${items.length}项)`);
      }
    }
    // Custom fields (extended data from queries 11-20)
    {
      const d = JSON.parse(localStorage.getItem(`dd-p-${projectId}-custom-fields`) || '{}');
      const map: [string, string | undefined][] = [
        ['DAU', profile.dau], ['MAU', profile.mau], ['增长渠道', profile.growthChannels],
        ['技术栈', profile.techStack], ['研发团队', profile.engineeringTeamSize],
        ['云服务商', profile.cloudProvider], ['技术债', profile.techDebt],
        ['政府关系', profile.governmentRelations], ['监管风险', profile.regulatoryRiskLevel],
        ['数据合规', profile.dataCompliance], ['董事会', profile.boardStructure],
        ['ESG评级', profile.esgRating], ['多元化', profile.diversityInclusion],
        ['治理风险', profile.governanceRisks], ['定价模式', profile.pricingModel],
        ['平均合同额', profile.avgContractValue], ['LTV/CAC比', profile.ltvCacRatio],
        ['CAC回收期(月)', profile.cacPaybackMonths], ['流失率', profile.churnRate],
        ['海外收入占比', profile.overseasRevenue], ['扩张计划', profile.expansionPlans],
        ['跨境风险', profile.crossBorderRisks], ['海外员工', profile.globalHeadcount],
      ];
      for (const [k, v] of map) { if (v && v !== 'null' && v !== 'undefined' && !d[k]) { d[k] = v; } }
      if (profile.strategicPartners.length > 0 && !d['战略伙伴']) d['战略伙伴'] = profile.strategicPartners.map(p => `${p.name}(${p.type}): ${p.description}`).join('; ');
      if (profile.keyCustomers_logo.length > 0 && !d['标杆客户']) d['标杆客户'] = profile.keyCustomers_logo.join(', ');
      if (profile.recentNews.length > 0 && !d['近期新闻']) d['近期新闻'] = profile.recentNews.map(n => `[${n.sentiment}] ${n.title}(${n.date})`).join('; ');
      if (profile.controversies.length > 0 && !d['争议']) d['争议'] = profile.controversies.join('; ');
      if (profile.overseasMarkets.length > 0 && !d['海外市场']) d['海外市场'] = profile.overseasMarkets.join(', ');
      localStorage.setItem(`dd-p-${projectId}-custom-fields`, JSON.stringify(d));
    }
    setFillMsg(`✅ 已填充 ${filled.length} 项: ${filled.slice(0, 8).join('、')}${filled.length > 8 ? '...' : ''}`);
    onFill?.(filled);
    setTimeout(() => setFillMsg(''), 5000);
  }, [profile, projectId, onFill]);

  const fmt = (n: string) => { if (!n) return ''; const v = parseFloat(n); if (isNaN(v)) return n; if (v >= 10000) return `${(v / 10000).toFixed(1)}亿`; return `${v}万`; };

  const modGroups: { mod: string; fields: [string, string][] }[] = profile ? [
    { mod: '🏢 概览', fields: [['名称', profile.companyName], ['描述', profile.businessDescription], ['成立', profile.founded], ['总部', profile.headquarters], ['网站', profile.website], ['模式', profile.businessModel], ['员工', profile.employeeCount]] },
    { mod: '🌍 行业', fields: [['行业', profile.industry], ['TAM', fmt(profile.tam) || profile.tam], ['增速', profile.marketGrowth ? `${profile.marketGrowth}%` : '']] },
    { mod: '👤 团队', fields: [['创始人', profile.founders.length > 0 ? `${profile.founders.length}人` : '']] },
    { mod: '💰 财务', fields: [['营收', fmt(profile.revenue) || profile.revenue], ['毛利', fmt(profile.grossProfit) || profile.grossProfit], ['净利', fmt(profile.netIncome) || profile.netIncome], ['毛利率', profile.grossMargin ? `${profile.grossMargin}%` : ''], ['ARR', profile.arr], ['NRR', profile.nrr]] },
    { mod: '📈 估值', fields: [['估值', fmt(profile.valuation) || profile.valuation], ['融资', fmt(profile.totalFunding) || profile.totalFunding], ['轮次', profile.latestRound], ['目标IRR', profile.targetIrr ? `${profile.targetIrr}%` : '']] },
    { mod: '🏢 竞品', fields: [['竞品', profile.competitors.length > 0 ? `${profile.competitors.length}家` : ''], ['优势', profile.competitiveAdvantage]] },
    { mod: '📱 用户增长', fields: [['DAU', profile.dau], ['MAU', profile.mau], ['增速', profile.userGrowth ? `${profile.userGrowth}%` : ''], ['渠道', profile.growthChannels], ['病毒系数', profile.viralCoefficient]] },
    { mod: '💻 技术', fields: [['技术栈', profile.techStack], ['研发团队', profile.engineeringTeamSize], ['AI能力', profile.aiMlCapability], ['云', profile.cloudProvider], ['技术债', profile.techDebt]] },
    { mod: '🏛️ 合规', fields: [['监管风险', profile.regulatoryRiskLevel], ['数据合规', profile.dataCompliance], ['政府关系', profile.governmentRelations]] },
    { mod: '🌱 ESG', fields: [['董事会', profile.boardStructure], ['ESG评级', profile.esgRating], ['治理风险', profile.governanceRisks]] },
    { mod: '💵 定价', fields: [['定价模式', profile.pricingModel], ['LTV/CAC', profile.ltvCacRatio], ['CAC回收月', profile.cacPaybackMonths], ['流失率', profile.churnRate]] },
    { mod: '🌏 国际化', fields: [['海外收入', profile.overseasRevenue ? `${profile.overseasRevenue}%` : ''], ['海外市场', profile.overseasMarkets.join(', ')], ['跨境风险', profile.crossBorderRisks]] },
  ] : [];

  return (
    <div style={{ background: '#0d1a1a', borderRadius: 8, padding: 16, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: '1.5rem' }}>🔎</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, color: '#e0e0e0', fontSize: '1rem' }}>AI 搜索补全公司信息</h3>
          <p style={{ margin: '2px 0 0', color: '#8ba8a8', fontSize: '0.78rem' }}>
            {hasAI ? '用已配置的 AI 模型搜索公司公开信息，一键补全分析工作台' : '需先在 AI Agent 配置页解锁并配置模型'}
          </p>
        </div>
        {!hasAI && <span style={{ color: '#f87171', fontSize: '0.78rem' }}>⚠️ AI 未配置</span>}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={companyName}
          onChange={e => setCompanyName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleResearch(); }}
          placeholder="输入公司全称后按回车"
          style={{ flex: 1, background: '#0a1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '8px 12px', borderRadius: 6, fontSize: '0.9rem' }}
        />
        <button className="button" onClick={handleResearch} disabled={researching || !companyName.trim() || !hasAI}
          style={{ background: researching ? '#3a5a5a' : '#70b8b0', color: '#0d1a1a', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
          {researching ? '⏳' : '🔍 搜索'}
        </button>
      </div>

      {researching && <div style={{ color: '#70b8b0', fontSize: '0.78rem', marginTop: 8 }}>⏳ 正在 20 路并行查询公司信息...</div>}

      {error && <div style={{ color: '#f87171', fontSize: '0.82rem', marginTop: 8, padding: '8px 12px', background: '#2a1a1a', borderRadius: 4 }}>{error}</div>}

      {/* Manual links */}
      {companyName.trim() && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ color: '#5a7a7a', fontSize: '0.75rem', cursor: 'pointer' }}>手动搜索引擎查（百度/Bing）</summary>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {generateCompanySearchQueries(companyName).map(q => (
              <a key={q.label} href={q.engine === 'baidu' ? baiduSearchUrl(q.query) : bingSearchUrl(q.query)} target="_blank" rel="noopener"
                style={{ color: '#70b8b0', fontSize: '0.75rem', background: '#1a2a2a', padding: '2px 8px', borderRadius: 4, textDecoration: 'none' }}>
                {q.engine === 'baidu' ? '百度' : 'Bing'}: {q.label}
              </a>
            ))}
          </div>
        </details>
      )}

      {/* Results */}
      {profile && (
        <div style={{ marginTop: 12, borderTop: '1px solid #2a4a4a', paddingTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong style={{ color: '#e0e0e0' }}>{profile.companyName}</strong>
              <span style={{ marginLeft: 8, fontSize: '0.78rem', color: profileResult?.confidence === 'high' ? '#70b8b0' : '#f0b870' }}>
                {profileResult?.filledFields.length} 字段 · {profileResult?.confidence === 'high' ? '高可信' : profileResult?.confidence === 'medium' ? '中可信' : '低可信'}
              </span>
            </div>
            <button className="button" onClick={handleFill}
              style={{ background: '#70b8b0', color: '#0d1a1a', fontWeight: 'bold', fontSize: '0.85rem', padding: '6px 16px' }}>
              📥 确认填充 ({profileResult?.filledFields.length}字段)
            </button>
          </div>
          {fillMsg && <div style={{ background: '#1a3a1a', color: '#70b8b0', padding: '6px 10px', borderRadius: 4, fontSize: '0.8rem', marginBottom: 8 }}>{fillMsg}</div>}

          {expanded && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 8 }}>
              {modGroups.map(g => {
                const ff = g.fields.filter(([, v]) => v);
                if (ff.length === 0) return null;
                return (
                  <div key={g.mod} style={{ background: '#0a1a1a', borderRadius: 6, padding: '8px 10px', border: '1px solid #1a3a3a' }}>
                    <div style={{ color: '#70b8b0', fontWeight: 'bold', fontSize: '0.78rem', marginBottom: 4 }}>{g.mod}</div>
                    {ff.map(([l, v]) => (
                      <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', marginBottom: 2 }}>
                        <span style={{ color: '#5a7a7a' }}>{l}</span>
                        <span style={{ color: '#ccc', textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          <button className="button" style={{ marginTop: 8, fontSize: '0.75rem', color: '#8ba8a8' }} onClick={() => setExpanded(!expanded)}>
            {expanded ? '收起详情' : '展开全部详情'}
          </button>
        </div>
      )}

      <p style={{ margin: '8px 0 0', fontSize: '0.68rem', color: '#5a7a7a' }}>
        AI 数据来自模型训练知识库，关键信息请以官方披露为准。
      </p>
    </div>
  );
}
