import { Fragment, useState, useEffect, useMemo, useRef } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { createCloudSecuritiesRepository } from './cloud/cloud-securities-repository';
import { executeAiTask, AiGatewayError } from '../ai-agents/ai-gateway';
import { getAiGatewayRuntime } from '../ai-agents/ai-gateway-runtime';
import { loadStockDirectory, fetchEastmoneyKLine, type StockQuote } from '../../infrastructure/market-data/stock-api';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import { scanPatterns } from '../../engines/market-analysis/kline-patterns';
import { WatchlistAdviceCell, WatchlistAdviceDetailRow } from './WatchlistAdviceCell';
import { WatchlistShortTermAdviceCell, WatchlistShortTermAdviceDetailRow } from './WatchlistShortTermAdviceCell';
import { RealtimeQuoteStatus } from './RealtimeQuoteStatus';
import { useRealtimeStockQuotes } from './useRealtimeStockQuotes';
import { useStockPositionLedger } from './useStockPositionLedger';
import { WatchlistPositionCell } from './WatchlistPositionCell';
import {
  analyzeWatchlistQuotes,
  analyzeWatchlistStock,
  clearWatchlistAdviceCache,
  type WatchlistAdviceTaskState,
} from './watchlist-buy-advice-service';
import {
  analyzeWatchlistShortTermQuotes,
  analyzeWatchlistShortTermStock,
  clearWatchlistShortTermAdviceCache,
  recalculateWatchlistShortTermStock,
  type WatchlistShortTermTaskState,
} from './watchlist-short-term-advice-service';
import { sortWatchlistItemsByAdvice } from './watchlist-score-sort';

interface Watchlist {
  id: string; name: string; codes: string[]; createdAt: string;
  groups: StockGroup[];
  codeGroups: Record<string, string[]>; // code -> groupIds
}

interface StockGroup {
  id: string; name: string; color: string;
}

const GROUP_COLORS = ['#d4a574','#70b8b0','#f0b870','#a0c0e0','#e0a0a0','#a0e0c0','#c0c0e0','#e0c0a0','#80d0d0','#e0e0a0'];
const STORAGE_KEY = 'sec_watchlists_v2';
const ACTIVE_KEY = 'sec_active_watchlist';

function load(): Watchlist[] { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); } catch { return []; } }
function save(wls: Watchlist[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(wls)); }
function loadActiveId(): string { return localStorage.getItem(ACTIVE_KEY) || ''; }
function saveActiveId(id: string) { localStorage.setItem(ACTIVE_KEY, id); }

const DEFAULT_WL: Watchlist = {
  id: 'default', name: '默认自选', createdAt: '2026-08-01',
  codes: ['000001','000002','000333','000538','000651','000858','002049','002230','002415','002594','300015','300059','300122','300274','300750','600000','600030','600031','600036','600085','600276','600309','600519','600570','600585','600690','600809','600887','600900','601012','601088','601166','601318','601398','601899','688981'],
  groups: [
    { id: 'g1', name: '价值投资', color: '#d4a574' },
    { id: 'g2', name: '成长股', color: '#70b8b0' },
    { id: 'g3', name: '短线关注', color: '#f0b870' },
    { id: 'g4', name: '防御型', color: '#a0c0e0' },
  ],
  codeGroups: {},
};

export function WatchlistPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const positionLedger = useStockPositionLedger();
  const { cloudEnabled, user } = useAuth();
  const cloudMode = cloudEnabled && Boolean(user);
  const backUrl = projectId ? `/projects/${projectId}/securities` : '/securities';

  const [watchlists, setWatchlists] = useState<Watchlist[]>(() => {
    // 云模式不从默认自选池开始，避免先拉默认行情再切云端数据
    if (cloudMode) return [];
    const wls = load(); return wls.length > 0 ? wls : [DEFAULT_WL];
  });
  const [cloudSyncState, setCloudSyncState] = useState<'loading' | 'ready' | 'error'>(cloudMode ? 'loading' : 'ready');
  const [cloudSyncError, setCloudSyncError] = useState('');
  const skipNextCloudSaveRef = useRef(false);
  const [activeId, setActiveId] = useState(() => loadActiveId() || watchlists[0]?.id || 'default');
  const [groupFilter, setGroupFilter] = useState('');
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<{ code: string; name: string }[]>([]);
  const [newWlName, setNewWlName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [researching, setResearching] = useState(false);
  const [researchReport, setResearchReport] = useState<string>('');
  const [adviceStates, setAdviceStates] = useState<Record<string, WatchlistAdviceTaskState>>({});
  const [expandedAdviceCode, setExpandedAdviceCode] = useState('');
  const adviceRunRef = useRef(0);
  const [shortTermStates, setShortTermStates] = useState<Record<string, WatchlistShortTermTaskState>>({});
  const [expandedShortTermCode, setExpandedShortTermCode] = useState('');
  const shortTermRunRef = useRef(0);
  // 云模式下从云端加载自选股池（登录后走云，未登录走本地）
  useEffect(() => {
    if (!cloudMode) {
      skipNextCloudSaveRef.current = false;
      setCloudSyncError('');
      setCloudSyncState('ready');
      return;
    }
    let cancelled = false;
    setCloudSyncError('');
    setCloudSyncState('loading');
    createCloudSecuritiesRepository().loadWatchlists()
      .then(cloudWls => {
        if (cancelled) return;
        const hydrated = cloudWls.map(cw => ({
          id: cw.id, name: cw.name, codes: cw.codes, createdAt: cw.createdAt,
          groups: cw.groups ?? [], codeGroups: cw.codeGroups ?? {},
        }));
        skipNextCloudSaveRef.current = true;
        setWatchlists(hydrated);
        setActiveId(current => hydrated.some(watchlist => watchlist.id === current)
          ? current
          : hydrated[0]?.id ?? '');
        setCloudSyncState('ready');
      })
      .catch(loadError => {
        if (cancelled) return;
        setCloudSyncError(loadError instanceof Error ? loadError.message : String(loadError));
        setCloudSyncState('error');
      });
    return () => { cancelled = true; };
  }, [cloudMode]);

  // Persist：云模式写云，未登录写本地；云加载失败或刚完成 hydrate 时绝不回写。
  useEffect(() => {
    if (cloudMode) {
      if (cloudSyncState !== 'ready') return;
      if (skipNextCloudSaveRef.current) {
        skipNextCloudSaveRef.current = false;
        return;
      }
      setCloudSyncError('');
      void createCloudSecuritiesRepository().saveWatchlists(watchlists.map(w => ({
        id: w.id, name: w.name, codes: w.codes, createdAt: w.createdAt,
        groups: w.groups, codeGroups: w.codeGroups,
      }))).catch(saveError => {
        setCloudSyncError(saveError instanceof Error ? saveError.message : String(saveError));
      });
    } else {
      save(watchlists);
    }
  }, [watchlists, cloudMode, cloudSyncState]);
  useEffect(() => { if (activeId) saveActiveId(activeId); }, [activeId]);

  const activeWl = watchlists.find(w => w.id === activeId);
  const realtime = useRealtimeStockQuotes(activeWl?.codes ?? []);
  const quotes = (activeWl?.codes ?? [])
    .map(code => realtime.quotes[code])
    .filter((quote): quote is StockQuote => Boolean(quote) && quote.price > 0);
  const loading = realtime.refreshing;
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  const shortTermStatesRef = useRef(shortTermStates);
  shortTermStatesRef.current = shortTermStates;


  const runAdviceAnalysis = (targetQuotes: StockQuote[], force = false) => {
    const runId = ++adviceRunRef.current;
    setAdviceStates(previous => Object.fromEntries(targetQuotes.map(quote => [
      quote.code,
      force && previous[quote.code]?.status === 'success'
        ? previous[quote.code]
        : { status: 'waiting' as const },
    ])));

    void analyzeWatchlistQuotes(targetQuotes, {
      force,
      shouldPublish: () => adviceRunRef.current === runId,
      onUpdate: (code, state) => {
        if (adviceRunRef.current !== runId) return;
        setAdviceStates(previous => ({
          ...previous,
          [code]: force && state.status === 'loading' && previous[code]?.status === 'success'
            ? previous[code]
            : state,
        }));
      },
    });
  };

  const adviceReadyKey = quotes.map(quote => quote.code).sort().join(',');

  useEffect(() => {
    const targetQuotes = quotesRef.current;
    if (targetQuotes.length === 0) {
      adviceRunRef.current += 1;
      setAdviceStates({});
      setExpandedAdviceCode('');
      return;
    }
    runAdviceAnalysis(targetQuotes, false);
    return () => { adviceRunRef.current += 1; };
  }, [activeId, adviceReadyKey]);

  const runShortTermAnalysis = (targetQuotes: StockQuote[], force = false) => {
    const runId = ++shortTermRunRef.current;
    setShortTermStates(previous => Object.fromEntries(targetQuotes.map(quote => [
      quote.code,
      force && previous[quote.code]?.status === 'success'
        ? previous[quote.code]
        : { status: 'waiting' as const },
    ])));

    void analyzeWatchlistShortTermQuotes(targetQuotes, {
      force,
      shouldPublish: () => shortTermRunRef.current === runId,
      onUpdate: (code, state) => {
        if (shortTermRunRef.current !== runId) return;
        setShortTermStates(previous => ({
          ...previous,
          [code]: force && state.status === 'loading' && previous[code]?.status === 'success'
            ? previous[code]
            : state,
        }));
      },
    });
  };

  useEffect(() => {
    const targetQuotes = quotesRef.current;
    if (targetQuotes.length === 0) {
      shortTermRunRef.current += 1;
      setShortTermStates({});
      setExpandedShortTermCode('');
      return;
    }
    runShortTermAnalysis(targetQuotes, false);
    return () => { shortTermRunRef.current += 1; };
  }, [activeId, adviceReadyKey]);

  const shortTermQuoteKey = quotes
    .map(quote => `${quote.code}:${quote.price}`)
    .sort()
    .join('|');

  useEffect(() => {
    if (!shortTermQuoteKey) return;
    const runId = shortTermRunRef.current;
    for (const quote of quotesRef.current) {
      if (shortTermStatesRef.current[quote.code]?.status !== 'success') continue;
      void recalculateWatchlistShortTermStock(quote).then(advice => {
        if (!advice || shortTermRunRef.current !== runId) return;
        setShortTermStates(previous => ({ ...previous, [quote.code]: { status: 'success', advice } }));
      }).catch(() => {
        // Keep the last successful advice visible when a lightweight refresh fails.
      });
    }
  }, [shortTermQuoteKey]);
  // Stock search
  useEffect(() => {
    if (!addSearch.trim()) { setAddResults([]); return; }
    loadStockDirectory().then(dir => {
      const kw = addSearch.toLowerCase();
      setAddResults(dir.filter(s => s.code.includes(kw) || s.name.toLowerCase().includes(kw)).slice(0, 15));
    });
  }, [addSearch]);

  const activeWlRef = watchlists.find(w => w.id === activeId);

  // Actions
  const updateWl = (id: string, patch: Partial<Watchlist>) => {
    setWatchlists(prev => prev.map(w => w.id === id ? { ...w, ...patch } : w));
  };

  const addStock = (code: string) => {
    const wl = watchlists.find(w => w.id === activeId);
    if (!wl || wl.codes.includes(code)) return;
    updateWl(activeId, { codes: [...wl.codes, code] });
    setAddSearch(''); setAddResults([]);
  };

  const removeStock = (code: string) => {
    const wl = watchlists.find(w => w.id === activeId);
    if (!wl) return;
    updateWl(activeId, { codes: wl.codes.filter(c => c !== code) });
  };

  const createWl = () => {
    if (!newWlName.trim()) return;
    const wl: Watchlist = { id: Date.now().toString(36), name: newWlName.trim(), codes: [], createdAt: new Date().toISOString().slice(0,10), groups: [], codeGroups: {} };
    setWatchlists([...watchlists, wl]); setNewWlName('');
  };

  const deleteWl = (id: string) => {
    if (watchlists.length <= 1) return;
    const next = watchlists.filter(w => w.id !== id);
    setWatchlists(next);
    if (activeId === id) { setActiveId(next[0].id); saveActiveId(next[0].id); }
  };

  // Group management
  const addGroup = () => {
    if (!newGroupName.trim()) return;
    const wl = watchlists.find(w => w.id === activeId);
    if (!wl) return;
    const color = GROUP_COLORS[wl.groups.length % GROUP_COLORS.length];
    updateWl(activeId, { groups: [...wl.groups, { id: `g_${Date.now()}`, name: newGroupName.trim(), color }] });
    setNewGroupName('');
  };

  const removeGroup = (gid: string) => {
    const wl = watchlists.find(w => w.id === activeId);
    if (!wl) return;
    updateWl(activeId, {
      groups: wl.groups.filter(g => g.id !== gid),
      codeGroups: Object.fromEntries(Object.entries(wl.codeGroups).map(([c, gs]) => [c, gs.filter(g => g !== gid)])),
    });
    if (groupFilter === gid) setGroupFilter('');
  };

  const toggleGroup = (code: string, gid: string) => {
    const wl = watchlists.find(w => w.id === activeId);
    if (!wl) return;
    const current = wl.codeGroups[code] || [];
    const next = current.includes(gid) ? current.filter(g => g !== gid) : [...current, gid];
    updateWl(activeId, { codeGroups: { ...wl.codeGroups, [code]: next } });
  };

  // Group stats
  const groupStats = useMemo(() => {
    const wl = activeWlRef;
    if (!wl) return {};
    const stats: Record<string, { count: number; avgChange: number }> = {};
    for (const g of wl.groups) {
      const codes = wl.codes.filter(c => wl.codeGroups[c]?.includes(g.id));
      const qs = quotes.filter(q => codes.includes(q.code) && q.changePct !== 0);
      stats[g.id] = { count: codes.length, avgChange: qs.length > 0 ? Math.round(qs.reduce((s,q) => s + q.changePct, 0) / qs.length * 100) / 100 : 0 };
    }
    return stats;
  }, [watchlists, activeId, quotes]);

  // ── One-click Research ──
  const runGroupResearch = async () => {
    setResearching(true); setResearchReport('');
    const targetQuotes = filteredQuotes.slice(0, 10); // top 10 for speed

    try {
      // Quick score each stock with available data
      const scored: { q: StockQuote; score: number; signals: string[]; patterns: string[] }[] = [];

      for (const q of targetQuotes) {
        let score = 50;
        const signals: string[] = [];
        const patterns: string[] = [];

        // Quick scoring from quote data
        if (q.changePct > 2) { score += 8; signals.push('今日强势'); }
        else if (q.changePct > 0) { score += 3; }
        else if (q.changePct < -3) { score -= 8; signals.push('今日弱势'); }
        if (q.pe > 0 && q.pe < 15) { score += 8; signals.push('PE低估'); }
        else if (q.pe > 50) { score -= 5; }
        if (q.pb > 0 && q.pb < 1.5) { score += 5; signals.push('PB低'); }
        if (q.turnover > 3 && q.turnover < 15) { score += 4; signals.push('换手活跃'); }
        if (q.totalCap > 500) { score += 3; }

        // Try K-line for tech signals
        try {
          const klines = await fetchEastmoneyKLine(q.code, 60);
          if (klines.length >= 20) {
            calcAllIndicators(klines);
            const last = klines[klines.length - 1] as any;
            const prev = klines[klines.length - 2] as any;
            if (last?.macd) {
              if (last.macd.dif > last.macd.dea) { score += 5; signals.push('MACD多头'); }
              if (prev?.macd && prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea) { score += 8; signals.push('MACD金叉'); }
            }
            if (last?.kdj && last.kdj.j < 20) { score += 5; signals.push('KDJ超卖'); }
            // Patterns
            const pats = scanPatterns(klines);
            pats.filter(p => p.type === 'bullish').forEach(p => { score += 3; patterns.push(p.name); });
            pats.filter(p => p.type === 'bearish').forEach(p => { score -= 3; patterns.push(p.name); });
          }
        } catch {}

        scored.push({ q, score: Math.round(Math.max(0, Math.min(100, score))), signals, patterns });
      }

      scored.sort((a, b) => b.score - a.score);

      // Build AI prompt
      const stockList = scored.map((s, i) =>
        `${i + 1}. ${s.q.name}(${s.q.code}) | 评分${s.score} | ¥${s.q.price.toFixed(2)} | ${s.q.changePct >= 0 ? '+' : ''}${s.q.changePct.toFixed(2)}% | PE:${s.q.pe > 0 ? s.q.pe.toFixed(1) : '—'} | PB:${s.q.pb > 0 ? s.q.pb.toFixed(2) : '—'} | 市值:${s.q.totalCap > 0 ? s.q.totalCap.toFixed(0) + '亿' : '—'} | 换手:${s.q.turnover > 0 ? s.q.turnover.toFixed(1) + '%' : '—'}` +
        (s.signals.length > 0 ? ` | 信号:${s.signals.join('/')}` : '') +
        (s.patterns.length > 0 ? ` | 形态:${s.patterns.join('/')}` : '')
      ).join('\n');

      const prompt = `你是资深A股投资组合分析师。请基于以下自选股池的实时数据，给出专业研究分析：

${stockList}

请从以下角度分析：
1. **整体评价**：这个组合的整体质量如何？
2. **排名前三**：哪3只最值得关注？为什么？
3. **风险提示**：组合中有哪些需要警惕的标的？
4. **配置建议**：从行业/风格角度看，这个组合是否有集中风险？建议如何调整？
5. **操作策略**：基于当前市场环境，给出整体操作建议。

控制在400字以内，给出具体建议。`;

      const response = await executeAiTask({
        taskId: 'securities.portfolio',
        systemPrompt: '你是资深A股投资组合分析师。基于数据给出具体、可操作的建议。',
        userPrompt: prompt,
        responseFormat: 'text',
      }, getAiGatewayRuntime());
      setResearchReport(response.content || 'AI 未返回有效回答');
    } catch (e) {
      setResearchReport('研究失败：' + (e instanceof AiGatewayError ? e.userMessage : e instanceof Error ? e.message : '网络错误'));
    } finally { setResearching(false); }
  };

  // Filtered quotes
  const filteredCodes = new Set(groupFilter ? watchlists.find(w => w.id === activeId)?.codes.filter(c => watchlists.find(w => w.id === activeId)?.codeGroups[c]?.includes(groupFilter)) : watchlists.find(w => w.id === activeId)?.codes);
  const filteredQuotes = sortWatchlistItemsByAdvice(
    quotes.filter(q => filteredCodes.has(q.code)),
    adviceStates,
    shortTermStates,
  );

  const adviceCompleted = quotes.filter(quote => {
    const state = adviceStates[quote.code];
    return state?.status === 'success' || state?.status === 'error';
  }).length;

  const shortTermCompleted = quotes.filter(quote => {
    const state = shortTermStates[quote.code];
    return state?.status === 'success' || state?.status === 'error';
  }).length;

  const refreshAllAdvice = () => {
    clearWatchlistAdviceCache(quotes.map(quote => quote.code));
    clearWatchlistShortTermAdviceCache(quotes.map(quote => quote.code));
    runAdviceAnalysis(quotes, true);
    runShortTermAnalysis(quotes, true);
  };

  const retryAdvice = async (quote: StockQuote) => {
    const runId = adviceRunRef.current;
    setAdviceStates(previous => ({ ...previous, [quote.code]: { status: 'loading' } }));
    try {
      const advice = await analyzeWatchlistStock(quote, { force: true });
      if (adviceRunRef.current !== runId) return;
      setAdviceStates(previous => ({ ...previous, [quote.code]: { status: 'success', advice } }));
    } catch (error) {
      if (adviceRunRef.current !== runId) return;
      setAdviceStates(previous => ({
        ...previous,
        [quote.code]: {
          status: 'error',
          error: error instanceof Error ? error.message : '建议分析失败',
        },
      }));
    }
  };

  const retryShortTermAdvice = async (quote: StockQuote) => {
    const runId = shortTermRunRef.current;
    setShortTermStates(previous => ({ ...previous, [quote.code]: { status: 'loading' } }));
    try {
      const advice = await analyzeWatchlistShortTermStock(quote, { force: true });
      if (shortTermRunRef.current !== runId) return;
      setShortTermStates(previous => ({ ...previous, [quote.code]: { status: 'success', advice } }));
    } catch (error) {
      if (shortTermRunRef.current !== runId) return;
      setShortTermStates(previous => ({
        ...previous,
        [quote.code]: {
          status: 'error',
          error: error instanceof Error ? error.message : '短线建议分析失败',
        },
      }));
    }
  };

  return (
    <div className="module-page" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <NavLink to={backUrl} style={{ color: '#70b8b0', fontSize: '0.85rem', display: 'inline-block', marginBottom: 16 }}>← 返回证券工作台</NavLink>
      <h1 style={{ color: '#d4a574', margin: '0 0 8px' }}>📋 自选股池管理</h1>
      {cloudSyncError && (
        <div role="alert" style={{ color: '#fecaca', background: '#451a1a', border: '1px solid #b91c1c', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
          云端自选股同步失败：{cloudSyncError}。为保护已有云数据，本次失败没有覆盖云端。
        </div>
      )}

      {/* Watchlist selector + actions */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {watchlists.map(wl => (
          <button key={wl.id} onClick={() => { setActiveId(wl.id); saveActiveId(wl.id); setGroupFilter(''); }}
            style={{
              padding: '6px 14px', border: activeId === wl.id ? '2px solid #70b8b0' : '1px solid #3a5a5a',
              borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', fontWeight: activeId === wl.id ? 'bold' : 'normal',
              background: activeId === wl.id ? '#1a3a3a' : '#0d1a1a', color: activeId === wl.id ? '#70b8b0' : '#ffffff',
            }}>{wl.name} ({wl.codes.length})</button>
        ))}
        <input value={newWlName} onChange={e => setNewWlName(e.target.value)} placeholder="新分组名..."
          onKeyDown={e => e.key === 'Enter' && createWl()}
          style={{ width: 100, background: '#0d1a1a', border: '1px dashed #3a5a5a', color: '#d4a574', padding: '6px 10px', borderRadius: 4, fontSize: '0.8rem' }} />
        <button className="button" onClick={createWl} style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#70b8b0', color: '#0d1a1a', fontWeight: 'bold' }}>+</button>
        {watchlists.length > 1 && <button className="button" onClick={() => deleteWl(activeId)} style={{ padding: '6px 10px', fontSize: '0.75rem', color: '#f87171' }}>删除当前</button>}
      </div>

      {/* Groups */}
      {activeWl && activeWl.groups.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setGroupFilter('')}
            style={{ padding: '3px 10px', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: '0.72rem',
              background: !groupFilter ? '#70b8b0' : '#1a3a3a', color: !groupFilter ? '#0d1a1a' : '#ffffff' }}>全部</button>
          {activeWl.groups.map(g => {
            const stat = groupStats[g.id];
            return (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button onClick={() => setGroupFilter(groupFilter === g.id ? '' : g.id)}
                  style={{ padding: '3px 10px', border: `2px solid ${g.color}`, borderRadius: 10, cursor: 'pointer', fontSize: '0.72rem',
                    background: groupFilter === g.id ? g.color + '33' : 'transparent', color: g.color }}>
                  {g.name} ({stat?.count || 0})
                  {stat && <span style={{ marginLeft: 4, fontSize: '0.65rem', color: stat.avgChange >= 0 ? '#ff6666' : '#66cc66' }}>{stat.avgChange >= 0 ? '+' : ''}{stat.avgChange}%</span>}
                </button>
                <button onClick={() => removeGroup(g.id)} style={{ border: 'none', background: 'none', color: '#5a5a5a', cursor: 'pointer', fontSize: '0.65rem', padding: 0 }}>✕</button>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 4 }}>
            <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="新标签..."
              onKeyDown={e => e.key === 'Enter' && addGroup()}
              style={{ width: 70, background: '#0d1a1a', border: '1px dashed #3a5a5a', color: '#d4a574', padding: '3px 8px', borderRadius: 10, fontSize: '0.7rem' }} />
            <button onClick={addGroup} style={{ border: 'none', background: '#70b8b0', color: '#0d1a1a', borderRadius: 10, cursor: 'pointer', fontSize: '0.7rem', padding: '3px 8px' }}>+标签</button>
          </div>
        </div>
      )}

      {/* One-click Research Button */}
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="button" onClick={runGroupResearch} disabled={researching || filteredQuotes.length === 0}
          style={{ padding: '8px 18px', background: researching ? '#5a5040' : '#d4a574', color: '#0d1a1a', fontWeight: 'bold', fontSize: '0.82rem' }}>
          {researching ? '⏳ 分析中...' : `🔬 一键研究 (${Math.min(filteredQuotes.length, 10)}只)`}
        </button>
        <span style={{ color: '#70b8b0', fontSize: '0.72rem' }}>
          取前10只，拉K线+指标+形态，AI横向对比
        </span>
      </div>


      <div style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: '#d7dcdd', fontSize: '0.78rem' }}>
          短线建议分析：{shortTermCompleted} / {quotes.length}
        </span>
        <span style={{ color: '#d7dcdd', fontSize: '0.78rem' }}>
          中线建议分析：{adviceCompleted} / {quotes.length}
        </span>
        <RealtimeQuoteStatus
          refreshing={realtime.refreshing}
          marketStatus={realtime.marketStatus}
          lastUpdatedAt={realtime.lastUpdatedAt}
          stale={realtime.stale}
          error={realtime.error}
          onRefresh={() => { void realtime.refreshNow(); }}
        />
        <button type="button" className="button" onClick={refreshAllAdvice} disabled={quotes.length === 0}>
          刷新全部建议
        </button>
      </div>
      {/* Research Report */}
      {researchReport && (
        <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #d4a574', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ color: '#d4a574', margin: 0 }}>🔬 股池研究报告</h3>
            <button onClick={() => setResearchReport('')} style={{ border: 'none', background: 'none', color: '#70b8b0', cursor: 'pointer', fontSize: '0.8rem' }}>✕ 关闭</button>
          </div>
          <div style={{ color: '#e0e0e0', fontSize: '0.85rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {researchReport}
          </div>
        </div>
      )}

      {/* Search */}
      <div style={{ marginBottom: 12, position: 'relative' }}>
        <input value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="搜索股票加入..."
          style={{ width: '100%', background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#d4a574', padding: '8px 12px', borderRadius: 6, fontSize: '0.85rem' }} />
        {addResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#1a2a2a', border: '1px solid #3a5a5a', borderRadius: 6, maxHeight: 250, overflowY: 'auto', marginTop: 4 }}>
            {addResults.map(s => (
              <div key={s.code} onClick={() => addStock(s.code)} style={{ cursor: 'pointer', padding: '6px 12px', fontSize: '0.82rem', color: activeWl?.codes.includes(s.code) ? '#5a7a7a' : '#ffffff', borderBottom: '1px solid #1a3a3a' }}>
                {s.code} — {s.name} {activeWl?.codes.includes(s.code) ? '(已添加)' : ''}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Group assignment modal-like row */}
      {activeWl && activeWl.groups.length > 0 && groupFilter && (
        <div style={{ fontSize: '0.7rem', color: '#d4a574', marginBottom: 8 }}>
          筛选: <span style={{ color: activeWl.groups.find(g => g.id === groupFilter)?.color, fontWeight: 'bold' }}>{activeWl.groups.find(g => g.id === groupFilter)?.name}</span> 的股票
        </div>
      )}

      {/* Quote Table */}
      {filteredQuotes.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr style={{ color: '#d4a574', fontSize: '0.78rem' }}>
              <th>代码</th><th>名称</th><th>最新价</th><th>涨跌幅</th><th>PE</th><th>市值(亿)</th><th>短线建议</th><th>中线建议</th>
              <th>持仓操作</th>
              {activeWl && activeWl.groups.length > 0 && <th>标签</th>}
              <th></th>
            </tr></thead>
            <tbody>
              {filteredQuotes.map(q => {
                const codeGroups = activeWl?.codeGroups[q.code] || [];
                const adviceState = adviceStates[q.code] ?? { status: 'waiting' as const };
                const shortTermState = shortTermStates[q.code] ?? { status: 'waiting' as const };
                return (
                  <Fragment key={q.code}>
                  <tr onClick={() => navigate(`/projects/${projectId || 'default'}/securities/stock/${q.code}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ color: '#70b8b0' }}>{q.code}</td>
                    <td style={{ color: '#d4a574', fontWeight: 500 }}>{q.name}</td>
                    <td style={{ color: '#d4a574', fontWeight: 'bold' }}>{q.price.toFixed(2)}</td>
                    <td style={{ color: q.changePct >= 0 ? '#f56c6c' : '#67c23a', fontWeight: 'bold' }}>{q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%</td>
                    <td style={{ color: '#d4a574' }}>{q.pe > 0 ? q.pe.toFixed(1) : '—'}</td>
                    <td style={{ color: '#d4a574' }}>{q.totalCap > 0 ? q.totalCap.toFixed(0) : '—'}</td>
                    <WatchlistShortTermAdviceCell
                      stockName={q.name}
                      state={shortTermState}
                      expanded={expandedShortTermCode === q.code}
                      onToggle={() => setExpandedShortTermCode(code => code === q.code ? '' : q.code)}
                      onRetry={() => { void retryShortTermAdvice(q); }}
                    />
                    <WatchlistAdviceCell
                      stockName={q.name}
                      state={adviceState}
                      expanded={expandedAdviceCode === q.code}
                      onToggle={() => setExpandedAdviceCode(code => code === q.code ? '' : q.code)}
                      onRetry={() => { void retryAdvice(q); }}
                    />
                    <WatchlistPositionCell
                      quote={q}
                      ledger={positionLedger.ledger}
                      ledgerError={positionLedger.error}
                      onLedgerChanged={positionLedger.reload}
                      onBuy={positionLedger.buy}
                    />
                    {activeWl && activeWl.groups.length > 0 && (
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                          {activeWl.groups.map(g => (
                            <span key={g.id} onClick={() => toggleGroup(q.code, g.id)}
                              style={{
                                padding: '1px 6px', borderRadius: 8, fontSize: '0.6rem', cursor: 'pointer', fontWeight: 'bold',
                                background: codeGroups.includes(g.id) ? g.color : 'transparent',
                                color: codeGroups.includes(g.id) ? '#0d1a1a' : g.color,
                                border: `1px solid ${g.color}`,
                              }}>{g.name}</span>
                          ))}
                        </div>
                      </td>
                    )}
                    <td><button className="button" style={{ fontSize: '0.65rem', padding: '2px 6px' }} onClick={e => { e.stopPropagation(); removeStock(q.code); }}>✕</button></td>
                  </tr>
                  {expandedShortTermCode === q.code && shortTermState.status === 'success' && (
                    <WatchlistShortTermAdviceDetailRow
                      advice={shortTermState.advice}
                      colSpan={activeWl && activeWl.groups.length > 0 ? 11 : 10}
                    />
                  )}
                  {expandedAdviceCode === q.code && adviceState.status === 'success' && (
                    <WatchlistAdviceDetailRow
                      advice={adviceState.advice}
                      colSpan={activeWl && activeWl.groups.length > 0 ? 11 : 10}
                    />
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ color: '#d4a574', padding: 30, textAlign: 'center' }}>
          {loading ? '加载行情中...' : activeWl?.codes.length === 0 ? '股池为空，请搜索添加股票' : '暂无匹配数据'}
        </div>
      )}
    </div>
  );
}
