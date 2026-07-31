import { useState, useEffect, useMemo } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { fetchFundValuations, type FundValuation, loadPositions, addTransaction, loadTransactions } from '../../infrastructure/market-data/fund-api';

export function FundAnalysisPage() {
  const { code = '110022' } = useParams<{ code: string }>();
  const [fund, setFund] = useState<FundValuation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'trades'>('overview');

  useEffect(() => {
    setLoading(true); setError('');
    fetchFundValuations([code]).then(vals => {
      if (vals.length === 0) { setError('未找到该基金'); return; }
      setFund(vals[0]);
    }).catch(() => setError('数据加载失败')).finally(() => setLoading(false));
  }, [code]);

  if (loading) return <Shell code={code}><div style={{ color: '#8ba8a8', padding: 40, textAlign: 'center' }}>加载中...</div></Shell>;
  if (error || !fund) return <Shell code={code}><div style={{ color: '#f87171', padding: 40, textAlign: 'center' }}>{error || '数据异常'}</div></Shell>;

  return <Shell code={code} name={fund.name}>
    <h2 style={{ color: '#e0e0e0', margin: '0 0 16px' }}>{fund.name}</h2>

    {/* Stats */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, marginBottom: 16 }}>
      <SC label="单位净值" value={fund.nav.toFixed(4)} color="#e0e0e0" />
      <SC label="累计净值" value={fund.accNav.toFixed(4)} color="#e0e0e0" />
      <SC label="估算涨跌" value={`${fund.estimatedChange >= 0 ? '+' : ''}${fund.estimatedChange.toFixed(2)}%`} color={fund.estimatedChange >= 0 ? '#f56c6c' : '#67c23a'} />
      <SC label="净值日期" value={fund.navDate || '—'} color="#aaa" />
      <SC label="基金类型" value={fund.type || '—'} color="#aaa" />
    </div>

    {/* Tabs */}
    <nav style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid #2a4a4a' }}>
      {(['overview', 'trades'] as const).map(t => (
        <button key={t} onClick={() => setActiveTab(t)} style={{
          padding: '8px 20px', border: 'none', cursor: 'pointer',
          background: activeTab === t ? '#1a3a3a' : 'transparent',
          color: activeTab === t ? '#70b8b0' : '#8ba8a8',
          borderBottom: activeTab === t ? '2px solid #70b8b0' : '2px solid transparent',
        }}>{t === 'overview' ? '📊 概览与持仓' : '💰 交易记录'}</button>
      ))}
    </nav>

    {activeTab === 'overview' && <FundOverview code={code} fund={fund} />}
    {activeTab === 'trades' && <FundTrades code={code} fund={fund} />}
  </Shell>;
}

function Shell({ code, name, children }: { code: string; name?: string; children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const backUrl = projectId ? `/projects/${projectId}/securities` : '/securities';
  return (
    <div className="module-page" style={{ maxWidth: 900, margin: '0 auto' }}>
      <NavLink to={backUrl} style={{ color: '#70b8b0', fontSize: '0.85rem', display: 'inline-block', marginBottom: 16 }}>
        ← 返回证券工作台
      </NavLink>
      <h1 style={{ color: '#e0e0e0', margin: '0 0 4px' }}>{name || code} <span style={{ color: '#5a7a7a', fontSize: '0.8rem' }}>{code}</span></h1>
      {children}
    </div>
  );
}

function SC({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#0d1f1f', padding: '8px 10px', borderRadius: 6, textAlign: 'center', border: '1px solid #1a3a3a' }}>
      <div style={{ color: '#5a7a7a', fontSize: '0.65rem' }}>{label}</div>
      <div style={{ color, fontWeight: 'bold', fontSize: '0.9rem' }}>{value}</div>
    </div>
  );
}

function FundOverview({ code, fund }: { code: string; fund: FundValuation }) {
  const position = useMemo(() => loadPositions().find(p => p.code === code), [code]);
  const profit = position && fund.nav > 0 && position.costNav > 0
    ? ((fund.nav - position.costNav) / position.costNav * 100).toFixed(2) : null;

  return (
    <div>
      {position && (
        <div style={{ background: '#1a2a2a', padding: 16, borderRadius: 8, marginBottom: 16, border: '1px solid #2a4a4a' }}>
          <h3 style={{ color: '#e0e0e0', margin: '0 0 8px' }}>我的持仓</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 8 }}>
            <SC label="持有份额" value={position.shares.toFixed(2)} color="#e0e0e0" />
            <SC label="成本净值" value={position.costNav.toFixed(4)} color="#aaa" />
            <SC label="持仓成本" value={position.totalCost.toFixed(2)} color="#aaa" />
            <SC label="当前市值" value={(position.shares * fund.nav).toFixed(2)} color="#e0e0e0" />
            {profit && <SC label="持仓收益" value={`${parseFloat(profit) >= 0 ? '+' : ''}${profit}%`} color={parseFloat(profit) >= 0 ? '#f56c6c' : '#67c23a'} />}
          </div>
        </div>
      )}

      <FundTradeForm code={code} fund={fund} />
    </div>
  );
}

function FundTradeForm({ code, fund }: { code: string; fund: FundValuation }) {
  const [shares, setShares] = useState('');
  const [nav, setNav] = useState('');
  const [msg, setMsg] = useState('');

  const doTrade = (type: 'buy' | 'sell') => {
    const s = parseFloat(shares);
    const n = parseFloat(nav) || fund.nav;
    if (!s || s <= 0 || !n) return;
    addTransaction(code, type, s, n);
    setMsg(`✅ ${type === 'buy' ? '买入' : '卖出'} ${s} 份，净值 ${n.toFixed(4)}`);
    setShares(''); setNav('');
    setTimeout(() => setMsg(''), 3000);
  };

  const position = loadPositions().find(p => p.code === code);

  return (
    <div style={{ background: '#1a2a2a', padding: 16, borderRadius: 8, border: '1px solid #2a4a4a' }}>
      <h3 style={{ color: '#e0e0e0', margin: '0 0 12px' }}>交易操作</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'end' }}>
        <input value={shares} onChange={e => setShares(e.target.value)} placeholder="份额" type="number"
          style={{ width: 100, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '6px 10px', borderRadius: 4 }} />
        <input value={nav} onChange={e => setNav(e.target.value)} placeholder={`净值(空=当前${fund.nav.toFixed(4)})`}
          style={{ width: 180, background: '#0d1a1a', border: '1px solid #3a5a5a', color: '#e0e0e0', padding: '6px 10px', borderRadius: 4, fontSize: '0.8rem' }} />
        <button className="button" onClick={() => doTrade('buy')} style={{ background: '#f56c6c', color: '#fff', padding: '6px 16px' }}>买入</button>
        {position && position.shares > 0 && (
          <button className="button" onClick={() => doTrade('sell')} style={{ background: '#67c23a', color: '#fff', padding: '6px 16px' }}>卖出</button>
        )}
      </div>
      {msg && <div style={{ color: '#70b8b0', fontSize: '0.85rem' }}>{msg}</div>}
    </div>
  );
}

function FundTrades({ code, fund }: { code: string; fund: FundValuation }) {
  const txs = loadTransactions(code).reverse();
  if (txs.length === 0) return <div style={{ color: '#5a7a7a', padding: 40, textAlign: 'center' }}>暂无交易记录</div>;
  return (
    <table className="data-table">
      <thead><tr><th>日期</th><th>类型</th><th>份额</th><th>净值</th><th>金额</th></tr></thead>
      <tbody>
        {txs.map(t => (
          <tr key={t.id}>
            <td style={{ color: '#5a7a7a', fontSize: '0.8rem' }}>{t.date}</td>
            <td style={{ color: t.type === 'buy' ? '#f56c6c' : '#67c23a', fontWeight: 'bold' }}>{t.type === 'buy' ? '买入' : '卖出'}</td>
            <td style={{ color: '#e0e0e0' }}>{t.shares.toFixed(2)}</td>
            <td style={{ color: '#e0e0e0' }}>{t.nav.toFixed(4)}</td>
            <td style={{ color: '#e0e0e0' }}>{t.amount.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
