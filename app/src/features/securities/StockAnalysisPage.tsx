import { useState, useEffect, useMemo } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { fetchSinaQuotes, fetchEastmoneyKLine, type StockQuote } from '../../infrastructure/market-data/stock-api';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import { runMultiAgentDebate, type DebateResult, type DebateDepth } from '../../engines/market-analysis/multi-agent-debate';
import { scanPatterns } from '../../engines/market-analysis/kline-patterns';

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

  if (loading) return <PageShell code={code}><div style={{ color: '#bbbbbb', padding: 40, textAlign: 'center' }}>加载中...</div></PageShell>;
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <NavLink to={backUrl} style={{ color: '#70b8b0', fontSize: '0.85rem', display: 'inline-block', marginBottom: 8 }}>
            ← 返回证券工作台
          </NavLink>
          <h1 style={{ color: '#e0e0e0', margin: 0 }}>{name || code} <span style={{ color: '#e8e0d0', fontSize: '0.8rem' }}>{code}</span></h1>
        </div>
        <button className="button" onClick={() => window.location.reload()}
          style={{ padding: '6px 16px', background: '#70b8b0', color: '#0d1a1a', fontWeight: 'bold', fontSize: '0.85rem' }}>
          🔄 刷新
        </button>
      </div>
      {children}
    </div>
  );
}

// ── Main Dashboard ──

function StockDashboard({ stock, klines: initialKlines }: { stock: StockQuote; klines: any[] }) {
  const [debate, setDebate] = useState<DebateResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [depth, setDepth] = useState<DebateDepth>('quick');
  const [activeSec, setActiveSec] = useState<'overview' | 'kline' | 'ai' | 'chat'>('overview');
  const [klines, setKlines] = useState<any[]>(initialKlines);
  useEffect(() => { setKlines(initialKlines); }, [initialKlines]);

  const signals = useMemo(() => computeSignals(klines), [klines]);
  const priceTargets = useMemo(() => computePriceTargets(klines, stock), [klines, stock]);
  const patterns = useMemo(() => scanPatterns(klines), [klines]);
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
    { id: 'chat', label: '💬 人工博弈' },
  ];

  return (
    <>
      {/* ── Header Stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8, margin: '16px 0' }}>
        <StatCard label="最新价" value={stock.price.toFixed(2)} color="#e0e0e0" size="large" />
        <StatCard label="涨跌幅" value={`${stock.changePct >= 0 ? '+' : ''}${stock.changePct.toFixed(2)}%`} color={stock.changePct >= 0 ? '#f56c6c' : '#67c23a'} />
        <StatCard label="涨跌额" value={`${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}`} color={stock.change >= 0 ? '#f56c6c' : '#67c23a'} />
        <StatCard label="总市值(亿)" value={stock.totalCap > 0 ? stock.totalCap.toFixed(0) : '—'} color="#c0b8a8" />
        <StatCard label="市盈率PE" value={stock.pe > 0 ? stock.pe.toFixed(1) : '—'} color="#c0b8a8" />
        <StatCard label="换手率" value={stock.turnover > 0 ? `${stock.turnover.toFixed(2)}%` : '—'} color="#c0b8a8" />
        <StatCard label="今开" value={stock.open > 0 ? stock.open.toFixed(2) : '—'} color="#c0b8a8" />
        <StatCard label="昨收" value={stock.preClose > 0 ? stock.preClose.toFixed(2) : '—'} color="#c0b8a8" />
        <StatCard label="最高" value={stock.high > 0 ? stock.high.toFixed(2) : '—'} color="#c0b8a8" />
        <StatCard label="最低" value={stock.low > 0 ? stock.low.toFixed(2) : '—'} color="#c0b8a8" />
        <StatCard label="成交量(手)" value={stock.volume > 0 ? `${(stock.volume/10000).toFixed(1)}万` : '—'} color="#c0b8a8" />
        <StatCard label="成交额(万)" value={stock.amount > 0 ? `${(stock.amount/10000).toFixed(1)}万` : '—'} color="#c0b8a8" />
      </div>

      {/* ── Price Targets ── */}
      {priceTargets && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 8, marginBottom: 16 }}>
          <TargetCard label="💰 建议买入价" value={priceTargets.buyPrice} sub={`支撑位: ${priceTargets.supportLevel}`} color="#f56c6c" />
          <TargetCard label="📈 建议卖出价" value={priceTargets.sellPrice} sub={`压力位: ${priceTargets.resistanceLevel}`} color="#67c23a" />
          <TargetCard label="🛑 止损价" value={priceTargets.stopLoss} sub={`ATR: ${priceTargets.atr}`} color="#f87171" />
          <TargetCard label="📊 仓位建议" value={priceTargets.position} sub={priceTargets.positionNote} color="#f0b870" />
        </div>
      )}

      {/* ── K-line Patterns ── */}
      {patterns.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#d4a574', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: 8 }}>
            🕯️ K线形态识别 (InStock算法)
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {patterns.map((p, i) => (
              <div key={i} style={{
                padding: '5px 12px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 'bold',
                background: p.type === 'bullish' ? '#4a1515' : p.type === 'bearish' ? '#153a15' : '#1a1a1a',
                color: p.type === 'bullish' ? '#ff6666' : p.type === 'bearish' ? '#66cc66' : '#dddddd',
                border: `2px solid ${p.type === 'bullish' ? '#ff4444' : p.type === 'bearish' ? '#44cc44' : '#888888'}`,
                cursor: 'help',
              }} title={p.description}>
                {p.type === 'bullish' ? '📈' : p.type === 'bearish' ? '📉' : '➖'} {p.name}
                <span style={{ fontSize: '0.65rem', marginLeft: 4, opacity: 0.7 }}>{p.strength}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
              <p style={{ color: '#f0e8d8', lineHeight: 1.8, marginBottom: 16 }}>{debate.consensus}</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
                {debate.reports.map(r => (
                  <div key={r.agent} style={{ background: '#0d1f1f', padding: 12, borderRadius: 6, border: '1px solid #1a3a3a' }}>
                    <div style={{ color: '#e0e0e0', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: 6 }}>{r.icon} {r.role}</div>
                    <div style={{ color: '#bbbbbb', fontSize: '0.78rem', lineHeight: 1.5, marginBottom: 6 }}>{r.thesis}</div>
                    {r.keyPoints.slice(0, 3).map((p, i) => (
                      <div key={i} style={{ color: '#6a8a8a', fontSize: '0.72rem', marginBottom: 2 }}>• {p}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!debate && !analyzing && (
            <div style={{ color: '#e8e0d0', padding: 40, textAlign: 'center' }}>
              点击上方按钮，启动 5 个 AI 智能体（多头/空头/风控/估值/策略）进行多空辩论分析
            </div>
          )}
        </div>
      )}

      {/* ── AI Chat ── */}
      {activeSec === 'chat' && <AIChatPanel stock={stock} klines={klines} />}
    </>
  );
}

// ── Sub Components ──

function StatCard({ label, value, color, size }: { label: string; value: string; color: string; size?: string }) {
  return (
    <div style={{ background: '#0d1f1f', padding: '8px 10px', borderRadius: 6, textAlign: 'center', border: '1px solid #1a3a3a' }}>
      <div style={{ color: '#e8e0d0', fontSize: '0.65rem', marginBottom: 2 }}>{label}</div>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f0e8d8' }}>
      <span style={{ color: '#e8e0d0' }}>{label}</span>
      <strong style={{ color: color || '#e0e0e0' }}>{typeof value === 'number' ? value.toFixed(2) : value}</strong>
    </div>
  );
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 'bold', background: color + '22', color, border: `1px solid ${color}44` }}>{children}</span>;
}

// ── AI Chat Panel ──

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  time: string;
}

function AIChatPanel({ stock, klines }: { stock: StockQuote; klines: any[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);

  const buildContext = (): string => {
    const last = klines[klines.length - 1] as any;
    const prev = klines[klines.length - 2] as any;
    const recent20 = klines.slice(-20);
    const parts = [
      `【股票信息】`,
      `${stock.name}(${stock.code}) | ${stock.market === 'sh' ? '上交所' : '深交所'}`,
      `最新价: ${stock.price.toFixed(2)} | 涨跌: ${stock.changePct >= 0 ? '+' : ''}${stock.changePct.toFixed(2)}% | 涨跌额: ${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}`,
      `今开: ${stock.open > 0 ? stock.open.toFixed(2) : '—'} | 昨收: ${stock.preClose > 0 ? stock.preClose.toFixed(2) : '—'} | 最高: ${stock.high > 0 ? stock.high.toFixed(2) : '—'} | 最低: ${stock.low > 0 ? stock.low.toFixed(2) : '—'}`,
      `PE: ${stock.pe > 0 ? stock.pe.toFixed(1) : '—'} | PB: ${stock.pb > 0 ? stock.pb.toFixed(1) : '—'} | 市值: ${stock.totalCap > 0 ? stock.totalCap.toFixed(0) + '亿' : '—'}`,
      `成交量: ${stock.volume > 0 ? (stock.volume/10000).toFixed(1) + '万手' : '—'} | 换手率: ${stock.turnover > 0 ? stock.turnover.toFixed(2) + '%' : '—'}`,
      '',
      `【技术指标 — 基于InStock算法】`,
    ];
    if (last?.macd) parts.push(`MACD(12,26,9): DIF=${last.macd.dif} DEA=${last.macd.dea} 柱=${last.macd.bar} | ${last.macd.dif > last.macd.dea ? '多头排列' : '空头排列'} | ${prev?.macd && prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea ? '⚠️ 刚发生金叉' : prev?.macd && prev.macd.dif >= prev.macd.dea && last.macd.dif < last.macd.dea ? '⚠️ 刚发生死叉' : ''}`);
    if (last?.kdj) parts.push(`KDJ(9,3,3): K=${last.kdj.k} D=${last.kdj.d} J=${last.kdj.j} | J值${last.kdj.j > 80 ? '>80 超买区' : last.kdj.j < 20 ? '<20 超卖区' : '正常区'}`);
    if (last?.rsi) parts.push(`RSI: 6日=${last.rsi.rsi6} 12日=${last.rsi.rsi12} 24日=${last.rsi.rsi24} | ${last.rsi.rsi6 > 70 ? 'RSI(6)>70 超买' : last.rsi.rsi6 < 30 ? 'RSI(6)<30 超卖' : '正常'}`);
    if (last?.ma) parts.push(`均线: MA5=${last.ma.ma5} MA10=${last.ma.ma10} MA20=${last.ma.ma20} MA60=${last.ma.ma60 || '—'} | ${last.close > last.ma.ma20 ? '价格>MA20 偏多' : '价格<MA20 偏空'} | ${last.ma.ma5 > last.ma.ma20 ? 'MA5>MA20 短期多头' : 'MA5<MA20 短期空头'}`);
    if (last?.boll) {
      const bollPos = last.close <= last.boll.lower ? '触及下轨(超卖)' : last.close >= last.boll.upper ? '触及上轨(超买)' : (((last.close - last.boll.lower) / (last.boll.upper - last.boll.lower)) * 100).toFixed(0) + '%位置';
      parts.push(`BOLL(20,2): 上轨=${last.boll.upper} 中轨=${last.boll.mid} 下轨=${last.boll.lower} | 价格处在${bollPos}`);
    }
    if (last?.atr) parts.push(`ATR(14): ${last.atr} | 波动率: ${(last.atr / stock.price * 100).toFixed(2)}%`);
    if (last?.obv !== undefined && prev?.obv !== undefined) {
      parts.push(`OBV: ${last.obv > prev.obv ? '↑ 上升（资金流入）' : '↓ 下降（资金流出）'}`);
    }

    // Recent price action
    if (recent20.length >= 20) {
      const high20 = Math.max(...recent20.map((k: any) => k.high));
      const low20 = Math.min(...recent20.map((k: any) => k.low));
      const avgVol20 = recent20.reduce((s: number, k: any) => s + k.volume, 0) / 20;
      parts.push('');
      parts.push(`【近期统计(20日)】`);
      parts.push(`20日最高: ${high20.toFixed(2)} | 20日最低: ${low20.toFixed(2)} | 区间振幅: ${((high20 - low20) / low20 * 100).toFixed(1)}%`);
      parts.push(`20日均量: ${(avgVol20 / 10000).toFixed(0)}万手 | 今日量: ${last?.volume > avgVol20 * 1.5 ? '放量(>1.5倍均量)' : last?.volume < avgVol20 * 0.5 ? '缩量(<0.5倍均量)' : '正常'}`);
    }

    // Price targets (computed locally)
    const ptargets = computePriceTargets(klines, stock);
    if (ptargets) {
      parts.push('');
      parts.push(`【量化参考】`);
      parts.push(`支撑位: ${ptargets.supportLevel} | 压力位: ${ptargets.resistanceLevel}`);
      parts.push(`建议买入区: ${ptargets.buyPrice} | 建议卖出区: ${ptargets.sellPrice} | 止损: ${ptargets.stopLoss}`);
    }

    return parts.join('\n');
  };

  const handleAsk = async () => {
    if (!input.trim() || thinking) return;
    const question = input.trim();
    setInput('');
    const now = new Date().toLocaleTimeString('zh-CN');
    setMessages(prev => [...prev, { role: 'user', text: question, time: now }]);
    setThinking(true);

    try {
      // Use existing AI config
      const { loadResearchConfig, PROVIDER_PRESETS } = await import('../../infrastructure/research/research-adapter');
      const cfg = loadResearchConfig();
      if (!cfg) { setMessages(prev => [...prev, { role: 'ai', text: '请先在 AI 研究页面配置模型。', time: new Date().toLocaleTimeString('zh-CN') }]); setThinking(false); return; }

      const preset = PROVIDER_PRESETS[cfg.provider] ?? PROVIDER_PRESETS.custom;
      const endpoint = cfg.endpoint || preset.endpoint;
      const model = cfg.model || (cfg.provider === 'ollama' ? 'deepseek-r1:14b' : 'deepseek-chat');

      const prompt = `你是资深A股多维度投资分析系统。参考TradingAgents-CN的5-Agent辩论框架，请从以下角度头脑风暴分析：

【多头视角】有哪些积极因素和买入理由？
【空头视角】有哪些风险和看空理由？
【技术面】当前技术指标信号如何？
【估值面】当前估值水平是否合理？
【策略建议】综合来看应该如何操作？

基于以下数据：

${buildContext()}

用户问题: ${question}

请用以下格式回答：
**多头逻辑**：...
**空头风险**：...
**技术判断**：...
**估值判断**：...
**综合建议**：...

控制在400字以内，给出具体价位和操作建议。`;

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { 'Authorization': `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是资深A股投资分析助手。基于数据给出具体分析，不要泛泛而谈。' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 1024, temperature: 0.5,
        }),
      });
      const data = await resp.json() as any;
      const reply = data.choices?.[0]?.message?.content || 'AI 未返回有效回答';

      setMessages(prev => [...prev, { role: 'ai', text: reply, time: new Date().toLocaleTimeString('zh-CN') }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', text: 'AI 调用失败：' + (e instanceof Error ? e.message : '未知错误'), time: new Date().toLocaleTimeString('zh-CN') }]);
    } finally { setThinking(false); }
  };

  return (
    <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a' }}>
      <h3 style={{ color: '#e0e0e0', margin: '0 0 4px' }}>💬 人工博弈</h3>
      <p style={{ color: '#e8e0d0', fontSize: '0.8rem', margin: '0 0 16px' }}>
        提出你的疑问，AI 结合当前技术指标和行情数据，头脑风暴式分析回答。
      </p>

      {/* Messages */}
      <div style={{ maxHeight: 400, overflowY: 'auto', marginBottom: 12 }}>
        {messages.length === 0 && (
          <div style={{ color: '#e8e0d0', padding: 20, textAlign: 'center', fontSize: '0.85rem' }}>
            试试问：<br/>
            "这个位置适合买入吗？"<br/>
            "现在最大的风险是什么？"<br/>
            "和同行业比估值怎么样？"
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            marginBottom: 12,
            padding: '10px 14px', borderRadius: 8,
            background: m.role === 'user' ? '#2a2218' : '#0d1f1f',
            border: m.role === 'user' ? '1px solid #3a3028' : '1px solid #1a3a3a',
            marginLeft: m.role === 'user' ? 40 : 0,
            marginRight: m.role === 'ai' ? 40 : 0,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: m.role === 'user' ? '#d4a574' : '#70b8b0', fontWeight: 'bold', fontSize: '0.78rem' }}>
                {m.role === 'user' ? '🧑 你' : '🤖 AI 分析'}
              </span>
              <span style={{ color: '#e8e0d0', fontSize: '0.65rem' }}>{m.time}</span>
            </div>
            <div style={{ color: '#e8e0d0', fontSize: '0.85rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{m.text}</div>
          </div>
        ))}
        {thinking && (
          <div style={{ color: '#d4a574', padding: '10px 14px', background: '#0d1f1f', borderRadius: 8, fontSize: '0.85rem' }}>
            🤖 AI 正在头脑风暴分析中...
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
          placeholder="输入你的问题，按回车发送..."
          rows={2}
          disabled={thinking}
          style={{
            flex: 1, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0',
            padding: '8px 12px', borderRadius: 6, fontSize: '0.85rem', resize: 'vertical',
          }}
        />
        <button className="button" onClick={handleAsk} disabled={thinking || !input.trim()}
          style={{ padding: '8px 20px', background: thinking ? '#5a5040' : '#d4a574', color: '#fff', fontWeight: 'bold', alignSelf: 'end' }}>
          {thinking ? '⏳' : '发送'}
        </button>
      </div>
    </div>
  );
}

// ── K-line Chart (SVG) ──

function KLineChart({ klines }: { klines: any[] }) {
  if (klines.length === 0) return <div style={{ color: '#e8e0d0', textAlign: 'center', padding: 40 }}>暂无K线数据</div>;

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

// ── Price Target Computation ──

function computePriceTargets(klines: any[], stock: StockQuote) {
  if (klines.length < 20) return null;
  const last = klines[klines.length - 1];
  const price = stock.price;

  // Support: BOLL lower band, or recent 20-day low
  const recent20 = klines.slice(-20);
  const low20 = Math.min(...recent20.map((k: any) => k.low));
  const high20 = Math.max(...recent20.map((k: any) => k.high));
  const bollLower = last?.boll?.lower;
  const bollUpper = last?.boll?.upper;
  const ma20 = last?.ma?.ma20;
  const atr = last?.atr || (high20 - low20) / 10;

  // Support = max(BOLL lower, recent low, MA20-2*ATR) — the strongest nearby support
  const supportCandidates = [bollLower, low20, ma20 ? ma20 - 2 * atr : null].filter(v => v && v < price) as number[];
  const supportLevel = supportCandidates.length > 0 ? Math.max(...supportCandidates) : low20;

  // Resistance = min(BOLL upper, recent high, MA20+2*ATR) — the nearest overhead resistance
  const resistCandidates = [bollUpper, high20, ma20 ? ma20 + 2 * atr : null].filter(v => v && v > price) as number[];
  const resistanceLevel = resistCandidates.length > 0 ? Math.min(...resistCandidates) : high20;

  // Buy price: near support, with a buffer
  const buyPrice = (supportLevel * 1.02).toFixed(2);

  // Sell price: near resistance
  const sellPrice = (resistanceLevel * 0.98).toFixed(2);

  // Stop loss: below support by 1 ATR
  const stopLoss = (supportLevel - atr).toFixed(2);

  // Position sizing: risk per share = buy - stopLoss
  const riskPerShare = parseFloat(buyPrice) - parseFloat(stopLoss);
  const positionPct = riskPerShare > 0 && price > 0
    ? Math.min(30, Math.max(5, Math.round((atr / price) * 100 * 2)))
    : 10;

  return {
    buyPrice,
    sellPrice,
    stopLoss: parseFloat(stopLoss) > 0 ? stopLoss : (price * 0.93).toFixed(2),
    supportLevel: supportLevel.toFixed(2),
    resistanceLevel: resistanceLevel.toFixed(2),
    atr: atr.toFixed(2),
    position: `${positionPct}%`,
    positionNote: positionPct <= 10 ? '保守仓位' : positionPct <= 20 ? '适中仓位' : '积极仓位',
  };
}

function TargetCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ background: '#0d1f1f', padding: '10px 12px', borderRadius: 6, border: `1px solid ${color}33` }}>
      <div style={{ color: '#bbbbbb', fontSize: '0.7rem', marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontWeight: 'bold', fontSize: '1.1rem' }}>{value}</div>
      <div style={{ color: '#e8e0d0', fontSize: '0.65rem', marginTop: 2 }}>{sub}</div>
    </div>
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
