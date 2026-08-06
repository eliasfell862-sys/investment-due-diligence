import { useNavigate, useParams } from 'react-router-dom';
import { useStrategyLearningLab } from './strategy-learning/useStrategyLearningLab';

const panelStyle = {
  background: 'var(--sec-surface-2, #142421)',
  border: '1px solid var(--sec-border, #29433d)',
  borderRadius: 12,
  padding: 18,
} as const;

export function StrategyLearningLabPage() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { reviews, patterns, candidates, approvals, loading, error, refresh, exportData } = useStrategyLearningLab();
  const backRoute = projectId ? `/projects/${projectId}/securities` : '/securities';

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
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 22 }}>
        <div>
          <button className="button" onClick={() => navigate(backRoute)}>← 返回股票主页面</button>
          <p style={{ color: 'var(--sec-accent, #55c7a5)', margin: '18px 0 6px' }}>Strategy Learning / 受控自我改进</p>
          <h1 style={{ margin: 0 }}>策略学习实验室</h1>
          <p style={{ color: 'var(--sec-text-secondary, #9db8b0)' }}>每日复盘虚拟交易，每10个交易日形成候选；正式策略只有经你批准后才会升级。</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="button" onClick={() => { void refresh(); }}>刷新</button>
          <button className="button" onClick={() => { void download(); }}>导出学习数据</button>
        </div>
      </header>

      {error && <div role="alert" style={{ ...panelStyle, borderColor: '#d9534f', marginBottom: 16 }}>{error}</div>}
      {loading && <p>正在加载策略学习记录…</p>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14 }}>
        <article style={panelStyle}><h2>每日复盘</h2><strong>{reviews.length}</strong><p>已保存的交易日复盘</p><small>{reviews[0]?.tradingDate ?? '等待收盘后首次复盘'}</small></article>
        <article style={panelStyle}><h2>问题模式</h2><strong>{patterns.length}</strong><p>跨交易日重复出现的问题</p><small>{patterns.filter(item => item.candidateEligible).length} 项可进入候选池</small></article>
        <article style={panelStyle}><h2>候选策略</h2><strong>{candidates.length}</strong><p>与正式策略隔离验证</p><small>{candidates.filter(item => item.status.includes('approval_ready')).length} 项等待审批</small></article>
        <article style={panelStyle}><h2>策略审批</h2><strong>{approvals.length}</strong><p>批准、拒绝和回滚审计</p><small>不会自动操作实际持仓</small></article>
      </section>

      <section style={{ ...panelStyle, marginTop: 16 }}>
        <h2>运行规则</h2>
        <p>收盘后 15:10 生成冻结快照；20 个前向交易日和至少 30 笔闭环交易后，候选才可能进入审批。</p>
      </section>
    </main>
  );
}
