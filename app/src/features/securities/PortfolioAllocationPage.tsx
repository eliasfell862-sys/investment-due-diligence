import { useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { ActualPositionsPanel } from './ActualPositionsPanel';
import { AiPortfolioAllocationWorkspace } from './AiPortfolioAllocationWorkspace';

type PortfolioView = 'actual' | 'ai';

export function PortfolioAllocationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [activeView, setActiveView] = useState<PortfolioView>('actual');
  const backUrl = projectId ? `/projects/${projectId}/securities` : '/securities';

  return (
    <div className="module-page" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <NavLink
        to={backUrl}
        style={{ color: '#70b8b0', fontSize: '0.85rem', display: 'inline-block', marginBottom: 16 }}
      >
        ← 返回证券工作台
      </NavLink>
      <h1 style={{ color: '#d4a574', margin: '0 0 4px' }}>💰 持仓分配系统</h1>
      <p style={{ color: '#70b8b0', fontSize: '0.82rem', marginBottom: 16 }}>
        管理真实买卖持仓，或基于全部自选股生成 AI 持仓方案
      </p>

      <div
        role="tablist"
        aria-label="持仓分配视图"
        style={{ display: 'flex', gap: 8, borderBottom: '1px solid #2a4a4a', marginBottom: 18 }}
      >
        <PortfolioTab selected={activeView === 'actual'} onClick={() => setActiveView('actual')}>
          我的实际持仓
        </PortfolioTab>
        <PortfolioTab selected={activeView === 'ai'} onClick={() => setActiveView('ai')}>
          AI 持仓分配
        </PortfolioTab>
      </div>

      {activeView === 'actual'
        ? <ActualPositionsPanel projectId={projectId} />
        : <AiPortfolioAllocationWorkspace />}
    </div>
  );
}

function PortfolioTab({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick(): void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      style={{
        border: 0,
        borderBottom: selected ? '2px solid #d4a574' : '2px solid transparent',
        background: 'transparent',
        color: selected ? '#d4a574' : '#70b8b0',
        fontWeight: selected ? 700 : 500,
        padding: '10px 14px',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
