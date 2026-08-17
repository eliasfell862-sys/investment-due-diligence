import { Link, useParams } from 'react-router-dom';
import { SHADOW_LIVE_TRADING_PROFILE } from './live-trading-profile';
import { useLiveTradingShadow } from './useLiveTradingShadow';
import './LiveTradingShadowPage.css';

const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: value % 1 ? 2 : 0 })}`;

export function LiveTradingShadowPage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();
  const state = useLiveTradingShadow();
  const bridgeOnline = state.bridgeStatus.state === 'ready';

  return (
    <main className="page live-trading-shadow-page">
      <header className="live-trading-header">
        <div>
          <p className="eyebrow">Local Shadow Execution / 本地影子交易</p>
          <h1>东方财富实盘网关验证台</h1>
          <p className="live-trading-warning">影子模式不会向券商提交订单</p>
        </div>
        <Link className="button" to={`/projects/${projectId}/securities`}>返回证券工作台</Link>
      </header>

      <section className="live-trading-status-grid">
        <article className="card">
          <h2>本地桥接状态</h2>
          <strong className={bridgeOnline ? 'is-online' : 'is-offline'}>
            {bridgeOnline ? '本地交易桥在线' : '本地交易桥离线'}
          </strong>
          <p>端口 {state.bridgeStatus.port} · 令牌仅保存在 Electron 主进程</p>
          <button className="button" disabled={!bridgeOnline} onClick={() => void state.runProbe()}>运行东方财富只读探测</button>
          {state.probeReport && <p>只读探测：{state.probeReport.safeForShadow ? '可用于影子验证' : '尚未满足条件'}</p>}
        </article>

        <article className="card">
          <h2>固定风险边界</h2>
          <div className="live-trading-limits">
            <span>资金池 {money(SHADOW_LIVE_TRADING_PROFILE.capitalPool)}</span>
            <span>最大投入 {money(SHADOW_LIVE_TRADING_PROFILE.maximumInvested)}</span>
            <span>预留现金 {money(SHADOW_LIVE_TRADING_PROFILE.reservedCash)}</span>
            <span>最多持仓 {SHADOW_LIVE_TRADING_PROFILE.maximumPositions} 只</span>
            <span>单股上限 {money(SHADOW_LIVE_TRADING_PROFILE.maximumPerStock)}</span>
            <span>单笔计划损失 ≤ {money(SHADOW_LIVE_TRADING_PROFILE.maximumPlannedLoss)}</span>
            <span>每日熔断 {money(SHADOW_LIVE_TRADING_PROFILE.dailyCircuitBreaker)}</span>
          </div>
        </article>

        <article className="card">
          <h2>验证进度</h2>
          <strong>影子订单 {state.validShadowOrders} / 20</strong>
          <p>阻断失败 {state.blockingFailures} · 做 T 回补保留 {money(state.reservedTBuybackCash)}</p>
          <p className={state.qualificationPassed ? 'is-online' : 'is-offline'}>{state.qualificationPassed ? '影子验证门槛已通过（Phase 1 仍不开放实盘）' : '尚未具备实盘资格'}</p>
          {(state.missingScenarios ?? []).length > 0 && <p>缺少场景：{state.missingScenarios.join('、')}</p>}
          {!state.probeReady && <p>需要当前有效的东方财富只读探测。</p>}
        </article>
      </section>

      <section className="card live-trading-candidates">
        <div className="live-trading-section-title">
          <div><h2>当前账号自选股候选</h2><p>中线 60% + 短线 40%，正式建议买入价才允许生成影子单。</p></div>
          <button className="button" disabled={state.analyzing} onClick={() => void state.scanCandidates()}>
            {state.analyzing ? '分析中…' : '扫描当前账号自选股'}
          </button>
        </div>
        {state.error && <p role="alert">{state.error}</p>}
        <div className="live-trading-candidate-list">
          {state.candidates.map(candidate => (
            <article className="live-trading-candidate" key={candidate.code}>
              <h3>{candidate.name} ({candidate.code})</h3>
              <strong>综合评分 {candidate.combinedScore.toFixed(1)}</strong>
              <div className="live-trading-price-grid">
                <span>短线 {candidate.shortAdvice.action}</span>
                <span>中线 {candidate.mediumAdvice.action}</span>
                <span>短线区间 {candidate.shortAdvice.entryRange ? `${money(candidate.shortAdvice.entryRange.low)}–${money(candidate.shortAdvice.entryRange.high)}` : '—'}</span>
                <span>正式买入价 {money(candidate.formalTargets.buyPrice)}</span>
                <span>建议卖出价 {money(candidate.formalTargets.sellPrice)}</span>
                <span>止损价 {money(candidate.formalTargets.stopLoss)}</span>
              </div>
              <p className={candidate.dataFresh ? 'is-online' : 'is-offline'}>{candidate.dataFresh ? '数据有效' : `不可交易：${candidate.failureReasons.join('、')}`}</p>
              <button
                className="button"
                disabled={!bridgeOnline || !candidate.dataFresh || candidate.price > candidate.formalTargets.buyPrice}
                onClick={() => void state.submitCandidate(candidate)}
                aria-label={`生成影子订单 ${candidate.name}`}
              >生成影子订单</button>
            </article>
          ))}
          {state.candidates.length === 0 && <p>尚未扫描候选股。</p>}
        </div>
      </section>

      <section className="card">
        <h2>影子订单时间线</h2>
        {state.orders.length === 0 ? <p>暂无影子订单。</p> : (
          <ol>{state.orders.map(order => <li key={order.id}>{order.code} · {order.kind} · {order.status} · {order.shares} 股</li>)}</ol>
        )}
      </section>
    </main>
  );
}

export default LiveTradingShadowPage;
