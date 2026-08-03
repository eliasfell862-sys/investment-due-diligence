import { useState, useEffect, useMemo } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { loadStockDirectory, fetchSinaQuotes, type StockQuote } from '../../infrastructure/market-data/stock-api';

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
  const backUrl = projectId ? `/projects/${projectId}/securities` : '/securities';

  const [watchlists, setWatchlists] = useState<Watchlist[]>(() => {
    const wls = load(); return wls.length > 0 ? wls : [DEFAULT_WL];
  });
  const [activeId, setActiveId] = useState(() => loadActiveId() || watchlists[0]?.id || 'default');
  const [selectedWl, setSelectedWl] = useState<Watchlist | null>(null);
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [groupFilter, setGroupFilter] = useState('');
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<{ code: string; name: string }[]>([]);
  const [newWlName, setNewWlName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [dragCode, setDragCode] = useState<string | null>(null);

  // Persist
  useEffect(() => { save(watchlists); }, [watchlists]);
  useEffect(() => { if (activeId) saveActiveId(activeId); }, [activeId]);

  const activeWl = watchlists.find(w => w.id === activeId);

  // Load quotes
  useEffect(() => {
    if (!selectedWl || selectedWl.codes.length === 0) { setQuotes([]); return; }
    setLoading(true);
    fetchSinaQuotes(selectedWl.codes).then(q => setQuotes(q.filter(x => x.price > 0))).catch(() => {}).finally(() => setLoading(false));
  }, [selectedWl?.id, selectedWl?.codes.length]);

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
    if (selectedWl?.id === id) setSelectedWl(prev => prev ? { ...prev, ...patch } : null);
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
    if (selectedWl?.id === id) setSelectedWl(null);
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

  // Filtered quotes
  const filteredCodes = new Set(groupFilter ? watchlists.find(w => w.id === activeId)?.codes.filter(c => watchlists.find(w => w.id === activeId)?.codeGroups[c]?.includes(groupFilter)) : watchlists.find(w => w.id === activeId)?.codes);
  const filteredQuotes = quotes.filter(q => filteredCodes.has(q.code));

  return (
    <div className="module-page" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <NavLink to={backUrl} style={{ color: '#70b8b0', fontSize: '0.85rem', display: 'inline-block', marginBottom: 16 }}>← 返回证券工作台</NavLink>
      <h1 style={{ color: '#e0e0e0', margin: '0 0 8px' }}>📋 自选股池管理</h1>

      {/* Watchlist selector + actions */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {watchlists.map(wl => (
          <button key={wl.id} onClick={() => { setActiveId(wl.id); saveActiveId(wl.id); setGroupFilter(''); }}
            style={{
              padding: '6px 14px', border: activeId === wl.id ? '2px solid #70b8b0' : '1px solid #3a5a5a',
              borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', fontWeight: activeId === wl.id ? 'bold' : 'normal',
              background: activeId === wl.id ? '#1a3a3a' : '#0d1a1a', color: activeId === wl.id ? '#70b8b0' : '#e8e0d0',
            }}>{wl.name} ({wl.codes.length})</button>
        ))}
        <input value={newWlName} onChange={e => setNewWlName(e.target.value)} placeholder="新分组名..."
          onKeyDown={e => e.key === 'Enter' && createWl()}
          style={{ width: 100, background: '#0d1a1a', border: '1px dashed #3a5a5a', color: '#e0e0e0', padding: '6px 10px', borderRadius: 4, fontSize: '0.8rem' }} />
        <button className="button" onClick={createWl} style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#70b8b0', color: '#0d1a1a', fontWeight: 'bold' }}>+</button>
        {watchlists.length > 1 && <button className="button" onClick={() => deleteWl(activeId)} style={{ padding: '6px 10px', fontSize: '0.75rem', color: '#f87171' }}>删除当前</button>}
      </div>

      {/* Groups */}
      {activeWl && activeWl.groups.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setGroupFilter('')}
            style={{ padding: '3px 10px', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: '0.72rem',
              background: !groupFilter ? '#70b8b0' : '#1a3a3a', color: !groupFilter ? '#0d1a1a' : '#e8e0d0' }}>全部</button>
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
              style={{ width: 70, background: '#0d1a1a', border: '1px dashed #3a5a5a', color: '#e0e0e0', padding: '3px 8px', borderRadius: 10, fontSize: '0.7rem' }} />
            <button onClick={addGroup} style={{ border: 'none', background: '#70b8b0', color: '#0d1a1a', borderRadius: 10, cursor: 'pointer', fontSize: '0.7rem', padding: '3px 8px' }}>+标签</button>
          </div>
        </div>
      )}

      {/* Search */}
      <div style={{ marginBottom: 12, position: 'relative' }}>
        <input value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="搜索股票加入..."
          style={{ width: '100%', background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '8px 12px', borderRadius: 6, fontSize: '0.85rem' }} />
        {addResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#1a2a2a', border: '1px solid #3a5a5a', borderRadius: 6, maxHeight: 250, overflowY: 'auto', marginTop: 4 }}>
            {addResults.map(s => (
              <div key={s.code} onClick={() => addStock(s.code)} style={{ cursor: 'pointer', padding: '6px 12px', fontSize: '0.82rem', color: activeWl?.codes.includes(s.code) ? '#5a7a7a' : '#e8e0d0', borderBottom: '1px solid #1a3a3a' }}>
                {s.code} — {s.name} {activeWl?.codes.includes(s.code) ? '(已添加)' : ''}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Group assignment modal-like row */}
      {activeWl && activeWl.groups.length > 0 && groupFilter && (
        <div style={{ fontSize: '0.7rem', color: '#e8e0d0', marginBottom: 8 }}>
          筛选: <span style={{ color: activeWl.groups.find(g => g.id === groupFilter)?.color, fontWeight: 'bold' }}>{activeWl.groups.find(g => g.id === groupFilter)?.name}</span> 的股票
        </div>
      )}

      {/* Quote Table */}
      {filteredQuotes.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr style={{ color: '#e8e0d0', fontSize: '0.78rem' }}>
              <th>代码</th><th>名称</th><th>最新价</th><th>涨跌幅</th><th>PE</th><th>市值(亿)</th>
              {activeWl && activeWl.groups.length > 0 && <th>标签</th>}
              <th></th>
            </tr></thead>
            <tbody>
              {filteredQuotes.map(q => {
                const codeGroups = activeWl?.codeGroups[q.code] || [];
                return (
                  <tr key={q.code} onClick={() => navigate(`/projects/${projectId || 'default'}/securities/stock/${q.code}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ color: '#9a9a9a' }}>{q.code}</td>
                    <td style={{ color: '#e0e0e0', fontWeight: 500 }}>{q.name}</td>
                    <td style={{ color: '#e0e0e0', fontWeight: 'bold' }}>{q.price.toFixed(2)}</td>
                    <td style={{ color: q.changePct >= 0 ? '#f56c6c' : '#67c23a', fontWeight: 'bold' }}>{q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%</td>
                    <td style={{ color: '#e8e0d0' }}>{q.pe > 0 ? q.pe.toFixed(1) : '—'}</td>
                    <td style={{ color: '#e8e0d0' }}>{q.totalCap > 0 ? q.totalCap.toFixed(0) : '—'}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ color: '#e8e0d0', padding: 30, textAlign: 'center' }}>
          {loading ? '加载行情中...' : activeWl?.codes.length === 0 ? '股池为空，请搜索添加股票' : '暂无匹配数据'}
        </div>
      )}
    </div>
  );
}
