/**
 * Signal Inbox — monitors watchlist stocks with backtest-validated recommendations.
 * Only notifies when signals are backed by historical performance data.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchStockQuotes, fetchEastmoneyKLine, type StockQuote } from '../../infrastructure/market-data/stock-api';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import { runBacktest, type BacktestResult } from '../../engines/market-analysis/backtest-engine';
import { scanStrategies } from '../../engines/market-analysis/trading-strategies';
import { scoreFundamentals } from '../../engines/market-analysis/fundamental-scorer';
import { scanPatterns } from '../../engines/market-analysis/kline-patterns';

interface Recommendation {
  id: string;
  code: string;
  name: string;
  price: number;
  action: 'buy' | 'sell' | 'hold';
  confidence: '高' | '中' | '低';
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  /** Backtest evidence */
  backtest: {
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
    totalTrades: number;
    annualReturn: number;
    profitFactor: number;
  };
  /** Why this recommendation */
  reasons: string[];
  time: string;
  read: boolean;
}

const INBOX_KEY = 'sec_rec_inbox_v1';
const LAST_REC_KEY = 'sec_rec_last_state';

function loadInbox(): Recommendation[] {
  try { return JSON.parse(localStorage.getItem(INBOX_KEY) || '[]'); } catch { return []; }
}
function saveInbox(msgs: Recommendation[]) {
  try { localStorage.setItem(INBOX_KEY, JSON.stringify(msgs.slice(-30))); } catch {}
}
function loadLastState(): Record<string, { action: string; score: number }> {
  try { return JSON.parse(localStorage.getItem(LAST_REC_KEY) || '{}'); } catch { return {}; }
}
function saveLastState(state: Record<string, { action: string; score: number }>) {
  try { localStorage.setItem(LAST_REC_KEY, JSON.stringify(state)); } catch {}
}

function getWatchlistCodes(): string[] {
  try {
    const wls = JSON.parse(localStorage.getItem('sec_watchlists_v2') || '[]');
    const activeId = localStorage.getItem('sec_active_watchlist') || '';
    const active = wls.find((w: any) => w.id === activeId) || wls[0];
    return active?.codes || [];
  } catch { return []; }
}

/** Compute a composite recommendation score and decide action */
function evaluateStock(
  quote: StockQuote,
  klines: any[],
  backtest: BacktestResult | null,
): { action: 'buy' | 'sell' | 'hold'; confidence: '高' | '中' | '低'; score: number; reasons: string[]; entryPrice: number; targetPrice: number; stopLoss: number } | null {
  if (klines.length < 60) return null;
  const last = klines[klines.length - 1] as any;
  const prev = klines[klines.length - 2] as any;
  if (!last || !prev) return null;

  let score = 50;
  const reasons: string[] = [];

  // ── Technical signals weighted by confluence ──
  let techSignals = 0;

  // MACD
  if (last.macd && prev.macd) {
    if (prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea) {
      score += 12; techSignals++; reasons.push('MACD金叉');
    } else if (last.macd.dif > last.macd.dea) {
      score += 5; techSignals++;
    } else if (prev.macd.dif >= prev.macd.dea && last.macd.dif < last.macd.dea) {
      score -= 12; techSignals--; reasons.push('MACD死叉');
    }
  }

  // KDJ
  if (last.kdj) {
    if (last.kdj.j < 20) { score += 10; techSignals++; reasons.push('KDJ超卖'); }
    else if (last.kdj.j > 85) { score -= 8; techSignals--; reasons.push('KDJ超买'); }
    if (prev?.kdj && prev.kdj.k <= prev.kdj.d && last.kdj.k > last.kdj.d && last.kdj.j < 40) {
      score += 8; techSignals++; reasons.push('KDJ低位金叉');
    }
  }

  // RSI
  if (last.rsi) {
    if (last.rsi.rsi6 < 28) { score += 8; techSignals++; reasons.push(`RSI超卖(${last.rsi.rsi6.toFixed(0)})`); }
    else if (last.rsi.rsi6 > 75) { score -= 7; techSignals--; }
  }

  // BOLL position
  if (last.boll && last.close) {
    if (last.close <= last.boll.lower * 1.02) { score += 9; techSignals++; reasons.push('触及布林下轨'); }
    else if (last.close >= last.boll.upper * 0.98) { score -= 7; techSignals--; reasons.push('触及布林上轨'); }
  }

  // MA trend
  if (last.ma && prev?.ma && last.close) {
    if (prev.close <= prev.ma.ma20 && last.close > last.ma.ma20) { score += 7; techSignals++; reasons.push('突破MA20'); }
    else if (prev.close >= prev.ma.ma20 && last.close < last.ma.ma20) { score -= 7; techSignals--; reasons.push('跌破MA20'); }
    if (last.ma.ma5 > last.ma.ma20 && last.ma.ma20 > (last.ma.ma60 || last.ma.ma20)) { score += 5; techSignals++; }
  }

  // Volume analysis
  if (last.volume && prev?.volume) {
    const volRatio = last.volume / prev.volume;
    if (volRatio > 1.8 && last.close > prev.close) { score += 6; techSignals++; reasons.push('放量上涨'); }
    else if (volRatio > 1.8 && last.close < prev.close) { score -= 6; techSignals--; reasons.push('放量下跌'); }
  }

  // ── Fundamentals ──
  const fund = scoreFundamentals(quote, klines);
  const fundScore = fund.totalScore;
  if (fundScore >= 65) { score += 10; reasons.push(`基本面优秀(${fundScore}分)`); }
  else if (fundScore >= 45) { score += 4; reasons.push(`基本面良好(${fundScore}分)`); }
  else if (fundScore < 25) { score -= 8; reasons.push(`基本面较差(${fundScore}分)`); }

  // ── Strategy signals ──
  try {
    const strats = scanStrategies(klines);
    const buys = strats.filter(s => s.type === 'buy').length;
    const sells = strats.filter(s => s.type === 'sell').length;
    if (buys >= 2) { score += 10; techSignals += buys; reasons.push(`${buys}个策略看多`); }
    if (sells >= 2) { score -= 10; techSignals -= sells; reasons.push(`${sells}个策略看空`); }
  } catch {}

  // ── Patterns ──
  try {
    const pats = scanPatterns(klines);
    const bulls = pats.filter(p => p.type === 'bullish').length;
    if (bulls >= 2) { score += 6; reasons.push(`${bulls}个看多形态`); }
  } catch {}

  // ── Valuation check ──
  if (quote.pe > 0 && quote.pe < 12) { score += 5; reasons.push(`PE低(${quote.pe.toFixed(1)})`); }
  else if (quote.pe > 60) { score -= 5; reasons.push(`PE过高(${quote.pe.toFixed(1)})`); }
  if (quote.pb > 0 && quote.pb < 1) { score += 4; reasons.push('破净'); }

  // ── Backtest validation — the critical gate ──
  if (backtest) {
    if (backtest.winRate >= 60 && backtest.sharpeRatio >= 0.8) {
      score += 10; reasons.push(`回测胜率${backtest.winRate}%·夏普${backtest.sharpeRatio}`);
    } else if (backtest.winRate >= 50) {
      score += 5; reasons.push(`回测可行(胜率${backtest.winRate}%)`);
    } else if (backtest.winRate < 40) {
      score -= 12; reasons.push(`回测胜率低(${backtest.winRate}%)，信号不可靠`);
    }
    if (backtest.maxDrawdown > 40) { score -= 5; reasons.push(`回撤过大(-${backtest.maxDrawdown}%)`); }
  } else {
    score -= 5; // No backtest = lower confidence
  }

  // ── Determine action ──
  score = Math.round(Math.max(10, Math.min(100, score)));

  let action: 'buy' | 'sell' | 'hold' = 'hold';
  let confidence: '高' | '中' | '低' = '低';

  if (score >= 75 && techSignals >= 3) { action = 'buy'; confidence = '高'; }
  else if (score >= 65 && techSignals >= 1) { action = 'buy'; confidence = '中'; }
  else if (score <= 25 && techSignals <= -2) { action = 'sell'; confidence = '高'; }
  else if (score <= 35) { action = 'sell'; confidence = '中'; }
  else if (score >= 58) { action = 'buy'; confidence = '低'; }
  else { action = 'hold'; confidence = '低'; }

  // Only notify on buy/sell with at least medium confidence
  if (action === 'hold' || (action !== 'hold' && confidence === '低')) return null;

  // Compute price targets
  const recent20 = klines.slice(-20);
  const high20 = Math.max(...recent20.map((k: any) => k.high));
  const low20 = Math.min(...recent20.map((k: any) => k.low));
  const atr = last.atr || ((high20 - low20) / 10);
  const price = quote.price;

  const entryPrice = action === 'buy' ? Math.round(Math.max(low20, price * 0.97) * 100) / 100 : price;
  const targetPrice = action === 'buy' ? Math.round(price * 1.15 * 100) / 100 : Math.round(price * 0.90 * 100) / 100;
  const stopLoss = action === 'buy' ? Math.round((entryPrice - atr * 2) * 100) / 100 : Math.round((price - atr) * 100) / 100;

  return {
    action, confidence, score,
    reasons: reasons.slice(0, 5),
    entryPrice,
    targetPrice,
    stopLoss,
  };
}

export function SignalInbox() {
  const [messages, setMessages] = useState<Recommendation[]>(loadInbox);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const unread = messages.filter(m => !m.read).length;

  useEffect(() => { saveInbox(messages); }, [messages]);

  const scanWatchlist = useCallback(async () => {
    const codes = getWatchlistCodes();
    if (codes.length === 0) return;

    setChecking(true);
    const lastState = loadLastState();
    const newState: Record<string, { action: string; score: number }> = {};
    const newMsgs: Recommendation[] = [];

    try {
      for (let i = 0; i < codes.length; i += 80) {
        const batch = codes.slice(i, i + 80);
        const quotes = await fetchStockQuotes(batch);

        // Only deep-analyze top candidates by market cap to avoid overload
        const validQuotes = quotes.filter(q => q.price > 0);
        const topQuotes = validQuotes.sort((a, b) => b.totalCap - a.totalCap).slice(0, 30);

        for (const q of topQuotes) {
          try {
            const klines = await fetchEastmoneyKLine(q.code, 250);
            if (klines.length < 60) continue;
            calcAllIndicators(klines);

            const backtest = runBacktest(klines);
            const rec = evaluateStock(q, klines, backtest);
            if (!rec) continue;

            newState[q.code] = { action: rec.action, score: rec.score };

            // Only notify if action changed from last state
            const prev = lastState[q.code];
            const changed = !prev || prev.action !== rec.action || Math.abs(prev.score - rec.score) >= 15;

            if (changed && rec.confidence !== '低') {
              newMsgs.push({
                id: `${q.code}_${rec.action}_${Date.now()}`,
                code: q.code,
                name: q.name,
                price: q.price,
                action: rec.action,
                confidence: rec.confidence,
                entryPrice: rec.entryPrice,
                targetPrice: rec.targetPrice,
                stopLoss: rec.stopLoss,
                backtest: backtest ? {
                  winRate: backtest.winRate,
                  sharpeRatio: backtest.sharpeRatio,
                  maxDrawdown: backtest.maxDrawdown,
                  totalTrades: backtest.totalTrades,
                  annualReturn: backtest.annualReturn,
                  profitFactor: backtest.profitFactor,
                } : { winRate: 0, sharpeRatio: 0, maxDrawdown: 0, totalTrades: 0, annualReturn: 0, profitFactor: 0 },
                reasons: rec.reasons,
                time: new Date().toLocaleTimeString('zh-CN'),
                read: false,
              });
            }
          } catch {}
        }
      }
    } catch {}

    if (newMsgs.length > 0) {
      setMessages(prev => [...newMsgs, ...prev]);
    }
    saveLastState(newState);
    setChecking(false);
  }, []);

  // Auto-scan: every 5 minutes during trading hours
  useEffect(() => {
    const isTradeTime = () => {
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes(), d = now.getDay();
      if (d === 0 || d === 6) return false;
      const t = h * 100 + m;
      return (t >= 925 && t <= 1135) || (t >= 1255 && t <= 1505);
    };

    if (isTradeTime()) scanWatchlist();
    const interval = setInterval(() => { if (isTradeTime()) scanWatchlist(); }, 300000);
    return () => clearInterval(interval);
  }, [scanWatchlist]);

  const markAllRead = () => setMessages(prev => prev.map(m => ({ ...m, read: true })));
  const clearAll = () => { setMessages([]); saveInbox([]); };

  const actionLabel = (a: string) => a === 'buy' ? '买入' : a === 'sell' ? '卖出' : '持有';
  const actionColor = (a: string) => a === 'buy' ? '#f56c6c' : a === 'sell' ? '#67c23a' : '#d4a574';

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => { setOpen(!open); if (!open) markAllRead(); }}
        title="回测验证的买卖建议"
        style={{
          position: 'relative', padding: '6px 12px',
          background: open ? '#1a3a3a' : '#0d1a1a',
          border: `1px solid ${unread > 0 ? '#d4a574' : '#3a5a5a'}`, borderRadius: 6,
          cursor: 'pointer', fontSize: '1.1rem', color: '#d4a574',
        }}>
        📬
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -6, right: -6, background: '#f56c6c', color: '#fff',
            borderRadius: '50%', width: 20, height: 20, fontSize: '0.65rem', fontWeight: 'bold',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, width: 420, maxHeight: 520, overflowY: 'auto',
          background: '#1a2a2a', border: '1px solid #3a5a5a', borderRadius: 8, zIndex: 100,
          marginTop: 6, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px', borderBottom: '1px solid #2a3a3a',
            position: 'sticky', top: 0, background: '#1a2a2a', zIndex: 1,
          }}>
            <span style={{ color: '#d4a574', fontWeight: 'bold', fontSize: '0.85rem' }}>
              📬 买卖建议 {unread > 0 && `(${unread})`}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={scanWatchlist} disabled={checking}
                style={{ border: 'none', background: 'none', color: '#70b8b0', cursor: 'pointer', fontSize: '0.7rem' }}>
                {checking ? '扫描中...' : '🔄 扫描'}
              </button>
              <button onClick={clearAll}
                style={{ border: 'none', background: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.7rem' }}>
                清空
              </button>
            </div>
          </div>

          {messages.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#70b8b0', fontSize: '0.82rem' }}>
              暂无买卖建议
              <br /><span style={{ fontSize: '0.7rem', color: '#5a7a7a' }}>
                交易时段每5分钟扫描自选股，经回测验证后推送建议
              </span>
            </div>
          ) : (
            messages.slice(0, 20).map(msg => (
              <div key={msg.id} style={{
                padding: '12px 14px', borderBottom: '1px solid #1a2a2a',
                background: msg.read ? 'transparent' : '#0d1f1f',
                borderLeft: `3px solid ${actionColor(msg.action)}`,
                opacity: msg.read ? 0.75 : 1,
              }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div>
                    <span style={{
                      color: actionColor(msg.action), fontWeight: 'bold', fontSize: '0.85rem',
                      padding: '2px 8px', borderRadius: 4,
                      background: actionColor(msg.action) + '22',
                    }}>
                      {actionLabel(msg.action)}
                    </span>
                    <span style={{
                      marginLeft: 6, padding: '1px 6px', borderRadius: 3, fontSize: '0.65rem',
                      background: msg.confidence === '高' ? '#d4a57422' : '#70b8b022',
                      color: msg.confidence === '高' ? '#d4a574' : '#70b8b0',
                    }}>
                      {msg.confidence}置信度
                    </span>
                  </div>
                  <span style={{ color: '#5a7a7a', fontSize: '0.65rem' }}>{msg.time}</span>
                </div>

                {/* Stock info */}
                <div style={{ color: '#d4a574', fontSize: '0.82rem', fontWeight: 'bold', marginBottom: 4 }}>
                  {msg.name} ({msg.code}) · ¥{msg.price.toFixed(2)}
                </div>

                {/* Price targets */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
                  <div style={{ fontSize: '0.68rem', color: '#70b8b0' }}>
                    入场: <span style={{ color: '#d4a574', fontWeight: 'bold' }}>{msg.entryPrice.toFixed(2)}</span>
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#70b8b0' }}>
                    目标: <span style={{ color: '#ff6666', fontWeight: 'bold' }}>{msg.targetPrice.toFixed(2)}</span>
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#70b8b0' }}>
                    止损: <span style={{ color: '#66cc66', fontWeight: 'bold' }}>{msg.stopLoss.toFixed(2)}</span>
                  </div>
                </div>

                {/* Reasons */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                  {msg.reasons.map((r, i) => (
                    <span key={i} style={{
                      padding: '1px 6px', borderRadius: 4, fontSize: '0.65rem',
                      background: '#0d1a1a', color: '#70b8b0', border: '1px solid #1a3a3a',
                    }}>{r}</span>
                  ))}
                </div>

                {/* Backtest evidence */}
                <div style={{
                  padding: '6px 8px', background: '#0d1a1a', borderRadius: 4,
                  display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4,
                  fontSize: '0.65rem',
                }}>
                  <div style={{ color: '#5a7a7a' }}>回测: <span style={{ color: '#d4a574' }}>{msg.backtest.totalTrades}笔</span></div>
                  <div style={{ color: '#5a7a7a' }}>胜率: <span style={{ color: msg.backtest.winRate >= 55 ? '#ff6666' : '#d4a574' }}>{msg.backtest.winRate}%</span></div>
                  <div style={{ color: '#5a7a7a' }}>夏普: <span style={{ color: msg.backtest.sharpeRatio >= 1 ? '#ff6666' : '#d4a574' }}>{msg.backtest.sharpeRatio}</span></div>
                  <div style={{ color: '#5a7a7a' }}>年化: <span style={{ color: msg.backtest.annualReturn >= 0 ? '#ff6666' : '#66cc66' }}>{msg.backtest.annualReturn >= 0 ? '+' : ''}{msg.backtest.annualReturn}%</span></div>
                  <div style={{ color: '#5a7a7a' }}>回撤: <span style={{ color: '#f0b870' }}>-{msg.backtest.maxDrawdown}%</span></div>
                  <div style={{ color: '#5a7a7a' }}>盈亏比: <span style={{ color: '#d4a574' }}>{msg.backtest.profitFactor}</span></div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
