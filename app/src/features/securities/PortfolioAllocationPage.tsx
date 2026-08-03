/**
 * Portfolio Allocation System
 * - Pulls stocks from active watchlist, one per group tag for diversification
 * - Scores each candidate (fundamental + technical + strategy)
 * - Allocates capital by risk-adjusted scoring
 * - AI summarizes the portfolio
 *
 * Combines: TradingAgents trader + InStock scoring + real-time-fund portfolio tracking
 */

import { useState, useEffect } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { fetchSinaQuotes, fetchEastmoneyKLine, type StockQuote } from '../../infrastructure/market-data/stock-api';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import { scanPatterns } from '../../engines/market-analysis/kline-patterns';
import { scanStrategies, type StrategySignal } from '../../engines/market-analysis/trading-strategies';
import {
  deletePortfolioGroup,
  findPortfolioVersion,
  loadPortfolioGroups,
  savePortfolioVersion,
  type PortfolioGroup,
  type PortfolioVersionDraft,
} from './portfolio-group-storage';

interface Watchlist {
  id: string; name: string; codes: string[]; createdAt: string;
  groups: StockGroup[];
  codeGroups: Record<string, string[]>;
}
interface StockGroup { id: string; name: string; color: string; }

interface Candidate {
  stock: StockQuote;
  groupName: string;
  groupColor: string;
  score: number;
  signals: string[];
  strategies: StrategySignal[];
  allocation: number;  // %
  amount: number;       // 元
  shares: number;       // 股(100股整数)
  rationale: string;
}

export function PortfolioAllocationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const backUrl = projectId ? `/projects/${projectId}/securities` : '/securities';

  const [wl, setWl] = useState<Watchlist | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [capital, setCapital] = useState(100000);
  const [riskLevel, setRiskLevel] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [portfolioGroups, setPortfolioGroups] = useState<PortfolioGroup[]>(() => loadPortfolioGroups());
  const [saveTarget, setSaveTarget] = useState('__new__');
  const [newGroupName, setNewGroupName] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [managedGroupId, setManagedGroupId] = useState('');
  const [managedVersionId, setManagedVersionId] = useState('');

  // Load watchlist
  useEffect(() => {
    try {
      const wls: Watchlist[] = JSON.parse(localStorage.getItem('sec_watchlists_v2') || '[]');
      const activeId = localStorage.getItem('sec_active_watchlist') || '';
      const active = wls.find(w => w.id === activeId) || wls[0];
      if (active) setWl(active);
    } catch {}
  }, []);

  // ── Run Analysis ──
  const runAnalysis = async () => {
    if (!wl || wl.codes.length === 0) return;
    setLoading(true); setProgress('正在获取行情...');
    setCandidates([]); setAiSummary('');

    try {
      // Step 1: Get quotes for all watchlist stocks
      const quotes = await fetchSinaQuotes(wl.codes);
      const validQuotes = quotes.filter(q => q.price > 0);
      setProgress(`获取到 ${validQuotes.length} 只股票行情`);

      // Step 2: Pick one stock per group (for diversification)
      const selected: { quote: StockQuote; groupName: string; groupColor: string }[] = [];
      const usedCodes = new Set<string>();

      if (wl.groups.length > 0) {
        for (const g of wl.groups) {
          const groupCodes = wl.codes.filter(c => (wl.codeGroups[c] || []).includes(g.id) && !usedCodes.has(c));
          const groupQuote = validQuotes.find(q => groupCodes.includes(q.code));
          if (groupQuote) {
            selected.push({ quote: groupQuote, groupName: g.name, groupColor: g.color });
            usedCodes.add(groupQuote.code);
          }
        }
      }

      // Fill remaining slots from ungrouped or top by market cap
      const remaining = validQuotes.filter(q => !usedCodes.has(q.code)).sort((a, b) => b.totalCap - a.totalCap);
      const totalSlots = Math.min(8, validQuotes.length);
      for (const q of remaining) {
        if (selected.length >= totalSlots) break;
        selected.push({ quote: q, groupName: '未分组', groupColor: '#888888' });
      }

      setProgress(`选中 ${selected.length} 只候选股，开始逐个深度分析...`);

      // Step 3: Deep analyze each candidate
      const results: Candidate[] = [];

      for (let i = 0; i < selected.length; i++) {
        const { quote, groupName, groupColor } = selected[i];
        setProgress(`分析 ${i + 1}/${selected.length}: ${quote.name}(${quote.code})...`);

        let score = 50;
        const signals: string[] = [];
        const strategies: StrategySignal[] = [];

        // Quick scoring from quotes
        if (quote.changePct > 2) { score += 6; signals.push('今日强势'); }
        else if (quote.changePct > 0) { score += 2; }
        else if (quote.changePct < -3) { score -= 6; signals.push('弱势'); }
        if (quote.pe > 0 && quote.pe < 15) { score += 8; signals.push('低PE'); }
        else if (quote.pe > 50) { score -= 5; signals.push('高PE'); }
        if (quote.pb > 0 && quote.pb < 1.5) { score += 5; signals.push('低PB'); }
        else if (quote.pb > 8) { score -= 3; }
        if (quote.turnover > 2 && quote.turnover < 15) { score += 4; signals.push('换手活跃'); }
        if (quote.totalCap > 500) { score += 4; signals.push('大盘'); }
        else if (quote.totalCap < 50) { score -= 2; }

        // K-line + indicators + strategies
        try {
          const klines = await fetchEastmoneyKLine(quote.code, 120);
          if (klines.length >= 20) {
            calcAllIndicators(klines);
            const last = klines[klines.length - 1] as any;
            const prev = klines[klines.length - 2] as any;

            if (last?.macd) {
              if (last.macd.dif > last.macd.dea) { score += 4; signals.push('MACD多头'); }
              if (prev?.macd && prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea) {
                score += 8; signals.push('MACD金叉');
              }
            }
            if (last?.kdj) {
              if (last.kdj.j < 20) { score += 6; signals.push('KDJ超卖'); }
              else if (last.kdj.j > 80) { score -= 3; signals.push('KDJ超买'); }
            }
            if (last?.rsi) {
              if (last.rsi.rsi6 < 30) { score += 5; signals.push('RSI超卖'); }
              else if (last.rsi.rsi6 > 70) { score -= 3; }
            }
            if (last?.ma && last.close > last.ma.ma20) { score += 3; signals.push('站上MA20'); }
            if (last?.boll && last.close <= last.boll.lower * 1.02) {
              score += 5; signals.push('布林下轨');
            }

            // Pattern scan
            const pats = scanPatterns(klines);
            const bullPats = pats.filter(p => p.type === 'bullish');
            const bearPats = pats.filter(p => p.type === 'bearish');
            score += bullPats.length * 3;
            score -= bearPats.length * 2;
            if (bullPats.length > 0) signals.push(`${bullPats.length}个看多形态`);

            // Strategy scan
            const strats = scanStrategies(klines);
            const buyStrats = strats.filter(s => s.type === 'buy');
            const sellStrats = strats.filter(s => s.type === 'sell');
            score += buyStrats.length * 4;
            score -= sellStrats.length * 3;
            strategies.push(...strats);
          }
        } catch {}

        // Risk adjustment
        if (riskLevel === 'conservative') {
          if (quote.pe > 30 || quote.pe <= 0) score -= 10;
          if (quote.totalCap < 100) score -= 8;
        } else if (riskLevel === 'aggressive') {
          if (quote.pe > 0 && quote.pe < 15 && quote.totalCap > 500) score -= 3; // Too boring for aggressive
          if (quote.turnover > 5) score += 5; // High activity is good
        }

        score = Math.round(Math.max(10, Math.min(100, score)));

        // Rationale
        const rationale = signals.length > 0 ? signals.join(' · ') : '综合评分';

        results.push({
          stock: quote,
          groupName,
          groupColor,
          score,
          signals,
          strategies,
          allocation: 0,
          amount: 0,
          shares: 0,
          rationale,
        });
      }

      // Step 4: Allocate capital
      const totalScore = results.reduce((s, r) => s + r.score, 0);
      for (const r of results) {
        // Base allocation by score proportion
        r.allocation = Math.round((r.score / totalScore) * 1000) / 10; // 0.1% precision

        // Diversification bonus: reduce if same group has high allocation
        const sameGroup = results.filter(x => x.groupName === r.groupName);
        if (sameGroup.length > 1) {
          r.allocation = Math.round(r.allocation / sameGroup.length * 10) / 10;
        }

        r.amount = Math.round(capital * r.allocation / 100);
        r.shares = Math.floor(r.amount / r.stock.price / 100) * 100; // Round to 100-share lots
      }

      // Normalize to 100%
      const totalAlloc = results.reduce((s, r) => s + r.allocation, 0);
      for (const r of results) {
        r.allocation = Math.round(r.allocation / totalAlloc * 1000) / 10;
        r.amount = Math.round(capital * r.allocation / 100);
        r.shares = Math.floor(r.amount / r.stock.price / 100) * 100;
      }

      // Sort by allocation descending
      results.sort((a, b) => b.allocation - a.allocation);
      setCandidates(results);
      setProgress('');
    } catch (e) {
      setProgress('分析失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  const saveCurrentAllocation = () => {
    setSaveMessage('');
    setSaveError('');

    const draft: PortfolioVersionDraft = {
      capital,
      riskLevel,
      sourceWatchlistId: wl?.id,
      sourceWatchlistName: wl?.name,
      aiSummary,
      positions: candidates.map(candidate => ({
        code: candidate.stock.code,
        name: candidate.stock.name,
        groupName: candidate.groupName,
        groupColor: candidate.groupColor,
        score: candidate.score,
        allocation: candidate.allocation,
        amount: candidate.amount,
        shares: candidate.shares,
        price: candidate.stock.price,
        rationale: candidate.rationale,
      })),
    };

    try {
      const result = savePortfolioVersion(
        saveTarget === '__new__'
          ? { newGroupName }
          : { groupId: saveTarget },
        draft,
      );
      setPortfolioGroups(result.groups);
      setSaveTarget(result.group.id);
      setNewGroupName('');
      setManagedGroupId(result.group.id);
      setManagedVersionId(result.version.id);
      setSaveMessage(`已保存到“${result.group.name}”，当前共 ${result.group.versions.length} 个版本`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请检查浏览器存储空间');
    }
  };

  // ── AI Summary ──
  const generateAISummary = async () => {
    if (candidates.length === 0) return;
    setAiLoading(true); setAiSummary('');

    try {
      const portfolio = candidates.map((c, i) =>
        `${i + 1}. ${c.stock.name}(${c.stock.code}) | ${c.groupName} | 评分${c.score} | 配比${c.allocation}% | ¥${(c.amount / 10000).toFixed(1)}万 | ${c.stock.price.toFixed(2)}元/股 | PE:${c.stock.pe > 0 ? c.stock.pe.toFixed(1) : '—'}`
      ).join('\n');

      const prompt = `你是资深投资组合经理。请审查以下持仓分配方案：

资金总额: ¥${(capital / 10000).toFixed(1)}万 | 风险偏好: ${riskLevel === 'conservative' ? '保守' : riskLevel === 'balanced' ? '均衡' : '激进'}
候选标的:
${portfolio}

请从以下角度分析：
1. **组合质量**: 这个配置是否合理？多元化程度如何？
2. **风险暴露**: 最大的集中风险是什么？
3. **改进建议**: 是否有需要调整的配比？
4. **预期表现**: 在 ${riskLevel === 'conservative' ? '保守' : riskLevel === 'balanced' ? '均衡' : '激进'} 策略下，预期收益和回撤范围？
5. **操作建议**: 是一次性建仓还是分批？止损和止盈策略？

控制在350字以内，用中文。`;

      const { loadResearchConfig, PROVIDER_PRESETS } = await import('../../infrastructure/research/research-adapter');
      const cfg = loadResearchConfig();
      if (!cfg) { setAiSummary('请先配置AI模型'); setAiLoading(false); return; }

      const preset = PROVIDER_PRESETS[cfg.provider] ?? PROVIDER_PRESETS.custom;
      const endpoint = cfg.endpoint || preset.endpoint;
      const model = cfg.model || 'deepseek-chat';

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { 'Authorization': `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({
          model, messages: [
            { role: 'system', content: '你是资深投资组合经理。基于数据给出具体、可操作的建议。' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 1024, temperature: 0.5,
        }),
      });
      const data = await resp.json() as any;
      setAiSummary(data.choices?.[0]?.message?.content || 'AI未返回');
    } catch (e) {
      setAiSummary('AI调用失败：' + (e instanceof Error ? e.message : ''));
    } finally { setAiLoading(false); }
  };

  // ── Stats ──
  const totalInvested = candidates.reduce((s, c) => s + c.amount, 0);
  const avgScore = candidates.length > 0 ? Math.round(candidates.reduce((s, c) => s + c.score, 0) / candidates.length) : 0;
  const groupCount = new Set(candidates.map(c => c.groupName)).size;
  const managedGroup = portfolioGroups.find(group => group.id === managedGroupId) ?? portfolioGroups[0];
  const managedVersion = managedGroup
    ? findPortfolioVersion(
      portfolioGroups,
      managedGroup.id,
      managedVersionId || managedGroup.currentVersionId,
    ) ?? findPortfolioVersion(portfolioGroups, managedGroup.id, managedGroup.currentVersionId)
    : null;
  const managedVersions = managedGroup ? [...managedGroup.versions].reverse() : [];
  const riskLabels = {
    conservative: '保守',
    balanced: '均衡',
    aggressive: '激进',
  } as const;

  const handleDeletePortfolioGroup = () => {
    if (!managedGroup) return;
    if (!window.confirm(`确定删除持仓组“${managedGroup.name}”及其全部历史版本吗？`)) return;

    const nextGroups = deletePortfolioGroup(managedGroup.id);
    setPortfolioGroups(nextGroups);
    if (saveTarget === managedGroup.id) setSaveTarget('__new__');
    const nextGroup = nextGroups[0];
    setManagedGroupId(nextGroup?.id ?? '');
    setManagedVersionId(nextGroup?.currentVersionId ?? '');
    setSaveError('');
    setSaveMessage(`已删除持仓组“${managedGroup.name}”`);
  };

  return (
    <div className="module-page" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <NavLink to={backUrl} style={{ color: '#70b8b0', fontSize: '0.85rem', display: 'inline-block', marginBottom: 16 }}>
        ← 返回证券工作台
      </NavLink>
      <h1 style={{ color: '#d4a574', margin: '0 0 4px' }}>💰 持仓分配系统</h1>
      <p style={{ color: '#70b8b0', fontSize: '0.82rem', marginBottom: 20 }}>
        从自选股池各标签中选股 → 多维评分 → 风险调整 → 智能分配
      </p>

      {/* Config */}
      <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <div style={{ color: '#70b8b0', fontSize: '0.75rem', marginBottom: 4 }}>可用资金 (元)</div>
            <input type="number" value={capital} onChange={e => setCapital(Number(e.target.value))}
              style={{ width: 140, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#d4a574', padding: '6px 10px', borderRadius: 4, fontSize: '0.9rem', fontWeight: 'bold' }} />
          </div>
          <div>
            <div style={{ color: '#70b8b0', fontSize: '0.75rem', marginBottom: 4 }}>风险偏好</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['conservative', 'balanced', 'aggressive'] as const).map(r => (
                <button key={r} onClick={() => setRiskLevel(r)}
                  style={{
                    padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem', fontWeight: riskLevel === r ? 'bold' : 'normal',
                    background: riskLevel === r ? '#d4a574' : '#0d1a1a',
                    color: riskLevel === r ? '#0d1a1a' : '#70b8b0',
                    border: riskLevel === r ? '2px solid #d4a574' : '1px solid #3a5a5a',
                  }}>{r === 'conservative' ? '🛡️ 保守' : r === 'balanced' ? '⚖️ 均衡' : '🚀 激进'}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ color: '#70b8b0', fontSize: '0.75rem', marginBottom: 4 }}>自选股池</div>
            <span style={{ color: '#d4a574', fontWeight: 'bold' }}>
              {wl ? `${wl.name} (${wl.codes.length}只, ${wl.groups.length}标签)` : '未找到股池'}
            </span>
          </div>
          <button className="button" onClick={runAnalysis} disabled={loading || !wl}
            style={{ padding: '10px 24px', background: loading ? '#5a5040' : '#d4a574', color: '#0d1a1a', fontWeight: 'bold', fontSize: '0.9rem' }}>
            {loading ? '⏳' : '🔬'} {loading ? '分析中...' : '开始分析'}
          </button>
        </div>
        {progress && <div style={{ color: '#70b8b0', fontSize: '0.78rem', marginTop: 8 }}>{progress}</div>}
      </div>

      {/* Results */}
      {candidates.length > 0 && (
        <>
          {/* Summary Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, marginBottom: 16 }}>
            <StatBox label="候选标的" value={`${candidates.length}只`} color="#d4a574" />
            <StatBox label="覆盖标签" value={`${groupCount}个`} color="#70b8b0" />
            <StatBox label="平均评分" value={`${avgScore}分`} color="#d4a574" />
            <StatBox label="已分配" value={`¥${(totalInvested / 10000).toFixed(1)}万`} color="#70b8b0" />
            <StatBox label="剩余现金" value={`¥${((capital - totalInvested) / 10000).toFixed(1)}万`} color={totalInvested < capital ? '#70b8b0' : '#f87171'} />
          </div>

          {/* Allocation Table */}
          <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a', marginBottom: 16 }}>
            <h3 style={{ color: '#d4a574', margin: '0 0 12px' }}>📊 持仓分配方案</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr style={{ color: '#d4a574', fontSize: '0.75rem' }}>
                    <th>#</th><th>代码</th><th>名称</th><th>标签</th><th>评分</th>
                    <th>最新价</th><th>PE</th><th>配比</th><th>金额</th><th>建议股数</th><th>理由</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c, i) => {
                    const buyStrats = c.strategies.filter(s => s.type === 'buy');
                    const sellStrats = c.strategies.filter(s => s.type === 'sell');
                    return (
                      <tr key={c.stock.code} onClick={() => navigate(`/projects/${projectId || 'default'}/securities/stock/${c.stock.code}`)}
                        style={{ cursor: 'pointer' }}>
                        <td style={{ color: '#d4a574', fontWeight: 'bold' }}>{i + 1}</td>
                        <td style={{ color: '#70b8b0', fontSize: '0.8rem' }}>{c.stock.code}</td>
                        <td style={{ color: '#d4a574', fontWeight: 500 }}>{c.stock.name}</td>
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: 8, fontSize: '0.65rem', fontWeight: 'bold',
                            background: c.groupColor + '33', color: c.groupColor, border: `1px solid ${c.groupColor}`,
                          }}>{c.groupName}</span>
                          {buyStrats.length > 0 && <span style={{ marginLeft: 4, fontSize: '0.6rem', color: '#ff6666' }}>+{buyStrats.length}策略</span>}
                          {sellStrats.length > 0 && <span style={{ marginLeft: 4, fontSize: '0.6rem', color: '#66cc66' }}>-{sellStrats.length}</span>}
                        </td>
                        <td>
                          <span style={{
                            fontWeight: 'bold', fontSize: '0.9rem',
                            color: c.score >= 70 ? '#d4a574' : c.score >= 50 ? '#70b8b0' : '#f0b870',
                          }}>{c.score}</span>
                        </td>
                        <td style={{ color: '#e0e0e0', fontWeight: 'bold' }}>{c.stock.price.toFixed(2)}</td>
                        <td style={{ color: '#70b8b0', fontSize: '0.8rem' }}>{c.stock.pe > 0 ? c.stock.pe.toFixed(1) : '—'}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ width: 50, height: 6, background: '#1a3a3a', borderRadius: 3, flex: 1 }}>
                              <div style={{
                                width: `${c.allocation}%`, height: '100%', borderRadius: 3,
                                background: c.allocation >= 20 ? '#d4a574' : c.allocation >= 10 ? '#70b8b0' : '#f0b870',
                              }} />
                            </div>
                            <span style={{ color: '#d4a574', fontWeight: 'bold', fontSize: '0.85rem', minWidth: 40 }}>{c.allocation}%</span>
                          </div>
                        </td>
                        <td style={{ color: '#d4a574', fontWeight: 'bold' }}>¥{(c.amount / 10000).toFixed(1)}万</td>
                        <td style={{ color: '#70b8b0' }}>{c.shares > 0 ? `${c.shares}股` : '—'}</td>
                        <td style={{ color: '#70b8b0', fontSize: '0.72rem', maxWidth: 200 }}>{c.rationale}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Save to Portfolio Group */}
          <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a', marginBottom: 16 }}>
            <h3 style={{ color: '#d4a574', margin: '0 0 12px' }}>保存到持仓组</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: 4, color: '#70b8b0', fontSize: '0.75rem' }}>
                目标持仓组
                <select
                  aria-label="目标持仓组"
                  value={saveTarget}
                  onChange={event => {
                    setSaveTarget(event.target.value);
                    setSaveMessage('');
                    setSaveError('');
                  }}
                  style={{ minWidth: 180, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '7px 10px', borderRadius: 4 }}
                >
                  <option value="__new__">新建持仓组</option>
                  {portfolioGroups.map(group => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </label>
              {saveTarget === '__new__' && (
                <label style={{ display: 'grid', gap: 4, color: '#70b8b0', fontSize: '0.75rem' }}>
                  新持仓组名称
                  <input
                    aria-label="新持仓组名称"
                    value={newGroupName}
                    onChange={event => setNewGroupName(event.target.value)}
                    placeholder="例如：稳健组合"
                    style={{ minWidth: 180, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '7px 10px', borderRadius: 4 }}
                  />
                </label>
              )}
              <button
                className="button"
                onClick={saveCurrentAllocation}
                style={{ padding: '8px 20px', background: '#d4a574', color: '#0d1a1a', fontWeight: 'bold', fontSize: '0.85rem' }}
              >
                保存当前方案
              </button>
            </div>
            {saveMessage && <div role="status" style={{ color: '#70b8b0', marginTop: 10, fontSize: '0.8rem' }}>{saveMessage}</div>}
            {saveError && <div role="alert" style={{ color: '#f87171', marginTop: 10, fontSize: '0.8rem' }}>{saveError}</div>}
          </div>

          {/* AI Summary */}
          <div style={{ marginBottom: 16 }}>
            {!aiSummary && (
              <button className="button" onClick={generateAISummary} disabled={aiLoading}
                style={{ padding: '8px 20px', background: aiLoading ? '#5a5040' : '#70b8b0', color: '#0d1a1a', fontWeight: 'bold', fontSize: '0.85rem' }}>
                {aiLoading ? '⏳ AI审查中...' : '🤖 AI审查组合'}
              </button>
            )}
            {aiSummary && (
              <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #70b8b0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ color: '#70b8b0', margin: 0 }}>🤖 AI 组合审查</h3>
                  <button onClick={() => setAiSummary('')} style={{ border: 'none', background: 'none', color: '#70b8b0', cursor: 'pointer' }}>✕</button>
                </div>
                <div style={{ color: '#e0e0e0', fontSize: '0.85rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{aiSummary}</div>
                <button onClick={generateAISummary} style={{ marginTop: 8, padding: '4px 12px', background: '#70b8b0', color: '#0d1a1a', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem' }}>
                  🔄 重新生成
                </button>
              </div>
            )}
          </div>

          {/* Risk Note */}
          <p style={{ color: '#70b8b0', fontSize: '0.72rem' }}>
            ⚠️ 以上分配基于技术指标和策略信号自动计算，仅供参考。投资有风险，入市需谨慎。
            建议股数为100股整数倍，实际买入时请以当时市价为准。
            数据来源：腾讯行情 · InStock技术指标 · InStock策略库
          </p>
        </>
      )}

      {/* Portfolio Group Manager */}
      <section style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a', marginBottom: 16 }}>
        <h2 style={{ color: '#d4a574', margin: '0 0 12px', fontSize: '1.05rem' }}>持仓组管理</h2>
        {!managedGroup || !managedVersion ? (
          <div style={{ color: '#70b8b0', fontSize: '0.82rem' }}>暂无已保存的持仓组</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 14 }}>
              <label style={{ display: 'grid', gap: 4, color: '#70b8b0', fontSize: '0.75rem' }}>
                管理持仓组
                <select
                  aria-label="管理持仓组"
                  value={managedGroup.id}
                  onChange={event => {
                    const group = portfolioGroups.find(item => item.id === event.target.value);
                    setManagedGroupId(event.target.value);
                    setManagedVersionId(group?.currentVersionId ?? '');
                  }}
                  style={{ minWidth: 200, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '7px 10px', borderRadius: 4 }}
                >
                  {portfolioGroups.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name}（{group.versions.length}个版本）
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, color: '#70b8b0', fontSize: '0.75rem' }}>
                历史版本
                <select
                  aria-label="历史版本"
                  value={managedVersion.id}
                  onChange={event => setManagedVersionId(event.target.value)}
                  style={{ minWidth: 320, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '7px 10px', borderRadius: 4 }}
                >
                  {managedVersions.map(version => (
                    <option key={version.id} value={version.id}>
                      {new Date(version.createdAt).toLocaleString('zh-CN', { hour12: false })}
                      {' · '}¥{(version.capital / 10000).toFixed(1)}万
                      {' · '}{riskLabels[version.riskLevel]}
                      {' · '}{version.positions.length}只
                      {version.aiSummary?.trim() ? ' · 含AI审查' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={handleDeletePortfolioGroup}
                style={{ padding: '8px 14px', background: '#3a1f24', border: '1px solid #f87171', borderRadius: 4, color: '#fca5a5', cursor: 'pointer' }}
              >
                删除持仓组
              </button>
            </div>

            <div style={{ color: '#70b8b0', fontSize: '0.72rem', marginBottom: 12 }}>
              {managedGroup.name} · 共 {managedGroup.versions.length} 个版本 · 最近更新 {new Date(managedGroup.updatedAt).toLocaleString('zh-CN', { hour12: false })}
            </div>

            <h3 style={{ color: '#d4a574', margin: '0 0 10px', fontSize: '0.95rem' }}>历史方案详情</h3>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, color: '#70b8b0', fontSize: '0.78rem' }}>
              <div>总资金 <strong style={{ color: '#d4a574' }}>¥{(managedVersion.capital / 10000).toFixed(1)}万</strong></div>
              <div>风险偏好 <strong style={{ color: '#d4a574' }}>{riskLabels[managedVersion.riskLevel]}</strong></div>
              <div>持仓数量 <strong style={{ color: '#d4a574' }}>{managedVersion.positions.length}只</strong></div>
              {managedVersion.sourceWatchlistName && <div>来源股池 <strong style={{ color: '#d4a574' }}>{managedVersion.sourceWatchlistName}</strong></div>}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr style={{ color: '#d4a574', fontSize: '0.75rem' }}>
                    <th>代码</th><th>名称</th><th>标签</th><th>评分</th><th>保存价格</th>
                    <th>配比</th><th>金额</th><th>股数</th><th>理由</th>
                  </tr>
                </thead>
                <tbody>
                  {managedVersion.positions.map(position => (
                    <tr key={position.code}>
                      <td style={{ color: '#70b8b0' }}>{position.code}</td>
                      <td style={{ color: '#d4a574' }}>{position.name}</td>
                      <td><span style={{ color: position.groupColor }}>{position.groupName}</span></td>
                      <td style={{ color: '#e0e0e0' }}>{position.score}</td>
                      <td style={{ color: '#e0e0e0' }}>{position.price.toFixed(2)}</td>
                      <td style={{ color: '#d4a574', fontWeight: 'bold' }}>{position.allocation}%</td>
                      <td style={{ color: '#d4a574' }}>¥{(position.amount / 10000).toFixed(1)}万</td>
                      <td style={{ color: '#70b8b0' }}>{position.shares}股</td>
                      <td style={{ color: '#70b8b0' }}>{position.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {managedVersion.aiSummary?.trim() && (
              <div style={{ marginTop: 12, padding: 12, background: '#0d1a1a', border: '1px solid #70b8b0', borderRadius: 6 }}>
                <div style={{ color: '#70b8b0', fontWeight: 'bold', marginBottom: 6 }}>保存时的 AI 组合审查</div>
                <div style={{ color: '#e0e0e0', whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.82rem' }}>{managedVersion.aiSummary}</div>
              </div>
            )}
          </>
        )}
      </section>

      {!wl && (
        <div style={{ color: '#70b8b0', padding: 30, textAlign: 'center' }}>
          请先在自选股池中创建股池并添加股票
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#1a2a2a', padding: '10px 14px', borderRadius: 8, textAlign: 'center', border: '1px solid #2a4a4a' }}>
      <div style={{ color: '#70b8b0', fontSize: '0.7rem', marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontWeight: 'bold', fontSize: '1rem' }}>{value}</div>
    </div>
  );
}
