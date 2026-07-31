import { useState, useCallback, useEffect } from 'react';
import { fetchSinaQuotes, fetchEastmoneyKLine, type StockQuote } from '../../infrastructure/market-data/stock-api';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';

type TabId = 'stock' | 'fund' | 'bond' | 'etf';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'stock', label: '股票', icon: '📈' },
  { id: 'fund', label: '基金', icon: '💰' },
  { id: 'bond', label: '债券', icon: '📜' },
  { id: 'etf', label: 'ETF', icon: '📊' },
];

const STOCK_POOL = [
  { code: '000001', name: '平安银行' }, { code: '600519', name: '贵州茅台' },
  { code: '000858', name: '五粮液' }, { code: '300750', name: '宁德时代' },
  { code: '600036', name: '招商银行' }, { code: '601318', name: '中国平安' },
  { code: '002415', name: '海康威视' }, { code: '600276', name: '恒瑞医药' },
  { code: '000333', name: '美的集团' }, { code: '688981', name: '中芯国际' },
  { code: '002594', name: '比亚迪' }, { code: '601012', name: '隆基绿能' },
];

export function SecuritiesWorkbenchPage() {
  const [activeTab, setActiveTab] = useState<TabId>('stock');
  const [watchlist, setWatchlist] = useState(STOCK_POOL);
  const [customCode, setCustomCode] = useState('');
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedStock, setSelectedStock] = useState<StockQuote | null>(null);

  // Fetch quotes
  const refreshQuotes = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const codes = watchlist.map(s => s.code);
      const results = await fetchSinaQuotes(codes);
      setQuotes(results);
      if (results.length === 0) setError('行情获取失败，请检查网络');
    } catch { setError('行情服务暂不可用'); }
    finally { setLoading(false); }
  }, [watchlist]);

  useEffect(() => { refreshQuotes(); }, []);

  const addStock = () => {
    if (!customCode || customCode.length !== 6) return;
    if (watchlist.find(s => s.code === customCode)) return;
    setWatchlist([...watchlist, { code: customCode, name: customCode }]);
    setCustomCode('');
  };

  const removeStock = (code: string) => {
    setWatchlist(watchlist.filter(s => s.code !== code));
  };

  const color = (v: number) => v > 0 ? '#f56c6c' : v < 0 ? '#67c23a' : '#aaa';

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
      <nav style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #2a4a4a' }}>
        {TABS.map(tab => (
          <button key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 24px', border: 'none', cursor: 'pointer',
              background: activeTab === tab.id ? '#1a3a3a' : 'transparent',
              color: activeTab === tab.id ? '#70b8b0' : '#8ba8a8',
              borderBottom: activeTab === tab.id ? '2px solid #70b8b0' : '2px solid transparent',
              fontSize: '0.95rem', fontWeight: activeTab === tab.id ? 'bold' : 'normal',
              transition: 'all 0.2s',
            }}
          >{tab.icon} {tab.label}</button>
        ))}
      </nav>

      {/* ── Stock Tab ── */}
      {activeTab === 'stock' && (
        <>
          {/* Watchlist */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'end' }}>
            <input
              value={customCode}
              onChange={e => setCustomCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addStock()}
              placeholder="输入6位股票代码"
              style={{ width: 180, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '8px 12px', borderRadius: 6 }}
            />
            <button className="button" onClick={addStock} style={{ padding: '8px 16px' }}>+ 添加</button>
            <button className="button" onClick={refreshQuotes} disabled={loading}
              style={{ padding: '8px 16px', background: loading ? '#3a5a5a' : '#70b8b0', color: '#0d1a1a' }}>
              {loading ? '刷新中...' : '🔄 刷新行情'}
            </button>
          </div>

          {error && <div style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: 12 }}>⚠️ {error}</div>}

          {/* Quote Table */}
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr style={{ color: '#8ba8a8', fontSize: '0.82rem' }}>
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
                      background: selectedStock?.code === q.code ? '#1a3a3a' : 'transparent',
                      transition: 'background 0.2s',
                    }}>
                    <td style={{ color: '#5a7a7a' }}>{q.code}</td>
                    <td style={{ color: '#e0e0e0', fontWeight: 500 }}>{q.name}</td>
                    <td style={{ color: '#e0e0e0', fontWeight: 'bold' }}>{q.price.toFixed(2)}</td>
                    <td style={{ color: color(q.changePct), fontWeight: 'bold' }}>
                      {q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%
                    </td>
                    <td style={{ color: color(q.change) }}>{q.change >= 0 ? '+' : ''}{q.change.toFixed(2)}</td>
                    <td style={{ color: '#aaa' }}>{(q.volume / 10000).toFixed(1)}万</td>
                    <td style={{ color: '#aaa' }}>{q.turnover?.toFixed(2)}%</td>
                    <td style={{ color: '#aaa' }}>{q.pe > 0 ? q.pe.toFixed(1) : '—'}</td>
                    <td style={{ color: '#aaa' }}>{q.pb > 0 ? q.pb.toFixed(1) : '—'}</td>
                    <td style={{ color: '#aaa' }}>{q.totalCap > 0 ? q.totalCap.toFixed(0) : '—'}</td>
                    <td>
                      <button className="button" style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                        onClick={(e) => { e.stopPropagation(); removeStock(q.code); }}>✕</button>
                    </td>
                  </tr>
                ))}
                {quotes.length === 0 && !loading && (
                  <tr><td colSpan={11} style={{ color: '#5a7a7a', textAlign: 'center', padding: 24 }}>点击"刷新行情"获取数据</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Selected Stock Detail */}
          {selectedStock && <StockDetailPanel stock={selectedStock} />}
        </>
      )}

      {/* ── Fund Tab (placeholder) ── */}
      {activeTab === 'fund' && (
        <PlaceholderModule
          title="基金研究"
          description="基金筛选、业绩归因、持仓穿透、基金经理评估"
          plannedFeatures={['公募/私募基金数据库', '夏普比率/最大回撤/α/β计算', '持仓穿透分析', '基金经理历史业绩追踪', '基金组合优化']}
        />
      )}

      {/* ── Bond Tab (placeholder) ── */}
      {activeTab === 'bond' && (
        <PlaceholderModule
          title="债券研究"
          description="信用债/利率债分析、收益率曲线、久期/凸性"
          plannedFeatures={['国债/企业债/可转债数据库', '收益率曲线拟合', '信用评级跟踪', '久期和凸性计算', '债券组合免疫策略']}
        />
      )}

      {/* ── ETF Tab (placeholder) ── */}
      {activeTab === 'etf' && (
        <PlaceholderModule
          title="ETF 研究"
          description="ETF筛选、折溢价分析、跟踪误差、资金流向"
          plannedFeatures={['全市场ETF数据库', '折溢价/跟踪误差监控', '资金净流入流出', 'ETF组合策略', '跨境ETF/行业ETF分类']}
        />
      )}
    </section>
  );
}

// ── Stock Detail Panel ──

function StockDetailPanel({ stock }: { stock: StockQuote }) {
  const [klines, setKlines] = useState<any[]>([]);
  const [loadingK, setLoadingK] = useState(false);

  useEffect(() => {
    setLoadingK(true);
    fetchEastmoneyKLine(stock.code, 120).then(data => {
      calcAllIndicators(data);
      setKlines(data);
    }).catch(() => {}).finally(() => setLoadingK(false));
  }, [stock.code]);

  const last = klines.length > 0 ? klines[klines.length - 1] : null;
  const lastM = last as any;

  return (
    <div style={{ marginTop: 24, background: '#1a2a2a', borderRadius: 8, padding: 20, border: '1px solid #2a4a4a' }}>
      <h2 style={{ color: '#e0e0e0', margin: '0 0 16px' }}>
        {stock.name} ({stock.code}) — 技术分析
      </h2>

      {loadingK && <div style={{ color: '#8ba8a8' }}>加载K线数据...</div>}

      {lastM && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {/* MACD */}
          {lastM.macd && (
            <IndicatorCard title="MACD (12,26,9)" color="#e6a23c">
              <div>DIF: <strong>{lastM.macd.dif}</strong></div>
              <div>DEA: <strong>{lastM.macd.dea}</strong></div>
              <div style={{ color: lastM.macd.bar >= 0 ? '#f56c6c' : '#67c23a' }}>
                BAR: <strong>{lastM.macd.bar}</strong> {lastM.macd.bar >= 0 ? '📈' : '📉'}
              </div>
            </IndicatorCard>
          )}
          {/* KDJ */}
          {lastM.kdj && (
            <IndicatorCard title="KDJ (9,3,3)" color="#909399">
              <div>K: <strong>{lastM.kdj.k}</strong></div>
              <div>D: <strong>{lastM.kdj.d}</strong></div>
              <div>J: <strong style={{ color: lastM.kdj.j > 80 ? '#f56c6c' : lastM.kdj.j < 20 ? '#67c23a' : '#e0e0e0' }}>{lastM.kdj.j}</strong></div>
            </IndicatorCard>
          )}
          {/* RSI */}
          {lastM.rsi && (
            <IndicatorCard title="RSI" color="#409eff">
              <div>RSI(6): <strong>{lastM.rsi.rsi6}</strong></div>
              <div>RSI(12): <strong>{lastM.rsi.rsi12}</strong></div>
              <div>RSI(24): <strong>{lastM.rsi.rsi24}</strong></div>
            </IndicatorCard>
          )}
          {/* BOLL */}
          {lastM.boll && (
            <IndicatorCard title="BOLL (20,2)" color="#67c23a">
              <div>上轨: <strong>{lastM.boll.upper}</strong></div>
              <div>中轨: <strong>{lastM.boll.mid}</strong></div>
              <div>下轨: <strong>{lastM.boll.lower}</strong></div>
            </IndicatorCard>
          )}
          {/* MA */}
          {lastM.ma && (
            <IndicatorCard title="均线" color="#f56c6c">
              <div>MA5: <strong>{lastM.ma.ma5}</strong></div>
              <div>MA10: <strong>{lastM.ma.ma10}</strong></div>
              <div>MA20: <strong>{lastM.ma.ma20}</strong></div>
              <div>MA60: {lastM.ma.ma60 ? <strong>{lastM.ma.ma60}</strong> : '—'}</div>
            </IndicatorCard>
          )}
          {/* ATR */}
          {lastM.atr && (
            <IndicatorCard title="ATR (14)" color="#e6a23c">
              <div>ATR: <strong>{lastM.atr}</strong></div>
            </IndicatorCard>
          )}
        </div>
      )}

      {/* Mini K-line chart (text-based) */}
      {klines.length > 10 && (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ color: '#8ba8a8', fontSize: '0.85rem', marginBottom: 8 }}>近30日走势</h4>
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
                    background: isRed ? '#f56c6c' : '#67c23a',
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
    <div style={{ background: '#0d1f1f', padding: 10, borderRadius: 6, borderLeft: `3px solid ${color}` }}>
      <div style={{ color, fontSize: '0.75rem', fontWeight: 'bold', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: '0.8rem', color: '#aaa', lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}

function PlaceholderModule({ title, description, plannedFeatures }: { title: string; description: string; plannedFeatures: string[] }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <h2 style={{ color: '#e0e0e0', marginBottom: 8 }}>{title}</h2>
      <p style={{ color: '#8ba8a8', marginBottom: 24 }}>{description}</p>
      <div style={{ textAlign: 'left', maxWidth: 500, margin: '0 auto', background: '#1a2a2a', padding: 20, borderRadius: 8, border: '1px solid #2a4a4a' }}>
        <h3 style={{ color: '#70b8b0', fontSize: '0.9rem', marginBottom: 12 }}>规划功能</h3>
        {plannedFeatures.map((f, i) => (
          <div key={i} style={{ color: '#8ba8a8', fontSize: '0.85rem', padding: '6px 0', borderBottom: '1px solid #1a3a3a' }}>
            {i + 1}. {f}
          </div>
        ))}
      </div>
    </div>
  );
}
