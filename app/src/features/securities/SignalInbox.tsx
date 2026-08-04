/**
 * Signal Inbox — monitors watchlist stocks and sends notifications
 * when buy/sell signals trigger (MACD金叉, KDJ超卖, RSI超卖, etc.)
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchStockQuotes, fetchEastmoneyKLine, type StockQuote } from '../../infrastructure/market-data/stock-api';
import { calcAllIndicators } from '../../engines/market-analysis/technical-indicators';
import { scanStrategies } from '../../engines/market-analysis/trading-strategies';

interface Notification {
  id: string;
  code: string;
  name: string;
  type: 'buy' | 'sell' | 'info';
  title: string;
  detail: string;
  time: string;
  read: boolean;
}

const INBOX_KEY = 'sec_inbox_v1';
const LAST_CHECK_KEY = 'sec_inbox_last_check';

function loadInbox(): Notification[] {
  try { return JSON.parse(localStorage.getItem(INBOX_KEY) || '[]'); } catch { return []; }
}
function saveInbox(msgs: Notification[]) {
  try { localStorage.setItem(INBOX_KEY, JSON.stringify(msgs.slice(-50))); } catch {}
}

function loadLastSignals(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(LAST_CHECK_KEY) || '{}'); } catch { return {}; }
}
function saveLastSignals(sigs: Record<string, string[]>) {
  try { localStorage.setItem(LAST_CHECK_KEY, JSON.stringify(sigs)); } catch {}
}

function getWatchlistCodes(): { code: string; name: string }[] {
  try {
    const wls = JSON.parse(localStorage.getItem('sec_watchlists_v2') || '[]');
    const activeId = localStorage.getItem('sec_active_watchlist') || '';
    const active = wls.find((w: any) => w.id === activeId) || wls[0];
    if (!active?.codes?.length) return [];
    // We only have codes, names will come from quotes
    return active.codes.map((c: string) => ({ code: c, name: '' }));
  } catch { return []; }
}

function detectSignals(_quote: StockQuote, klines: any[]): { key: string; type: 'buy' | 'sell' | 'info'; title: string; detail: string }[] {
  const results: { key: string; type: 'buy' | 'sell' | 'info'; title: string; detail: string }[] = [];
  if (klines.length < 20) return results;
  const last = klines[klines.length - 1] as any;
  const prev = klines[klines.length - 2] as any;
  if (!last || !prev) return results;

  // MACD
  if (last.macd && prev.macd) {
    if (prev.macd.dif <= prev.macd.dea && last.macd.dif > last.macd.dea) {
      results.push({ key: 'macd_golden', type: 'buy', title: 'MACD金叉', detail: `DIF(${last.macd.dif.toFixed(3)})上穿DEA(${last.macd.dea.toFixed(3)})` });
    }
    if (prev.macd.dif >= prev.macd.dea && last.macd.dif < last.macd.dea) {
      results.push({ key: 'macd_dead', type: 'sell', title: 'MACD死叉', detail: `DIF(${last.macd.dif.toFixed(3)})下穿DEA(${last.macd.dea.toFixed(3)})` });
    }
  }

  // KDJ
  if (last.kdj) {
    if (last.kdj.j < 20) {
      results.push({ key: 'kdj_oversold', type: 'buy', title: 'KDJ超卖', detail: `J值${last.kdj.j.toFixed(1)}<20，超卖区域可能反弹` });
    }
    if (last.kdj.j > 80) {
      results.push({ key: 'kdj_overbought', type: 'sell', title: 'KDJ超买', detail: `J值${last.kdj.j.toFixed(1)}>80，超买区域注意风险` });
    }
    if (prev.kdj && prev.kdj.k <= prev.kdj.d && last.kdj.k > last.kdj.d && last.kdj.j < 40) {
      results.push({ key: 'kdj_golden', type: 'buy', title: 'KDJ低位金叉', detail: `K线上穿D线，J值${last.kdj.j.toFixed(1)}低位金叉` });
    }
  }

  // RSI
  if (last.rsi) {
    if (last.rsi.rsi6 < 30) {
      results.push({ key: 'rsi_oversold', type: 'buy', title: 'RSI超卖', detail: `RSI(6)=${last.rsi.rsi6.toFixed(1)}<30，超卖信号` });
    }
    if (last.rsi.rsi6 > 70) {
      results.push({ key: 'rsi_overbought', type: 'sell', title: 'RSI超买', detail: `RSI(6)=${last.rsi.rsi6.toFixed(1)}>70，超买信号` });
    }
  }

  // BOLL
  if (last.boll && last.close) {
    if (last.close <= last.boll.lower) {
      results.push({ key: 'boll_lower', type: 'buy', title: '触及布林下轨', detail: `收盘${last.close.toFixed(2)}≤下轨${last.boll.lower.toFixed(2)}，超跌反弹概率大` });
    }
    if (last.close >= last.boll.upper) {
      results.push({ key: 'boll_upper', type: 'sell', title: '触及布林上轨', detail: `收盘${last.close.toFixed(2)}≥上轨${last.boll.upper.toFixed(2)}，可能回调` });
    }
  }

  // MA20 break
  if (last.ma && prev.ma && last.close) {
    if (prev.close <= prev.ma.ma20 && last.close > last.ma.ma20) {
      results.push({ key: 'ma20_break_up', type: 'buy', title: '突破MA20', detail: `收盘价${last.close.toFixed(2)}突破20日均线${last.ma.ma20.toFixed(2)}` });
    }
    if (prev.close >= prev.ma.ma20 && last.close < last.ma.ma20) {
      results.push({ key: 'ma20_break_down', type: 'sell', title: '跌破MA20', detail: `收盘价${last.close.toFixed(2)}跌破20日均线${last.ma.ma20.toFixed(2)}` });
    }
  }

  // Volume surge
  if (last.volume && prev.volume && last.volume > prev.volume * 2) {
    const dir = last.close > prev.close ? '放量上涨' : '放量下跌';
    results.push({ key: 'vol_surge', type: last.close > prev.close ? 'buy' : 'sell', title: dir, detail: `成交量${(last.volume/10000).toFixed(0)}万手，较前日放量${(last.volume/prev.volume).toFixed(1)}倍` });
  }

  // Strategy signals
  try {
    const strats = scanStrategies(klines);
    for (const s of strats.slice(0, 3)) {
      results.push({
        key: `strat_${s.id}`,
        type: s.type === 'buy' ? 'buy' : s.type === 'sell' ? 'sell' : 'info',
        title: `策略: ${s.name}`,
        detail: s.description.slice(0, 50),
      });
    }
  } catch {}

  return results;
}

export function SignalInbox() {
  const [messages, setMessages] = useState<Notification[]>(loadInbox);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const unread = messages.filter(m => !m.read).length;

  // Persist messages
  useEffect(() => { saveInbox(messages); }, [messages]);

  // Scan watchlist for signals
  const scanWatchlist = useCallback(async () => {
    const wlStocks = getWatchlistCodes();
    if (wlStocks.length === 0) return;

    setChecking(true);
    const lastSignals = loadLastSignals();
    const newSignals: Record<string, string[]> = {};
    const newMsgs: Notification[] = [];

    try {
      // Fetch quotes in batches of 80
      for (let i = 0; i < wlStocks.length; i += 80) {
        const batch = wlStocks.slice(i, i + 80);
        const codes = batch.map(s => s.code);
        const quotes = await fetchStockQuotes(codes);

        for (const q of quotes) {
          if (!q.price) continue;
          // Update name
          const stockEntry = wlStocks.find(s => s.code === q.code);
          if (stockEntry) stockEntry.name = q.name;

          // Try K-line for indicators (limit to avoid overload)
          try {
            const klines = await fetchEastmoneyKLine(q.code, 120);
            if (klines.length < 20) continue;
            calcAllIndicators(klines);

            const signals = detectSignals(q, klines);
            const prevKeys = lastSignals[q.code] || [];
            const currentKeys = signals.map(s => s.key);
            newSignals[q.code] = currentKeys;

            // Only notify on NEW signals
            for (const s of signals) {
              if (!prevKeys.includes(s.key)) {
                newMsgs.push({
                  id: `${q.code}_${s.key}_${Date.now()}`,
                  code: q.code,
                  name: q.name,
                  type: s.type,
                  title: s.title,
                  detail: s.detail,
                  time: new Date().toLocaleTimeString('zh-CN'),
                  read: false,
                });
              }
            }
          } catch {}
        }
      }
    } catch {}

    if (newMsgs.length > 0) {
      setMessages(prev => [...newMsgs, ...prev]);
    }
    saveLastSignals(newSignals);
    setChecking(false);
  }, []);

  // Auto-scan: every 3 minutes during trading hours
  useEffect(() => {
    const isTradeTime = () => {
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes(), d = now.getDay();
      if (d === 0 || d === 6) return false;
      const t = h * 100 + m;
      return (t >= 925 && t <= 1135) || (t >= 1255 && t <= 1505);
    };

    // Initial scan
    if (isTradeTime()) scanWatchlist();

    const interval = setInterval(() => {
      if (isTradeTime()) scanWatchlist();
    }, 180000); // 3 min

    return () => clearInterval(interval);
  }, [scanWatchlist]);

  const markAllRead = () => {
    setMessages(prev => prev.map(m => ({ ...m, read: true })));
  };

  const clearAll = () => {
    setMessages([]);
    saveInbox([]);
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Bell icon */}
      <button
        onClick={() => { setOpen(!open); if (!open) markAllRead(); }}
        title="自选股信号通知"
        style={{
          position: 'relative',
          padding: '6px 12px',
          background: open ? '#1a3a3a' : '#0d1a1a',
          border: `1px solid ${unread > 0 ? '#d4a574' : '#3a5a5a'}`,
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: '1.1rem',
          color: '#d4a574',
        }}
      >
        📬
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6,
            background: '#f56c6c', color: '#fff',
            borderRadius: '50%', width: 20, height: 20,
            fontSize: '0.65rem', fontWeight: 'bold',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0,
          width: 380, maxHeight: 480, overflowY: 'auto',
          background: '#1a2a2a', border: '1px solid #3a5a5a', borderRadius: 8,
          zIndex: 100, marginTop: 6, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px', borderBottom: '1px solid #2a3a3a',
            position: 'sticky', top: 0, background: '#1a2a2a', zIndex: 1,
          }}>
            <span style={{ color: '#d4a574', fontWeight: 'bold', fontSize: '0.9rem' }}>
              📬 自选信号通知 {unread > 0 && `(${unread}条未读)`}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={scanWatchlist} disabled={checking}
                style={{ border: 'none', background: 'none', color: '#70b8b0', cursor: 'pointer', fontSize: '0.72rem' }}>
                {checking ? '⏳' : '🔄'}
              </button>
              <button onClick={clearAll}
                style={{ border: 'none', background: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.72rem' }}>
                清空
              </button>
            </div>
          </div>

          {/* Messages */}
          {messages.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#70b8b0', fontSize: '0.85rem' }}>
              暂无信号通知
              <br />
              <span style={{ fontSize: '0.72rem', color: '#5a7a7a' }}>
                交易时段每3分钟扫描自选股，发现信号自动通知
              </span>
            </div>
          ) : (
            messages.slice(0, 30).map(msg => (
              <div key={msg.id} style={{
                padding: '10px 14px', borderBottom: '1px solid #1a2a2a',
                background: msg.read ? 'transparent' : '#0d1f1f',
                borderLeft: `3px solid ${msg.type === 'buy' ? '#f56c6c' : msg.type === 'sell' ? '#67c23a' : '#d4a574'}`,
                opacity: msg.read ? 0.7 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{
                    color: msg.type === 'buy' ? '#f56c6c' : msg.type === 'sell' ? '#67c23a' : '#d4a574',
                    fontWeight: 'bold', fontSize: '0.82rem',
                  }}>
                    {msg.type === 'buy' ? '📈' : msg.type === 'sell' ? '📉' : '📢'} {msg.title}
                  </span>
                  <span style={{ color: '#5a7a7a', fontSize: '0.65rem' }}>{msg.time}</span>
                </div>
                <div style={{ color: '#d4a574', fontSize: '0.78rem', marginBottom: 3 }}>
                  <strong>{msg.name}</strong> ({msg.code})
                </div>
                <div style={{ color: '#70b8b0', fontSize: '0.72rem' }}>{msg.detail}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
