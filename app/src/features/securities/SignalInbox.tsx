/**
 * Signal Inbox — monitors watchlist stocks via backtest engine.
 * Notifies when the backtest strategy generates a fresh buy or sell signal.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchStockQuotes, fetchEastmoneyKLine, type StockQuote } from '../../infrastructure/market-data/stock-api';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import { runBacktest, type BacktestResult } from '../../engines/market-analysis/backtest-engine';

interface BacktestAlert {
  id: string;
  code: string;
  name: string;
  price: number;
  action: 'buy' | 'sell';
  reason: string;
  entryPrice: number;
  stopLoss: number;
  backtest: { winRate: number; sharpeRatio: number; maxDrawdown: number; totalTrades: number; annualReturn: number; profitFactor: number };
  time: string;
  read: boolean;
}

const INBOX_KEY = 'sec_bt_inbox_v1';
const LAST_ALERT_KEY = 'sec_bt_last_alert';

function load(): BacktestAlert[] { try { return JSON.parse(localStorage.getItem(INBOX_KEY) || '[]'); } catch { return []; } }
function save(alerts: BacktestAlert[]) { try { localStorage.setItem(INBOX_KEY, JSON.stringify(alerts.slice(-30))); } catch {} }
function loadLast(): Record<string, string> { try { return JSON.parse(localStorage.getItem(LAST_ALERT_KEY) || '{}'); } catch { return {}; } }
function saveLast(s: Record<string, string>) { try { localStorage.setItem(LAST_ALERT_KEY, JSON.stringify(s)); } catch {} }

function getWatchlistCodes(): string[] {
  try {
    const wls = JSON.parse(localStorage.getItem('sec_watchlists_v2') || '[]');
    const activeId = localStorage.getItem('sec_active_watchlist') || '';
    const active = wls.find((w: any) => w.id === activeId) || wls[0];
    return active?.codes || [];
  } catch { return []; }
}

/** Determine if current bar triggers a buy or sell based on the 5-signal strategy used by backtest */
function detectBacktestSignal(klines: any[]): { action: 'buy' | 'sell'; reason: string } | null {
  if (klines.length < 25) return null;
  const last = klines[klines.length - 1] as any;
  const prev = klines[klines.length - 2] as any;
  if (!last || !prev) return null;

  let score = 0;
  const reasons: string[] = [];

  // MACD
  if (last.macd && prev.macd) {
    if (prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea) { score += 3; reasons.push('MACD金叉'); }
    else if (prev.macd.dif >= prev.macd.dea && last.macd.dif < last.macd.dea) { score -= 3; reasons.push('MACD死叉'); }
  }

  // KDJ
  if (last.kdj) {
    if (last.kdj.j < 20) { score += 2; reasons.push('KDJ超卖'); }
    else if (last.kdj.j > 85) { score -= 2; reasons.push('KDJ超买'); }
  }

  // RSI
  if (last.rsi) {
    if (last.rsi.rsi6 < 30) { score += 1; reasons.push('RSI超卖'); }
    else if (last.rsi.rsi6 > 75) { score -= 1; }
  }

  // BOLL
  if (last.boll && last.close) {
    if (last.close <= last.boll.lower) { score += 2; reasons.push('触布林下轨'); }
    else if (last.close >= last.boll.upper) { score -= 2; reasons.push('触布林上轨'); }
  }

  // MA20
  if (last.ma && prev?.ma) {
    if (prev.close <= prev.ma.ma20 && last.close > last.ma.ma20) { score += 2; reasons.push('突破MA20'); }
    else if (prev.close >= prev.ma.ma20 && last.close < last.ma.ma20) { score -= 2; reasons.push('跌破MA20'); }
  }

  if (score >= 4) return { action: 'buy', reason: reasons.join('·') };
  if (score <= -4) return { action: 'sell', reason: reasons.join('·') };
  return null;
}

export function SignalInbox() {
  const [alerts, setAlerts] = useState<BacktestAlert[]>(load);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const unread = alerts.filter(m => !m.read).length;

  useEffect(() => { save(alerts); }, [alerts]);

  const scanWatchlist = useCallback(async () => {
    const codes = getWatchlistCodes();
    if (codes.length === 0) return;
    setChecking(true);

    const lastAlerts = loadLast();
    const newState: Record<string, string> = {};
    const newAlerts: BacktestAlert[] = [];

    try {
      for (let i = 0; i < codes.length; i += 80) {
        const batch = codes.slice(i, i + 80);
        const quotes = await fetchStockQuotes(batch);
        const valid = quotes.filter(q => q.price > 0).sort((a, b) => b.totalCap - a.totalCap).slice(0, 40);

        for (const q of valid) {
          try {
            const klines = await fetchEastmoneyKLine(q.code, 250);
            if (klines.length < 60) continue;
            calcAllIndicators(klines);

            // Run backtest
            const bt = runBacktest(klines);
            if (!bt || bt.totalTrades < 5) continue;

            // Detect current signal
            const sig = detectBacktestSignal(klines);
            if (!sig) continue;

            // Generate alert key
            const alertKey = `${sig.action}`;
            const prevKey = lastAlerts[q.code];
            newState[q.code] = alertKey;

            // Only alert if signal changed
            if (prevKey !== alertKey) {
              const last = klines[klines.length - 1] as any;
              const atr = last?.atr || (q.price * 0.03);
              newAlerts.push({
                id: `${q.code}_${sig.action}_${Date.now()}`,
                code: q.code, name: q.name, price: q.price,
                action: sig.action, reason: sig.reason,
                entryPrice: sig.action === 'buy' ? q.price : 0,
                stopLoss: sig.action === 'buy' ? Math.round((q.price - atr * 2) * 100) / 100 : 0,
                backtest: {
                  winRate: bt.winRate, sharpeRatio: bt.sharpeRatio,
                  maxDrawdown: bt.maxDrawdown, totalTrades: bt.totalTrades,
                  annualReturn: bt.annualReturn, profitFactor: bt.profitFactor,
                },
                time: new Date().toLocaleTimeString('zh-CN'),
                read: false,
              });
            }
          } catch {}
        }
      }
    } catch {}

    if (newAlerts.length > 0) setAlerts(prev => [...newAlerts, ...prev]);
    saveLast(newState);
    setChecking(false);
  }, []);

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

  const markRead = () => setAlerts(prev => prev.map(m => ({ ...m, read: true })));
  const clearAll = () => { setAlerts([]); save([]); };

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => { setOpen(!open); if (!open) markRead(); }}
        title="回测买卖信号"
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
          position: 'absolute', top: '100%', right: 0, width: 400, maxHeight: 500, overflowY: 'auto',
          background: '#1a2a2a', border: '1px solid #3a5a5a', borderRadius: 8, zIndex: 100,
          marginTop: 6, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px', borderBottom: '1px solid #2a3a3a',
            position: 'sticky', top: 0, background: '#1a2a2a', zIndex: 1,
          }}>
            <span style={{ color: '#d4a574', fontWeight: 'bold', fontSize: '0.85rem' }}>
              📬 回测信号 {unread > 0 && `(${unread})`}
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

          {alerts.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#70b8b0', fontSize: '0.82rem' }}>
              暂无回测信号
              <br /><span style={{ fontSize: '0.7rem', color: '#5a7a7a' }}>
                交易时段每5分钟扫描 · 仅当回测信号方向变化时通知
              </span>
            </div>
          ) : (
            alerts.slice(0, 20).map(msg => (
              <div key={msg.id} style={{
                padding: '12px 14px', borderBottom: '1px solid #1a2a2a',
                background: msg.read ? 'transparent' : '#0d1f1f',
                borderLeft: `3px solid ${msg.action === 'buy' ? '#f56c6c' : '#67c23a'}`,
                opacity: msg.read ? 0.75 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{
                    color: '#fff', fontWeight: 'bold', fontSize: '0.85rem',
                    padding: '2px 10px', borderRadius: 4,
                    background: msg.action === 'buy' ? '#f56c6c' : '#67c23a',
                  }}>
                    {msg.action === 'buy' ? '📈 买入信号' : '📉 卖出信号'}
                  </span>
                  <span style={{ color: '#5a7a7a', fontSize: '0.65rem' }}>{msg.time}</span>
                </div>
                <div style={{ color: '#d4a574', fontSize: '0.82rem', fontWeight: 'bold', margin: '6px 0' }}>
                  {msg.name} ({msg.code}) · ¥{msg.price.toFixed(2)}
                </div>
                {msg.action === 'buy' && (
                  <div style={{ display: 'flex', gap: 12, fontSize: '0.7rem', marginBottom: 6 }}>
                    <span style={{ color: '#70b8b0' }}>入场: <span style={{ color: '#d4a574' }}>¥{msg.entryPrice.toFixed(2)}</span></span>
                    <span style={{ color: '#70b8b0' }}>止损: <span style={{ color: '#66cc66' }}>¥{msg.stopLoss.toFixed(2)}</span></span>
                  </div>
                )}
                <div style={{ color: '#70b8b0', fontSize: '0.72rem', marginBottom: 6 }}>{msg.reason}</div>
                <div style={{
                  padding: '6px 8px', background: '#0d1a1a', borderRadius: 4,
                  display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, fontSize: '0.65rem',
                }}>
                  <div>回测<span style={{ color: '#d4a574', marginLeft: 2 }}>{msg.backtest.totalTrades}笔</span></div>
                  <div>胜率<span style={{ color: msg.backtest.winRate >= 55 ? '#ff6666' : '#d4a574', marginLeft: 2 }}>{msg.backtest.winRate}%</span></div>
                  <div>夏普<span style={{ color: msg.backtest.sharpeRatio >= 1 ? '#ff6666' : '#d4a574', marginLeft: 2 }}>{msg.backtest.sharpeRatio}</span></div>
                  <div>年化<span style={{ color: msg.backtest.annualReturn >= 0 ? '#ff6666' : '#66cc66', marginLeft: 2 }}>{msg.backtest.annualReturn >= 0 ? '+' : ''}{msg.backtest.annualReturn}%</span></div>
                  <div>回撤<span style={{ color: '#f0b870', marginLeft: 2 }}>-{msg.backtest.maxDrawdown}%</span></div>
                  <div>盈亏比<span style={{ color: '#d4a574', marginLeft: 2 }}>{msg.backtest.profitFactor}</span></div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
