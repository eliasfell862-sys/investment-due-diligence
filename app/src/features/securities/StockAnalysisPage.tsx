import { useState, useEffect, useMemo } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { fetchSinaQuotes, fetchEastmoneyKLine, type StockQuote } from '../../infrastructure/market-data/stock-api';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import { runMultiAgentDebate, type DebateResult, type DebateDepth } from '../../engines/market-analysis/multi-agent-debate';

export function StockAnalysisPage() {
  const { code = '600519' } = useParams<{ code: string }>();
  const [stock, setStock] = useState<StockQuote | null>(null);
  const [klines, setKlines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    Promise.all([
      fetchSinaQuotes([code]),
      fetchEastmoneyKLine(code, 250),
    ]).then(([quotes, klineData]) => {
      if (quotes.length === 0) { setError('未找到该股票，请检查代码'); return; }
      setStock(quotes[0]);
      calcAllIndicators(klineData);
      setKlines(klineData);
    }).catch(() => setError('数据加载失败')).finally(() => setLoading(false));
  }, [code]);

  if (loading) return <PageShell code={code}><div style={{ color: '#8ba8a8', padding: 40, textAlign: 'center' }}>加载中...</div></PageShell>;
  if (error || !stock) return <PageShell code={code}><div style={{ color: '#f87171', padding: 40, textAlign: 'center' }}>{error || '数据异常'}</div></PageShell>;

  return <PageShell code={code} name={stock.name}>
    <StockDashboard stock={stock} klines={klines} />
  </PageShell>;
}

function PageShell({ code, name, children }: { code: string; name?: string; children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const backUrl = projectId ? `/projects/${projectId}/securities` : '/securities';
  return (
    <div className="module-page" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <NavLink to={backUrl} style={{ color: '#70b8b0', fontSize: '0.85rem', display: 'inline-block', marginBottom: 16 }}>
        ← 返回证券工作台
      </NavLink>
      <h1 style={{ color: '#e0e0e0', margin: '0 0 4px' }}>{name || code} <span style={{ color: '#5a7a7a', fontSize: '0.8rem' }}>{code}</span></h1>
      {children}
    </div>
  );
}

// ── Main Dashboard ──

function StockDashboard({ stock, klines }: { stock: StockQuote; klines: any[] }) {
  const [debate, setDebate] = useState<DebateResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [depth, setDepth] = useState<DebateDepth>('quick');
  const [activeSec, setActiveSec] = useState<'overview' | 'kline' | 'ai'>('overview');

  const signals = useMemo(() => computeSignals(klines), [klines]);
  const last = klines[klines.length - 1] as any;

  const handleAI = async () => {
    setAnalyzing(true);
    try {
      setDebate(await runMultiAgentDebate(stock.code, stock.name, stock.price, stock.changePct, depth));
    } catch { setDebate(null); }
    finally { setAnalyzing(false); }
  };

  const sections: { id: string; label: string }[] = [
    { id: 'overview', label: '📊 概览' },
    { id: 'kline', label: '📈 K线与指标' },
    { id: 'ai', label: `🧠 AI分析${debate ? ` (${debate.actionBias})` : ''}` },
  ];

  return (
    <>
      {/* ── Header Stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8, margin: '16px 0' }}>
        <StatCard label="最新价" value={stock.price.toFixed(2)} color="#e0e0e0" size="large" />
        <StatCard label="涨跌幅" value={`${stock.changePct >= 0 ? '+' : ''}${stock.changePct.toFixed(2)}%`} color={stock.changePct >= 0 ? '#f56c6c' : '#67c23a'} />
        <StatCard label="涨跌额" value={`${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}`} color={stock.change >= 0 ? '#f56c6c' : '#67c23a'} />
        <StatCard label="总市值(亿)" value={stock.totalCap > 0 ? stock.totalCap.toFixed(0) : '—'} color="#aaa" />
        <StatCard label="市盈率PE" value={stock.pe > 0 ? stock.pe.toFixed(1) : '—'} color="#aaa" />
        <StatCard label="换手率" value={stock.turnover > 0 ? `${stock.turnover.toFixed(2)}%` : '—'} color="#aaa" />
        <StatCard label="今开" value={stock.open > 0 ? stock.open.toFixed(2) : '—'} color="#aaa" />
        <StatCard label="昨收" value={stock.preClose > 0 ? stock.preClose.toFixed(2) : '—'} color="#aaa" />
        <StatCard label="最高" value={stock.high > 0 ? stock.high.toFixed(2) : '—'} color="#aaa" />
        <StatCard label="最低" value={stock.low > 0 ? stock.low.toFixed(2) : '—'} color="#aaa" />
        <StatCard label="成交量(手)" value={stock.volume > 0 ? `${(stock.volume/10000).toFixed(1)}万` : '—'} color="#aaa" />
        <StatCard label="成交额(万)" value={stock.amount > 0 ? `${(stock.amount/10000).toFixed(1)}万` : '—'} color="#aaa" />
      </div>

      {/* ── Buy/Sell Signals ── */}
      {signals.length > 0 && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {signals.map((s, i) => (
            <SignalBadge key={i} signal={s} />
          ))}
        </div>
      )}

      {/* ── Section Tabs ── */}
      <nav style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid #2a4a4a' }}>
        {sections.map(sec => (
          <button key={sec.id} onClick={() => setActiveSec(sec.id as any)}
            style={{
              padding: '8px 20px', border: 'none', cursor: 'pointer',
              background: activeSec === sec.id ? '#1a3a3a' : 'transparent',
              color: activeSec === sec.id ? '#70b8b0' : '#8ba8a8',
              borderBottom: activeSec === sec.id ? '2px solid #70b8b0' : '2px solid transparent',
              fontSize: '0.9rem',
            }}>{sec.label}</button>
        ))}
      </nav>

      {/* ── Overview ── */}
      {activeSec === 'overview' && last && (
        <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a' }}>
          <h3 style={{ color: '#e0e0e0', margin: '0 0 16px' }}>技术指标概览</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
            {last.macd && (
              <IndiBlock title="MACD (12,26,9)" color="#e6a23c">
                <IndiRow label="DIF" value={last.macd.dif} />
                <IndiRow label="DEA" value={last.macd.dea} />
                <IndiRow label="柱" value={last.macd.bar} color={last.macd.bar >= 0 ? '#f56c6c' : '#67c23a'} />
              </IndiBlock>
            )}
            {last.kdj && (
              <IndiBlock title="KDJ (9,3,3)" color="#909399">
                <IndiRow label="K" value={last.kdj.k} />
                <IndiRow label="D" value={last.kdj.d} />
                <IndiRow label="J" value={last.kdj.j} color={last.kdj.j > 80 ? '#f56c6c' : last.kdj.j < 20 ? '#67c23a' : '#e0e0e0'} />
              </IndiBlock>
            )}
            {last.rsi && (
              <IndiBlock title="RSI" color="#409eff">
                <IndiRow label="RSI(6)" value={last.rsi.rsi6} color={last.rsi.rsi6 > 70 ? '#f56c6c' : last.rsi.rsi6 < 30 ? '#67c23a' : '#e0e0e0'} />
                <IndiRow label="RSI(12)" value={last.rsi.rsi12} />
                <IndiRow label="RSI(24)" value={last.rsi.rsi24} />
              </IndiBlock>
            )}
            {last.boll && (
              <IndiBlock title="BOLL (20,2)" color="#67c23a">
                <IndiRow label="上轨" value={last.boll.upper} />
                <IndiRow label="中轨" value={last.boll.mid} />
                <IndiRow label="下轨" value={last.boll.lower} />
              </IndiBlock>
            )}
            {last.ma && (
              <IndiBlock title="均线" color="#f56c6c">
                <IndiRow label="MA5" value={last.ma.ma5} color={stock.price > last.ma.ma5 ? '#f56c6c' : '#67c23a'} />
                <IndiRow label="MA10" value={last.ma.ma10} />
                <IndiRow label="MA20" value={last.ma.ma20} />
                <IndiRow label="MA60" value={last.ma.ma60 || '—'} />
              </IndiBlock>
            )}
            {last.atr && <IndiBlock title="ATR (14)" color="#e6a23c"><IndiRow label="ATR" value={last.atr} /></IndiBlock>}
          </div>
        </div>
      )}

      {/* ── K-line Chart ── */}
      {activeSec === 'kline' && (
        <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a' }}>
          <h3 style={{ color: '#e0e0e0', margin: '0 0 16px' }}>K线走势 (近120日)</h3>
          <KLineChart klines={klines.slice(-120)} />
        </div>
      )}

      {/* ── AI Analysis ── */}
      {activeSec === 'ai' && (
        <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <select value={depth} onChange={e => setDepth(e.target.value as DebateDepth)}
              style={{ background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '6px 10px', borderRadius: 4 }}>
              <option value="quick">⚡ 快速分析</option>
              <option value="standard">🔄 标准（含多空反驳）</option>
              <option value="deep">🔬 深度（三轮辩论）</option>
            </select>
            <button className="button" onClick={handleAI} disabled={analyzing}
              style={{ background: analyzing ? '#3a5a5a' : '#e6a23c', color: '#fff', fontWeight: 'bold', padding: '8px 20px' }}>
              {analyzing ? '⏳ AI 分析中...' : '🧠 启动多智能体分析'}
            </button>
          </div>

          {debate && (
            <div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <Tag color={debate.actionBias.includes('看多') ? '#f56c6c' : debate.actionBias.includes('看空') ? '#67c23a' : '#aaa'}>
                  综合: {debate.actionBias}
                </Tag>
                <Tag color={debate.riskLevel === '极高' ? '#f87171' : debate.riskLevel === '高' ? '#f0b870' : '#70b8b0'}>
                  风险: {debate.riskLevel}
                </Tag>
                <Tag color="#5a7a7a">{debate.depth} · {debate.rounds.length}轮</Tag>
              </div>
              <p style={{ color: '#aaa', lineHeight: 1.8, marginBottom: 16 }}>{debate.consensus}</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
                {debate.reports.map(r => (
                  <div key={r.agent} style={{ background: '#0d1f1f', padding: 12, borderRadius: 6, border: '1px solid #1a3a3a' }}>
                    <div style={{ color: '#e0e0e0', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: 6 }}>{r.icon} {r.role}</div>
                    <div style={{ color: '#8ba8a8', fontSize: '0.78rem', lineHeight: 1.5, marginBottom: 6 }}>{r.thesis}</div>
                    {r.keyPoints.slice(0, 3).map((p, i) => (
                      <div key={i} style={{ color: '#6a8a8a', fontSize: '0.72rem', marginBottom: 2 }}>• {p}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!debate && !analyzing && (
            <div style={{ color: '#5a7a7a', padding: 40, textAlign: 'center' }}>
              点击上方按钮，启动 5 个 AI 智能体（多头/空头/风控/估值/策略）进行多空辩论分析
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Sub Components ──

function StatCard({ label, value, color, size }: { label: string; value: string; color: string; size?: string }) {
  return (
    <div style={{ background: '#0d1f1f', padding: '8px 10px', borderRadius: 6, textAlign: 'center', border: '1px solid #1a3a3a' }}>
      <div style={{ color: '#5a7a7a', fontSize: '0.65rem', marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontWeight: 'bold', fontSize: size === 'large' ? '1.15rem' : '0.85rem' }}>{value}</div>
    </div>
  );
}

function SignalBadge({ signal }: { signal: { type: string; strength: string; reason: string } }) {
  const isBuy = signal.type === 'buy';
  return (
    <div style={{
      padding: '4px 10px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 'bold',
      background: isBuy ? 'rgba(245,108,108,0.1)' : 'rgba(103,194,58,0.1)',
      color: isBuy ? '#f56c6c' : '#67c23a',
      border: `1px solid ${isBuy ? 'rgba(245,108,108,0.25)' : 'rgba(103,194,58,0.25)'}`,
    }}>{isBuy ? '📈' : '📉'} {signal.strength}{isBuy ? '买入' : '卖出'} — {signal.reason}</div>
  );
}

function IndiBlock({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#0d1f1f', padding: 10, borderRadius: 6, borderLeft: `3px solid ${color}` }}>
      <div style={{ color, fontSize: '0.78rem', fontWeight: 'bold', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: '0.8rem', lineHeight: 1.8 }}>{children}</div>
    </div>
  );
}

function IndiRow({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#aaa' }}>
      <span style={{ color: '#5a7a7a' }}>{label}</span>
      <strong style={{ color: color || '#e0e0e0' }}>{typeof value === 'number' ? value.toFixed(2) : value}</strong>
    </div>
  );
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 'bold', background: color + '22', color, border: `1px solid ${color}44` }}>{children}</span>;
}

// ── K-line Chart (SVG) ──

function KLineChart({ klines }: { klines: any[] }) {
  if (klines.length === 0) return <div style={{ color: '#5a7a7a', textAlign: 'center', padding: 40 }}>暂无K线数据</div>;

  const W = 800, H = 360, pad = { top: 20, right: 20, bottom: 40, left: 60 };
  const plotW = W - pad.left - pad.right, plotH = H - pad.top - pad.bottom;

  const highs = klines.map((k: any) => k.high);
  const lows = klines.map((k: any) => k.low);
  const maxH = Math.max(...highs), minL = Math.min(...lows);
  const range = maxH - minL || 1;

  const toX = (i: number) => pad.left + (i / (klines.length - 1)) * plotW;
  const toY = (v: number) => pad.top + plotH - ((v - minL) / range) * plotH;

  const barW = Math.max(1, Math.min(8, plotW / klines.length * 0.7));
  const gap = plotW / klines.length;

  // MA lines
  const ma5Pts = klines.map((k: any, i: number) => k.ma?.ma5 ? `${toX(i)},${toY(k.ma.ma5)}` : '').filter(Boolean).join(' ');
  const ma20Pts = klines.map((k: any, i: number) => k.ma?.ma20 ? `${toX(i)},${toY(k.ma.ma20)}` : '').filter(Boolean).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', background: '#0d1a1a', borderRadius: 8 }}>
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map(pct => {
        const y = toY(minL + range * pct);
        const val = (minL + range * pct).toFixed(2);
        return (
          <g key={pct}>
            <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="#1a3a3a" strokeWidth={0.5} />
            <text x={pad.left - 6} y={y + 4} textAnchor="end" fill="#5a7a7a" fontSize={9}>{val}</text>
          </g>
        );
      })}
      {/* K-line bars */}
      {klines.map((k: any, i: number) => {
        const x = pad.left + i * gap + (gap - barW) / 2;
        const isRed = k.close >= k.open;
        return (
          <g key={i}>
            <line x1={x + barW/2} y1={toY(k.high)} x2={x + barW/2} y2={toY(k.low)} stroke={isRed ? '#f56c6c' : '#67c23a'} strokeWidth={0.5} />
            <rect x={x} y={toY(Math.max(k.open, k.close))} width={barW} height={Math.max(1, Math.abs(toY(k.open) - toY(k.close)))} fill={isRed ? '#f56c6c' : '#67c23a'} opacity={0.8} />
          </g>
        );
      })}
      {/* MA lines */}
      {ma5Pts && <polyline points={ma5Pts} fill="none" stroke="#f0b870" strokeWidth={1} opacity={0.7} />}
      {ma20Pts && <polyline points={ma20Pts} fill="none" stroke="#70b8b0" strokeWidth={1} opacity={0.7} />}
      {/* Legend */}
      <line x1={pad.left + 10} y1={H - 20} x2={pad.left + 30} y2={H - 20} stroke="#f0b870" strokeWidth={1.5} />
      <text x={pad.left + 34} y={H - 16} fill="#f0b870" fontSize={9}>MA5</text>
      <line x1={pad.left + 60} y1={H - 20} x2={pad.left + 80} y2={H - 20} stroke="#70b8b0" strokeWidth={1.5} />
      <text x={pad.left + 84} y={H - 16} fill="#70b8b0" fontSize={9}>MA20</text>
    </svg>
  );
}

// ── Signal Computation ──

function computeSignals(klines: any[]): { type: string; strength: string; reason: string }[] {
  const signals: { type: string; strength: string; reason: string }[] = [];
  if (klines.length < 20) return signals;
  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2];
  if (!last || !prev) return signals;

  if (last.macd && prev.macd) {
    if (prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea) signals.push({ type: 'buy', strength: '中', reason: 'MACD金叉，DIF上穿DEA' });
    if (prev.macd.dif >= prev.macd.dea && last.macd.dif < last.macd.dea) signals.push({ type: 'sell', strength: '中', reason: 'MACD死叉，DIF下穿DEA' });
  }
  if (last.kdj) {
    if (last.kdj.j < 20) signals.push({ type: 'buy', strength: last.kdj.j < 0 ? '强' : '中', reason: `KDJ超卖，J值${last.kdj.j.toFixed(1)}` });
    if (last.kdj.j > 80) signals.push({ type: 'sell', strength: last.kdj.j > 100 ? '强' : '中', reason: `KDJ超买，J值${last.kdj.j.toFixed(1)}` });
    if (prev.kdj && prev.kdj.k <= prev.kdj.d && last.kdj.k > last.kdj.d && last.kdj.j < 40) signals.push({ type: 'buy', strength: '强', reason: 'KDJ金叉（低位）' });
  }
  if (last.rsi?.rsi6) {
    if (last.rsi.rsi6 < 30) signals.push({ type: 'buy', strength: '中', reason: `RSI(6)超卖 ${last.rsi.rsi6.toFixed(1)}` });
    if (last.rsi.rsi6 > 70) signals.push({ type: 'sell', strength: '中', reason: `RSI(6)超买 ${last.rsi.rsi6.toFixed(1)}` });
  }
  if (last.boll && last.close) {
    if (last.close <= last.boll.lower) signals.push({ type: 'buy', strength: '强', reason: '触及布林下轨，可能反弹' });
    if (last.close >= last.boll.upper) signals.push({ type: 'sell', strength: '强', reason: '触及布林上轨，可能回调' });
  }
  if (last.ma && prev.ma && last.close) {
    if (prev.close >= prev.ma.ma20 && last.close < last.ma.ma20) signals.push({ type: 'sell', strength: '中', reason: '跌破MA20' });
    if (prev.close <= prev.ma.ma20 && last.close > last.ma.ma20) signals.push({ type: 'buy', strength: '中', reason: '突破MA20' });
  }
  return signals.slice(0, 6);
}
