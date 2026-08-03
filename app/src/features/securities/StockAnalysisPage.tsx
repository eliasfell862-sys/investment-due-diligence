import { useState, useEffect, useMemo } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { fetchSinaQuotes, fetchEastmoneyKLine, fetchEastmoneyBasic, type StockQuote, type DailyBasicData } from '../../infrastructure/market-data/stock-api';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import { runMultiAgentDebate, type DebateResult, type DebateDepth } from '../../engines/market-analysis/multi-agent-debate';
import { runDeepResearch, type ResearchReport } from '../../engines/market-analysis/deep-research-engine';
import { scanPatterns } from '../../engines/market-analysis/kline-patterns';
import { runBacktest, type BacktestResult } from '../../engines/market-analysis/backtest-engine';
import { scoreFundamentals, type FundamentalScore } from '../../engines/market-analysis/fundamental-scorer';
import { scanStrategies, type StrategySignal } from '../../engines/market-analysis/trading-strategies';
import { fetchStockFundFlow, fmtFundFlow, flowColor, type CapitalFlow } from '../../infrastructure/market-data/capital-flow-api';

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
  const [research, setResearch] = useState<ResearchReport | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [depth, setDepth] = useState<DebateDepth>('quick');
  const [activeSec, setActiveSec] = useState<'overview' | 'kline' | 'fundamental' | 'strategy' | 'flow' | 'research' | 'ai' | 'chat' | 'backtest'>('overview');
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

  const handleDeepResearch = async () => {
    setAnalyzing(true);
    try {
      const report = await runDeepResearch({
        stock, klines, financial, fundamentals, strategies, fundFlow, backtest,
      });
      setResearch(report);
    } catch { setResearch(null); }
    finally { setAnalyzing(false); }
  };

  const [financial, setFinancial] = useState<DailyBasicData | null>(null);
  useEffect(() => { fetchEastmoneyBasic(stock.code).then(setFinancial).catch(() => {}); }, [stock.code]);

  const [fundFlow, setFundFlow] = useState<CapitalFlow | null>(null);
  useEffect(() => { fetchStockFundFlow(stock.code).then(setFundFlow).catch(() => {}); }, [stock.code]);

  const backtest = useMemo(() => klines.length > 60 ? runBacktest(klines) : null, [klines]);
  const fundamentals = useMemo(() => scoreFundamentals(stock, klines, financial), [stock, klines, financial]);
  const strategies = useMemo(() => scanStrategies(klines), [klines]);

  const sections: { id: string; label: string }[] = [
    { id: 'overview', label: '📊 概览' },
    { id: 'kline', label: '📈 K线与指标' },
    { id: 'fundamental', label: `💰 基本面(${fundamentals.rating})` },
    { id: 'strategy', label: `🎯 策略信号${strategies.length > 0 ? ` (${strategies.length})` : ''}` },
    { id: 'flow', label: `💵 资金流向${fundFlow ? (fundFlow.mainNet >= 0 ? ' 🔴流入' : ' 🟢流出') : ''}` },
    { id: 'research', label: `🧠 深度研究${research ? ` (${research.rating})` : ''}` },
    { id: 'ai', label: `⚡ 快速辩论${debate ? ` (${debate.actionBias})` : ''}` },
    { id: 'chat', label: '💬 人工博弈' },
    { id: 'backtest', label: `⏪ 回测${backtest ? ` (${backtest.totalTrades}笔)` : ''}` },
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

      {/* ── Fundamental ── */}
      {activeSec === 'fundamental' && <FundamentalPanel score={fundamentals} />}

      {/* ── Strategy Signals ── */}
      {activeSec === 'strategy' && <StrategyPanel signals={strategies} stock={stock} />}

      {/* ── Capital Flow ── */}
      {activeSec === 'flow' && <FlowPanel flow={fundFlow} stock={stock} klines={klines} />}

      {/* ── Deep Research ── */}
      {activeSec === 'research' && (
        <ResearchPanel research={research} analyzing={analyzing} onRun={handleDeepResearch} stock={stock} />
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

      {/* ── Backtest ── */}
      {activeSec === 'backtest' && backtest && <BacktestPanel result={backtest} stock={stock} />}
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

// ── Capital Flow Panel ──

function FlowPanel({ flow, klines, stock }: { flow: CapitalFlow | null; stock: StockQuote; klines: any[] }) {
  // ── Compute MFI and volume-based flow indicators locally ──
  const localFlow = useMemo(() => {
    if (klines.length < 20) return null;
    const recent = klines.slice(-20);

    // Money Flow Index style: typical price × volume, signed by direction
    let posFlow = 0, negFlow = 0;
    let buyVol = 0, sellVol = 0;
    const dailyFlows: { date: string; flow: number; pct: number }[] = [];

    for (let i = 1; i < recent.length; i++) {
      const k = recent[i];
      const prev = recent[i - 1];
      const typicalPrice = (k.high + k.low + k.close) / 3;
      const moneyFlow = typicalPrice * k.volume;
      const pctChg = ((k.close - prev.close) / prev.close) * 100;

      if (k.close > prev.close) {
        posFlow += moneyFlow;
        buyVol += k.volume;
      } else {
        negFlow += moneyFlow;
        sellVol += k.volume;
      }

      dailyFlows.push({
        date: k.date?.slice(5) || '',
        flow: moneyFlow * (k.close > prev.close ? 1 : -1) / 1e8,
        pct: pctChg,
      });
    }

    const totalFlow = posFlow + negFlow;
    const mfi = totalFlow > 0 ? 100 - (100 / (1 + posFlow / (negFlow || 1))) : 50;
    const netFlow = posFlow - negFlow;
    const buyRatio = buyVol / (buyVol + sellVol || 1) * 100;

    // Recent 5-day trend
    const recent5 = dailyFlows.slice(-5);
    const recentFlow5 = recent5.reduce((s, d) => s + d.flow, 0);

    return {
      mfi: Math.round(mfi),
      netFlow: netFlow / 1e8, // 亿
      buyRatio: Math.round(buyRatio),
      recentFlow5: recentFlow5,
      dailyFlows: dailyFlows.slice(-10),
      isInflow: recentFlow5 > 0,
    };
  }, [klines]);

  // Use real API data if available, otherwise local estimate
  const hasReal = !!flow;
  const mfi = localFlow?.mfi || 50;
  const netFlowEst = localFlow?.netFlow || 0;
  const buyRatio = localFlow?.buyRatio || 50;

  return (
    <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ color: '#d4a574', margin: 0 }}>💵 资金流向分析</h3>
        <span style={{ fontSize: '0.75rem', color: '#70b8b0' }}>
          {hasReal ? '来源：东方财富' : '来源：本地量价模型(MFI)'}
        </span>
      </div>

      {/* Core Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8, marginBottom: 16 }}>
        {hasReal ? (
          <>
            <FlowCard label="主力净流入" value={fmtFundFlow(flow!.mainNet)} ratio={`${flow!.mainRatio.toFixed(1)}%`} color={flowColor(flow!.mainNet)} />
            <FlowCard label="超大单净流入" value={fmtFundFlow(flow!.superLargeNet)} ratio={`${flow!.superLargeRatio.toFixed(1)}%`} color={flowColor(flow!.superLargeNet)} />
            <FlowCard label="大单净流入" value={fmtFundFlow(flow!.largeNet)} ratio={`${flow!.largeRatio.toFixed(1)}%`} color={flowColor(flow!.largeNet)} />
            <FlowCard label="中单净流入" value={fmtFundFlow(flow!.mediumNet)} ratio="—" color={flowColor(flow!.mediumNet)} />
            <FlowCard label="小单净流入" value={fmtFundFlow(flow!.smallNet)} ratio="—" color={flowColor(flow!.smallNet)} />
          </>
        ) : (
          <>
            <FlowCard label="资金流量(MFI)" value={`${mfi}`} ratio={mfi > 50 ? '偏多' : mfi < 50 ? '偏空' : '中性'} color={mfi > 55 ? '#ff6666' : mfi < 45 ? '#66cc66' : '#d4a574'} />
            <FlowCard label="5日净流量" value={`${netFlowEst >= 0 ? '+' : ''}${netFlowEst.toFixed(1)}亿`} ratio={localFlow?.isInflow ? '流入' : '流出'} color={netFlowEst >= 0 ? '#ff6666' : '#66cc66'} />
            <FlowCard label="买入量占比" value={`${buyRatio}%`} ratio="近20日" color={buyRatio >= 55 ? '#ff6666' : buyRatio <= 45 ? '#66cc66' : '#d4a574'} />
            <FlowCard label="今日涨跌" value={`${stock.changePct >= 0 ? '+' : ''}${stock.changePct.toFixed(2)}%`} ratio={stock.turnover > 0 ? `换手${stock.turnover.toFixed(1)}%` : '—'} color={stock.changePct >= 0 ? '#ff6666' : '#66cc66'} />
            <FlowCard label="成交额" value={stock.amount > 0 ? `${(stock.amount/10000).toFixed(1)}亿` : '—'} ratio="今日" color="#d4a574" />
          </>
        )}
      </div>

      {/* MFI Gauge + Volume Bar Chart (local model) */}
      {!hasReal && localFlow && (
        <>
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#d4a574', fontSize: '0.78rem', fontWeight: 'bold', marginBottom: 6 }}>MFI 资金流量指标 (0-100)</div>
            <div style={{ height: 24, background: '#1a3a3a', borderRadius: 12, position: 'relative', overflow: 'hidden' }}>
              <div style={{
                width: `${mfi}%`, height: '100%', borderRadius: 12,
                background: mfi > 50 ? `linear-gradient(90deg, #44cc44, #ff4444)` : `linear-gradient(90deg, #44cc44, #888888)`,
                transition: 'width 0.5s',
              }} />
              <div style={{
                position: 'absolute', top: 2, right: 8, color: '#fff', fontWeight: 'bold', fontSize: '0.75rem',
              }}>{mfi}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: '#70b8b0', marginTop: 2 }}>
              <span>0 超卖</span><span>20</span><span>50 中性</span><span>80</span><span>100 超买</span>
            </div>
          </div>

          {/* Daily flow bars */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#d4a574', fontSize: '0.78rem', fontWeight: 'bold', marginBottom: 6 }}>每日资金流向 (近10日, 亿)</div>
            <div style={{ display: 'flex', alignItems: 'end', gap: 3, height: 80 }}>
              {localFlow.dailyFlows.map((d, i) => {
                const maxAbs = Math.max(...localFlow.dailyFlows.map(x => Math.abs(x.flow)), 1);
                const h = Math.abs(d.flow) / maxAbs * 70;
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{
                      width: '100%', height: `${h}px`, borderRadius: '2px 2px 0 0',
                      background: d.flow >= 0 ? '#ff4444' : '#44cc44',
                      minHeight: 2,
                    }} title={`${d.date}: ${d.flow >= 0 ? '+' : ''}${d.flow.toFixed(2)}亿 / ${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(1)}%`} />
                    <span style={{ color: '#70b8b0', fontSize: '0.55rem', marginTop: 2 }}>{d.date}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <p style={{ fontSize: '0.75rem', color: '#70b8b0', marginTop: 8 }}>
        {hasReal
          ? (flow!.mainNet > 0 ? '🔴 主力资金净流入，短期看多' : flow!.mainNet < 0 ? '🟢 主力资金净流出，短期谨慎' : '➖ 主力资金平衡')
          : (netFlowEst > 0 ? `🔴 近5日资金净流入 ${netFlowEst.toFixed(1)}亿，MFI=${mfi}偏多` :
             netFlowEst < 0 ? `🟢 近5日资金净流出 ${Math.abs(netFlowEst).toFixed(1)}亿，MFI=${mfi}偏空` :
             `➖ 资金平衡，MFI=${mfi}中性`)}
        {' · '}{hasReal ? `主力占比 ${(flow!.mainNet / (Math.abs(flow!.superLargeNet) + Math.abs(flow!.largeNet) + Math.abs(flow!.mediumNet) + Math.abs(flow!.smallNet) || 1) * 100).toFixed(1)}%` : `买入量占比 ${buyRatio}%`}
      </p>
    </div>
  );
}

function FlowCard({ label, value, ratio, color }: { label: string; value: string; ratio: string; color: string }) {
  return (
    <div style={{ background: '#0d1f1f', padding: '10px 12px', borderRadius: 6, border: '1px solid #1a3a3a', textAlign: 'center' }}>
      <div style={{ color: '#70b8b0', fontSize: '0.65rem', marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontWeight: 'bold', fontSize: '0.9rem' }}>{value}</div>
      <div style={{ color: '#70b8b0', fontSize: '0.65rem', marginTop: 2 }}>{ratio}</div>
    </div>
  );
}

// ── Deep Research Panel ──

function ResearchPanel({ research, analyzing, onRun, stock }: {
  research: ResearchReport | null;
  analyzing: boolean;
  onRun: () => void;
  stock: StockQuote;
}) {
  const ratingColors: Record<string, string> = {
    '强烈买入': '#ff4444', '买入': '#ff6666', '持有': '#d4a574',
    '减持': '#66cc66', '卖出': '#44cc44',
  };

  if (!research) {
    return (
      <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 30, border: '1px solid #2a4a4a', textAlign: 'center' }}>
        <h3 style={{ color: '#d4a574', margin: '0 0 8px' }}>🧠 AI 深度研究</h3>
        <p style={{ color: '#70b8b0', fontSize: '0.85rem', marginBottom: 16 }}>
          TradingAgents 5-Analyst 架构：技术面/基本面/情绪面/A股策略/风控 → 综合研究报告
        </p>
        <p style={{ color: '#70b8b0', fontSize: '0.75rem', marginBottom: 16 }}>
          将调用 {stock.name}({stock.code}) 的完整行情数据、技术指标、财务数据、策略信号、资金流向和回测结果，
          由 5 位独立 AI 分析师各出具报告，多方/空方研究员交叉辩论，风控经理最终评估。
        </p>
        <button className="button" onClick={onRun} disabled={analyzing}
          style={{ padding: '10px 28px', background: analyzing ? '#5a5040' : '#d4a574', color: '#0d1a1a', fontWeight: 'bold', fontSize: '0.9rem' }}>
          {analyzing ? '⏳ AI 正在深度分析中 (约30-60秒)...' : '🔬 开始深度研究'}
        </button>
        {analyzing && <p style={{ color: '#70b8b0', fontSize: '0.7rem', marginTop: 12 }}>正在调用5位分析师并行研究，请耐心等待...</p>}
      </div>
    );
  }

  return (
    <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ color: '#d4a574', margin: 0 }}>🧠 AI 深度研究报告</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: ratingColors[research.rating] }}>
            {research.rating}
          </span>
          <span style={{ padding: '4px 12px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 'bold',
            background: ratingColors[research.rating] + '33', color: ratingColors[research.rating] }}>
            {research.ratingScore}分
          </span>
        </div>
      </div>

      {/* Summary */}
      <div style={{ background: '#0d1f1f', padding: 12, borderRadius: 6, marginBottom: 16, border: '1px solid #1a3a3a' }}>
        <p style={{ color: '#e0e0e0', margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>{research.summary}</p>
      </div>

      {/* Key metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 8, marginBottom: 16 }}>
        {[
          { l: '风险等级', v: research.riskLevel, c: research.riskLevel === '低' ? '#66cc66' : research.riskLevel === '中' ? '#d4a574' : '#ff4444' },
          { l: '置信度', v: research.confidenceLevel, c: '#d4a574' },
          { l: '目标价(中)', v: research.priceTarget.mid.toFixed(2), c: '#d4a574' },
          { l: '止损价', v: research.stopLoss.toFixed(2), c: '#ff6644' },
          { l: '持有周期', v: research.holdingPeriod, c: '#70b8b0' },
        ].map(m => (
          <div key={m.l} style={{ background: '#0d1f1f', padding: 8, borderRadius: 6, textAlign: 'center', border: '1px solid #1a3a3a' }}>
            <div style={{ color: '#70b8b0', fontSize: '0.65rem' }}>{m.l}</div>
            <div style={{ color: m.c, fontWeight: 'bold', fontSize: '0.85rem' }}>{m.v}</div>
          </div>
        ))}
      </div>

      {/* Analyst Reports — collapsible sections */}
      {[
        { title: '📊 技术面分析', content: research.technicalAnalysis },
        { title: '💰 基本面分析', content: research.fundamentalAnalysis },
        { title: '📰 市场情绪分析', content: research.sentimentAnalysis },
        { title: '🏛️ A股策略分析', content: research.chinaMarketAnalysis },
        { title: '🐂 多头逻辑', content: research.bullCase },
        { title: '🐻 空头风险', content: research.bearCase },
        { title: '⚖️ 风险评估', content: research.riskAssessment },
      ].map(section => (
        <details key={section.title} style={{ marginBottom: 8 }}>
          <summary style={{
            cursor: 'pointer', padding: '8px 12px', background: '#0d1f1f', borderRadius: 6,
            color: '#d4a574', fontWeight: 'bold', fontSize: '0.85rem', border: '1px solid #1a3a3a',
          }}>{section.title}</summary>
          <div style={{
            padding: '12px 16px', background: '#0d1a1a', borderRadius: '0 0 6px 6px',
            color: '#e0e0e0', fontSize: '0.82rem', lineHeight: 1.7, whiteSpace: 'pre-wrap',
            border: '1px solid #1a3a3a', borderTop: 'none',
          }}>{section.content}</div>
        </details>
      ))}

      {/* Catalysts & Risks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <div style={{ color: '#ff6666', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: 6 }}>🚀 关键催化剂</div>
          {research.keyCatalysts.map((c, i) => (
            <div key={i} style={{ color: '#e0e0e0', fontSize: '0.78rem', padding: '3px 0' }}>• {c}</div>
          ))}
        </div>
        <div>
          <div style={{ color: '#66cc66', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: 6 }}>⚠️ 关键风险</div>
          {research.keyRisks.map((r, i) => (
            <div key={i} style={{ color: '#e0e0e0', fontSize: '0.78rem', padding: '3px 0' }}>• {r}</div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 16, padding: '8px 12px', background: '#0d1f1f', borderRadius: 6, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ color: '#70b8b0', fontSize: '0.7rem' }}>
          生成时间: {new Date(research.generatedAt).toLocaleString('zh-CN')}
        </span>
        <span style={{ color: '#70b8b0', fontSize: '0.7rem' }}>
          数据源: {research.dataSources.join(' · ')}
        </span>
      </div>

      <button className="button" onClick={onRun} disabled={analyzing}
        style={{ marginTop: 12, padding: '6px 18px', background: '#d4a574', color: '#0d1a1a', fontWeight: 'bold', fontSize: '0.8rem' }}>
        {analyzing ? '⏳ 重新分析中...' : '🔄 重新生成报告'}
      </button>
    </div>
  );
}

// ── Strategy Panel ──

function StrategyPanel({ signals, stock }: { signals: StrategySignal[]; stock: StockQuote }) {
  const buySignals = signals.filter(s => s.type === 'buy');
  const sellSignals = signals.filter(s => s.type === 'sell');

  return (
    <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ color: '#d4a574', margin: 0 }}>🎯 策略信号扫描</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ color: '#ff6666', fontSize: '0.85rem', fontWeight: 'bold' }}>买入 {buySignals.length}</span>
          <span style={{ color: '#66cc66', fontSize: '0.85rem', fontWeight: 'bold' }}>卖出 {sellSignals.length}</span>
        </div>
      </div>
      <p style={{ color: '#70b8b0', fontSize: '0.78rem', margin: '0 0 12px' }}>
        InStock 10大策略库扫描 · {stock.name}({stock.code})
      </p>

      {signals.length === 0 ? (
        <div style={{ color: '#70b8b0', padding: 30, textAlign: 'center' }}>
          当前无策略信号触发
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 10 }}>
          {signals.map((s, i) => (
            <div key={i} style={{
              padding: '12px 14px', borderRadius: 8,
              background: s.type === 'buy' ? '#1a2a1a' : s.type === 'sell' ? '#2a1a1a' : '#1a1a2a',
              border: `2px solid ${s.type === 'buy' ? '#ff4444' : s.type === 'sell' ? '#44cc44' : '#888888'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: s.type === 'buy' ? '#ff6666' : s.type === 'sell' ? '#66cc66' : '#dddddd', fontWeight: 'bold', fontSize: '0.9rem' }}>
                  {s.type === 'buy' ? '📈' : s.type === 'sell' ? '📉' : '➖'} {s.name}
                </span>
                <span style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: '0.65rem', fontWeight: 'bold',
                  background: s.strength === '强' ? '#d4a57433' : s.strength === '中' ? '#70b8b033' : '#88888833',
                  color: s.strength === '强' ? '#d4a574' : s.strength === '中' ? '#70b8b0' : '#888888',
                }}>{s.strength}</span>
              </div>
              <p style={{ color: '#e0e0e0', fontSize: '0.78rem', margin: '0 0 8px', lineHeight: 1.5 }}>{s.description}</p>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {s.conditions.map((c, j) => (
                  <span key={j} style={{
                    padding: '1px 6px', borderRadius: 4, fontSize: '0.65rem',
                    background: '#0d1a1a', color: '#70b8b0', border: '1px solid #1a3a3a',
                  }}>{c}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Fundamental Panel ──

function FundamentalPanel({ score }: { score: FundamentalScore }) {
  const ratingColors: Record<string, string> = { '优秀': '#d4a574', '良好': '#70b8b0', '一般': '#f0b870', '较差': '#f87171' };
  return (
    <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ color: '#d4a574', margin: 0 }}>💰 基本面评分</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: ratingColors[score.rating] }}>{score.totalScore}分</span>
          <span style={{ padding: '4px 12px', borderRadius: 10, fontSize: '0.85rem', fontWeight: 'bold', background: ratingColors[score.rating] + '33', color: ratingColors[score.rating] }}>
            {score.rating}
          </span>
        </div>
      </div>

      {/* Breakdown Bars */}
      <div style={{ marginBottom: 16 }}>
        {score.breakdown.map((b, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: '#d4a574', fontSize: '0.82rem', fontWeight: 'bold' }}>{b.category}</span>
              <span style={{ color: '#d4a574', fontSize: '0.8rem' }}>{b.score}/{b.max}</span>
            </div>
            <div style={{ height: 6, background: '#2a2a2a', borderRadius: 3 }}>
              <div style={{ width: `${(b.score / b.max) * 100}%`, height: '100%', borderRadius: 3, background: b.score / b.max >= 0.7 ? '#d4a574' : b.score / b.max >= 0.4 ? '#70b8b0' : '#f0b870', transition: 'width 0.5s' }} />
            </div>
            <div style={{ color: '#70b8b0', fontSize: '0.7rem', marginTop: 2 }}>{b.detail}</div>
          </div>
        ))}
      </div>

      {/* Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
        {score.metrics.map(d => (
          <div key={d.label} style={{ background: '#0d1f1f', padding: 8, borderRadius: 6, border: '1px solid #1a3a3a' }}>
            <div style={{ color: '#70b8b0', fontSize: '0.65rem', marginBottom: 2 }}>{d.label}</div>
            <div style={{ color: d.color, fontWeight: 'bold', fontSize: '0.9rem' }}>{d.value}</div>
            <div style={{ color: '#70b8b0', fontSize: '0.65rem', marginTop: 2 }}>{d.level}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Backtest Panel ──

function BacktestPanel({ result }: { result: BacktestResult; stock: StockQuote }) {
  return (
    <div style={{ background: '#1a2a2a', borderRadius: 8, padding: 16, border: '1px solid #2a4a4a' }}>
      <h3 style={{ color: '#e0e0e0', margin: '0 0 4px' }}>⏪ 策略回测</h3>
      <p style={{ color: '#e8e0d0', fontSize: '0.78rem', margin: '0 0 12px' }}>
        基于 MACD/KDJ/RSI/BOLL/MA 五信号综合交易策略 | 区间: {result.period}
      </p>

      {/* Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, marginBottom: 16 }}>
        <BMetric label="总交易次数" value={String(result.totalTrades)} color="#e0e0e0" />
        <BMetric label="胜率" value={`${result.winRate}%`} color={result.winRate >= 50 ? '#ff6666' : '#66cc66'} />
        <BMetric label="总收益" value={`${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn}%`} color={result.totalReturn >= 0 ? '#ff6666' : '#66cc66'} />
        <BMetric label="年化收益" value={`${result.annualReturn >= 0 ? '+' : ''}${result.annualReturn}%`} color={result.annualReturn >= 0 ? '#ff6666' : '#66cc66'} />
        <BMetric label="最大回撤" value={`-${result.maxDrawdown}%`} color="#ff6644" />
        <BMetric label="夏普比率" value={String(result.sharpeRatio)} color={result.sharpeRatio >= 1 ? '#66cc66' : result.sharpeRatio >= 0.5 ? '#dddddd' : '#ff6644'} />
        <BMetric label="盈亏比" value={String(result.profitFactor)} color={result.profitFactor >= 2 ? '#66cc66' : '#dddddd'} />
        <BMetric label="平均持仓(天)" value={String(result.avgHoldingDays)} color="#dddddd" />
        <BMetric label="基准收益" value={`${result.benchmarkReturn >= 0 ? '+' : ''}${result.benchmarkReturn}%`} color="#e8e0d0" />
        <BMetric label="超额收益" value={`${result.excessReturn >= 0 ? '+' : ''}${result.excessReturn}%`} color={result.excessReturn >= 0 ? '#ff6666' : '#66cc66'} />
      </div>

      {/* Performance vs Benchmark */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: '#d4a574', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: 8 }}>
          📊 策略 vs 买入持有
        </div>
        <div style={{ background: '#0d1f1f', padding: 12, borderRadius: 6, display: 'flex', gap: 20, fontSize: '0.85rem' }}>
          <div>
            <div style={{ color: '#e8e0d0' }}>策略收益</div>
            <div style={{ color: result.totalReturn >= 0 ? '#ff6666' : '#66cc66', fontWeight: 'bold', fontSize: '1.1rem' }}>
              {result.totalReturn >= 0 ? '+' : ''}{result.totalReturn}%
            </div>
          </div>
          <div>
            <div style={{ color: '#e8e0d0' }}>买入持有</div>
            <div style={{ color: result.benchmarkReturn >= 0 ? '#ff6666' : '#66cc66', fontWeight: 'bold', fontSize: '1.1rem' }}>
              {result.benchmarkReturn >= 0 ? '+' : ''}{result.benchmarkReturn}%
            </div>
          </div>
          <div>
            <div style={{ color: '#e8e0d0' }}>超额收益</div>
            <div style={{ color: result.excessReturn >= 0 ? '#ff6666' : '#66cc66', fontWeight: 'bold', fontSize: '1.1rem' }}>
              {result.excessReturn >= 0 ? '+' : ''}{result.excessReturn}%
            </div>
          </div>
        </div>
      </div>

      {/* Recent Trades */}
      {result.trades.length > 0 && (
        <div>
          <div style={{ color: '#d4a574', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: 8 }}>
            📋 最近交易记录 ({Math.min(10, result.trades.length)}/{result.trades.length})
          </div>
          <table className="data-table">
            <thead><tr style={{ color: '#e8e0d0', fontSize: '0.75rem' }}>
              <th>买入日</th><th>卖出日</th><th>买入价</th><th>卖出价</th><th>收益</th><th>持(天)</th><th>原因</th>
            </tr></thead>
            <tbody>
              {result.trades.slice(-10).reverse().map((t, i) => (
                <tr key={i}>
                  <td style={{ color: '#e8e0d0', fontSize: '0.75rem' }}>{t.entryDate}</td>
                  <td style={{ color: '#e8e0d0', fontSize: '0.75rem' }}>{t.exitDate}</td>
                  <td style={{ color: '#dddddd' }}>{t.entryPrice.toFixed(2)}</td>
                  <td style={{ color: '#dddddd' }}>{t.exitPrice.toFixed(2)}</td>
                  <td style={{ color: t.returnPct >= 0 ? '#ff6666' : '#66cc66', fontWeight: 'bold' }}>
                    {t.returnPct >= 0 ? '+' : ''}{t.returnPct}%
                  </td>
                  <td style={{ color: '#e8e0d0' }}>{t.holdingDays}</td>
                  <td style={{ color: '#e8e0d0', fontSize: '0.7rem' }}>
                    {t.exitReason === 'stop_loss' ? '止损' : t.exitReason === 'timeout' ? '超时' : '信号'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 12, fontSize: '0.7rem', color: '#e8e0d0' }}>
        ⚠️ 回测基于 MACD/KDJ/RSI/BOLL/MA20 五信号策略，止损{8}%，最大持仓{60}天。历史表现不代表未来收益。
      </p>
    </div>
  );
}

function BMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#0d1f1f', padding: '8px 10px', borderRadius: 6, textAlign: 'center', border: '1px solid #1a3a3a' }}>
      <div style={{ color: '#e8e0d0', fontSize: '0.65rem', marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontWeight: 'bold', fontSize: '0.9rem' }}>{value}</div>
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
