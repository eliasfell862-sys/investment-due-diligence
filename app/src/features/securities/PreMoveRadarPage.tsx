import { useNavigate, useParams } from 'react-router-dom';
import { usePreMoveRadar } from './pre-move-radar/usePreMoveRadar';
import { PredictionFutureEvents } from './pre-move-radar/PredictionFutureEvents';
import type { PreMovePrediction, PreMoveStatus } from './pre-move-radar/types';
import './SecuritiesWorkbenchPage.css';

const STATUS_TEXT: Record<PreMoveStatus, string> = { layout_ready: '可布局', await_confirmation: '等待确认', avoid_layout: '暂不布局' };
const WINDOW_TEXT: Record<PreMovePrediction['expectedWindow'], string> = { '3_5': '未来 3–5 个交易日', '5_10': '未来 5–10 个交易日', '10_15': '未来 10–15 个交易日' };
const REGIME_TEXT = { strong: '偏强', sideways: '震荡', weak: '偏弱' } as const;

const panel: React.CSSProperties = { background: 'var(--sec-surface-2)', border: '1px solid var(--sec-border)', borderRadius: 10, padding: 16 };

export function PreMoveRadarPage() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const radar = usePreMoveRadar();
  const stockPath = (code: string) => projectId ? `/projects/${projectId}/securities/stock/${code}` : `/securities/stock/${code}`;

  return <section className="page securities-workbench-page" style={{ color: 'var(--sec-text)' }}>
    <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'start' }}>
      <div><p className="eyebrow">Prediction / 前瞻扫描</p><h1>启动预期雷达</h1>
        <p className="page-intro">预测未来3–15个交易日的启动可能性；成功需同时满足涨幅≥5%、跑赢沪深300≥3%、目标前回撤≤4%。</p></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="button" onClick={() => navigate(-1)} aria-label="返回上一页">← 返回</button>
        <button className="button" onClick={() => void radar.refresh()} disabled={radar.loading}>🔄 {radar.loading ? '扫描中…' : '重新扫描'}</button>
      </div>
    </header>

    {radar.error && <div role="alert" style={{ ...panel, borderColor: 'var(--sec-loss)', marginBottom: 12 }}>{radar.error}</div>}
    {radar.result && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(280px, 2fr)', gap: 12, marginBottom: 14 }}>
        <section style={panel}><h2 style={{ marginTop: 0, fontSize: '1rem' }}>市场环境：{REGIME_TEXT[radar.result.marketRegime]}</h2>
          <div style={{ color: 'var(--sec-text-muted)', fontSize: '.82rem' }}>{radar.result.formal ? '正式收盘快照' : '盘中预览'} · {new Date(radar.result.dataAsOf).toLocaleString()}</div>
          <div style={{ color: 'var(--sec-text-subtle)', fontSize: '.78rem', marginTop: 8 }}>盘中缓存15分钟；评分不是概率，概率来自历史滚动校准。</div></section>
        <section style={panel}><h2 style={{ marginTop: 0, fontSize: '1rem' }}>增强行业 Top 10</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{radar.result.industries.map(item => <span key={item.industry}
            style={{ background: 'var(--sec-selected)', color: 'var(--sec-accent)', padding: '5px 9px', borderRadius: 999, fontSize: '.8rem' }}>
            {item.rank}. {item.industry} · {item.stage}</span>)}</div></section>
      </div>
      {radar.result.errors.length > 0 && <div role="status" style={{ ...panel, marginBottom: 12, color: 'var(--sec-warning)' }}>
        部分数据源不可用，结果已降级：{radar.result.errors.map(item => item.code ? `${item.code} ${item.message}` : item.message).join('；')}
      </div>}
    </>}

    <nav aria-label="雷达候选范围" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      {([['all', '全部候选'], ['watchlist', '我的自选股'], ['rotation', '板块轮动候选']] as const).map(([value, label]) =>
        <button key={value} className="button" aria-pressed={radar.filter === value} onClick={() => radar.setFilter(value)}>{label}</button>)}
    </nav>

    {radar.loading && !radar.result ? <div role="status" style={panel}>正在扫描自选股与板块轮动候选…</div> :
      <div style={{ display: 'grid', gap: 12 }}>{radar.visiblePredictions.map((item, idx) => <article key={item.code} style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <button className="button" onClick={() => navigate(stockPath(item.code))} aria-label={`查看 ${item.name} ${item.code}`}
            style={{ fontSize: '1rem', fontWeight: 700 }}>{item.name} · {item.code}</button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <strong style={{ color: item.status === 'layout_ready' ? 'var(--sec-gain)' : item.status === 'avoid_layout' ? 'var(--sec-loss)' : 'var(--sec-warning)' }}>{STATUS_TEXT[item.status]}</strong>
            {!item.formalProbability && <span style={{ color: 'var(--sec-warning)', fontSize: '.78rem' }}>样本校准中</span>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8, margin: '12px 0' }}>
          <strong>启动预期 {item.probability}%</strong><span>置信度 {item.confidence}%</span><span>信号强度 {item.signalScore}/100</span>
          <span>相似样本 {item.similarSampleSize}</span><span>{WINDOW_TEXT[item.expectedWindow]}</span><span>现价 {item.currentPrice.toFixed(2)}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, fontSize: '.78rem', color: 'var(--sec-text-muted)' }}>
          <span>板块 {item.scores.industryRotation}/30</span><span>资金 {item.scores.capitalFlow}/25</span><span>蓄势 {item.scores.accumulation}/25</span>
          <span>相强 {item.scores.relativeStrength}/10</span><span>空间 {item.scores.upsideRoom}/10</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 12, fontSize: '.82rem' }}>
          <div><b>正向依据</b>{item.positiveEvidence.length ? item.positiveEvidence.map(text => <div key={text}>{text}</div>) : <div>暂无充分正向依据</div>}</div>
          <div><b>主要风险</b>{item.risks.length ? item.risks.map(text => <div key={text}>{text}</div>) : <div>未发现额外风险</div>}</div>
          <div><b>失效条件</b>{item.invalidationConditions.map(text => <div key={text}>{text}</div>)}</div>
        </div>
        {/* Top 8 预测拉取未来事件（事件催化验证），有事件才显示 */}
        {idx < 8 && <PredictionFutureEvents code={item.code} />}
      </article>)}</div>}
  </section>;
}