import { useState, useEffect } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { loadStockDirectory, fetchSinaQuotes, type StockQuote } from '../../infrastructure/market-data/stock-api';

interface Watchlist {
  id: string;
  name: string;
  codes: string[];
  createdAt: string;
}

const STORAGE_KEY = 'sec_watchlists';
const ACTIVE_KEY = 'sec_active_watchlist';

function loadWatchlists(): Watchlist[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveWatchlists(wls: Watchlist[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(wls)); }
function loadActiveId(): string | null { return localStorage.getItem(ACTIVE_KEY); }
function saveActiveId(id: string) { localStorage.setItem(ACTIVE_KEY, id); }

// Default watchlist with 36 major A-shares
const DEFAULT_WL: Watchlist = {
  id: 'default', name: '默认自选', createdAt: '2026-08-01',
  codes: ['000001','000002','000333','000538','000651','000858','002049','002230','002415','002594','300015','300059','300122','300274','300750','600000','600030','600031','600036','600085','600276','600309','600519','600570','600585','600690','600809','600887','600900','601012','601088','601166','601318','601398','601899','688981'],
};

export function WatchlistPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const backUrl = projectId ? `/projects/${projectId}/securities` : '/securities';

  const [watchlists, setWatchlists] = useState<Watchlist[]>(() => {
    const wls = loadWatchlists();
    return wls.length > 0 ? wls : [DEFAULT_WL];
  });
  const [activeId, setActiveId] = useState<string>(() => loadActiveId() || watchlists[0]?.id || 'default');
  const [selectedWl, setSelectedWl] = useState<Watchlist | null>(null);
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingName, setEditingName] = useState('');
  const [editWlId, setEditWlId] = useState<string | null>(null);
  // Stock search for adding
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<{ code: string; name: string }[]>([]);

  // Init
  useEffect(() => { saveWatchlists(watchlists); }, [watchlists]);
  useEffect(() => { if (activeId) saveActiveId(activeId); }, [activeId]);

  // Load quotes for selected watchlist
  useEffect(() => {
    const wl = watchlists.find(w => w.id === selectedWl?.id);
    if (!wl || wl.codes.length === 0) { setQuotes([]); return; }
    setLoading(true);
    fetchSinaQuotes(wl.codes).then(setQuotes).catch(() => {}).finally(() => setLoading(false));
  }, [selectedWl?.id, selectedWl?.codes.length]);

  // Stock search for adding
  useEffect(() => {
    if (!addSearch.trim()) { setAddResults([]); return; }
    loadStockDirectory().then(dir => {
      const kw = addSearch.toLowerCase();
      setAddResults(dir.filter((s: any) => s.code.includes(kw) || s.name.toLowerCase().includes(kw)).slice(0, 20));
    });
  }, [addSearch]);

  // Actions
  const createWl = () => {
    if (!newName.trim()) return;
    const wl: Watchlist = { id: Date.now().toString(36), name: newName.trim(), codes: [], createdAt: new Date().toISOString().slice(0, 10) };
    setWatchlists([...watchlists, wl]); setNewName('');
  };

  const deleteWl = (id: string) => {
    if (watchlists.length <= 1) return;
    const next = watchlists.filter(w => w.id !== id);
    setWatchlists(next);
    if (activeId === id) setActiveId(next[0].id);
    if (selectedWl?.id === id) setSelectedWl(null);
  };

  const renameWl = (id: string) => {
    if (!editingName.trim()) { setEditWlId(null); return; }
    setWatchlists(watchlists.map(w => w.id === id ? { ...w, name: editingName.trim() } : w));
    setEditWlId(null); setEditingName('');
  };

  const addToWl = (wlId: string, code: string, _name: string) => {
    setWatchlists(watchlists.map(w => {
      if (w.id !== wlId || w.codes.includes(code)) return w;
      return { ...w, codes: [...w.codes, code] };
    }));
    // Also update selected if it's this one
    if (selectedWl?.id === wlId) {
      setSelectedWl(prev => prev ? { ...prev, codes: [...prev.codes.filter(c => c !== code), code] } : prev);
    }
  };

  const removeFromWl = (wlId: string, code: string) => {
    setWatchlists(watchlists.map(w => w.id === wlId ? { ...w, codes: w.codes.filter(c => c !== code) } : w));
    if (selectedWl?.id === wlId) {
      setSelectedWl(prev => prev ? { ...prev, codes: prev.codes.filter(c => c !== code) } : prev);
    }
  };

  const color = (v: number) => v > 0 ? '#f56c6c' : v < 0 ? '#67c23a' : '#aaa';

  return (
    <div className="module-page" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <NavLink to={backUrl} style={{ color: '#70b8b0', fontSize: '0.85rem', display: 'inline-block', marginBottom: 16 }}>
        ← 返回证券工作台
      </NavLink>
      <h1 style={{ color: '#e0e0e0', margin: '0 0 8px' }}>📋 自选股池管理</h1>
      <p style={{ color: '#bbbbbb', fontSize: '0.85rem', marginBottom: 20 }}>
        创建多个自选股池，按策略或行业分类管理。设为"当前活跃"后，证券工作台和智能荐股将使用该股池。
      </p>

      {/* Watchlist List */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12, marginBottom: 24 }}>
        {watchlists.map(wl => (
          <div key={wl.id} style={{
            background: activeId === wl.id ? '#1a3a3a' : '#1a2a2a',
            padding: 14, borderRadius: 8,
            border: activeId === wl.id ? '2px solid #70b8b0' : '1px solid #2a4a4a',
            cursor: 'pointer',
          }} onClick={() => setSelectedWl(wl)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {editWlId === wl.id ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={editingName} onChange={e => setEditingName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && renameWl(wl.id)}
                    autoFocus style={{ width: 150, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '4px 8px', borderRadius: 4, fontSize: '0.9rem' }} />
                  <button className="button" onClick={() => renameWl(wl.id)} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>✓</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#e0e0e0', fontWeight: 'bold', fontSize: '0.95rem' }}>{wl.name}</span>
                  {activeId === wl.id && <span style={{ background: '#70b8b0', color: '#0d1a1a', padding: '1px 8px', borderRadius: 8, fontSize: '0.65rem', fontWeight: 'bold' }}>当前活跃</span>}
                </div>
              )}
              <div style={{ display: 'flex', gap: 4 }}>
                {activeId !== wl.id && <button className="button" onClick={e => { e.stopPropagation(); setActiveId(wl.id); }} style={{ padding: '2px 8px', fontSize: '0.65rem' }}>激活</button>}
                <button className="button" onClick={e => { e.stopPropagation(); setEditWlId(wl.id); setEditingName(wl.name); }} style={{ padding: '2px 6px', fontSize: '0.65rem' }}>✎</button>
                <button className="button" onClick={e => { e.stopPropagation(); deleteWl(wl.id); }} style={{ padding: '2px 6px', fontSize: '0.65rem', color: '#f87171' }}>✕</button>
              </div>
            </div>
            <div style={{ color: '#9a9a9a', fontSize: '0.72rem', marginTop: 6 }}>
              {wl.codes.length} 只股票 · 创建于 {wl.createdAt}
            </div>
          </div>
        ))}

        {/* New watchlist */}
        <div style={{ background: '#0d1f1f', padding: 14, borderRadius: 8, border: '1px dashed #3a5a5a', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createWl()}
            placeholder="新自选池名称..."
            style={{ flex: 1, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '6px 10px', borderRadius: 4 }} />
          <button className="button" onClick={createWl} style={{ background: '#70b8b0', color: '#0d1a1a', padding: '6px 14px', fontWeight: 'bold' }}>+ 创建</button>
        </div>
      </div>

      {/* Selected Watchlist Detail */}
      {selectedWl && (
        <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ color: '#e0e0e0', margin: 0 }}>📌 {selectedWl.name} ({selectedWl.codes.length} 只)</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={addSearch} onChange={e => setAddSearch(e.target.value)}
                placeholder="搜索股票加入此池..."
                style={{ width: 180, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '4px 10px', borderRadius: 4, fontSize: '0.8rem' }} />
            </div>
          </div>

          {/* Add search results */}
          {addSearch && addResults.length > 0 && (
            <div style={{ marginBottom: 12, background: '#0d1f1f', padding: 8, borderRadius: 6, maxHeight: 200, overflowY: 'auto' }}>
              {addResults.map(s => (
                <div key={s.code} onClick={() => { addToWl(selectedWl.id, s.code, s.name); setAddSearch(''); setAddResults([]); }}
                  style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 3, fontSize: '0.8rem', color: '#cccccc',
                    background: selectedWl.codes.includes(s.code) ? '#1a3a3a' : 'transparent' }}>
                  {s.code} — {s.name} {selectedWl.codes.includes(s.code) ? '(已添加)' : ''}
                </div>
              ))}
            </div>
          )}

          {/* Quotes table */}
          {quotes.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr style={{ color: '#bbbbbb', fontSize: '0.78rem' }}>
                  <th>代码</th><th>名称</th><th>最新价</th><th>涨跌幅</th><th>PE</th><th>总市值</th><th></th>
                </tr></thead>
                <tbody>
                  {quotes.map(q => (
                    <tr key={q.code} onClick={() => navigate(`/projects/${projectId || 'default'}/securities/stock/${q.code}`)}
                      style={{ cursor: 'pointer' }}>
                      <td style={{ color: '#9a9a9a' }}>{q.code}</td>
                      <td style={{ color: '#e0e0e0', fontWeight: 500 }}>{q.name}</td>
                      <td style={{ color: '#e0e0e0', fontWeight: 'bold' }}>{q.price.toFixed(2)}</td>
                      <td style={{ color: color(q.changePct), fontWeight: 'bold' }}>{q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%</td>
                      <td style={{ color: '#cccccc' }}>{q.pe > 0 ? q.pe.toFixed(1) : '—'}</td>
                      <td style={{ color: '#cccccc' }}>{q.totalCap > 0 ? `${q.totalCap.toFixed(0)}亿` : '—'}</td>
                      <td>
                        <button className="button" style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                          onClick={e => { e.stopPropagation(); removeFromWl(selectedWl.id, q.code); }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ color: '#9a9a9a', padding: 24, textAlign: 'center' }}>
              {loading ? '加载行情中...' : selectedWl.codes.length === 0 ? '此股池为空，请搜索添加股票' : '点击"刷新行情"查看数据'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
