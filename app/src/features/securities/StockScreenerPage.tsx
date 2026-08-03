import { useState, useEffect, useMemo, useCallback } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { loadStockDirectory, fetchSinaQuotes, type StockQuote, type AStockDirectoryItem } from '../../infrastructure/market-data/stock-api';

// ── 200-dimension screening (practical subset using available data) ──

type SortKey = 'score' | 'changePct' | 'pe' | 'totalCap' | 'turnover' | 'price';

interface FilterState {
  // 市场范围
  market: string;        // '' = all, 'sh' = 上交所, 'sz' = 深交所, 'cyb' = 创业板, 'kcb' = 科创板
  industry: string;
  // 基本面
  peMin: string; peMax: string;
  pbMin: string; pbMax: string;
  capMin: string; capMax: string;
  // 行情
  changeMin: string; changeMax: string;
  turnoverMin: string; turnoverMax: string;
  priceMin: string; priceMax: string;
  // 技术信号
  macdGolden: boolean;
  kdjOversold: boolean;
  kdjOverbought: boolean;
  rsiOversold: boolean;
  rsiOverbought: boolean;
  maBullish: boolean;     // MA5>MA20
  nearBollLower: boolean;  // Price near BOLL lower
  volumeSpike: boolean;    // Volume > 2x avg
  // 排序
  sortBy: SortKey;
  sortDesc: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  market: '', industry: '',
  peMin: '', peMax: '', pbMin: '', pbMax: '',
  capMin: '', capMax: '',
  changeMin: '', changeMax: '', turnoverMin: '', turnoverMax: '',
  priceMin: '', priceMax: '',
  macdGolden: false, kdjOversold: false, kdjOverbought: false,
  rsiOversold: false, rsiOverbought: false,
  maBullish: false, nearBollLower: false, volumeSpike: false,
  sortBy: 'score', sortDesc: true,
};

const MARKET_OPTIONS = [
  { v: '', l: '全部市场' }, { v: 'sh', l: '上交所' }, { v: 'sz', l: '深交所' },
  { v: 'cyb', l: '创业板' }, { v: 'kcb', l: '科创板' },
];

const SORT_OPTIONS: { v: SortKey; l: string }[] = [
  { v: 'score', l: '综合评分' }, { v: 'changePct', l: '涨跌幅' },
  { v: 'pe', l: '市盈率' }, { v: 'totalCap', l: '总市值' },
  { v: 'turnover', l: '换手率' }, { v: 'price', l: '最新价' },
];

const TECH_SIGNALS: { key: keyof FilterState; label: string; desc: string }[] = [
  { key: 'macdGolden', label: 'MACD金叉', desc: 'DIF上穿DEA' },
  { key: 'kdjOversold', label: 'KDJ超卖', desc: 'J值<20' },
  { key: 'kdjOverbought', label: 'KDJ超买', desc: 'J值>80' },
  { key: 'rsiOversold', label: 'RSI超卖', desc: 'RSI(6)<30' },
  { key: 'rsiOverbought', label: 'RSI超买', desc: 'RSI(6)>70' },
  { key: 'maBullish', label: 'MA多头', desc: 'MA5>MA20' },
  { key: 'nearBollLower', label: '布林下轨', desc: '接近BOLL下轨' },
  { key: 'volumeSpike', label: '放量', desc: '成交量>2倍均量' },
];

export function StockScreenerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const backUrl = projectId ? `/projects/${projectId}/securities` : '/securities';

  const [filters, setFilters] = useState<FilterState>(() => {
    try { const s = localStorage.getItem('screener_filters'); return s ? { ...DEFAULT_FILTERS, ...JSON.parse(s) } : DEFAULT_FILTERS; }
    catch { return DEFAULT_FILTERS; }
  });
  const [allStocks, setAllStocks] = useState<AStockDirectoryItem[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [results, setResults] = useState<(StockQuote & { score: number; signalCount: number })[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    loadStockDirectory().then(dir => {
      setAllStocks(dir);
      setIndustries([...new Set(dir.map(s => s.industry).filter(Boolean))].sort());
    });
  }, []);

  const updateFilter = (k: keyof FilterState, v: any) => {
    setFilters(prev => ({ ...prev, [k]: v }));
  };

  const doScreen = useCallback(async () => {
    localStorage.setItem('screener_filters', JSON.stringify(filters));
    setLoading(true); setProgress(''); setResults([]);

    // Filter stocks by market and industry from directory
    let pool = allStocks;
    if (filters.market) {
      if (filters.market === 'cyb') pool = pool.filter(s => s.code.startsWith('300') || s.code.startsWith('301'));
      else if (filters.market === 'kcb') pool = pool.filter(s => s.code.startsWith('688'));
      else if (filters.market === 'sh') pool = pool.filter(s => s.code.startsWith('6'));
      else if (filters.market === 'sz') pool = pool.filter(s => s.code.startsWith('0') || s.code.startsWith('3'));
    }
    if (filters.industry) pool = pool.filter(s => s.industry === filters.industry);

    const poolSize = Math.min(pool.length, 300); // Limit to top 300
    const codes = pool.slice(0, poolSize).map(s => s.code);

    setProgress(`正在获取 ${codes.length} 只股票行情...`);
    const quotes = await fetchSinaQuotes(codes);
    const validQuotes = quotes.filter(q => q.price > 0);

    // Apply numeric filters
    let filtered = validQuotes;
    const n = (v: string) => parseFloat(v) || 0;
    if (filters.peMin) filtered = filtered.filter(q => q.pe >= n(filters.peMin));
    if (filters.peMax) filtered = filtered.filter(q => q.pe <= n(filters.peMax));
    if (filters.pbMin) filtered = filtered.filter(q => q.pb >= n(filters.pbMin));
    if (filters.pbMax) filtered = filtered.filter(q => q.pb <= n(filters.pbMax));
    if (filters.capMin) filtered = filtered.filter(q => q.totalCap >= n(filters.capMin));
    if (filters.capMax) filtered = filtered.filter(q => q.totalCap <= n(filters.capMax));
    if (filters.changeMin) filtered = filtered.filter(q => q.changePct >= n(filters.changeMin));
    if (filters.changeMax) filtered = filtered.filter(q => q.changePct <= n(filters.changeMax));
    if (filters.turnoverMin) filtered = filtered.filter(q => q.turnover >= n(filters.turnoverMin));
    if (filters.turnoverMax) filtered = filtered.filter(q => q.turnover <= n(filters.turnoverMax));
    if (filters.priceMin) filtered = filtered.filter(q => q.price >= n(filters.priceMin));
    if (filters.priceMax) filtered = filtered.filter(q => q.price <= n(filters.priceMax));

    // Score each stock
    const hasTechFilters = filters.macdGolden || filters.kdjOversold || filters.kdjOverbought ||
      filters.rsiOversold || filters.rsiOverbought || filters.maBullish || filters.nearBollLower || filters.volumeSpike;

    type ScoredResult = StockQuote & { score: number; signalCount: number };

    if (hasTechFilters && filtered.length > 0) {
      setProgress(`正在计算 ${filtered.length} 只股票技术指标...`);
      const { calcAllIndicators } = await import('../../engines/market-analysis/technical-indicators');

      const scored: ScoredResult[] = [];
      for (let i = 0; i < Math.min(filtered.length, 200); i++) {
        const q = filtered[i];
        try {
          const { fetchEastmoneyKLine } = await import('../../infrastructure/market-data/stock-api');
          const klines = await fetchEastmoneyKLine(q.code, 60);
          if (klines.length >= 20) {
            calcAllIndicators(klines);
            let score = 50, count = 0;
            const last = klines[klines.length - 1] as any;
            const prev = klines[klines.length - 2] as any;

            if (filters.macdGolden && last?.macd && prev?.macd && prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea) { score += 10; count++; }
            if (filters.kdjOversold && last?.kdj && last.kdj.j < 20) { score += 10; count++; }
            if (filters.kdjOverbought && last?.kdj && last.kdj.j > 80) { score -= 5; count++; }
            if (filters.rsiOversold && last?.rsi && last.rsi.rsi6 < 30) { score += 8; count++; }
            if (filters.rsiOverbought && last?.rsi && last.rsi.rsi6 > 70) { score -= 5; count++; }
            if (filters.maBullish && last?.ma && last.ma.ma5 > last.ma.ma20) { score += 5; count++; }
            if (filters.nearBollLower && last?.boll && last.close <= last.boll.lower * 1.02) { score += 8; count++; }
            if (filters.volumeSpike && last?.volume && prev?.volume && last.volume > prev.volume * 2) { score += 5; count++; }
            scored.push({ ...q, score: Math.round(score), signalCount: count });
          } else {
            scored.push({ ...q, score: 50, signalCount: 0 });
          }
        } catch {
          scored.push({ ...q, score: 50, signalCount: 0 });
        }
        if ((i + 1) % 20 === 0) setProgress(`技术分析 ${i + 1}/${Math.min(filtered.length, 200)}...`);
      }
      filtered = scored as any;
    } else {
      filtered = filtered.map(q => {
        let score = 50;
        if (q.changePct > 2) score += 10; else if (q.changePct > 0) score += 5;
        if (q.pe > 0 && q.pe < 15) score += 8; else if (q.pe > 0 && q.pe < 25) score += 4;
        if (q.totalCap > 500) score += 5;
        if (q.turnover > 3 && q.turnover < 15) score += 3;
        return { ...q, score: Math.round(score), signalCount: 0 } as ScoredResult;
      });
    }

    // Sort
    const sorter = (a: ScoredResult, b: ScoredResult) => {
      const desc = filters.sortDesc ? -1 : 1;
      if (filters.sortBy === 'score') return (b.score - a.score) * desc;
      if (filters.sortBy === 'changePct') return (b.changePct - a.changePct) * desc;
      if (filters.sortBy === 'pe') return ((a.pe || 9999) - (b.pe || 9999)) * desc;
      if (filters.sortBy === 'totalCap') return (b.totalCap - a.totalCap) * desc;
      if (filters.sortBy === 'turnover') return (b.turnover - a.turnover) * desc;
      return (b.price - a.price) * desc;
    };
    filtered.sort(sorter);

    setResults(filtered.slice(0, 100) as ScoredResult[]);
    setProgress('');
    setLoading(false);
  }, [filters, allStocks]);

  return (
    <div className="module-page" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <NavLink to={backUrl} style={{ color: '#70b8b0', fontSize: '0.85rem', display: 'inline-block', marginBottom: 16 }}>← 返回证券工作台</NavLink>
      <h1 style={{ color: '#e0e0e0', margin: '0 0 8px' }}>🔍 综合选股</h1>
      <p style={{ color: '#e8e0d0', fontSize: '0.85rem', marginBottom: 20 }}>
        基本面 + 技术面 + 行情数据多维筛选，综合评分排序
      </p>

      {/* Filters */}
      <div style={{ background: '#1a2a2a', padding: 16, borderRadius: 8, marginBottom: 16, border: '1px solid #2a4a4a' }}>
        {/* Row 1: Market + Industry */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <select value={filters.market} onChange={e => updateFilter('market', e.target.value)}
            style={{ background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '6px 12px', borderRadius: 4, fontSize: '0.82rem' }}>
            {MARKET_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <select value={filters.industry} onChange={e => updateFilter('industry', e.target.value)}
            style={{ background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '6px 12px', borderRadius: 4, fontSize: '0.82rem', maxWidth: 180 }}>
            <option value="">全部行业</option>
            {industries.slice(0, 40).map(ind => <option key={ind} value={ind}>{ind}</option>)}
          </select>
          <select value={filters.sortBy} onChange={e => updateFilter('sortBy', e.target.value)}
            style={{ background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '6px 12px', borderRadius: 4, fontSize: '0.82rem' }}>
            {SORT_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <button onClick={() => updateFilter('sortDesc', !filters.sortDesc)}
            style={{ background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '6px 12px', borderRadius: 4, fontSize: '0.82rem', cursor: 'pointer' }}>
            {filters.sortDesc ? '↓ 降序' : '↑ 升序'}
          </button>
        </div>

        {/* Row 2: Numeric ranges */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            ['PE', 'peMin', 'peMax'], ['PB', 'pbMin', 'pbMax'], ['市值(亿)', 'capMin', 'capMax'],
            ['涨跌%', 'changeMin', 'changeMax'], ['换手%', 'turnoverMin', 'turnoverMax'], ['价格', 'priceMin', 'priceMax'],
          ].map(([label, minK, maxK]) => (
            <div key={minK} style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: '0.72rem' }}>
              <span style={{ color: '#e8e0d0', minWidth: 50 }}>{label}:</span>
              <input value={(filters as any)[minK]} onChange={e => updateFilter(minK as any, e.target.value)}
                placeholder="≥" type="number"
                style={{ width: 55, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '3px 6px', borderRadius: 3, fontSize: '0.72rem' }} />
              <span style={{ color: '#5a7a7a' }}>—</span>
              <input value={(filters as any)[maxK]} onChange={e => updateFilter(maxK as any, e.target.value)}
                placeholder="≤" type="number"
                style={{ width: 55, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '3px 6px', borderRadius: 3, fontSize: '0.72rem' }} />
            </div>
          ))}
        </div>

        {/* Row 3: Technical signals */}
        <details open={showAdvanced} onToggle={e => setShowAdvanced((e.target as HTMLDetailsElement).open)}>
          <summary style={{ color: '#d4a574', fontSize: '0.8rem', cursor: 'pointer', marginBottom: 6 }}>
            📊 技术信号筛选（展开）
          </summary>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {TECH_SIGNALS.map(s => (
              <button key={s.key} onClick={() => updateFilter(s.key, !(filters[s.key] as boolean))}
                title={s.desc}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: '1px solid',
                  cursor: 'pointer', fontSize: '0.72rem', fontWeight: 'bold',
                  background: (filters[s.key] as boolean) ? '#d4a57433' : 'transparent',
                  color: (filters[s.key] as boolean) ? '#d4a574' : '#e8e0d0',
                  borderColor: (filters[s.key] as boolean) ? '#d4a574' : '#3a5a5a',
                }}>{s.label}</button>
            ))}
          </div>
        </details>

        {/* Action */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="button" onClick={doScreen} disabled={loading}
            style={{ padding: '10px 28px', background: loading ? '#5a5040' : '#d4a574', color: '#0d1a1a', fontWeight: 'bold', fontSize: '1rem' }}>
            {loading ? '⏳ 筛选中...' : '🚀 开始筛选'}
          </button>
          <button className="button" onClick={() => { setFilters(DEFAULT_FILTERS); localStorage.removeItem('screener_filters'); }}
            style={{ padding: '8px 16px', fontSize: '0.8rem', background: 'transparent', color: '#e8e0d0', border: '1px solid #3a5a5a' }}>
            重置
          </button>
          <span style={{ fontSize: '0.72rem', color: '#e8e0d0' }}>
            候选池: {allStocks.length.toLocaleString()} 只
          </span>
        </div>
        {progress && <div style={{ color: '#d4a574', fontSize: '0.82rem', marginTop: 8 }}>{progress}</div>}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div>
          <h3 style={{ color: '#e0e0e0', marginBottom: 8 }}>筛选结果 ({results.length} 只)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr style={{ color: '#e8e0d0', fontSize: '0.78rem' }}>
                <th>评分</th><th>代码</th><th>名称</th><th>最新价</th><th>涨跌幅</th><th>PE</th><th>市值(亿)</th><th>换手率</th><th>信号</th>
              </tr></thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.code} onClick={() => navigate(`/projects/${projectId || 'default'}/securities/stock/${r.code}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ color: r.score >= 70 ? '#d4a574' : r.score >= 55 ? '#70b8b0' : '#e8e0d0', fontWeight: 'bold', fontSize: '0.9rem' }}>{r.score}</td>
                    <td style={{ color: '#9a9a9a' }}>{r.code}</td>
                    <td style={{ color: '#e0e0e0', fontWeight: 500 }}>{r.name}</td>
                    <td style={{ color: '#e0e0e0', fontWeight: 'bold' }}>{r.price.toFixed(2)}</td>
                    <td style={{ color: r.changePct >= 0 ? '#ff6666' : '#66cc66', fontWeight: 'bold' }}>{r.changePct >= 0 ? '+' : ''}{r.changePct.toFixed(2)}%</td>
                    <td style={{ color: '#e8e0d0' }}>{r.pe > 0 ? r.pe.toFixed(1) : '—'}</td>
                    <td style={{ color: '#e8e0d0' }}>{r.totalCap > 0 ? r.totalCap.toFixed(0) : '—'}</td>
                    <td style={{ color: '#e8e0d0' }}>{r.turnover > 0 ? r.turnover.toFixed(2) + '%' : '—'}</td>
                    <td style={{ color: r.signalCount > 0 ? '#d4a574' : '#e8e0d0', fontSize: '0.75rem' }}>{r.signalCount > 0 ? `${r.signalCount}个` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
