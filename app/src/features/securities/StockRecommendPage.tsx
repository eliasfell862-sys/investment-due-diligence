import { useState, useEffect } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { fetchSinaQuotes, loadStockDirectory, type StockQuote } from '../../infrastructure/market-data/stock-api';
import { recommendStocks, type StockRecommendation } from '../../engines/market-analysis/stock-recommender';

export function StockRecommendPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const backUrl = projectId ? `/projects/${projectId}/securities` : '/securities';

  const [recs, setRecs] = useState<StockRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'watchlist' | 'top100' | 'all' | 'industry'>('watchlist');
  const [industry, setIndustry] = useState('');
  const [progress, setProgress] = useState('');

  const doRecommend = async () => {
    setLoading(true); setError(''); setRecs([]);

    try {
      // Get candidate pool
      let candidates: StockQuote[] = [];

      if (mode === 'watchlist') {
        const dir = await loadStockDirectory();
        const wlCodes = dir.slice(0, 100).map((s: any) => s.code);
        setProgress(`正在分析 ${wlCodes.length} 只自选股...`);
        candidates = await fetchSinaQuotes(wlCodes);
      } else if (mode === 'top100') {
        const dir = await loadStockDirectory();
        setProgress('正在分析排名前300只股票...');
        const csiCodes = dir.slice(0, 300).map((s: any) => s.code);
        candidates = await fetchSinaQuotes(csiCodes);
      } else if (mode === 'industry' && industry) {
        const dir = await loadStockDirectory();
        const indCodes = dir.filter((s: any) => s.industry === industry).slice(0, 50).map((s: any) => s.code);
        setProgress(`正在分析 ${industry} 行业 ${indCodes.length} 只股票...`);
        candidates = await fetchSinaQuotes(indCodes);
      } else if (mode === 'all') {
        const dir = await loadStockDirectory();
        // Stratified sampling: top N from each major industry for broad coverage
        const industries = [...new Set(dir.map((s: any) => s.industry).filter(Boolean))];
        const sampled: Set<string> = new Set();
        for (const ind of industries) {
          dir.filter((s: any) => s.industry === ind).slice(0, 15).forEach((s: any) => sampled.add(s.code));
        }
        const allCodes = [...sampled].slice(0, 300);
        setProgress(`正在从30个行业中各抽取15只，共${allCodes.length}只进行分析...`);
        candidates = await fetchSinaQuotes(allCodes);
      }

      if (candidates.length === 0) { setError('未找到候选股票'); return; }

      setProgress(`正在逐只计算技术指标...`);
      const results = await recommendStocks(candidates.filter(q => q.price > 0), 5);
      setRecs(results);
      setProgress('');
    } catch (e) {
      setError('分析失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  // Load industries for filter
  const [industries, setIndustries] = useState<string[]>([]);
  useEffect(() => {
    loadStockDirectory().then(dir => {
      const inds = [...new Set(dir.map((s: any) => s.industry).filter(Boolean))].sort();
      setIndustries(inds);
    });
  }, []);

  return (
    <div className="module-page" style={{ maxWidth: 900, margin: '0 auto' }}>
      <NavLink to={backUrl} style={{ color: '#70b8b0', fontSize: '0.85rem', display: 'inline-block', marginBottom: 16 }}>
        ← 返回证券工作台
      </NavLink>
      <h1 style={{ color: '#e0e0e0', margin: '0 0 8px' }}>⭐ 智能荐股</h1>
      <p style={{ color: '#8ba8a8', fontSize: '0.85rem', marginBottom: 20 }}>
        基于 MACD/KDJ/RSI/MA/BOLL/成交量 等技术指标 + 估值分析，综合评分选出最值得关注的股票。
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'end', flexWrap: 'wrap' }}>
        <select value={mode} onChange={e => setMode(e.target.value as any)}
          style={{ background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '8px 12px', borderRadius: 6 }}>
          <option value="watchlist">自选股池</option>
          <option value="top100">排名前300</option>
          <option value="all">全部A股</option>
          <option value="industry">行业筛选</option>
        </select>
        {mode === 'industry' && (
          <select value={industry} onChange={e => setIndustry(e.target.value)}
            style={{ background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '8px 12px', borderRadius: 6, maxWidth: 160 }}>
            <option value="">选择行业</option>
            {industries.map(ind => <option key={ind} value={ind}>{ind}</option>)}
          </select>
        )}
        <button className="button" onClick={doRecommend} disabled={loading || (mode === 'industry' && !industry)}
          style={{ padding: '10px 28px', background: loading ? '#3a5a5a' : '#e6a23c', color: '#fff', fontWeight: 'bold', fontSize: '1rem' }}>
          {loading ? '⏳ 分析中...' : '🚀 开始推荐'}
        </button>
      </div>

      {progress && <div style={{ color: '#70b8b0', fontSize: '0.85rem', marginBottom: 12 }}>{progress}</div>}
      {error && <div style={{ color: '#f87171', marginBottom: 12 }}>{error}</div>}

      {/* Results */}
      {recs.length > 0 && (
        <div>
          <h3 style={{ color: '#e0e0e0', marginBottom: 12 }}>
            📈 推荐结果（综合技术面评分 Top 5）— 未来一个月看多
          </h3>
          {recs.map((r, i) => (
            <div key={r.code} onClick={() => navigate(`/projects/${projectId || 'default'}/securities/stock/${r.code}`)}
              style={{
                cursor: 'pointer', background: '#1a2a2a', padding: 16, borderRadius: 8, marginBottom: 10,
                border: i === 0 ? '2px solid #e6a23c' : '1px solid #2a4a4a',
                transition: 'all 0.2s',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ color: '#e6a23c', fontWeight: 'bold', fontSize: '1.2rem' }}>#{i + 1}</span>
                    <span style={{ color: '#e0e0e0', fontWeight: 'bold', fontSize: '1.05rem' }}>{r.name}</span>
                    <span style={{ color: '#5a7a7a' }}>{r.code}</span>
                  </div>
                  <div style={{ marginTop: 4, color: '#8ba8a8', fontSize: '0.82rem' }}>{r.summary}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#e0e0e0', fontWeight: 'bold', fontSize: '1.1rem' }}>{r.price.toFixed(2)}</div>
                  <div style={{ color: r.changePct >= 0 ? '#f56c6c' : '#67c23a', fontSize: '0.85rem', fontWeight: 'bold' }}>
                    {r.changePct >= 0 ? '+' : ''}{r.changePct.toFixed(2)}%
                  </div>
                  <div style={{
                    marginTop: 4, padding: '2px 12px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 'bold',
                    background: r.score >= 80 ? '#e6a23c33' : r.score >= 65 ? '#70b8b033' : '#aaa3',
                    color: r.score >= 80 ? '#e6a23c' : r.score >= 65 ? '#70b8b0' : '#aaa',
                  }}>{r.score} 分</div>
                </div>
              </div>

              {/* Signals */}
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {r.signals.map((s, j) => (
                  <span key={j} style={{
                    padding: '3px 10px', borderRadius: 6, fontSize: '0.72rem',
                    background: s.includes('金叉') || s.includes('超卖') || s.includes('多头') ? 'rgba(245,108,108,0.1)' : 'rgba(112,184,176,0.1)',
                    color: s.includes('金叉') || s.includes('超卖') || s.includes('多头') ? '#f56c6c' : '#70b8b0',
                    border: `1px solid ${s.includes('金叉') || s.includes('超卖') || s.includes('多头') ? 'rgba(245,108,108,0.25)' : 'rgba(112,184,176,0.25)'}`,
                  }}>{s}</span>
                ))}
              </div>

              {/* Score bar */}
              <div style={{ marginTop: 8, height: 4, background: '#2a2a2a', borderRadius: 2 }}>
                <div style={{ width: `${r.score}%`, height: '100%', borderRadius: 2, background: r.score >= 80 ? '#e6a23c' : r.score >= 65 ? '#70b8b0' : '#5a7a7a', transition: 'width 0.5s' }} />
              </div>
            </div>
          ))}
          <p style={{ marginTop: 16, fontSize: '0.72rem', color: '#5a7a7a' }}>
            ⚠️ 以上为技术面分析结果，不构成投资建议。请结合基本面、行业趋势和自身风险承受能力综合判断。
          </p>
        </div>
      )}
    </div>
  );
}
