import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchSinaQuotes, fetchEastmoneyKLine, loadStockDirectory, filterAStocks, type StockQuote, type AStockDirectoryItem } from '../../infrastructure/market-data/stock-api';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import { fetchFundValuations, searchFunds, fetchFundHoldings, fetchFundNAVHistory, fetchTencentQuotes, addTransaction, loadPositions, loadTransactions, type FundValuation, type FundHolding, type FundPosition, type FundSearchResult, type FundNAVHistory } from '../../infrastructure/market-data/fund-api';
import { fetchConvertibleBonds, fetchTreasuryYieldCurve, type ConvertibleBond, type YieldCurvePoint } from '../../infrastructure/market-data/bond-api';
import { fetchAStockETFs, fetchGlobalETFs, type ETFItem, type GlobalETF } from '../../infrastructure/market-data/etf-api';
import { getGlobalStocks, fetchGlobalQuotes, type GlobalStock } from '../../infrastructure/market-data/global-stock-api';
import { fmtCap, fmtPct, colorPct } from '../../infrastructure/market-data/common';
import { runMultiAgentDebate, type DebateResult, type DebateDepth } from '../../engines/market-analysis/multi-agent-debate';
import { createMarketDataMeta, currentMarketDataTime } from '../../infrastructure/market-data/market-data-meta';
import { MarketDataStatusBadge } from './MarketDataStatusBadge';

import './SecuritiesWorkbenchPage.css';

type TabId = 'stock' | 'fund' | 'bond' | 'etf';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'stock', label: '股票', icon: '📈' },
  { id: 'fund', label: '基金', icon: '💰' },
  { id: 'bond', label: '债券', icon: '📜' },
  { id: 'etf', label: 'ETF', icon: '📊' },
];

const STOCK_POOL = [
  // 金融
  { code: '000001', name: '平安银行' }, { code: '600036', name: '招商银行' },
  { code: '601318', name: '中国平安' }, { code: '600030', name: '中信证券' },
  { code: '601398', name: '工商银行' }, { code: '601166', name: '兴业银行' },
  // 消费
  { code: '600519', name: '贵州茅台' }, { code: '000858', name: '五粮液' },
  { code: '000333', name: '美的集团' }, { code: '000651', name: '格力电器' },
  { code: '600887', name: '伊利股份' }, { code: '002714', name: '牧原股份' },
  { code: '600690', name: '海尔智家' }, { code: '603288', name: '海天味业' },
  // 科技
  { code: '002415', name: '海康威视' }, { code: '688981', name: '中芯国际' },
  { code: '002230', name: '科大讯飞' }, { code: '002049', name: '紫光国微' },
  { code: '688111', name: '金山办公' }, { code: '300124', name: '汇川技术' },
  // 新能源
  { code: '300750', name: '宁德时代' }, { code: '002594', name: '比亚迪' },
  { code: '601012', name: '隆基绿能' }, { code: '300274', name: '阳光电源' },
  // 医药
  { code: '600276', name: '恒瑞医药' }, { code: '300760', name: '迈瑞医疗' },
  { code: '000538', name: '云南白药' }, { code: '300122', name: '智飞生物' },
  // 周期
  { code: '601899', name: '紫金矿业' }, { code: '600809', name: '山西汾酒' },
  { code: '601088', name: '中国神华' }, { code: '600585', name: '海螺水泥' },
  // 地产
  { code: '000002', name: '万科A' }, { code: '001979', name: '招商蛇口' },
  // 基建
  { code: '601668', name: '中国建筑' }, { code: '600031', name: '三一重工' },
];

export function SecuritiesWorkbenchPage() {
  const navigate = useNavigate();
  const { projectId = 'default' } = useParams<{ projectId: string }>();
  const [activeTab, setActiveTab] = useState<TabId>('stock');
  const [watchlist, setWatchlist] = useState(STOCK_POOL);
  const [customCode, setCustomCode] = useState('');
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedStock, setSelectedStock] = useState<StockQuote | null>(null);
  // Full market search
  const [allStocks, setAllStocks] = useState<AStockDirectoryItem[]>([]);
  const [stockDirectoryLoading, setStockDirectoryLoading] = useState(true);
  const [stockDirectoryError, setStockDirectoryError] = useState('');
  const [stockSearch, setStockSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [showMarket, setShowMarket] = useState(false);

  // Load full A-share list on mount
  useEffect(() => {
    let cancelled = false;
    setStockDirectoryLoading(true);
    setStockDirectoryError('');

    loadStockDirectory()
      .then((list) => {
        if (cancelled) return;
        setAllStocks(list);
      })
      .catch(() => {
        if (!cancelled) setStockDirectoryError('股票目录加载失败');
      })
      .finally(() => {
        if (!cancelled) setStockDirectoryLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Fetch quotes
  const doRefresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const codes = watchlist.map(s => s.code);
      const results = await fetchSinaQuotes(codes);
      setQuotes(results);
      if (results.length === 0) setError('行情获取失败，请检查网络');
    } catch { setError('行情服务暂不可用'); }
    finally { setLoading(false); }
  }, [watchlist]);

  // Auto-refresh every 3 seconds, manual refresh resets timer
  useEffect(() => {
    doRefresh();
    const isTradeTime = () => {
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes(), d = now.getDay();
      if (d === 0 || d === 6) return false;
      const t = h * 100 + m;
      return (t >= 925 && t <= 1135) || (t >= 1255 && t <= 1505);
    };
    if (!isTradeTime()) return;
    const interval = setInterval(doRefresh, 3000);
    return () => clearInterval(interval);
  }, [watchlist]);

  const addStock = (code: string, name?: string) => {
    if (!code) return;
    if (!watchlist.find(s => s.code === code)) {
      setWatchlist([...watchlist, { code, name: name || code }]);
    }
    setCustomCode('');
    setShowMarket(false);
    setStockSearch('');
    setStockFilter('');
  };

  // Jump to stock detail page
  const viewStock = (code: string, name?: string) => {
    addStock(code, name);
    navigate(`/projects/${projectId}/securities/stock/${code}`);
  };

  // Handle Enter key
  const handleSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && filteredStocks.length > 0) {
      const first = filteredStocks[0];
      viewStock(first.code, first.name);
    }
  };

  // Filtered stocks for market browser
  const industries = [...new Set(allStocks.map(s => s.industry).filter(Boolean))].sort();
  const filteredStocks = filterAStocks(allStocks, stockSearch, stockFilter).slice(0, 100);

  const removeStock = (code: string) => {
    setWatchlist(watchlist.filter(s => s.code !== code));
  };

  const color = (v: number) => v > 0 ? 'var(--sec-gain)' : v < 0 ? 'var(--sec-loss)' : 'var(--sec-text-muted)';

  return (
    <section className="page securities-workbench-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Securities / 证券研究</p>
          <h1>证券项目工作台</h1>
          <p className="page-intro">股票 · 基金 · 债券 · ETF 综合研究平台</p>
        </div>
      </header>

      {/* Tabs */}
      <nav className="securities-tabs" aria-label="证券资产类别"
        style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--sec-border)' }}>
        {TABS.map(tab => (
          <button key={tab.id}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 24px', border: 'none', cursor: 'pointer',
              background: activeTab === tab.id ? 'var(--sec-selected)' : 'transparent',
              color: activeTab === tab.id ? 'var(--sec-accent)' : 'var(--sec-text-secondary)',
              borderBottom: activeTab === tab.id ? '2px solid var(--sec-accent)' : '2px solid transparent',
              fontSize: '0.95rem', fontWeight: activeTab === tab.id ? 'bold' : 'normal',
              transition: 'all 0.2s',
            }}
          >{tab.icon} {tab.label}</button>
        ))}
      </nav>

      {/* ── Stock Tab ── */}
      {activeTab === 'stock' && (
        <>
          {/* Search & Market Browser */}
          <div className="securities-toolbar"
            style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <input value={customCode} onChange={e => { setCustomCode(e.target.value); setStockSearch(e.target.value); setShowMarket(true); }}
              onFocus={() => setShowMarket(true)}
              onKeyDown={handleSearchKey}
              placeholder="搜索全部A股（代码或名称）..."
              style={{ flex: 1, minWidth: 200, background: 'var(--sec-surface-0)', border: '1px solid var(--sec-border-strong)', color: 'var(--sec-text)', padding: '8px 12px', borderRadius: 6, fontSize: '0.9rem' }} />
            <button className="button" onClick={() => { if (filteredStocks.length > 0) viewStock(filteredStocks[0].code, filteredStocks[0].name); }}
              style={{ padding: '8px 16px', background: '#70b8b0', color: '#0d1a1a', fontWeight: 'bold' }}>
              🔍 搜索
            </button>
            <select value={stockFilter} onChange={e => { setStockFilter(e.target.value); setShowMarket(true); }}
              style={{ background: 'var(--sec-surface-0)', border: '1px solid var(--sec-border-strong)', color: 'var(--sec-text)', padding: '8px 12px', borderRadius: 6, fontSize: '0.85rem', maxWidth: 160 }}>
              <option value="">全部行业</option>
              {industries.slice(0, 30).map(ind => <option key={ind} value={ind}>{ind}</option>)}
            </select>
            <span className={`securities-directory-status${stockDirectoryError ? ' is-error' : ''}`} role="status">
              {stockDirectoryLoading
                ? '正在加载A股数据库…'
                : stockDirectoryError
                  ? stockDirectoryError
                  : `已加载 ${allStocks.length.toLocaleString()} 只A股`}
            </span>
            <button className="button" onClick={doRefresh} disabled={loading}
              style={{ padding: '8px 20px', background: loading ? 'var(--sec-border-strong)' : 'var(--sec-accent)', color: 'var(--sec-surface-0)', fontWeight: 'bold' }}>
              {loading ? '刷新中...' : '🔄 刷新 (' + watchlist.length + ')'}
            </button>
            <button className="button" onClick={() => navigate(`/projects/${projectId}/securities/recommend`)}
              style={{ padding: '8px 20px', background: '#e6a23c', color: '#fff', fontWeight: 'bold' }}>
              ⭐ 智能荐股
            </button>
            <button className="button" onClick={() => navigate(`/projects/${projectId}/securities/watchlist`)}
              style={{ padding: '8px 20px', background: '#409eff', color: '#fff', fontWeight: 'bold' }}>
              📋 自选股池
            </button>
          </div>

          {/* Market Browser */}
          {showMarket && (stockSearch || stockFilter) && (
            <div style={{ background: 'var(--sec-surface-2)', borderRadius: 8, padding: 12, marginBottom: 16, border: '1px solid var(--sec-border)', maxHeight: 350, overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--sec-text-secondary)', fontSize: '0.8rem' }}>
                  搜索结果 ({filteredStocks.length}只)
                  {stockFilter && <span> · {stockFilter}</span>}
                </span>
                <button className="button" style={{ fontSize: '0.7rem', padding: '2px 10px' }}
                  onClick={() => { setShowMarket(false); setStockSearch(''); setStockFilter(''); setCustomCode(''); }}>✕ 关闭</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 4 }}>
                {filteredStocks.map(s => (
                  <div key={s.code} onClick={() => viewStock(s.code, s.name)}
                    style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 4, fontSize: '0.82rem', color: 'var(--sec-text-muted)',
                      background: watchlist.some(w => w.code === s.code) ? 'var(--sec-selected)' : 'transparent',
                      display: 'flex', justifyContent: 'space-between' }}>
                    <span className="securities-stock-result" style={{ color: 'var(--sec-text)' }}>
                      <span>{s.code}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--sec-text-secondary)' }}>{s.name}</span>
                    </span>
                    {s.industry && <span style={{ color: 'var(--sec-text-subtle)', fontSize: '0.7rem' }}>{s.industry}</span>}
                  </div>
                ))}
                {filteredStocks.length === 0 && (
                  <span style={{ color: 'var(--sec-text-subtle)', fontSize: '0.8rem' }}>
                    {stockDirectoryLoading ? 'A股数据库加载中…' : stockDirectoryError || '未找到匹配的A股'}
                  </span>
                )}
              </div>
            </div>
          )}

          {error && <div style={{ color: 'var(--sec-danger)', fontSize: '0.85rem', marginBottom: 12 }}>⚠️ {error}</div>}

          {/* Quote Table */}
          <div className="securities-table-shell" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr style={{ color: 'var(--sec-text-secondary)', fontSize: '0.82rem' }}>
                  <th>代码</th><th>名称</th><th>最新价</th><th>涨跌幅</th>
                  <th>涨跌额</th><th>成交量(手)</th><th>换手率</th>
                  <th>PE</th><th>PB</th><th>总市值(亿)</th><th></th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.code}
                    onClick={() => setSelectedStock(q)}
                    style={{
                      cursor: 'pointer',
                      background: selectedStock?.code === q.code ? 'var(--sec-selected)' : 'transparent',
                      transition: 'background 0.2s',
                    }}>
                    <td style={{ color: 'var(--sec-text-subtle)' }}>{q.code}</td>
                    <td style={{ color: 'var(--sec-text)', fontWeight: 500 }}>{q.name}</td>
                    <td style={{ color: 'var(--sec-text)', fontWeight: 'bold' }}>{q.price.toFixed(2)}</td>
                    <td style={{ color: color(q.changePct), fontWeight: 'bold' }}>
                      {q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%
                    </td>
                    <td style={{ color: color(q.change) }}>{q.change >= 0 ? '+' : ''}{q.change.toFixed(2)}</td>
                    <td style={{ color: 'var(--sec-text-muted)' }}>{(q.volume / 10000).toFixed(1)}万</td>
                    <td style={{ color: 'var(--sec-text-muted)' }}>{q.turnover?.toFixed(2)}%</td>
                    <td style={{ color: 'var(--sec-text-muted)' }}>{q.pe > 0 ? q.pe.toFixed(1) : '—'}</td>
                    <td style={{ color: 'var(--sec-text-muted)' }}>{q.pb > 0 ? q.pb.toFixed(1) : '—'}</td>
                    <td style={{ color: 'var(--sec-text-muted)' }}>{q.totalCap > 0 ? q.totalCap.toFixed(0) : '—'}</td>
                    <td>
                      <button className="button" style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                        onClick={(e) => { e.stopPropagation(); removeStock(q.code); }}>✕</button>
                    </td>
                  </tr>
                ))}
                {quotes.length === 0 && !loading && (
                  <tr><td colSpan={11} style={{ color: 'var(--sec-text-subtle)', textAlign: 'center', padding: 24 }}>点击"刷新行情"获取数据</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Selected Stock Detail */}
          {selectedStock && <StockDetailPanel stock={selectedStock} />}

          {/* Global Stocks */}
          <GlobalStockPanel />
        </>
      )}

      {/* ── Fund Tab ── */}
      {activeTab === 'fund' && <FundModule />}

      {/* ── Bond Tab ── */}
      {activeTab === 'bond' && <BondModule />}

      {/* ── ETF Tab ── */}
      {activeTab === 'etf' && <ETFModule />}
    </section>
  );
}

// ── Fund Module ──

function FundModule() {
  const [fundCodes, setFundCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('fund_watchlist') || '[]'); } catch { return ['110022', '000001', '510300']; }
  });
  const [searchKw, setSearchKw] = useState('');
  const [searchResults, setSearchResults] = useState<FundSearchResult[]>([]);
  const [valuations, setValuations] = useState<FundValuation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { projectId = 'default' } = useParams<{ projectId: string }>();
  const [selectedFund] = useState<FundValuation | null>(null);
  const [activeFundTab, setActiveFundTab] = useState<'overview' | 'holdings' | 'nav' | 'trades'>('overview');

  const saveFunds = (codes: string[]) => { setFundCodes(codes); localStorage.setItem('fund_watchlist', JSON.stringify(codes)); };

  const refresh = async () => {
    if (fundCodes.length === 0) return;
    setLoading(true); setError('');
    try {
      const vals = await fetchFundValuations(fundCodes);
      setValuations(vals);
    } catch { setError('基金数据获取失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const handleSearch = async () => {
    if (!searchKw.trim()) return;
    const results = await searchFunds(searchKw.trim());
    setSearchResults(results);
  };

  const addFund = (code: string) => {
    if (!fundCodes.includes(code)) saveFunds([...fundCodes, code]);
    setSearchResults([]); setSearchKw('');
  };

  const removeFund = (code: string) => saveFunds(fundCodes.filter(c => c !== code));

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'end' }}>
        <input value={searchKw} onChange={e => setSearchKw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="搜索基金名称或代码..."
          style={{ width: 220, background: 'var(--sec-surface-0)', border: '1px solid var(--sec-border-strong)', color: 'var(--sec-text)', padding: '8px 12px', borderRadius: 6 }} />
        <button className="button" onClick={handleSearch} style={{ padding: '8px 16px' }}>🔍 搜索</button>
        <button className="button" onClick={refresh} disabled={loading}
          style={{ padding: '8px 16px', background: loading ? 'var(--sec-border-strong)' : 'var(--sec-accent)', color: 'var(--sec-surface-0)' }}>
          {loading ? '刷新中...' : '🔄 刷新估值'}
        </button>
      </div>

      {error && <div style={{ color: 'var(--sec-danger)', fontSize: '0.85rem', marginBottom: 12 }}>⚠️ {error}</div>}

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div style={{ background: 'var(--sec-surface-2)', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid var(--sec-border-strong)', maxHeight: 300, overflowY: 'auto' }}>
          {searchResults.map(r => (
            <div key={r.code} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sec-selected)', alignItems: 'center' }}>
              <span style={{ color: 'var(--sec-text)', fontSize: '0.85rem' }}>{r.code} — {r.name}</span>
              <button className="button" style={{ fontSize: '0.75rem', padding: '4px 12px' }}
                onClick={() => addFund(r.code)}>+ 添加</button>
            </div>
          ))}
        </div>
      )}

      {/* Fund Valuation Table */}
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr style={{ color: 'var(--sec-text-secondary)', fontSize: '0.82rem' }}>
              <th>代码</th><th>名称</th><th>单位净值</th><th>估算净值</th>
              <th>估算涨跌</th><th>累计净值</th><th>净值日期</th><th></th>
            </tr>
          </thead>
          <tbody>
            {valuations.map(v => (
              <tr key={v.code} onClick={() => navigate(`/projects/${projectId}/securities/fund/${v.code}`)}
                style={{ cursor: 'pointer' }}>
                <td style={{ color: 'var(--sec-text-subtle)' }}>{v.code}</td>
                <td style={{ color: 'var(--sec-text)', fontWeight: 500 }}>{v.name}</td>
                <td style={{ color: 'var(--sec-text)' }}>{v.nav.toFixed(4)}</td>
                <td style={{ color: 'var(--sec-text)' }}>{v.estimatedNav > 0 ? v.estimatedNav.toFixed(4) : '—'}</td>
                <td style={{ color: v.estimatedChange >= 0 ? 'var(--sec-gain)' : 'var(--sec-loss)', fontWeight: 'bold' }}>
                  {v.estimatedChange !== 0 ? `${v.estimatedChange >= 0 ? '+' : ''}${v.estimatedChange.toFixed(2)}%` : '—'}
                </td>
                <td style={{ color: 'var(--sec-text-muted)' }}>{v.accNav.toFixed(4)}</td>
                <td style={{ color: 'var(--sec-text-subtle)', fontSize: '0.78rem' }}>{v.navDate}</td>
                <td><button className="button" style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                  onClick={(e) => { e.stopPropagation(); removeFund(v.code); }}>✕</button></td>
              </tr>
            ))}
            {valuations.length === 0 && !loading && (
              <tr><td colSpan={8} style={{ color: 'var(--sec-text-subtle)', textAlign: 'center', padding: 24 }}>添加基金后点击"刷新估值"</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Fund Detail */}
      {selectedFund && <FundDetailPanel fund={selectedFund} activeTab={activeFundTab} setActiveTab={setActiveFundTab} />}
    </>
  );
}

function FundDetailPanel({ fund, activeTab, setActiveTab }: { fund: FundValuation; activeTab: string; setActiveTab: (t: any) => void }) {
  const [holdings, setHoldings] = useState<FundHolding[]>([]);
  const [navHistory, setNavHistory] = useState<FundNAVHistory[]>([]);
  const [stockQuotes, setStockQuotes] = useState<Record<string, { price: number; change: number }>>({});
  const [loadingH, setLoadingH] = useState(false);
  const [position, setPosition] = useState<FundPosition | null>(null);
  const [buyShares, setBuyShares] = useState('');
  const [buyNav, setBuyNav] = useState('');
  const [txMsg, setTxMsg] = useState('');

  useEffect(() => {
    setLoadingH(true);
    Promise.all([
      fetchFundHoldings(fund.code),
      fetchFundNAVHistory(fund.code),
    ]).then(([h, n]) => {
      setHoldings(h);
      setNavHistory(n);
      // Fetch stock quotes for holdings
      if (h.length > 0) {
        const stockCodes = h.map(s => s.stockCode).filter(Boolean);
        fetchTencentQuotes(stockCodes).then(q => {
          setStockQuotes(q);
        }).catch(() => {});
      }
    }).catch(() => {}).finally(() => setLoadingH(false));

    // Load position
    const positions = loadPositions();
    setPosition(positions.find(p => p.code === fund.code) || null);
  }, [fund.code]);

  const handleBuy = () => {
    const shares = parseFloat(buyShares);
    const nav = parseFloat(buyNav) || fund.estimatedNav || fund.nav;
    if (!shares || shares <= 0 || !nav) return;
    addTransaction(fund.code, 'buy', shares, nav);
    setTxMsg(`✅ 买入 ${shares} 份，净值 ${nav.toFixed(4)}`);
    setBuyShares(''); setBuyNav('');
    const positions = loadPositions();
    setPosition(positions.find(p => p.code === fund.code) || null);
    setTimeout(() => setTxMsg(''), 3000);
  };

  const handleSell = () => {
    if (!position) return;
    const shares = parseFloat(buyShares);
    const nav = parseFloat(buyNav) || fund.estimatedNav || fund.nav;
    if (!shares || shares <= 0 || shares > position.shares || !nav) return;
    addTransaction(fund.code, 'sell', shares, nav);
    setTxMsg(`✅ 卖出 ${shares} 份，净值 ${nav.toFixed(4)}`);
    setBuyShares(''); setBuyNav('');
    const positions = loadPositions();
    setPosition(positions.find(p => p.code === fund.code) || null);
    setTimeout(() => setTxMsg(''), 3000);
  };

  const tabs: { id: string; label: string }[] = [
    { id: 'overview', label: '概览' },
    { id: 'holdings', label: `持仓 (${holdings.length})` },
    { id: 'nav', label: '净值走势' },
    { id: 'trades', label: '交易' },
  ];

  const profit = position && fund.estimatedNav > 0
    ? ((fund.estimatedNav - position.costNav) / position.costNav * 100) : 0;

  return (
    <div style={{ marginTop: 24, background: 'var(--sec-surface-2)', borderRadius: 8, padding: 20, border: '1px solid var(--sec-border)' }}>
      <h2 style={{ color: 'var(--sec-text)', margin: '0 0 16px' }}>{fund.name} ({fund.code})</h2>

      {/* Quick Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10, marginBottom: 16 }}>
        <MiniCard label="单位净值" value={fund.nav.toFixed(4)} color="var(--sec-text)" />
        <MiniCard label="估算净值" value={fund.estimatedNav > 0 ? fund.estimatedNav.toFixed(4) : '—'} color="var(--sec-text)" />
        <MiniCard label="估算涨跌" value={`${fund.estimatedChange >= 0 ? '+' : ''}${fund.estimatedChange.toFixed(2)}%`}
          color={fund.estimatedChange >= 0 ? 'var(--sec-gain)' : 'var(--sec-loss)'} />
        {position && (
          <>
            <MiniCard label="持仓成本" value={position.costNav.toFixed(4)} color="var(--sec-text-secondary)" />
            <MiniCard label="持仓收益" value={`${profit >= 0 ? '+' : ''}${profit.toFixed(2)}%`}
              color={profit >= 0 ? 'var(--sec-gain)' : 'var(--sec-loss)'} />
          </>
        )}
      </div>

      {/* Sub Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--sec-border)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              padding: '6px 16px', border: 'none', cursor: 'pointer',
              background: activeTab === t.id ? 'var(--sec-selected)' : 'transparent',
              color: activeTab === t.id ? 'var(--sec-accent)' : 'var(--sec-text-secondary)',
              borderBottom: activeTab === t.id ? '2px solid var(--sec-accent)' : '2px solid transparent',
              fontSize: '0.85rem',
            }}>{t.label}</button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === 'overview' && (
        <div>
          <p style={{ color: 'var(--sec-text-secondary)', fontSize: '0.85rem' }}>估值时间: {fund.valuationTime || '—'}</p>
          <p style={{ color: 'var(--sec-text-secondary)', fontSize: '0.85rem' }}>净值日期: {fund.navDate || '—'}</p>
          <p style={{ color: 'var(--sec-text-secondary)', fontSize: '0.85rem' }}>基金类型: {fund.type || '—'}</p>
          <p style={{ color: 'var(--sec-text-secondary)', fontSize: '0.85rem' }}>累计净值: {fund.accNav.toFixed(4)}</p>
        </div>
      )}

      {/* Holdings */}
      {activeTab === 'holdings' && (
        loadingH ? <div style={{ color: 'var(--sec-text-secondary)' }}>加载持仓...</div> : (
          <table className="data-table">
            <thead><tr><th>股票代码</th><th>名称</th><th>占净值比</th><th>最新价</th><th>涨跌幅</th></tr></thead>
            <tbody>
              {holdings.map((h, i) => {
                const quote = stockQuotes[h.stockCode];
                return (
                  <tr key={i}>
                    <td style={{ color: 'var(--sec-text-subtle)' }}>{h.stockCode}</td>
                    <td style={{ color: 'var(--sec-text)' }}>{h.stockName}</td>
                    <td style={{ color: 'var(--sec-text-muted)' }}>{h.ratio}%</td>
                    <td style={{ color: 'var(--sec-text)' }}>{quote ? quote.price.toFixed(2) : '—'}</td>
                    <td style={{ color: quote ? (quote.change >= 0 ? 'var(--sec-gain)' : 'var(--sec-loss)') : 'var(--sec-text-muted)', fontWeight: 500 }}>
                      {quote ? `${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
              {holdings.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--sec-text-subtle)', textAlign: 'center' }}>无持仓数据</td></tr>}
            </tbody>
          </table>
        )
      )}

      {/* NAV History */}
      {activeTab === 'nav' && (
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          <table className="data-table">
            <thead><tr><th>日期</th><th>单位净值</th><th>累计净值</th><th>日涨跌</th></tr></thead>
            <tbody>
              {navHistory.slice(-60).reverse().map((n, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--sec-text-subtle)', fontSize: '0.8rem' }}>{n.date}</td>
                  <td style={{ color: 'var(--sec-text)' }}>{n.nav.toFixed(4)}</td>
                  <td style={{ color: 'var(--sec-text)' }}>{n.accNav.toFixed(4)}</td>
                  <td style={{ color: n.change >= 0 ? 'var(--sec-gain)' : 'var(--sec-loss)' }}>
                    {n.change >= 0 ? '+' : ''}{n.change.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Trades */}
      {activeTab === 'trades' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'end' }}>
            <input value={buyShares} onChange={e => setBuyShares(e.target.value)}
              placeholder="份额" type="number" style={{ width: 100, background: 'var(--sec-surface-0)', border: '1px solid var(--sec-border-strong)', color: 'var(--sec-text)', padding: '6px 10px', borderRadius: 4 }} />
            <input value={buyNav} onChange={e => setBuyNav(e.target.value)}
              placeholder="净值(空=现价)" type="number" style={{ width: 140, background: 'var(--sec-surface-0)', border: '1px solid var(--sec-border-strong)', color: 'var(--sec-text)', padding: '6px 10px', borderRadius: 4 }} />
            <button className="button" onClick={handleBuy} style={{ background: 'var(--sec-gain)', color: 'var(--sec-text)', padding: '6px 16px' }}>买入</button>
            <button className="button" onClick={handleSell} style={{ background: 'var(--sec-loss)', color: 'var(--sec-text)', padding: '6px 16px' }}>卖出</button>
          </div>
          {txMsg && <div style={{ color: 'var(--sec-accent)', fontSize: '0.85rem', marginBottom: 8 }}>{txMsg}</div>}

          {position && (
            <div style={{ background: 'var(--sec-surface-1)', padding: 12, borderRadius: 6, marginBottom: 12 }}>
              <div style={{ color: 'var(--sec-text)' }}>持仓: <strong>{position.shares.toFixed(2)}</strong> 份</div>
              <div style={{ color: 'var(--sec-text-secondary)', fontSize: '0.82rem' }}>成本净值: {position.costNav.toFixed(4)} | 总成本: {position.totalCost.toFixed(2)}</div>
            </div>
          )}

          <TransactionList code={fund.code} />
        </div>
      )}
    </div>
  );
}

function MiniCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: 'var(--sec-surface-1)', padding: '8px 12px', borderRadius: 6, textAlign: 'center' }}>
      <div style={{ color: 'var(--sec-text-subtle)', fontSize: '0.7rem', marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontWeight: 'bold', fontSize: '0.95rem' }}>{value}</div>
    </div>
  );
}

function TransactionList({ code }: { code: string }) {
  const txs = loadTransactions(code).reverse();
  if (txs.length === 0) return <div style={{ color: 'var(--sec-text-subtle)' }}>暂无交易记录</div>;
  return (
    <table className="data-table">
      <thead><tr><th>日期</th><th>类型</th><th>份额</th><th>净值</th><th>金额</th></tr></thead>
      <tbody>
        {txs.map(t => (
          <tr key={t.id}>
            <td style={{ color: 'var(--sec-text-subtle)', fontSize: '0.8rem' }}>{t.date}</td>
            <td style={{ color: t.type === 'buy' ? 'var(--sec-gain)' : 'var(--sec-loss)' }}>{t.type === 'buy' ? '买入' : '卖出'}</td>
            <td style={{ color: 'var(--sec-text)' }}>{t.shares.toFixed(2)}</td>
            <td style={{ color: 'var(--sec-text)' }}>{t.nav.toFixed(4)}</td>
            <td style={{ color: 'var(--sec-text)' }}>{t.amount.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Bond Module ──

function BondModule() {
  const [cbBonds, setCbBonds] = useState<ConvertibleBond[]>([]);
  const [yieldCurve, setYieldCurve] = useState<YieldCurvePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'cb' | 'treasury'>('cb');
  const [sortKey, setSortKey] = useState<string>('changePct');
  const [sortDesc, setSortDesc] = useState(true);

  const [bondMeta, setBondMeta] = useState(() => createMarketDataMeta({
    source: '腾讯行情',
    mode: 'realtime',
    status: 'loading',
  }));
  const treasuryMeta = createMarketDataMeta({
    source: '内置收益率快照',
    mode: 'static',
    status: 'stale',
  });
  const refresh = async () => {
    setLoading(true);
    setBondMeta(createMarketDataMeta({ source: '腾讯行情', mode: 'realtime', status: 'loading' }));
    const [bondResult, curveResult] = await Promise.allSettled([
      fetchConvertibleBonds(),
      fetchTreasuryYieldCurve(),
    ]);
    if (bondResult.status === 'fulfilled') {
      setCbBonds(bondResult.value);
      setBondMeta(createMarketDataMeta({
        source: '腾讯行情',
        mode: 'realtime',
        status: 'success',
        asOf: currentMarketDataTime(),
      }));
    } else {
      setCbBonds([]);
      setBondMeta(createMarketDataMeta({
        source: '腾讯行情',
        mode: 'realtime',
        status: 'error',
        error: String(bondResult.reason),
      }));
    }
    setYieldCurve(curveResult.status === 'fulfilled' ? curveResult.value : []);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const sorted = [...cbBonds].sort((a, b) => {
    const va = (a as any)[sortKey] ?? Number.NEGATIVE_INFINITY;
    const vb = (b as any)[sortKey] ?? Number.NEGATIVE_INFINITY;
    return sortDesc ? vb - va : va - vb;
  });

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="button" onClick={refresh} disabled={loading}
          style={{ background: loading ? 'var(--sec-border-strong)' : 'var(--sec-accent)', color: 'var(--sec-surface-0)', padding: '8px 20px' }}>
          {loading ? '刷新中...' : '🔄 刷新数据'}
        </button>
        <MarketDataStatusBadge meta={activeSubTab === 'cb' ? bondMeta : treasuryMeta} />
      </div>

      {/* Sub Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--sec-border)' }}>
        {[
          { id: 'cb' as const, label: `可转债 (${cbBonds.length})` },
          { id: 'treasury' as const, label: '国债收益率' },
        ].map(t => (
          <button key={t.id} onClick={() => setActiveSubTab(t.id)}
            style={{
              padding: '8px 20px', border: 'none', cursor: 'pointer',
              background: activeSubTab === t.id ? 'var(--sec-selected)' : 'transparent',
              color: activeSubTab === t.id ? 'var(--sec-accent)' : 'var(--sec-text-secondary)',
              borderBottom: activeSubTab === t.id ? '2px solid var(--sec-accent)' : '2px solid transparent',
              fontSize: '0.9rem',
            }}>{t.label}</button>
        ))}
      </div>

      {/* Convertible Bonds */}
      {activeSubTab === 'cb' && (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr style={{ color: 'var(--sec-text-secondary)', fontSize: '0.8rem' }}>
                {[
                  ['code', '代码'], ['name', '名称'], ['price', '最新价'], ['changePct', '涨跌幅'],
                  ['premium', '转股溢价率'], ['yieldToMaturity', '到期收益率'],
                  ['stockPrice', '正股价'], ['stockChangePct', '正股涨跌'],
                  ['convertPrice', '转股价'], ['volume', '成交量(手)'],
                ].map(([key, label]) => (
                  <th key={key} style={{ cursor: 'pointer', padding: '6px 8px' }}
                    onClick={() => { if (sortKey === key) setSortDesc(!sortDesc); else { setSortKey(key); setSortDesc(true); } }}>
                    {label}{sortKey === key ? (sortDesc ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 50).map(b => (
                <tr key={b.code}>
                  <td style={{ color: 'var(--sec-text-subtle)', fontSize: '0.8rem' }}>{b.code}</td>
                  <td style={{ color: 'var(--sec-text)', fontWeight: 500 }}>{b.name}</td>
                  <td style={{ color: 'var(--sec-text)' }}>{b.price > 0 ? b.price.toFixed(2) : '—'}</td>
                  <td style={{ color: b.changePct >= 0 ? 'var(--sec-gain)' : 'var(--sec-loss)', fontWeight: 'bold' }}>
                    {b.changePct !== 0 ? `${b.changePct >= 0 ? '+' : ''}${b.changePct.toFixed(2)}%` : '—'}
                  </td>
                  <td style={{ color: b.premium !== null && (b.premium ?? 0) < 0 ? 'var(--sec-loss)' : 'var(--sec-warning)' }}>{b.premium === null ? '—' : `${b.premium.toFixed(2)}%`}</td>
                  <td style={{ color: b.yieldToMaturity !== null && (b.yieldToMaturity ?? 0) > 0 ? 'var(--sec-gain)' : 'var(--sec-text-muted)' }}>{b.yieldToMaturity === null ? '—' : `${(b.yieldToMaturity ?? 0).toFixed(2)}%`}</td>
                  <td style={{ color: 'var(--sec-text)' }}>{b.stockPrice === null ? '—' : b.stockPrice.toFixed(2)}</td>
                  <td style={{ color: b.stockChangePct !== null && b.stockChangePct >= 0 ? 'var(--sec-gain)' : 'var(--sec-loss)', fontSize: '0.8rem' }}>
                    {b.stockChangePct === null ? '—' : `${b.stockChangePct >= 0 ? '+' : ''}${b.stockChangePct.toFixed(2)}%`}
                  </td>
                  <td style={{ color: 'var(--sec-text-muted)' }}>{b.convertPrice === null ? '—' : b.convertPrice.toFixed(2)}</td>
                  <td style={{ color: 'var(--sec-text-muted)', fontSize: '0.8rem' }}>{b.volume > 0 ? (b.volume / 10000).toFixed(1) + '万' : '—'}</td>
                </tr>
              ))}
              {sorted.length === 0 && !loading && (
                <tr><td colSpan={10} style={{ color: 'var(--sec-text-subtle)', textAlign: 'center', padding: 24 }}>点击"刷新数据"获取可转债行情</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Treasury Yield Curve */}
      {activeSubTab === 'treasury' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10, marginBottom: 20 }}>
            {yieldCurve.map(pt => (
              <div key={pt.term} style={{ background: 'var(--sec-surface-1)', padding: 12, borderRadius: 8, border: '1px solid var(--sec-border)', textAlign: 'center' }}>
                <div style={{ color: 'var(--sec-text-secondary)', fontSize: '0.75rem', marginBottom: 4 }}>{pt.term}</div>
                <div style={{ color: 'var(--sec-text)', fontWeight: 'bold', fontSize: '1.1rem' }}>{pt.yield.toFixed(3)}%</div>
                {pt.change !== 0 && (
                  <div style={{ color: pt.change >= 0 ? 'var(--sec-gain)' : 'var(--sec-loss)', fontSize: '0.75rem', marginTop: 2 }}>
                    {pt.change >= 0 ? '+' : ''}{pt.change.toFixed(1)} bp
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Mini chart */}
          {yieldCurve.length > 2 && (
            <div style={{ background: 'var(--sec-surface-1)', padding: 20, borderRadius: 8, border: '1px solid var(--sec-border)' }}>
              <h4 style={{ color: 'var(--sec-text-secondary)', fontSize: '0.85rem', margin: '0 0 16px' }}>收益率曲线</h4>
              <div style={{ display: 'flex', alignItems: 'end', gap: 4, height: 120 }}>
                {yieldCurve.map((pt, i) => {
                  const maxY = Math.max(...yieldCurve.map(p => p.yield), 0.01);
                  const minY = Math.min(...yieldCurve.map(p => p.yield));
                  const range = maxY - minY || 1;
                  const h = ((pt.yield - minY) / range) * 100;
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ color: 'var(--sec-text-muted)', fontSize: '0.7rem', marginBottom: 2 }}>{pt.yield.toFixed(2)}%</div>
                      <div style={{
                        width: '80%', height: Math.max(4, h),
                        background: 'linear-gradient(180deg, var(--sec-accent), var(--sec-accent))',
                        borderRadius: '2px 2px 0 0',
                        minHeight: 4,
                      }} />
                      <div style={{ color: 'var(--sec-text-subtle)', fontSize: '0.65rem', marginTop: 4 }}>{pt.term}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {yieldCurve.length === 0 && <div style={{ color: 'var(--sec-text-subtle)', padding: 24, textAlign: 'center' }}>点击"刷新数据"获取国债收益率</div>}
        </div>
      )}

    </>
  );
}

// ── ETF Module ──

function ETFModule() {
  const [etfs, setEtfs] = useState<ETFItem[]>([]);
  const [globalETFs, setGlobalETFs] = useState<GlobalETF[]>([]);
  const [loading, setLoading] = useState(false);
  const [etfTab, setEtfTab] = useState<'cn' | 'global'>('cn');
  const [filterCategory, setFilterCategory] = useState('');

  const refresh = async () => {
    setLoading(true);
    const [cnList] = await Promise.all([
      fetchAStockETFs().catch(() => []),
    ]);
    setEtfs(cnList);
    setGlobalETFs(fetchGlobalETFs());
    setLoading(false);
  };

  const refreshGlobalQuotes = async () => {
  };

  useEffect(() => { refresh(); }, []);

  // Auto-fetch global quotes when switching to the global tab (only once)
  useEffect(() => {
    if (etfTab === 'global' && globalETFs.length > 0) {
      refreshGlobalQuotes();
    }
  }, [etfTab]);

  const categories = [...new Set(etfs.map(e => e.category))].sort();
  const filtered = filterCategory ? etfs.filter(e => e.category === filterCategory) : etfs;

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="button" onClick={refresh} disabled={loading}
          style={{ background: loading ? 'var(--sec-border-strong)' : 'var(--sec-accent)', color: 'var(--sec-surface-0)', padding: '8px 20px' }}>
          {loading ? '刷新中...' : '🔄 刷新'}
        </button>
        <div style={{ display: 'flex', gap: 2, background: 'var(--sec-surface-0)', borderRadius: 6 }}>
          <button onClick={() => setEtfTab('cn')} style={{
            padding: '6px 16px', border: 'none', cursor: 'pointer', borderRadius: 6,
            background: etfTab === 'cn' ? 'var(--sec-accent)' : 'transparent',
            color: etfTab === 'cn' ? 'var(--sec-surface-0)' : 'var(--sec-text-secondary)', fontWeight: etfTab === 'cn' ? 'bold' : 'normal',
          }}>A股 ETF ({etfs.length})</button>
          <button onClick={() => setEtfTab('global')} style={{
            padding: '6px 16px', border: 'none', cursor: 'pointer', borderRadius: 6,
            background: etfTab === 'global' ? 'var(--sec-accent)' : 'transparent',
            color: etfTab === 'global' ? 'var(--sec-surface-0)' : 'var(--sec-text-secondary)', fontWeight: etfTab === 'global' ? 'bold' : 'normal',
          }}>全球 ETF ({globalETFs.length})</button>
        </div>
      </div>

      {etfTab === 'cn' && (
        <>
          {/* Category filter */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <button onClick={() => setFilterCategory('')} style={{
              padding: '3px 12px', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: '0.75rem',
              background: !filterCategory ? 'var(--sec-accent)' : 'var(--sec-selected)', color: !filterCategory ? 'var(--sec-surface-0)' : 'var(--sec-text-secondary)',
            }}>全部</button>
            {categories.map(c => (
              <button key={c} onClick={() => setFilterCategory(c === filterCategory ? '' : c)} style={{
                padding: '3px 12px', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: '0.75rem',
                background: filterCategory === c ? 'var(--sec-accent)' : 'var(--sec-selected)', color: filterCategory === c ? 'var(--sec-surface-0)' : 'var(--sec-text-secondary)',
              }}>{c}</button>
            ))}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr style={{ color: 'var(--sec-text-secondary)', fontSize: '0.8rem' }}>
                <th>代码</th><th>名称</th><th>最新价</th><th>涨跌幅</th><th>折溢价</th>
                <th>规模(亿)</th><th>类型</th><th>基金公司</th><th>成交量</th>
              </tr></thead>
              <tbody>
                {filtered.slice(0, 50).map(e => (
                  <tr key={e.code}>
                    <td style={{ color: 'var(--sec-text-subtle)', fontSize: '0.8rem' }}>{e.code}</td>
                    <td style={{ color: 'var(--sec-text)', fontWeight: 500 }}>{e.name}</td>
                    <td style={{ color: 'var(--sec-text)' }}>{e.price > 0 ? e.price.toFixed(3) : '—'}</td>
                    <td style={{ color: colorPct(e.changePct), fontWeight: 'bold' }}>{fmtPct(e.changePct)}</td>
                    <td style={{ color: e.premium < 0 ? 'var(--sec-loss)' : 'var(--sec-warning)' }}>{e.premium?.toFixed(2)}%</td>
                    <td style={{ color: 'var(--sec-text-muted)' }}>{e.fundSize.toFixed(0)}</td>
                    <td style={{ color: 'var(--sec-text-muted)' }}>{e.category}</td>
                    <td style={{ color: 'var(--sec-text-muted)', fontSize: '0.78rem' }}>{e.issuer}</td>
                    <td style={{ color: 'var(--sec-text-muted)' }}>{fmtCap(e.volume)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={9} style={{ color: 'var(--sec-text-subtle)', textAlign: 'center', padding: 24 }}>点击"刷新"</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {etfTab === 'global' && (
        <>
          {/* Category filter for global ETFs */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
            <button onClick={() => setFilterCategory('')} style={{
              padding: '2px 10px', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: '0.72rem',
              background: !filterCategory ? 'var(--sec-accent)' : 'var(--sec-selected)', color: !filterCategory ? 'var(--sec-surface-0)' : 'var(--sec-text-secondary)',
            }}>全部</button>
            {[...new Set(globalETFs.map(e => e.category))].sort().map(c => (
              <button key={c} onClick={() => setFilterCategory(c === filterCategory ? '' : c)} style={{
                padding: '2px 10px', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: '0.72rem',
                background: filterCategory === c ? 'var(--sec-accent)' : 'var(--sec-selected)',
                color: filterCategory === c ? 'var(--sec-surface-0)' : 'var(--sec-text-secondary)',
              }}>{c}</button>
            ))}
          </div>

          {(filterCategory ? globalETFs.filter(e => e.category === filterCategory) : globalETFs).length === 0 && (
            <div style={{ color: 'var(--sec-text-subtle)', textAlign: 'center', padding: 24 }}>无匹配的ETF数据</div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 10 }}>
            {(filterCategory ? globalETFs.filter(e => e.category === filterCategory) : globalETFs).map(e => {
              const hasPrice = e.price != null && e.price > 0;
              const hasChange = e.changePct != null;
              return (
                <div key={e.symbol} style={{ background: 'var(--sec-surface-1)', padding: 14, borderRadius: 8, border: '1px solid var(--sec-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Top row: symbol + category badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ color: 'var(--sec-text)', fontWeight: 'bold', fontSize: '0.95rem' }}>{e.symbol}</span>
                        <span style={{ color: 'var(--sec-text-subtle)', fontSize: '0.7rem' }}>{e.currency}</span>
                      </div>
                      <div style={{ color: 'var(--sec-text-muted)', fontSize: '0.76rem', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.name}>{e.name}</div>
                    </div>
                    <span style={{ color: 'var(--sec-accent)', fontSize: '0.68rem', background: 'var(--sec-selected)', padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap', flexShrink: 0 }}>{e.category}</span>
                  </div>

                  {/* Live price row */}
                  {hasPrice ? (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                      <span style={{ color: 'var(--sec-text)', fontWeight: 'bold', fontSize: '1.15rem' }}>
                        {e.price!.toFixed(e.price! > 100 ? 1 : 2)}
                      </span>
                      {hasChange && (
                        <span style={{
                          color: colorPct(e.changePct!), fontWeight: 'bold', fontSize: '0.85rem',
                          background: e.changePct! > 0 ? 'rgba(245,108,108,0.12)' : e.changePct! < 0 ? 'rgba(103,194,58,0.12)' : 'transparent',
                          padding: '1px 8px', borderRadius: 4,
                        }}>
                          {fmtPct(e.changePct!)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div style={{ color: 'var(--sec-text-subtle)', fontSize: '0.85rem', fontStyle: 'italic', marginTop: 2 }}>
                      点击 "💹 刷新实时报价" 获取价格
                    </div>
                  )}

                  {/* Bottom row: exchange + family + AUM */}
                  <div style={{ display: 'flex', gap: 12, fontSize: '0.72rem', color: 'var(--sec-text-subtle)', borderTop: hasPrice ? '1px solid var(--sec-selected)' : 'none', paddingTop: hasPrice ? 6 : 0, marginTop: 2 }}>
                    <span>{e.exchange}</span>
                    <span>{e.family}</span>
                    <span style={{ marginLeft: 'auto' }}>{fmtCap(e.aum)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}


function QuickStat({ label, value, color: c }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#0d1f1f', padding: '8px 10px', borderRadius: 6, textAlign: 'center' }}>
      <div style={{ color: '#9a9a9a', fontSize: '0.68rem', marginBottom: 2 }}>{label}</div>
      <div style={{ color: c, fontWeight: 'bold', fontSize: '0.9rem' }}>{value}</div>
    </div>
  );
}

// ── Buy/Sell Signal Logic ──

interface TradingSignal {
  type: 'buy' | 'sell' | 'hold';
  strength: '强' | '中' | '弱';
  reason: string;
}

function computeSignals(klines: any[]): TradingSignal[] {
  const signals: TradingSignal[] = [];
  if (klines.length < 20) return signals;
  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2];

  // MACD golden cross / dead cross
  if (last?.macd && prev?.macd) {
    if (prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea) {
      signals.push({ type: 'buy', strength: '中', reason: 'MACD金叉 — DIF上穿DEA' });
    }
    if (prev.macd.dif >= prev.macd.dea && last.macd.dif < last.macd.dea) {
      signals.push({ type: 'sell', strength: '中', reason: 'MACD死叉 — DIF下穿DEA' });
    }
    if (last.macd.bar > 0 && prev.macd.bar <= 0) {
      signals.push({ type: 'buy', strength: '弱', reason: 'MACD红柱出现' });
    }
  }

  // KDJ overbought/oversold
  if (last?.kdj) {
    if (last.kdj.j < 0) {
      signals.push({ type: 'buy', strength: '强', reason: `KDJ超卖 — J值${last.kdj.j.toFixed(1)}，极度超卖` });
    } else if (last.kdj.j < 20) {
      signals.push({ type: 'buy', strength: '中', reason: `KDJ低位 — J值${last.kdj.j.toFixed(1)}，超卖区域` });
    }
    if (last.kdj.j > 100) {
      signals.push({ type: 'sell', strength: '强', reason: `KDJ超买 — J值${last.kdj.j.toFixed(1)}，极度超买` });
    } else if (last.kdj.j > 80) {
      signals.push({ type: 'sell', strength: '中', reason: `KDJ高位 — J值${last.kdj.j.toFixed(1)}，超买区域` });
    }
    // KDJ golden cross
    if (prev?.kdj && prev.kdj.k <= prev.kdj.d && last.kdj.k > last.kdj.d && last.kdj.j < 40) {
      signals.push({ type: 'buy', strength: '强', reason: 'KDJ金叉 — K线上穿D线（低位）' });
    }
  }

  // RSI
  if (last?.rsi) {
    if (last.rsi.rsi6 < 20) {
      signals.push({ type: 'buy', strength: '强', reason: `RSI(6)超卖 — ${last.rsi.rsi6.toFixed(1)}，极度超卖` });
    } else if (last.rsi.rsi6 < 30) {
      signals.push({ type: 'buy', strength: '中', reason: `RSI(6)低位 — ${last.rsi.rsi6.toFixed(1)}，超卖` });
    }
    if (last.rsi.rsi6 > 80) {
      signals.push({ type: 'sell', strength: '强', reason: `RSI(6)超买 — ${last.rsi.rsi6.toFixed(1)}，极度超买` });
    } else if (last.rsi.rsi6 > 70) {
      signals.push({ type: 'sell', strength: '中', reason: `RSI(6)高位 — ${last.rsi.rsi6.toFixed(1)}，超买` });
    }
  }

  // Bollinger band touch
  if (last?.boll && last?.close) {
    if (last.close <= last.boll.lower) {
      signals.push({ type: 'buy', strength: '强', reason: '触及布林下轨 — 可能超跌反弹' });
    }
    if (last.close >= last.boll.upper) {
      signals.push({ type: 'sell', strength: '强', reason: '触及布林上轨 — 可能高位回调' });
    }
  }

  // Price vs MA
  if (last?.ma && last?.close) {
    if (last.close < last.ma.ma20 && prev?.close && prev.close >= prev.ma?.ma20) {
      signals.push({ type: 'sell', strength: '中', reason: '跌破MA20均线' });
    }
    if (last.close > last.ma.ma20 && prev?.close && prev.close <= prev.ma?.ma20) {
      signals.push({ type: 'buy', strength: '中', reason: '突破MA20均线' });
    }
  }

  return signals.slice(0, 5);
}

// ── Global Stock Sub-Tab (inside Stock tab) ──

function GlobalStockPanel() {
  const [stocks, setStocks] = useState<GlobalStock[]>([]);
  const [open, setOpen] = useState(false);
  const [market, setMarket] = useState<'us' | 'hk'>('hk');

  useEffect(() => {
    if (open && stocks.length === 0) {
      fetchGlobalQuotes(getGlobalStocks(market)).then(r => setStocks(r.filter(s => s.price > 0)));
    }
  }, [open, market]);

  const refresh = async () => {
    const result = await fetchGlobalQuotes(getGlobalStocks(market));
    setStocks(result.filter(s => s.price > 0));
  };

  return (
    <details open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)} style={{ marginTop: 24 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--sec-text-secondary)', fontSize: '0.9rem', padding: '8px 0' }}>
        🌍 海外参考 (美股10只 + 港股5只) — 点击展开
      </summary>
      <div style={{ background: 'var(--sec-surface-2)', borderRadius: 8, padding: 16, border: '1px solid var(--sec-border)', marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['hk', 'us'] as const).map(m => (
            <button key={m} onClick={() => setMarket(m)} style={{
              padding: '4px 14px', border: 'none', cursor: 'pointer', borderRadius: 6, fontSize: '0.8rem',
              background: market === m ? 'var(--sec-accent)' : 'var(--sec-selected)',
              color: market === m ? 'var(--sec-surface-0)' : 'var(--sec-text-secondary)',
            }}>{m === 'hk' ? '港股' : '美股'}</button>
          ))}
          <button className="button" onClick={refresh} style={{ padding: '4px 14px', fontSize: '0.8rem' }}>
            🔄 刷新
          </button>
        </div>
        <table className="data-table">
          <thead><tr style={{ color: 'var(--sec-text-secondary)', fontSize: '0.8rem' }}>
            <th>代码</th><th>名称</th><th>最新价</th><th>涨跌幅</th><th>市值</th>
          </tr></thead>
          <tbody>
            {stocks.map(s => (
              <tr key={s.symbol}>
                <td style={{ color: 'var(--sec-text-subtle)' }}>{s.symbol}</td>
                <td style={{ color: 'var(--sec-text)' }}>{s.name}</td>
                <td style={{ color: 'var(--sec-text)', fontWeight: 'bold' }}>{s.price.toFixed(2)}</td>
                <td style={{ color: colorPct(s.changePct), fontWeight: 'bold' }}>{fmtPct(s.changePct)}</td>
                <td style={{ color: 'var(--sec-text-muted)' }}>{fmtCap(s.marketCap)}</td>
              </tr>
            ))}
            {stocks.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--sec-text-subtle)', textAlign: 'center' }}>点击展开加载...</td></tr>}
          </tbody>
        </table>
      </div>
    </details>
  );
}
// ── Stock Detail Panel ──

function StockDetailPanel({ stock }: { stock: StockQuote }) {
  const [klines, setKlines] = useState<any[]>([]);
  const [loadingK, setLoadingK] = useState(false);
  const [debate, setDebate] = useState<DebateResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [debateDepth, setDebateDepth] = useState<DebateDepth>('quick');

  const handleAIAnalyze = async () => {
    setAnalyzing(true);
    try {
      const result = await runMultiAgentDebate(stock.code, stock.name, stock.price, stock.changePct, debateDepth);
      setDebate(result);
    } catch (e) {
      const fallback: DebateResult = { symbol: stock.code, name: stock.name, price: stock.price, changePct: stock.changePct, depth: 'quick', rounds: [], roundHistory: [], reports: [], consensus: 'AI 分析失败，请检查 AI 模型配置', riskLevel: '中', actionBias: '中性', keyCatalysts: [], keyRisks: [], priceTarget: { low: '—', mid: '—', high: '—' }, generatedAt: '' };
      setDebate(fallback);
    } finally { setAnalyzing(false); }
  };

  useEffect(() => {
    setLoadingK(true);
    fetchEastmoneyKLine(stock.code, 120).then(data => {
      calcAllIndicators(data);
      setKlines(data);
    }).catch(() => {}).finally(() => setLoadingK(false));
  }, [stock.code]);

  const last = klines.length > 0 ? klines[klines.length - 1] : null;
  const lastM = last as any;
  const signals = useMemo(() => klines.length > 0 ? computeSignals(klines) : [], [klines]);

  return (
    <div style={{ marginTop: 24, background: 'var(--sec-surface-2)', borderRadius: 8, padding: 20, border: '1px solid var(--sec-border)' }}>
      {/* Market Cap Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 6, marginBottom: 16 }}>
        <QuickStat label="最新价" value={stock.price.toFixed(2)} color="var(--sec-text)" />
        <QuickStat label="涨跌幅" value={`${stock.changePct >= 0 ? '+' : ''}${stock.changePct.toFixed(2)}%`} color={stock.changePct >= 0 ? '#f56c6c' : '#67c23a'} />
        <QuickStat label="总市值(亿)" value={stock.totalCap > 0 ? stock.totalCap.toFixed(0) : '—'} color="var(--sec-text-muted)" />
        <QuickStat label="PE" value={stock.pe > 0 ? stock.pe.toFixed(1) : '—'} color="var(--sec-text-muted)" />
        <QuickStat label="换手率" value={stock.turnover > 0 ? `${stock.turnover.toFixed(2)}%` : '—'} color="var(--sec-text-muted)" />
        <QuickStat label="今开/昨收" value={`${stock.open > 0 ? stock.open.toFixed(2) : '—'}/${stock.preClose > 0 ? stock.preClose.toFixed(2) : '—'}`} color="var(--sec-text-muted)" />
      </div>

      {/* Buy/Sell Signals */}
      {signals.length > 0 && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {signals.map((s, i) => (
            <div key={i} style={{
              padding: '4px 10px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 'bold',
              background: s.type === 'buy' ? 'rgba(245,108,108,0.12)' : s.type === 'sell' ? 'rgba(103,194,58,0.12)' : 'rgba(255,255,255,0.05)',
              color: s.type === 'buy' ? '#f56c6c' : s.type === 'sell' ? '#67c23a' : '#aaa',
              border: `1px solid ${s.type === 'buy' ? 'rgba(245,108,108,0.3)' : s.type === 'sell' ? 'rgba(103,194,58,0.3)' : 'rgba(255,255,255,0.1)'}`,
            }}>
              {s.type === 'buy' ? '📈' : s.type === 'sell' ? '📉' : '➡️'} {s.strength}{s.type === 'buy' ? '买入' : s.type === 'sell' ? '卖出' : '持有'} — {s.reason}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ color: 'var(--sec-text)', margin: 0 }}>{stock.name} ({stock.code})</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'var(--sec-text-subtle)', fontSize: '0.72rem' }}>辩论深度</span>
          <select value={debateDepth} onChange={e => setDebateDepth(e.target.value as DebateDepth)}
            style={{
              background: 'var(--sec-surface-0)',
              border: `1px solid ${debateDepth === 'deep' ? 'var(--sec-accent)' : debateDepth === 'standard' ? 'var(--sec-warning)' : 'var(--sec-border-strong)'}`,
              color: 'var(--sec-text)', padding: '6px 10px', borderRadius: 4, fontSize: '0.8rem',
              cursor: 'pointer',
              boxShadow: debateDepth === 'deep' ? '0 0 6px rgba(112,184,176,0.3)' : 'none',
            }}>
            <option value="quick">⚡ 快速 · 仅首轮 (1轮)</option>
            <option value="standard">🔄 标准 · 含辩论交锋 (2轮)</option>
            <option value="deep">🔬 深度 · 完整三轮决策 (3轮)</option>
          </select>
          <button className="button" onClick={handleAIAnalyze} disabled={analyzing}
            style={{ background: analyzing ? 'var(--sec-border-strong)' : 'var(--sec-warning)', color: 'var(--sec-text)', fontWeight: 'bold', padding: '8px 20px' }}>
            {analyzing ? '⏳ 辩论中...' : '🧠 AI 多空辩论'}
          </button>
        </div>
      </div>

      {/* AI Debate Result */}
      {debate && (
        <div style={{ marginBottom: 20, background: 'var(--sec-surface-1)', borderRadius: 8, padding: 16, border: '1px solid var(--sec-border-strong)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--sec-text)', fontWeight: 'bold', fontSize: '0.95rem' }}>
              🧠 多智能体分析结论
            </span>
            <span style={{
              padding: '3px 10px', borderRadius: 8, fontSize: '0.7rem',
              background: debate.depth === 'deep' ? 'var(--sec-positive-surface)' : debate.depth === 'standard' ? 'var(--sec-surface-2)' : 'var(--sec-surface-2)',
              color: debate.depth === 'deep' ? 'var(--sec-accent)' : debate.depth === 'standard' ? 'var(--sec-text-secondary)' : 'var(--sec-text-subtle)',
            }}>{debate.depth === 'deep' ? '🔬 深度' : debate.depth === 'standard' ? '🔄 标准' : '⚡ 快速'} · {debate.rounds.length}轮</span>
            <span style={{
              padding: '3px 12px', borderRadius: 10, fontSize: '0.78rem', fontWeight: 'bold',
              background: debate.actionBias === '强烈看多' || debate.actionBias === '偏多' ? 'var(--sec-positive-surface)' :
                debate.actionBias === '强烈看空' || debate.actionBias === '偏空' ? 'var(--sec-negative-surface)' : 'var(--sec-surface-2)',
              color: debate.actionBias === '强烈看多' || debate.actionBias === '偏多' ? 'var(--sec-gain)' :
                debate.actionBias === '强烈看空' || debate.actionBias === '偏空' ? 'var(--sec-loss)' : 'var(--sec-text-secondary)',
            }}>{debate.actionBias}</span>
            <span style={{
              padding: '3px 12px', borderRadius: 10, fontSize: '0.78rem', fontWeight: 'bold',
              background: debate.riskLevel === '极高' ? 'var(--sec-negative-surface)' : debate.riskLevel === '高' ? 'var(--sec-warning-surface)' : 'var(--sec-surface-2)',
              color: debate.riskLevel === '极高' ? 'var(--sec-danger)' : debate.riskLevel === '高' ? 'var(--sec-warning)' : 'var(--sec-accent)',
            }}>风险: {debate.riskLevel}</span>
          </div>

          <p style={{ color: 'var(--sec-text-muted)', fontSize: '0.85rem', lineHeight: 1.7, marginBottom: 12 }}>{debate.consensus}</p>

          {/* Round History — shows debate evolution with clear round labels */}
          {debate.rounds.length > 1 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{
                color: 'var(--sec-accent)', fontSize: '0.8rem', fontWeight: 'bold',
                marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>🔄 辩论演进过程</span>
                <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, var(--sec-border), transparent)' }} />
                <span style={{ color: 'var(--sec-text-subtle)', fontSize: '0.68rem' }}>{debate.rounds.length}轮辩论</span>
              </div>

              {/* Round flow — each round in a styled card showing evolution */}
              <div style={{ position: 'relative', paddingLeft: 24 }}>
                {debate.rounds.map((rd, ri) => {
                  const isLast = ri === debate.rounds.length - 1;
                  const roundColors: Record<number, { accent: string; bg: string; border: string; glow: string }> = {
                    1: { accent: 'var(--sec-text-secondary)', bg: 'var(--sec-surface-1)', border: 'var(--sec-border)', glow: 'rgba(139,168,168,0.15)' },
                    2: { accent: 'var(--sec-warning)', bg: 'var(--sec-warning-surface)', border: 'var(--sec-warning-surface)', glow: 'rgba(230,162,60,0.15)' },
                    3: { accent: 'var(--sec-accent)', bg: 'var(--sec-surface-1)', border: 'var(--sec-border)', glow: 'rgba(112,184,176,0.2)' },
                  };
                  const cs = roundColors[rd.round] || roundColors[1];

                  return (
                    <div key={ri} style={{
                      position: 'relative',
                      marginBottom: isLast ? 0 : 8,
                      padding: '10px 14px',
                      background: cs.bg,
                      border: `1px solid ${cs.border}`,
                      borderRadius: 6,
                      boxShadow: `0 0 12px ${cs.glow}`,
                    }}>
                      {/* Timeline connector dot */}
                      <div style={{
                        position: 'absolute',
                        left: -18, top: 14,
                        width: 12, height: 12,
                        borderRadius: '50%',
                        background: cs.accent,
                        boxShadow: `0 0 8px ${cs.accent}`,
                        zIndex: 2,
                      }} />
                      {/* Timeline line to next */}
                      {!isLast && (
                        <div style={{
                          position: 'absolute',
                          left: -13, top: 30,
                          width: 2,
                          height: 'calc(100% + 8px)',
                          background: `linear-gradient(180deg, ${cs.accent}, ${roundColors[rd.round + 1]?.accent || 'var(--sec-border-strong)'})`,
                          zIndex: 1,
                        }} />
                      )}

                      {/* Round header */}
                      <details open={isLast} style={{ margin: 0 }}>
                        <summary style={{
                          cursor: 'pointer',
                          color: cs.accent,
                          fontSize: '0.82rem',
                          fontWeight: 'bold',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          userSelect: 'none',
                        }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 20, height: 20,
                            borderRadius: '50%',
                            background: cs.accent,
                            color: 'var(--sec-surface-0)',
                            fontSize: '0.7rem',
                            fontWeight: 'bold',
                          }}>{rd.round}</span>
                          <span>{rd.label}</span>
                        </summary>

                        {/* Agents in this round */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))',
                          gap: 6,
                          marginTop: 10,
                        }}>
                          {rd.reports.map(r => (
                            <div key={r.agent} style={{
                              background: 'var(--sec-bg)',
                              padding: 10,
                              borderRadius: 4,
                              border: `1px solid ${cs.border}`,
                              transition: 'all 0.2s',
                            }}>
                              <div style={{
                                color: cs.accent,
                                fontWeight: 'bold',
                                fontSize: '0.78rem',
                                marginBottom: 4,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}>
                                <span>{r.icon}</span>
                                <span>{r.role}</span>
                                <span style={{
                                  marginLeft: 'auto',
                                  fontSize: '0.6rem',
                                  padding: '1px 6px',
                                  borderRadius: 6,
                                  background: r.confidence === 'high' ? 'var(--sec-positive-surface)' : r.confidence === 'medium' ? 'var(--sec-surface-2)' : 'var(--sec-surface-2)',
                                  color: r.confidence === 'high' ? 'var(--sec-loss)' : r.confidence === 'medium' ? 'var(--sec-warning)' : 'var(--sec-gain)',
                                }}>
                                  {r.confidence === 'high' ? '高置信度' : r.confidence === 'medium' ? '中置信度' : '低置信度'}
                                </span>
                              </div>
                              <div style={{
                                color: 'var(--sec-text-muted)',
                                fontSize: '0.72rem',
                                lineHeight: 1.5,
                                marginBottom: 4,
                              }}>
                                {r.thesis}
                              </div>
                              {r.keyPoints.length > 0 && (
                                <ul style={{
                                  margin: 0,
                                  paddingLeft: 16,
                                  fontSize: '0.68rem',
                                  color: 'var(--sec-text-muted)',
                                  lineHeight: 1.6,
                                }}>
                                  {r.keyPoints.map((p, i) => (
                                    <li key={i}>{p}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Single-round mode: show reports without timeline for backward compatibility */}
          {debate.rounds.length <= 1 && debate.reports.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: 'var(--sec-text-subtle)', fontSize: '0.75rem', marginBottom: 8 }}>
                📊 首轮分析 ({debate.reports.length} Agent)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 8 }}>
                {debate.reports.map(r => (
                  <div key={r.agent} style={{ background: 'var(--sec-bg)', padding: 10, borderRadius: 6, border: '1px solid var(--sec-selected)' }}>
                    <div style={{ color: 'var(--sec-text)', fontWeight: 'bold', fontSize: '0.82rem', marginBottom: 4 }}>
                      {r.icon} {r.role}
                    </div>
                    <div style={{ color: 'var(--sec-text-secondary)', fontSize: '0.75rem', marginBottom: 6, lineHeight: 1.5 }}>
                      {r.thesis}
                    </div>
                    {r.keyPoints.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: '0.7rem', color: 'var(--sec-text-muted)' }}>
                        {r.keyPoints.map((p, i) => (
                          <li key={i} style={{ marginBottom: 2 }}>{p}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {loadingK && <div style={{ color: 'var(--sec-text-secondary)' }}>加载K线数据...</div>}

      {lastM && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {/* MACD */}
          {lastM.macd && (
            <IndicatorCard title="MACD (12,26,9)" color="var(--sec-warning)">
              <div>DIF: <strong>{lastM.macd.dif}</strong></div>
              <div>DEA: <strong>{lastM.macd.dea}</strong></div>
              <div style={{ color: lastM.macd.bar >= 0 ? 'var(--sec-gain)' : 'var(--sec-loss)' }}>
                BAR: <strong>{lastM.macd.bar}</strong> {lastM.macd.bar >= 0 ? '📈' : '📉'}
              </div>
            </IndicatorCard>
          )}
          {/* KDJ */}
          {lastM.kdj && (
            <IndicatorCard title="KDJ (9,3,3)" color="var(--sec-text-muted)">
              <div>K: <strong>{lastM.kdj.k}</strong></div>
              <div>D: <strong>{lastM.kdj.d}</strong></div>
              <div>J: <strong style={{ color: lastM.kdj.j > 80 ? 'var(--sec-gain)' : lastM.kdj.j < 20 ? 'var(--sec-loss)' : 'var(--sec-text)' }}>{lastM.kdj.j}</strong></div>
            </IndicatorCard>
          )}
          {/* RSI */}
          {lastM.rsi && (
            <IndicatorCard title="RSI" color="var(--sec-info)">
              <div>RSI(6): <strong>{lastM.rsi.rsi6}</strong></div>
              <div>RSI(12): <strong>{lastM.rsi.rsi12}</strong></div>
              <div>RSI(24): <strong>{lastM.rsi.rsi24}</strong></div>
            </IndicatorCard>
          )}
          {/* BOLL */}
          {lastM.boll && (
            <IndicatorCard title="BOLL (20,2)" color="var(--sec-loss)">
              <div>上轨: <strong>{lastM.boll.upper}</strong></div>
              <div>中轨: <strong>{lastM.boll.mid}</strong></div>
              <div>下轨: <strong>{lastM.boll.lower}</strong></div>
            </IndicatorCard>
          )}
          {/* MA */}
          {lastM.ma && (
            <IndicatorCard title="均线" color="var(--sec-gain)">
              <div>MA5: <strong>{lastM.ma.ma5}</strong></div>
              <div>MA10: <strong>{lastM.ma.ma10}</strong></div>
              <div>MA20: <strong>{lastM.ma.ma20}</strong></div>
              <div>MA60: {lastM.ma.ma60 ? <strong>{lastM.ma.ma60}</strong> : '—'}</div>
            </IndicatorCard>
          )}
          {/* ATR */}
          {lastM.atr && (
            <IndicatorCard title="ATR (14)" color="var(--sec-warning)">
              <div>ATR: <strong>{lastM.atr}</strong></div>
            </IndicatorCard>
          )}
        </div>
      )}

      {/* Mini K-line chart (text-based) */}
      {klines.length > 10 && (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ color: 'var(--sec-text-secondary)', fontSize: '0.85rem', marginBottom: 8 }}>近30日走势</h4>
          <div style={{ display: 'flex', alignItems: 'end', gap: 2, height: 80, overflow: 'hidden' }}>
            {klines.slice(-30).map((k: any, i: number) => {
              const maxH = Math.max(...klines.slice(-30).map((k2: any) => k2.high));
              const minL = Math.min(...klines.slice(-30).map((k2: any) => k2.low));
              const range = maxH - minL || 1;
              const h = ((k.high - k.low) / range) * 60 + 4;
              const y = 80 - ((k.high - minL) / range) * 80;
              const isRed = k.close >= k.open;
              return (
                <div key={i} title={`${k.date} O:${k.open} C:${k.close} H:${k.high} L:${k.low}`}
                  style={{
                    width: 6, height: Math.max(2, h),
                    background: isRed ? 'var(--sec-gain)' : 'var(--sec-loss)',
                    position: 'relative',
                    top: y - h,
                    borderRadius: 1,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function IndicatorCard({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--sec-surface-1)', padding: 10, borderRadius: 6, borderLeft: `3px solid ${color}` }}>
      <div style={{ color, fontSize: '0.75rem', fontWeight: 'bold', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--sec-text-muted)', lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}

