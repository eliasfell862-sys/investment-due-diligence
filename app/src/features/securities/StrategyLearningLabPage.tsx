import { useNavigate, useParams } from 'react-router-dom';
import { useStrategyLearningLab } from './strategy-learning/useStrategyLearningLab';
import type { DailyReviewStatus, ReviewFinding } from './strategy-learning/types';

const panelStyle = {
  background: 'var(--sec-surface-2, #142421)',
  border: '1px solid var(--sec-border, #29433d)',
  borderRadius: 12,
  padding: 18,
} as const;

const mutedStyle = { color: 'var(--sec-text-secondary, #9db8b0)' } as const;

const statusLabels: Record<DailyReviewStatus, string> = {
  pending: '等待复盘',
  running: '复盘中',
  completed: '已完成',
  blocked: '数据阻断',
  failed: '复盘失败',
};

function FindingList({ items, emptyText }: { items: ReviewFinding[]; emptyText: string }) {
  if (items.length === 0) return <p style={mutedStyle}>{emptyText}</p>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map(item => (
        <div key={item.id} style={{ borderLeft: '3px solid var(--sec-accent, #55c7a5)', paddingLeft: 12 }}>
          <strong>{item.title}</strong>
          <p style={{ ...mutedStyle, margin: '5px 0 0', lineHeight: 1.6 }}>{item.description}</p>
        </div>
      ))}
    </div>
  );
}

export function StrategyLearningLabPage() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const {
    reviews, latestDecisions, patterns, candidates, approvals,
    loading, error, refresh, exportData,
  } = useStrategyLearningLab();
  const backRoute = projectId ? `/projects/${projectId}/securities` : '/securities';
  const latestReview = reviews[0];
  const improvementSuggestions = latestDecisions.flatMap(item => item.improvementSuggestions);

  const download = async () => {
    const bundle = await exportData();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `strategy-learning-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="securities-workbench-page" style={{ minHeight: '100vh', padding: 24, color: 'var(--sec-text, #eef7f4)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <button className="button" onClick={() => navigate(backRoute)}>← 返回股票主页面</button>
          <p style={{ color: 'var(--sec-accent, #55c7a5)', margin: '18px 0 6px' }}>Strategy Learning / 受控自我改进</p>
          <h1 style={{ margin: 0 }}>策略学习实验室</h1>
          <p style={mutedStyle}>每日复盘虚拟交易，每10个交易日形成候选；正式策略只有经你批准后才会升级。</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="button" onClick={() => { void refresh(); }}>刷新</button>
          <button className="button" onClick={() => { void download(); }}>导出学习数据</button>
        </div>
      </header>

      {error && <div role="alert" style={{ ...panelStyle, borderColor: '#d9534f', marginBottom: 16 }}>{error}</div>}
      {loading && <p>正在生成或加载策略学习记录…</p>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14 }}>
        <article style={panelStyle}><h2>每日复盘</h2><strong>{reviews.length}</strong><p>已保存的交易日复盘</p><small>{latestReview?.tradingDate ?? '等待收盘后首次复盘'}</small></article>
        <article style={panelStyle}><h2>问题模式</h2><strong>{patterns.length}</strong><p>跨交易日重复出现的问题</p><small>{patterns.filter(item => item.candidateEligible).length} 项可进入候选池</small></article>
        <article style={panelStyle}><h2>候选策略</h2><strong>{candidates.length}</strong><p>与正式策略隔离验证</p><small>{candidates.filter(item => item.status.includes('approval_ready')).length} 项等待审批</small></article>
        <article style={panelStyle}><h2>策略审批</h2><strong>{approvals.length}</strong><p>批准、拒绝和回滚审计</p><small>不会自动操作实际持仓</small></article>
      </section>

      {latestReview && (
        <section style={{ ...panelStyle, marginTop: 16 }} aria-labelledby="latest-review-title">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <h2 id="latest-review-title" style={{ marginBottom: 6 }}>最新交易日复盘</h2>
              <span>{latestReview.tradingDate}</span>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <strong>{statusLabels[latestReview.status]}</strong>
              <span>置信度 <strong>{Math.round(latestReview.confidence * 100)}%</strong></span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '18px 0', padding: '14px 0', borderTop: '1px solid var(--sec-border, #29433d)', borderBottom: '1px solid var(--sec-border, #29433d)' }}>
            <strong>{latestDecisions.length > 0 ? `今日虚拟交易 ${latestDecisions.length} 笔` : '今日无虚拟交易'}</strong>
            <span>今日收益 {latestReview.portfolioMetrics.returnPct.toFixed(2)}%</span>
            <span>未平仓 {latestReview.portfolioMetrics.openPositions}</span>
            <span>最大回撤 {latestReview.portfolioMetrics.maxDrawdownPct.toFixed(2)}%</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
            <article><h3>做得好的地方</h3><FindingList items={latestReview.positiveFindings} emptyText="本次未识别出明确优势。" /></article>
            <article><h3>存在的问题</h3><FindingList items={latestReview.negativeFindings} emptyText="本次未识别出明确问题。" /></article>
            <article><h3>改进建议</h3><FindingList items={improvementSuggestions} emptyText="暂无需要调整的策略建议。" /></article>
          </div>

          {latestReview.dataQuality.blockingIssues.length > 0 && (
            <div style={{ marginTop: 18, padding: 14, borderRadius: 10, background: 'rgba(217, 83, 79, 0.12)', border: '1px solid rgba(217, 83, 79, 0.55)' }}>
              <h3 style={{ marginTop: 0 }}>数据质量阻断项</h3>
              <ul style={{ marginBottom: 0 }}>
                {latestReview.dataQuality.blockingIssues.map(issue => <li key={issue}>{issue}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {!loading && !latestReview && (
        <section style={{ ...panelStyle, marginTop: 16 }}>
          <h2>尚无每日复盘</h2>
          <p style={mutedStyle}>系统会在目标交易日数据具备后自动补做；也可以点击“刷新”立即检查。</p>
        </section>
      )}

      <section style={{ ...panelStyle, marginTop: 16 }}>
        <h2>运行规则</h2>
        <p>收盘后 15:10 生成冻结快照；20 个前向交易日和至少 30 笔闭环交易后，候选才可能进入审批。</p>
      </section>
    </main>
  );
}